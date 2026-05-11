"""Web Push subscription management for the agent PWA.

Endpoints:
  GET  /push/public-key       — VAPID public key (unauthenticated; it's public
                                by design — the browser uses it as the
                                applicationServerKey when subscribing).
  POST /push/subscribe        — store the browser's PushSubscription for the
                                logged-in user. Idempotent by endpoint.
  POST /push/unsubscribe      — remove a subscription. Used on sign-out and
                                when the SW reports a permission revoke.
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.push import is_configured
from app.core.security import current_user
from app.models.push_subscription import PushSubscription
from app.models.user import User

router = APIRouter(prefix="/push", tags=["push"])


class _Keys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: _Keys


class UnsubscribeRequest(BaseModel):
    endpoint: str


@router.get("/public-key")
async def public_key() -> dict:
    """Returns the VAPID public key, or `enabled: false` when push isn't
    configured on this install. The frontend uses this to skip the whole
    subscribe flow without a console error on dev boxes."""
    if not is_configured():
        return {"enabled": False}
    return {"enabled": True, "public_key": settings.vapid_public_key}


@router.post("/subscribe", status_code=204)
async def subscribe(
    payload: SubscribeRequest,
    user_agent: str | None = Header(default=None),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> None:
    if not is_configured():
        # Don't 4xx — the frontend may have a stale public key cached. Treat
        # the call as a no-op so the SPA doesn't surface a scary error.
        return

    # endpoint is globally unique. If this device previously subscribed under
    # a different user (e.g. shared phone), this re-binds it.
    existing = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
    )
    sub = existing.scalars().first()
    if sub is None:
        sub = PushSubscription(
            user_id=user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            user_agent=user_agent,
        )
        db.add(sub)
    else:
        sub.user_id = user.id
        sub.p256dh = payload.keys.p256dh
        sub.auth = payload.keys.auth
        sub.user_agent = user_agent
    await db.commit()


@router.post("/unsubscribe", status_code=204)
async def unsubscribe(
    payload: UnsubscribeRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> None:
    # Scope to the caller's user_id so a logged-in user can't drop someone
    # else's subscription by guessing endpoints.
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == payload.endpoint,
            PushSubscription.user_id == user.id,
        )
    )
    await db.commit()
