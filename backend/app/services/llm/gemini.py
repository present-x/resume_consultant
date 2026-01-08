from typing import AsyncIterator
import google.generativeai as genai
from app.services.llm.base import LLMProviderBase


class GeminiProvider(LLMProviderBase):
    """Google Gemini API provider."""
    
    def __init__(self, api_key: str, model: str = "gemini-2.0-flash", base_url: str = None):
        super().__init__(api_key, model, base_url)
        genai.configure(api_key=api_key)
        self.model_instance = genai.GenerativeModel(model)
    
    def _convert_messages(self, messages: list[dict]) -> list[dict]:
        """Convert OpenAI-style messages to Gemini format."""
        gemini_messages = []
        system_content = ""
        
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            
            if role == "system":
                system_content = content
            elif role == "user":
                if system_content:
                    content = f"{system_content}\n\n{content}"
                    system_content = ""
                gemini_messages.append({"role": "user", "parts": [content]})
            elif role == "assistant":
                gemini_messages.append({"role": "model", "parts": [content]})
        
        return gemini_messages
    
    async def chat_stream(
        self, 
        messages: list[dict],
        temperature: float = 0.7
    ) -> AsyncIterator[str]:
        gemini_messages = self._convert_messages(messages)
        
        # Start chat with history if there are previous messages
        if len(gemini_messages) > 1:
            chat = self.model_instance.start_chat(history=gemini_messages[:-1])
            last_message = gemini_messages[-1]["parts"][0]
        else:
            chat = self.model_instance.start_chat()
            last_message = gemini_messages[0]["parts"][0] if gemini_messages else ""
        
        response = await chat.send_message_async(
            last_message,
            generation_config=genai.GenerationConfig(temperature=temperature),
            stream=True
        )
        
        async for chunk in response:
            if chunk.text:
                yield chunk.text
    
    async def chat(
        self, 
        messages: list[dict],
        temperature: float = 0.7
    ) -> str:
        gemini_messages = self._convert_messages(messages)
        
        if len(gemini_messages) > 1:
            chat = self.model_instance.start_chat(history=gemini_messages[:-1])
            last_message = gemini_messages[-1]["parts"][0]
        else:
            chat = self.model_instance.start_chat()
            last_message = gemini_messages[0]["parts"][0] if gemini_messages else ""
        
        response = await chat.send_message_async(
            last_message,
            generation_config=genai.GenerationConfig(temperature=temperature)
        )
        
        return response.text
