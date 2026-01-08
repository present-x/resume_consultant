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
from typing import Optional
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


router = APIRouter(prefix="/chat", tags=["Chat"])

STOP_MARKER = "[STOPPED]"
MAX_CONCURRENT_ANALYSIS = 3


@dataclass
class _AnalysisRuntime:
    user_id: int
    conversation_id: int
    started_at: float
    task: asyncio.Task
    listeners: set[asyncio.Queue] = field(default_factory=set)
    status: str = "running"


_runtime_lock = asyncio.Lock()
_runtimes: dict[int, _AnalysisRuntime] = {}


async def _broadcast_event(conversation_id: int, event: dict) -> None:
    async with _runtime_lock:
        runtime = _runtimes.get(conversation_id)
        if not runtime:
            return
        listeners = list(runtime.listeners)
    for q in listeners:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            continue


async def _cleanup_runtime(conversation_id: int) -> None:
    async with _runtime_lock:
        runtime = _runtimes.get(conversation_id)
        if not runtime:
            return
        if runtime.status == "running":
            return
        if runtime.listeners:
            return
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
    current_step_content: dict[int, str] = {}

    try:
        executor = WorkflowExecutor(llm_provider)
        async with async_session() as db:
            async for event in executor.execute_all_stream(
                resume_text=resume_text,
                job_description=job_description if job_description else None,
            ):
                if event.get("type") == "content" and "step" in event:
                    step = event["step"]
                    current_step_content[step] = current_step_content.get(step, "") + event.get("content", "")
                elif event.get("type") == "step_end" and "step" in event:
                    step = event["step"]
                    if step in current_step_content:
                        db.add(
                            Message(
                                conversation_id=conversation_id,
                                role="assistant",
                                content=current_step_content[step],
                                step=step,
                            )
                        )
                        await db.commit()
                elif event.get("type") == "complete":
                    async with _runtime_lock:
                        runtime = _runtimes.get(conversation_id)
                        if runtime:
                            runtime.status = "completed"

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
    """Extract text from PDF file."""
    reader = PdfReader(io.BytesIO(file_content))
    text_parts = []
    for page in reader.pages:
        text_parts.append(page.extract_text() or "")
    return "\n".join(text_parts)


def extract_text_from_docx(file_content: bytes) -> str:
    """Extract text from DOCX file."""
    doc = DocxDocument(io.BytesIO(file_content))
    text_parts = []
    for para in doc.paragraphs:
        text_parts.append(para.text)
    return "\n".join(text_parts)


def extract_text_from_file(filename: str, content: bytes) -> str:
    """Extract text based on file extension."""
    ext = filename.lower().split(".")[-1] if "." in filename else ""
    
    if ext == "pdf":
        return extract_text_from_pdf(content)
    elif ext in ["docx", "doc"]:
        return extract_text_from_docx(content)
    elif ext in ["txt", "md"]:
        return content.decode("utf-8")
    else:
        # Try to decode as text
        try:
            return content.decode("utf-8")
        except:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format: {ext}"
            )


import os
import shutil
import uuid

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
    """
    Analyze a resume using the 5-step workflow.
    Returns a streaming response with step markers and content.
    """
    
    # Get default LLM config
    result = await db.execute(
        select(LLMConfig).where(
            LLMConfig.user_id == current_user.id,
            LLMConfig.is_default == True
        )
    )
    llm_config = result.scalar_one_or_none()
    
    if not llm_config:
        # Try to get any config
        result = await db.execute(
            select(LLMConfig).where(LLMConfig.user_id == current_user.id).limit(1)
        )
        llm_config = result.scalar_one_or_none()
    
    if not llm_config:
        raise HTTPException(
            status_code=400,
            detail="No LLM configuration found. Please configure an LLM provider first."
        )
    
    resume_text = ""
    resume_filename = ""
    file_path: Optional[str] = None
    
    # CASE 1: New File Uploaded
    if resume:
        # Validate and save file
        allowed_extensions = {".pdf", ".docx", ".doc", ".txt", ".md"}
        ext = os.path.splitext(resume.filename)[1].lower()
        if ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}"
            )
        
        content = await resume.read()
        
        # Extract text first to ensure it's valid
        try:
            resume_text = extract_text_from_file(resume.filename, content)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to extract text: {str(e)}")
            
        if not resume_text.strip():
            raise HTTPException(status_code=400, detail="Could not extract text from resume file")
            
        # Save to disk
        safe_filename = f"{uuid.uuid4()}{ext}"
        file_path = os.path.join(UPLOAD_DIR, safe_filename)
        
        try:
            with open(file_path, "wb") as buffer:
                buffer.write(content)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
            
        result = await db.execute(select(ResumeFile).where(ResumeFile.user_id == current_user.id))
        existing = result.scalars().all()
        if len(existing) >= 5:
            result = await db.execute(
                select(ResumeFile)
                .where(ResumeFile.user_id == current_user.id)
                .order_by(ResumeFile.created_at.asc(), ResumeFile.id.asc())
                .limit(1)
            )
            oldest = result.scalar_one_or_none()
            if oldest and oldest.file_path and os.path.exists(oldest.file_path):
                try:
                    os.remove(oldest.file_path)
                except:
                    pass
            if oldest:
                await db.delete(oldest)
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

    # CASE 2: No Upload, Use Existing
    else:
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
        
        # Read file
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            resume_text = extract_text_from_file(resume_filename, content)
        except Exception as e:
             raise HTTPException(status_code=500, detail=f"Failed to read stored resume: {str(e)}")

    if not resume_text.strip():
         raise HTTPException(status_code=400, detail="Extracted resume text is empty.")

    # Create conversation record
    conversation = Conversation(
        user_id=current_user.id,
        title=f"简历分析 - {resume_filename}",
        resume_text=resume_text,
        job_description=job_description if job_description else None
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)

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

    queue: asyncio.Queue = asyncio.Queue(maxsize=256)

    async with _runtime_lock:
        running = [r for r in _runtimes.values() if r.user_id == current_user.id and r.status == "running"]
        if len(running) >= MAX_CONCURRENT_ANALYSIS:
            oldest = sorted(running, key=lambda r: r.started_at)[0]
            oldest.task.cancel()

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


@router.get("/history")
async def get_chat_history(
    limit: int = 10,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's conversation history."""
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
    """Delete a conversation and its messages."""
    # Verify ownership
    stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    )
    result = await db.execute(stmt)
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Delete (Cascading delete handles messages usually, but let's be safe if no cascade configured)
    # SQLAlchemy relationship cascade="all, delete" should be set on User model or we delete manually.
    # Given we didn't define relationship explicitly in models shown, we delete messages first.
    
    # Delete messages
    from sqlalchemy import delete
    await db.execute(
        delete(Message).where(Message.conversation_id == conversation_id)
    )
    
    # Delete conversation
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
    """Get full conversation details including messages."""
    # Get conversation
    stmt = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id
    )
    result = await db.execute(stmt)
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    # Get messages
    stmt = select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at.asc())
    result = await db.execute(stmt)
    messages = result.scalars().all()
    
    # Authenticated URL for resume not needed if we just use stored resume from user?
    # But conversation snapshot might be different from current user resume.
    
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
