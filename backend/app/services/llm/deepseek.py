from typing import AsyncIterator
from openai import AsyncOpenAI
from app.services.llm.base import LLMProviderBase


class DeepSeekProvider(LLMProviderBase):
    """DeepSeek API provider using OpenAI-compatible interface."""
    
    def __init__(self, api_key: str, model: str = "deepseek-chat", base_url: str = None):
        super().__init__(api_key, model, base_url or "https://api.deepseek.com/v1")
        self.client = AsyncOpenAI(api_key=api_key, base_url=self.base_url)
    
    async def chat_stream(
        self, 
        messages: list[dict],
        temperature: float = 0.7
    ) -> AsyncIterator[str]:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            stream=True
        )
        
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    
    async def chat(
        self, 
        messages: list[dict],
        temperature: float = 0.7
    ) -> str:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature
        )
        return response.choices[0].message.content
