from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.models.api_key import ApiKey
from app.models.user import User, UserRole

ALGO = "HS256"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def make_token(user_id: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_ttl_hours)
    return jwt.encode(
        {"sub": user_id, "role": role, "exp": exp}, settings.jwt_secret, algorithm=ALGO
    )


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGO])


async def _user_from_api_key(
    api_key: str, db: AsyncSession
) -> User | None:
    """Authenticate via X-API-Key header. Returns the key's creator as the
    acting user — keys inherit their creator's role. Bumps last_used_at."""
    if not api_key or not api_key.startswith("ck_"):
        return None
    prefix = api_key[:12]
    res = await db.execute(
        select(ApiKey).where(ApiKey.prefix == prefix, ApiKey.revoked_at.is_(None))
    )
    for rec in res.scalars().all():
        try:
            if bcrypt.checkpw(api_key.encode(), rec.key_hash.encode()):
                rec.last_used_at = datetime.now(timezone.utc)
                await db.commit()
                if rec.created_by:
                    user = await db.get(User, rec.created_by)
                    if user and user.is_active:
                        return user
                return None
        except ValueError:
            continue
    return None


async def current_user(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
    db: AsyncSession = Depends(get_session),
) -> User:
    # Path 1: JWT bearer
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="invalid token")
        user = await db.get(User, payload["sub"])
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="user not found or disabled")
        return user

    # Path 2: API key
    if x_api_key:
        user = await _user_from_api_key(x_api_key, db)
        if user:
            return user

    raise HTTPException(status_code=401, detail="missing or invalid credentials")


def require_role(*roles: UserRole):
    async def _dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="forbidden")
        return user

    return _dep
