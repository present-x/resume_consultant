from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from app.core.database import get_db
from app.core.auth import verify_password, get_password_hash, create_access_token, get_current_user
from app.core.config import settings
from app.models.user import User


router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.options("/login")
async def options_login():
    return {}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserResponse(BaseModel):
    id: int
    email: str
    name: str | None


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Login with email and password. Supports test account."""
    
    # Check for test account
    if request.email == settings.TEST_USER_EMAIL and request.password == settings.TEST_USER_PASSWORD:
        # Find or create test user
        result = await db.execute(select(User).where(User.email == settings.TEST_USER_EMAIL))
        user = result.scalar_one_or_none()
        
        if not user:
            user = User(
                email=settings.TEST_USER_EMAIL,
                hashed_password=get_password_hash(settings.TEST_USER_PASSWORD),
                name="Test User"
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
    else:
        # Normal login
        result = await db.execute(select(User).where(User.email == request.email))
        user = result.scalar_one_or_none()
        
        if not user or not verify_password(request.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )
    
    token = create_access_token({"sub": str(user.id)})
    
    return LoginResponse(
        access_token=token,
        user={
            "id": user.id,
            "email": user.email,
            "name": user.name
        }
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current authenticated user."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name
    )
