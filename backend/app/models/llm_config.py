from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.sql import func
from app.core.database import Base


class LLMProvider:
    """Supported LLM providers"""
    DEEPSEEK = "deepseek"
    KIMI = "kimi"
    GEMINI = "gemini"
    
    @classmethod
    def all(cls):
        return [cls.DEEPSEEK, cls.KIMI, cls.GEMINI]
    
    @classmethod
    def info(cls):
        return {
            cls.DEEPSEEK: {
                "name": "DeepSeek",
                "icon": "deepseek",
                "default_model": "deepseek-chat",
                "base_url": "https://api.deepseek.com/v1"
            },
            cls.KIMI: {
                "name": "Kimi (Moonshot)",
                "icon": "kimi",
                "default_model": "moonshot-v1-8k",
                "base_url": "https://api.moonshot.cn/v1"
            },
            cls.GEMINI: {
                "name": "Google Gemini",
                "icon": "gemini",
                "default_model": "gemini-2.0-flash",
                "base_url": None  # Uses Google SDK
            }
        }


class LLMConfig(Base):
    __tablename__ = "llm_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    provider = Column(String(50), nullable=False)  # deepseek, kimi, gemini
    name = Column(String(100), nullable=False)  # User-defined name
    api_key = Column(String(255), nullable=False)
    model_name = Column(String(100), nullable=False)
    base_url = Column(String(255), nullable=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
