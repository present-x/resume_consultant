from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
from typing import Optional
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.llm_config import LLMConfig, LLMProvider


router = APIRouter(prefix="/llm", tags=["LLM Configuration"])


class ProviderInfo(BaseModel):
    id: str
    name: str
    icon: str
    default_model: str
    base_url: Optional[str]


class LLMConfigCreate(BaseModel):
    provider: str
    name: str
    api_key: str
    model_name: str
    base_url: Optional[str] = None


class LLMConfigUpdate(BaseModel):
    name: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    base_url: Optional[str] = None


class LLMConfigResponse(BaseModel):
    id: int
    provider: str
    name: str
    model_name: str
    base_url: Optional[str]
    is_default: bool
    
    class Config:
        from_attributes = True


@router.get("/providers", response_model=list[ProviderInfo])
async def get_providers():
    """Get list of supported LLM providers."""
    try:
        print("Fetching providers...")
        providers = []
        for provider_id in LLMProvider.all():
            info = LLMProvider.info()[provider_id]
            providers.append(ProviderInfo(
                id=provider_id,
                name=info["name"],
                icon=info["icon"],
                default_model=info["default_model"],
                base_url=info["base_url"]
            ))
        return providers
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching providers: {str(e)}"
        )


@router.get("/configs", response_model=list[LLMConfigResponse])
async def get_configs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's LLM configurations."""
    try:
        result = await db.execute(
            select(LLMConfig).where(LLMConfig.user_id == current_user.id)
        )
        configs = result.scalars().all()
        return [LLMConfigResponse.model_validate(c) for c in configs]
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching configs: {str(e)}"
        )


@router.post("/configs", response_model=LLMConfigResponse, status_code=status.HTTP_201_CREATED)
async def create_config(
    config: LLMConfigCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new LLM configuration."""
    if config.provider not in LLMProvider.all():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid provider. Must be one of: {LLMProvider.all()}"
        )
    
    # Check if this is the first config - make it default
    result = await db.execute(
        select(LLMConfig).where(LLMConfig.user_id == current_user.id)
    )
    existing = result.scalars().all()
    is_default = len(existing) == 0
    
    # Use provider's default base_url if not specified
    base_url = config.base_url
    if not base_url and config.provider in LLMProvider.info():
        base_url = LLMProvider.info()[config.provider].get("base_url")
    
    db_config = LLMConfig(
        user_id=current_user.id,
        provider=config.provider,
        name=config.name,
        api_key=config.api_key,
        model_name=config.model_name,
        base_url=base_url,
        is_default=is_default
    )
    db.add(db_config)
    await db.commit()
    await db.refresh(db_config)
    
    return LLMConfigResponse.model_validate(db_config)


@router.put("/configs/{config_id}", response_model=LLMConfigResponse)
async def update_config(
    config_id: int,
    config: LLMConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update an LLM configuration."""
    result = await db.execute(
        select(LLMConfig).where(
            LLMConfig.id == config_id,
            LLMConfig.user_id == current_user.id
        )
    )
    db_config = result.scalar_one_or_none()
    
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    
    update_data = config.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_config, key, value)
    
    await db.commit()
    await db.refresh(db_config)
    
    return LLMConfigResponse.model_validate(db_config)


@router.delete("/configs/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config(
    config_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete an LLM configuration."""
    result = await db.execute(
        select(LLMConfig).where(
            LLMConfig.id == config_id,
            LLMConfig.user_id == current_user.id
        )
    )
    db_config = result.scalar_one_or_none()
    
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    
    await db.delete(db_config)
    await db.commit()


@router.put("/configs/{config_id}/default", response_model=LLMConfigResponse)
async def set_default_config(
    config_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Set a configuration as the default."""
    # Reset all defaults for this user
    await db.execute(
        update(LLMConfig)
        .where(LLMConfig.user_id == current_user.id)
        .values(is_default=False)
    )
    
    # Set the new default
    result = await db.execute(
        select(LLMConfig).where(
            LLMConfig.id == config_id,
            LLMConfig.user_id == current_user.id
        )
    )
    db_config = result.scalar_one_or_none()
    
    if not db_config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    
    db_config.is_default = True
    await db.commit()
    await db.refresh(db_config)
    
    return LLMConfigResponse.model_validate(db_config)
