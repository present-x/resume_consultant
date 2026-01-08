from app.api.auth import router as auth_router
from app.api.llm import router as llm_router
from app.api.chat import router as chat_router
from app.api.resume import router as resume_router

__all__ = ["auth_router", "llm_router", "chat_router", "resume_router"]
