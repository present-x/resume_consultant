from abc import ABC, abstractmethod
from typing import AsyncIterator


class LLMProviderBase(ABC):
    """Base class for LLM providers with streaming support."""
    
    def __init__(self, api_key: str, model: str, base_url: str = None):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url
    
    @abstractmethod
    async def chat_stream(
        self, 
        messages: list[dict],
        temperature: float = 0.7
    ) -> AsyncIterator[str]:
        """Stream chat completions."""
        pass
    
    @abstractmethod
    async def chat(
        self, 
        messages: list[dict],
        temperature: float = 0.7
    ) -> str:
        """Non-streaming chat completion."""
        pass
