import uuid
from datetime import datetime

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.security import (
    ALGO,
    AUDIENCE,
    current_user,
    dummy_verify_password,
    make_token,
    revoke_jti,
    verify_password,
)
from app.models.user import User, UserRole

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    role: UserRole
    is_active: bool
    is_available: bool
    created_at: datetime


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest, db: AsyncSession = Depends(get_session)
) -> LoginResponse:
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalars().first()
    # Always run a bcrypt verification so timing doesn't leak whether the
    # email exists. Collapse missing-user / wrong-password / disabled-user
    # into one 401 so the response doesn't leak it either.
    if user is None:
        dummy_verify_password(payload.password)
        raise HTTPException(status_code=401, detail="invalid credentials")
    ok = verify_password(payload.password, user.password_hash)
    if not ok or not user.is_active:
        raise HTTPException(status_code=401, detail="invalid credentials")
    token = make_token(str(user.id), user.role.value)
    return LoginResponse(access_token=token, user=user)  # type: ignore[arg-type]


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> User:
    return user


@router.post("/logout", status_code=204)
async def logout(authorization: str | None = Header(default=None)) -> None:
    """Add the caller's JWT jti to the revocation set so the token can't be
    reused before its natural expiry. Idempotent — already-expired or
    malformed tokens return 204 without error so the SPA can always clear
    local state."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return
    token = authorization.split(None, 1)[1].strip()
    try:
        # Verify signature, issuer, and audience so a third party can't poison
        # the revocation set with arbitrary jti values from forged or
        # cross-service tokens.
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGO],
            audience=AUDIENCE,
            options={"require": ["jti", "exp"]},
        )
    except jwt.InvalidTokenError:
        # Idempotent on tampered/expired/legacy tokens — the SPA can always
        # clear local state regardless.
        return
    await revoke_jti(payload["jti"], payload.get("exp"))
