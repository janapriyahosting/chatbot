"""Admin-managed API keys for programmatic access.

The plaintext key is shown ONCE at create time. Thereafter we only store a
bcrypt hash + the first 12 chars as a prefix so the UI can label rows.
Callers authenticate by passing the key in the `X-API-Key` header (or,
equivalently, `Authorization: Bearer <jwt>`).
"""
import secrets
import uuid
from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import current_user, require_role
from app.models.api_key import ApiKey
from app.models.user import User, UserRole

router = APIRouter(
    prefix="/api/api-keys",
    tags=["api-keys"],
    dependencies=[Depends(require_role(UserRole.admin))],
)


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ApiKeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class ApiKeyCreatedResponse(ApiKeyOut):
    # Plaintext key — only returned once.
    key: str


@router.get("", response_model=list[ApiKeyOut])
async def list_keys(db: AsyncSession = Depends(get_session)) -> list[ApiKey]:
    result = await db.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=ApiKeyCreatedResponse, status_code=201)
async def create_key(
    payload: ApiKeyCreate,
    me: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    raw = "ck_live_" + secrets.token_urlsafe(32)
    prefix = raw[:12]
    key_hash = bcrypt.hashpw(raw.encode(), bcrypt.gensalt()).decode()
    rec = ApiKey(name=payload.name, prefix=prefix, key_hash=key_hash, created_by=me.id)
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return {
        "id": rec.id,
        "name": rec.name,
        "prefix": rec.prefix,
        "created_at": rec.created_at,
        "last_used_at": rec.last_used_at,
        "revoked_at": rec.revoked_at,
        "key": raw,
    }


@router.post("/{key_id}/revoke", response_model=ApiKeyOut)
async def revoke_key(
    key_id: uuid.UUID, db: AsyncSession = Depends(get_session)
) -> ApiKey:
    rec = await db.get(ApiKey, key_id)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    if rec.revoked_at is None:
        rec.revoked_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(rec)
    return rec
