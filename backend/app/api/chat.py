import io
import json
import asyncio
import time
from dataclasses import dataclass, field
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, desc, delete
from pydantic import BaseModel
from typing import Optional, Set, List, Dict
from PyPDF2 import PdfReader
from docx import Document as DocxDocument
from app.core.database import get_db, async_session
from app.core.auth import get_current_user
from app.models.user import User
from app.models.resume_file import ResumeFile
from app.models.llm_config import LLMConfig
from app.models.conversation import Conversation, Message
from app.services.llm import create_llm_provider
from app.services.workflow import WorkflowExecutor
import os
import shutil
import uuid

router = APIRouter(prefix="/chat", tags=["Chat"])

STOP_MARKER = "[STOPPED]"
MAX_CONCURRENT_ANALYSIS = 1


@dataclass
class _AnalysisRuntime:
    user_id: int
    conversation_id: int
    started_at: float
    task: asyncio.Task
    listeners: Set[asyncio.Queue] = field(default_factory=set)
    status: str = "running"
    
    # State tracking for reconnection
    current_step: Optional[int] = None
    current_content: str = ""


_runtime_lock = asyncio.Lock()
_runtimes: Dict[int, _AnalysisRuntime] = {}


async def _broadcast_event(conversation_id: int, event: dict) -> None:
    async with _runtime_lock:
        runtime = _runtimes.get(conversation_id)
        if not runtime:
            return
        listeners = list(runtime.listeners)
    
    for q in listeners:
        try:
            # Wait up to 5 seconds to put event in queue
            await asyncio.wait_for(q.put(event), timeout=5.0)
        except (asyncio.QueueFull, asyncio.TimeoutError):
            print(f"Warning: Dropped event for conversation {conversation_id} due to full queue/timeout")
            continue


async def _cleanup_runtime(conversation_id: int) -> None:
    async with _runtime_lock:
        runtime = _runtimes.get(conversation_id)
        if not runtime:
            return
        # Only clean up if task is NOT running AND no listeners attached
        # OR if task is completed/stopped/error
        if runtime.status == "running" and runtime.listeners:
            return
            
        if runtime.status == "running":
            # Still running but no listeners? Keep it running!
            # The task itself will clean up when it finishes.
            return
            
        # If we are here, status is NOT running (completed/stopped/error)
        # We can remove if no listeners are waiting for final events?
        # Ideally we keep it for a bit so reconnecting clients can see "completed" status.
        # But for now, if no listeners, we remove.
        if not runtime.listeners:
             _runtimes.pop(conversation_id, None)


async def _ensure_stop_marker(db: AsyncSession, conversation_id: int) -> None:
    result = await db.execute(
        select(Message.id)
        .where(Message.conversation_id == conversation_id, Message.role == "system", Message.content == STOP_MARKER)
        .limit(1)
    )
    existing_id = result.scalar_one_or_none()
    if existing_id is None:
        db.add(
            Message(
                conversation_id=conversation_id,
                role="system",
                content=STOP_MARKER,
                step=None,
            )
        )
        await db.commit()


async def _run_workflow_background(
    user_id: int,
    conversation_id: int,
    resume_text: str,
    job_description: Optional[str],
    llm_provider,
) -> None:
    try:
        executor = WorkflowExecutor(llm_provider)
        async with async_session() as db:
            async for event in executor.execute_all_stream(
                resume_text=resume_text,
                job_description=job_description if job_description else None,
            ):
                # Update runtime state
                async with _runtime_lock:
                    runtime = _runtimes.get(conversation_id)
                    if runtime:
                        if event.get("type") == "step_start":
                            runtime.current_step = event.get("step")
                            runtime.current_content = ""
                        elif event.get("type") == "content" and "step" in event:
                            content = event.get("content", "")
                            runtime.current_content += content
                        elif event.get("type") == "complete":
                            runtime.status = "completed"

                if event.get("type") == "content" and "step" in event:
                    pass # Handled above
                elif event.get("type") == "step_end" and "step" in event:
                    step = event["step"]
                    # In step_end, we persist to DB
                    # We can also get the full content from runtime if we want, or rely on event
                    # The executor usually sends full content or we accumulated it.
                    # Let's assume event["content"] has the full step content if available,
                    # or we use what we accumulated.
                    # Usually executor sends 'content' in step_end if configured, or we trust our accumulation.
                    # But to be safe and consistent with previous logic:
                    
                    final_content = event.get("content")
                    if not final_content and runtime:
                        final_content = runtime.current_content
                        event["content"] = final_content # Ensure event has it for listeners
                    
                    if final_content:
                        db.add(
                            Message(
                                conversation_id=conversation_id,
                                role="assistant",
                                content=final_content,
                                step=step,
                            )
                        )
                        await db.commit()
                        
                await _broadcast_event(conversation_id, event)
                
    except asyncio.CancelledError:
        async with async_session() as db:
            await _ensure_stop_marker(db, conversation_id)
        async with _runtime_lock:
            runtime = _runtimes.get(conversation_id)
            if runtime:
                runtime.status = "stopped"
        await _broadcast_event(conversation_id, {"type": "stopped"})
    except Exception as e:
        async with _runtime_lock:
            runtime = _runtimes.get(conversation_id)
            if runtime:
                runtime.status = "error"
        await _broadcast_event(conversation_id, {"type": "error", "message": str(e)})
    finally:
        await _cleanup_runtime(conversation_id)


class AnalyzeRequest(BaseModel):
    job_description: Optional[str] = None


def extract_text_from_pdf(file_content: bytes) -> str:
    reader = PdfReader(io.BytesIO(file_content))
    text_parts = []
    for page in reader.pages:
        text_parts.append(page.extract_text() or "")
    return "\n".join(text_parts)


def extract_text_from_docx(file_content: bytes) -> str:
    doc = DocxDocument(io.BytesIO(file_content))
    text_parts = []
    for para in doc.paragraphs:
        text_parts.append(para.text)
    return "\n".join(text_parts)


def extract_text_from_file(filename: str, content: bytes) -> str:
    ext = filename.lower().split(".")[-1] if "." in filename else ""
    if ext == "pdf":
        return extract_text_from_pdf(content)
    elif ext in ["docx", "doc"]:
        return extract_text_from_docx(content)
    elif ext in ["txt", "md"]:
        return content.decode("utf-8")
    else:
        try:
            return content.decode("utf-8")
        except:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format: {ext}"
            )


UPLOAD_DIR = "data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/analyze")
async def analyze_resume(
    resume: Optional[UploadFile] = File(None),
    job_description: str = Form(default=""),
    resume_id: Optional[int] = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # LLM Config Check
    result = await db.execute(
        select(LLMConfig).where(
            LLMConfig.user_id == current_user.id,
            LLMConfig.is_default == True
        )
    )
    llm_config = result.scalar_one_or_none()
    if not llm_config:
        result = await db.execute(
            select(LLMConfig).where(LLMConfig.user_id == current_user.id).limit(1)
        )
        llm_config = result.scalar_one_or_none()
    if not llm_config:
        raise HTTPException(
            status_code=400,
            detail="尚未配置 LLM 服务，请先前往设置页面完成配置后再使用。"
        )
    
    resume_text = ""
    resume_filename = ""
    file_path: Optional[str] = None
    
    # Handle Resume File/ID
    if resume:
        # New upload logic
        allowed_extensions = {".pdf", ".docx", ".doc", ".txt", ".md"}
        ext = os.path.splitext(resume.filename)[1].lower()
        if ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}"
            )
        content = await resume.read()
        try:
            resume_text = extract_text_from_file(resume.filename, content)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to extract text: {str(e)}")
        if not resume_text.strip():
            raise HTTPException(status_code=400, detail="Could not extract text from resume file")
            
        safe_filename = f"{uuid.uuid4()}{ext}"
        file_path = os.path.join(UPLOAD_DIR, safe_filename)
        try:
            with open(file_path, "wb") as buffer:
                buffer.write(content)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
            
        # Manage file limits
        result = await db.execute(select(ResumeFile).where(ResumeFile.user_id == current_user.id))
        existing = result.scalars().all()
        if len(existing) >= 5:
            result = await db.execute(
                select(ResumeFile)
                .where(ResumeFile.user_id == current_user.id)
                .order_by(ResumeFile.created_at.asc(), ResumeFile.id.asc())
                .limit(1)
            )
            oldest_file = result.scalar_one_or_none()
            if oldest_file and oldest_file.file_path and os.path.exists(oldest_file.file_path):
                try:
                    os.remove(oldest_file.file_path)
                except:
                    pass
            if oldest_file:
                await db.delete(oldest_file)
                await db.commit()

        await db.execute(update(ResumeFile).where(ResumeFile.user_id == current_user.id).values(is_active=False))
        resume_record = ResumeFile(
            user_id=current_user.id,
            original_filename=resume.filename,
            file_path=file_path,
            is_active=True,
        )
        db.add(resume_record)
        await db.commit()
        await db.refresh(resume_record)
        resume_filename = resume.filename

    else:
        # Use existing
        resume_record: Optional[ResumeFile] = None
        if resume_id is not None:
            result = await db.execute(
                select(ResumeFile).where(ResumeFile.user_id == current_user.id, ResumeFile.id == resume_id).limit(1)
            )
            resume_record = result.scalar_one_or_none()
        else:
            result = await db.execute(
                select(ResumeFile)
                .where(ResumeFile.user_id == current_user.id, ResumeFile.is_active == True)
                .order_by(desc(ResumeFile.created_at), desc(ResumeFile.id))
                .limit(1)
            )
            resume_record = result.scalar_one_or_none()

        if resume_record and resume_record.file_path and os.path.exists(resume_record.file_path):
            file_path = resume_record.file_path
            resume_filename = resume_record.original_filename
        elif current_user.resume_path and current_user.resume_filename and os.path.exists(current_user.resume_path):
            file_path = current_user.resume_path
            resume_filename = current_user.resume_filename
        else:
            raise HTTPException(status_code=400, detail="No resume uploaded. Please upload a resume first.")
        
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            resume_text = extract_text_from_file(resume_filename, content)
        except Exception as e:
             raise HTTPException(status_code=500, detail=f"Failed to read stored resume: {str(e)}")

    if not resume_text.strip():
         raise HTTPException(status_code=400, detail="Extracted resume text is empty.")

    # Create conversation
    conversation = Conversation(
        user_id=current_user.id,
        title=f"简历分析 - {resume_filename}",
        resume_text=resume_text,
        job_description=job_description if job_description else None
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)

    # Clean old conversations
    keep = 10
    result = await db.execute(
        select(Conversation.id)
        .where(Conversation.user_id == current_user.id)
        .order_by(desc(Conversation.created_at), desc(Conversation.id))
        .offset(keep)
    )
    to_delete_ids = [row[0] for row in result.all()]
    if to_delete_ids:
        await db.execute(delete(Message).where(Message.conversation_id.in_(to_delete_ids)))
        await db.execute(delete(Conversation).where(Conversation.id.in_(to_delete_ids)))
        await db.commit()
    
    llm_provider = create_llm_provider(llm_config)
    queue: asyncio.Queue = asyncio.Queue(maxsize=2000)

    # Concurrency Management
    async with _runtime_lock:
        running = [r for r in _runtimes.values() if r.user_id == current_user.id]
        limit = MAX_CONCURRENT_ANALYSIS
        
        while len(running) >= limit:
            oldest = sorted(running, key=lambda r: r.started_at)[0]
            print(f"Enforcing concurrency limit: Stopping task {oldest.conversation_id}")
            for q in oldest.listeners:
                try:
                    q.put_nowait({"type": "stopped"})
                except asyncio.QueueFull:
                    pass
            try:
                oldest.task.cancel()
            except Exception as e:
                print(f"Error cancelling task {oldest.conversation_id}: {e}")
            _runtimes.pop(oldest.conversation_id, None)
            running = [r for r in _runtimes.values() if r.user_id == current_user.id]

        task = asyncio.create_task(
            _run_workflow_background(
                user_id=current_user.id,
                conversation_id=conversation.id,
                resume_text=resume_text,
                job_description=job_description if job_description else None,
                llm_provider=llm_provider,
            )
        )
        _runtimes[conversation.id] = _AnalysisRuntime(
            user_id=current_user.id,
            conversation_id=conversation.id,
            started_at=time.time(),
            task=task,
        )
        _runtimes[conversation.id].listeners.add(queue)

    async def generate_stream():
        try:
            yield f"data: {json.dumps({'type': 'conversation_start', 'conversation_id': conversation.id, 'title': conversation.title, 'created_at': conversation.created_at.isoformat() if conversation.created_at else None}, ensure_ascii=False)}\n\n"
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in {"complete", "stopped", "error"}:
                    break
        finally:
            async with _runtime_lock:
                runtime = _runtimes.get(conversation.id)
                if runtime:
                    runtime.listeners.discard(queue)
            await _cleanup_runtime(conversation.id)
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/stream/{conversation_id}")
async def stream_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
):
    """Reconnect to an existing analysis stream."""
    async with _runtime_lock:
        runtime = _runtimes.get(conversation_id)
        if not runtime or runtime.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Conversation stream not active")
        
        queue = asyncio.Queue(maxsize=2000)
        runtime.listeners.add(queue)
        
        # Capture state for replay
        replay_step = runtime.current_step
        replay_content = runtime.current_content

    async def generate_stream():
        try:
            # Send initial ping
            yield f"data: {json.dumps({'type': 'ping'}, ensure_ascii=False)}\n\n"
            
            # Replay current state
            if replay_step:
                # 1. Notify step start
                yield f"data: {json.dumps({'type': 'step_start', 'step': replay_step}, ensure_ascii=False)}\n\n"
                # 2. Send accumulated content
                if replay_content:
                    yield f"data: {json.dumps({'type': 'content', 'step': replay_step, 'content': replay_content}, ensure_ascii=False)}\n\n"
            
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in {"complete", "stopped", "error"}:
                    break
        finally:
            async with _runtime_lock:
                runtime = _runtimes.get(conversation_id)
                if runtime:
                    runtime.listeners.discard(queue)
            await _cleanup_runtime(conversation_id)

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/history")
async def get_chat_history(
    limit: int = 10,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    limit = min(limit, 10)
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == current_user.id)
        .order_by(Conversation.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    conversations = result.scalars().all()

    ids = [c.id for c in conversations]
    completed_ids: set[int] = set()
    stopped_ids: set[int] = set()
    if ids:
        result = await db.execute(
            select(Message.conversation_id)
            .where(Message.conversation_id.in_(ids), Message.role == "assistant", Message.step == 5)
            .distinct()
        )
        completed_ids = {row[0] for row in result.all()}
        result = await db.execute(
            select(Message.conversation_id)
            .where(Message.conversation_id.in_(ids), Message.role == "system", Message.content == STOP_MARKER)
            .distinct()
        )
        stopped_ids = {row[0] for row in result.all()}

    return [
        {
            "id": c.id,
            "title": c.title,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "status": "completed" if c.id in completed_ids else ("stopped" if c.id in stopped_ids else "in_progress"),
        }
        for c in conversations
    ]

@router.post("/conversation/{conversation_id}/stop")
async def stop_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    )
    result = await db.execute(stmt)
    conversation = result.scalar_one_or_none()

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    result = await db.execute(
        select(Message.id)
        .where(Message.conversation_id == conversation_id, Message.role == "assistant", Message.step == 5)
        .limit(1)
    )
    completed_id = result.scalar_one_or_none()
    if completed_id is not None:
        return {"status": "already_completed"}

    async with _runtime_lock:
        runtime = _runtimes.get(conversation_id)
        if runtime and runtime.user_id == current_user.id and runtime.status == "running":
            runtime.task.cancel()

    await _ensure_stop_marker(db, conversation_id)

    return {"status": "success"}


@router.delete("/conversation/{conversation_id}")
async def delete_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    )
    result = await db.execute(stmt)
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    await db.execute(
        delete(Message).where(Message.conversation_id == conversation_id)
    )
    await db.execute(
        delete(Conversation).where(Conversation.id == conversation_id)
    )
    
    await db.commit()
    return {"status": "success"}


@router.get("/conversation/{conversation_id}")
async def get_conversation(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    )
    result = await db.execute(stmt)
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    stmt = select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at.asc())
    result = await db.execute(stmt)
    messages = result.scalars().all()
    
    return {
        "id": conversation.id,
        "title": conversation.title,
        "resume_text": conversation.resume_text,
        "job_description": conversation.job_description,
        "created_at": conversation.created_at,
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                "step": m.step,
                "created_at": m.created_at
            }
            for m in messages
        ]
    }
