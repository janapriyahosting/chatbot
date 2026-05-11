"""Web Push delivery for the agent PWA.

Fire-and-forget from the assignment hook. Each user can have multiple
subscriptions (phone + desktop, multiple devices) — we fan out to all
of them and drop any that come back 404/410 (the browser has revoked
the subscription on its side).

If VAPID isn't configured this module is a no-op so the app still
runs on a dev box without keys.
"""
import asyncio
import base64
import json
import logging
import uuid as _uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select

from app.core.config import settings
from app.core.db import SessionLocal
from app.models.push_subscription import PushSubscription

log = logging.getLogger(__name__)


# Built once on first send. The env stores the private key as a raw 32-byte
# scalar (base64url, no padding) — easy to paste into .env — but pywebpush
# 2.3's string-parse path is broken on PKCS8/SEC1 PEM, so we hand it a
# Vapid02 instance instead and skip the parser entirely.
_vapid_cache: Vapid02 | None = None


def _vapid_instance() -> Vapid02:
    global _vapid_cache
    if _vapid_cache is not None:
        return _vapid_cache
    raw_b64 = settings.vapid_private_key
    padded = raw_b64 + "=" * ((4 - len(raw_b64) % 4) % 4)
    raw = base64.urlsafe_b64decode(padded)
    if len(raw) != 32:
        raise ValueError(
            f"VAPID_PRIVATE_KEY must be a 32-byte P-256 scalar (got {len(raw)}); "
            "regenerate with `python scripts/gen_vapid.py`"
        )
    priv = ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256R1())
    pem_bytes = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    _vapid_cache = Vapid02.from_pem(pem_bytes)
    return _vapid_cache

# Time-to-live the push service holds the message before giving up. Short —
# a stale "new chat" notification 10 minutes later is just noise.
_TTL_SECONDS = 60


def is_configured() -> bool:
    return bool(settings.vapid_private_key and settings.vapid_public_key)


def _vapid_claims() -> dict:
    contact = settings.vapid_contact_email or "admin@example.com"
    return {"sub": f"mailto:{contact}"}


async def send_push_to_user(user_id: _uuid.UUID, payload: dict) -> int:
    """Returns the count of successful deliveries (per-device).

    Drops any subscription whose endpoint returns 404/410 (Gone) so the
    table doesn't accumulate dead rows.
    """
    if not is_configured():
        return 0

    # Caller is typically a fire-and-forget asyncio task; its request session
    # may already be closed. Open our own.
    async with SessionLocal() as db:
        result = await db.execute(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
        subs = list(result.scalars().all())
        if not subs:
            return 0

        outcomes = await asyncio.gather(
            *[_send_one(s, payload) for s in subs],
            return_exceptions=False,
        )
        gone_ids = [s.id for s, o in zip(subs, outcomes) if o == "gone"]
        if gone_ids:
            await db.execute(
                delete(PushSubscription).where(PushSubscription.id.in_(gone_ids))
            )
            await db.commit()
        ok_count = sum(1 for o in outcomes if o == "ok")
        return ok_count


async def _send_one(sub: PushSubscription, payload: dict) -> str:
    """Returns 'ok' | 'gone' | 'fail'. Never raises."""
    sub_info = {
        "endpoint": sub.endpoint,
        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
    }
    try:
        # pywebpush is blocking — push it to a thread so we don't stall the
        # event loop on slow push services.
        await asyncio.to_thread(
            webpush,
            subscription_info=sub_info,
            data=json.dumps(payload),
            vapid_private_key=_vapid_instance(),
            vapid_claims=_vapid_claims(),
            ttl=_TTL_SECONDS,
        )
        return "ok"
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status in (404, 410):
            log.info("push: dropping dead subscription %s (status=%s)", sub.id, status)
            return "gone"
        log.warning("push: send failed for %s: %s (status=%s)", sub.id, e, status)
        return "fail"
    except Exception as e:
        log.warning("push: unexpected error for %s: %s", sub.id, e)
        return "fail"
