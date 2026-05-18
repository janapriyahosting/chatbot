import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
import valkey.asyncio as _valkey
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.models.api_key import ApiKey
from app.models.user import User, UserRole

ALGO = "HS256"
ISSUER = "chatbot-api"

# Valkey-backed JWT revocation: jti → present-until-exp.
_JTI_REVOKED_PREFIX = f"{settings.valkey_prefix}jwt:revoked:"
_valkey_client: _valkey.Valkey | None = None


def _vk() -> _valkey.Valkey:
    global _valkey_client
    if _valkey_client is None:
        _valkey_client = _valkey.from_url(settings.valkey_url, decode_responses=True)
    return _valkey_client

# A real bcrypt hash of an unguessable random value, used to equalize timing
# when the requested user doesn't exist (or is disabled). Without this, the
# bcrypt call is skipped for missing users and an attacker can distinguish
# "no such email" from "wrong password" by response latency.
_DUMMY_PASSWORD_HASH = bcrypt.hashpw(
    f"unreachable-{datetime.now(timezone.utc).timestamp()}".encode(),
    bcrypt.gensalt(),
).decode()


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def dummy_verify_password(plain: str) -> None:
    """Run bcrypt against a discarded hash, purely to equalize login timing."""
    try:
        bcrypt.checkpw(plain.encode(), _DUMMY_PASSWORD_HASH.encode())
    except ValueError:
        pass


AUDIENCE = "chatbot-api"


def make_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=settings.jwt_ttl_hours)
    return jwt.encode(
        {
            "iss": ISSUER,
            "aud": AUDIENCE,
            "sub": user_id,
            "role": role,
            "iat": now,
            "exp": exp,
            "jti": uuid.uuid4().hex,
        },
        settings.jwt_secret,
        algorithm=ALGO,
    )


def decode_token(token: str) -> dict:
    # `require` forces the listed claims to be present — without it, a token
    # forged by a sibling service that omits e.g. exp would silently decode.
    # `audience` pins the token to this service so a token signed with the
    # same JWT secret for a sibling service can't be replayed here.
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[ALGO],
        issuer=ISSUER,
        audience=AUDIENCE,
        options={"require": ["exp", "iat", "sub", "jti", "iss", "aud"]},
    )


async def revoke_jti(jti: str, exp_unix: int | float | None) -> None:
    """Add a jti to the revocation set with TTL = remaining seconds till exp.

    If exp is None or in the past, fall back to the full TTL so we always
    have *some* coverage. Tokens fail decode after exp anyway, so the worst
    case here is wasting a small amount of Valkey memory.
    """
    if exp_unix is None:
        ttl = settings.jwt_ttl_hours * 3600
    else:
        ttl = int(exp_unix - datetime.now(timezone.utc).timestamp())
        if ttl <= 0:
            return  # already expired; jwt.decode will reject
    await _vk().set(_JTI_REVOKED_PREFIX + jti, "1", ex=ttl)


async def is_jti_revoked(jti: str) -> bool:
    return bool(await _vk().exists(_JTI_REVOKED_PREFIX + jti))


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
        if await is_jti_revoked(payload["jti"]):
            raise HTTPException(status_code=401, detail="token revoked")
        # `sub` is a UUID hex string — guard against tokens with a
        # non-UUID `sub` from a future misconfigured signer.
        try:
            user_id = uuid.UUID(payload["sub"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=401, detail="invalid token")
        user = await db.get(User, user_id)
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
