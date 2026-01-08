from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # App
    APP_NAME: str = "Resume Consultant"
    DEBUG: bool = False
    SECRET_KEY: str = "your-secret-key-change-in-production"
    
    # Database (defaults to SQLite for easy local dev, use PostgreSQL in production)
    DATABASE_URL: str = "sqlite+aiosqlite:///./resume_consultant.db"
    
    # JWT
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Test Account
    TEST_USER_EMAIL: str = "test@resume.ai"
    TEST_USER_PASSWORD: str = "test123"
    
    # CORS (add all localhost variations for dev)
    CORS_ORIGINS: list[str] = [
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]
    
    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
