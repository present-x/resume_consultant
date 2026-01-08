from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, desc
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.resume_file import ResumeFile
import shutil
import os
import uuid

router = APIRouter(prefix="/resume", tags=["Resume"])

UPLOAD_DIR = "data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

async def _migrate_legacy_resume_if_needed(current_user: User, db: AsyncSession) -> None:
    result = await db.execute(select(ResumeFile).where(ResumeFile.user_id == current_user.id).limit(1))
    any_resume = result.scalar_one_or_none()
    if any_resume:
        return
    if not current_user.resume_path or not current_user.resume_filename:
        return
    if not os.path.exists(current_user.resume_path):
        return

    resume = ResumeFile(
        user_id=current_user.id,
        original_filename=current_user.resume_filename,
        file_path=current_user.resume_path,
        is_active=True,
    )
    db.add(resume)
    await db.commit()


def _media_type_for_path(path: str) -> str:
    if path.endswith(".pdf"):
        return "application/pdf"
    if path.endswith(".txt"):
        return "text/plain"
    if path.endswith(".md"):
        return "text/markdown"
    return "application/octet-stream"


@router.get("/list")
async def list_resumes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _migrate_legacy_resume_if_needed(current_user, db)
    result = await db.execute(
        select(ResumeFile)
        .where(ResumeFile.user_id == current_user.id)
        .order_by(desc(ResumeFile.created_at), desc(ResumeFile.id))
    )
    resumes = result.scalars().all()
    return [
        {
            "id": r.id,
            "filename": r.original_filename,
            "uploaded_at": r.created_at.isoformat() if r.created_at else None,
            "is_active": r.is_active,
        }
        for r in resumes
    ]


@router.get("")
async def get_resume_info(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _migrate_legacy_resume_if_needed(current_user, db)
    result = await db.execute(
        select(ResumeFile)
        .where(ResumeFile.user_id == current_user.id, ResumeFile.is_active == True)
        .limit(1)
    )
    resume = result.scalar_one_or_none()
    if not resume:
        return None
    return {
        "id": resume.id,
        "filename": resume.original_filename,
        "has_resume": True,
        "uploaded_at": resume.created_at.isoformat() if resume.created_at else None,
    }


@router.post("")
async def upload_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    allowed_extensions = {".pdf", ".docx", ".doc", ".txt", ".md"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}")

    await _migrate_legacy_resume_if_needed(current_user, db)

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
        if not oldest:
            raise HTTPException(status_code=500, detail="Failed to manage resume limit")
        if oldest.file_path and os.path.exists(oldest.file_path):
            try:
                os.remove(oldest.file_path)
            except:
                pass
        await db.delete(oldest)
        await db.commit()

    safe_filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, safe_filename)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    await db.execute(update(ResumeFile).where(ResumeFile.user_id == current_user.id).values(is_active=False))

    resume = ResumeFile(
        user_id=current_user.id,
        original_filename=file.filename,
        file_path=file_path,
        is_active=True,
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)

    return {
        "id": resume.id,
        "filename": resume.original_filename,
        "uploaded_at": resume.created_at.isoformat() if resume.created_at else None,
        "is_active": resume.is_active,
    }


@router.put("/{resume_id}/active")
async def set_active_resume(
    resume_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ResumeFile).where(ResumeFile.id == resume_id, ResumeFile.user_id == current_user.id).limit(1)
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    await db.execute(update(ResumeFile).where(ResumeFile.user_id == current_user.id).values(is_active=False))
    resume.is_active = True
    await db.commit()

    return {"ok": True}


@router.delete("/{resume_id}")
async def delete_resume(
    resume_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ResumeFile).where(ResumeFile.id == resume_id, ResumeFile.user_id == current_user.id).limit(1)
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    was_active = resume.is_active
    if resume.file_path and os.path.exists(resume.file_path):
        try:
            os.remove(resume.file_path)
        except:
            pass
    await db.delete(resume)
    await db.commit()

    if was_active:
        result = await db.execute(
            select(ResumeFile)
            .where(ResumeFile.user_id == current_user.id)
            .order_by(desc(ResumeFile.created_at), desc(ResumeFile.id))
            .limit(1)
        )
        newest = result.scalar_one_or_none()
        if newest:
            newest.is_active = True
            await db.commit()

    return {"ok": True}


@router.get("/{resume_id}/preview")
async def preview_resume_by_id(
    resume_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ResumeFile).where(ResumeFile.id == resume_id, ResumeFile.user_id == current_user.id).limit(1)
    )
    resume = result.scalar_one_or_none()
    if not resume or not resume.file_path or not os.path.exists(resume.file_path):
        raise HTTPException(status_code=404, detail="No resume found")

    return FileResponse(resume.file_path, media_type=_media_type_for_path(resume.file_path), filename=resume.original_filename)


@router.get("/preview")
async def preview_resume(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _migrate_legacy_resume_if_needed(current_user, db)
    result = await db.execute(
        select(ResumeFile)
        .where(ResumeFile.user_id == current_user.id, ResumeFile.is_active == True)
        .order_by(desc(ResumeFile.created_at), desc(ResumeFile.id))
        .limit(1)
    )
    resume = result.scalar_one_or_none()
    if not resume or not resume.file_path or not os.path.exists(resume.file_path):
        raise HTTPException(status_code=404, detail="No resume found")

    return FileResponse(resume.file_path, media_type=_media_type_for_path(resume.file_path), filename=resume.original_filename)
