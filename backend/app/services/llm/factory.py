from app.services.llm.base import LLMProviderBase
from app.services.llm.deepseek import DeepSeekProvider
from app.services.llm.kimi import KimiProvider
from app.services.llm.gemini import GeminiProvider
from app.models.llm_config import LLMConfig, LLMProvider


def create_llm_provider(config: LLMConfig) -> LLMProviderBase:
    """Factory function to create LLM provider from config."""
    
    if config.provider == LLMProvider.DEEPSEEK:
        return DeepSeekProvider(
            api_key=config.api_key,
            model=config.model_name,
            base_url=config.base_url
        )
    elif config.provider == LLMProvider.KIMI:
        return KimiProvider(
            api_key=config.api_key,
            model=config.model_name,
            base_url=config.base_url
        )
    elif config.provider == LLMProvider.GEMINI:
        return GeminiProvider(
            api_key=config.api_key,
            model=config.model_name
        )
    else:
        raise ValueError(f"Unsupported provider: {config.provider}")
