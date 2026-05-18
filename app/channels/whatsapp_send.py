"""WhatsApp send wrapper. Loads config from the app_setting table (set via the
admin Settings page); falls back to .env values. Empty api_key/from/url = no-op.
"""
import logging

import httpx
from sqlalchemy import select

from app.core.config import settings as env_settings
from app.core.crypto import decrypt
from app.core.db import SessionLocal
from app.models.app_setting import AppSetting

log = logging.getLogger(__name__)

_KEY = "whatsapp"


async def _load_whatsapp_config() -> dict:
    """Resolve runtime WhatsApp config: DB row > env. Returns a flat dict."""
    db_cfg: dict = {}
    try:
        async with SessionLocal() as db:
            row = (
                await db.execute(select(AppSetting).where(AppSetting.key == _KEY))
            ).scalars().first()
            if row and isinstance(row.value, dict):
                db_cfg = row.value
    except Exception as e:
        log.warning("whatsapp config DB load failed (using env): %s", e)

    def pick(key: str, env_default):
        v = db_cfg.get(key)
        return v if v not in (None, "") else env_default

    return {
        "api_key": decrypt(pick("api_key", env_settings.whatsapp_api_key)),
        "from_number": pick("from_number", env_settings.whatsapp_from),
        "webhook_secret": decrypt(pick("webhook_secret", env_settings.whatsapp_webhook_secret)),
        "session_message_url": pick(
            "session_message_url", env_settings.whatsapp_session_message_url
        ),
    }


async def send_text(to: str, body: str) -> dict:
    """Send a WhatsApp session text message via the configured provider."""
    cfg = await _load_whatsapp_config()
    if not (cfg["api_key"] and cfg["from_number"] and cfg["session_message_url"]):
        raise RuntimeError(
            "WhatsApp credentials are not fully configured (api_key, from, session_message_url)"
        )
    payload = {
        "api_key": cfg["api_key"],
        "from": cfg["from_number"],
        "recipient_type": "individual",
        "to": to,
        "type": "text",
        "text": {"body": body},
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(cfg["session_message_url"], json=payload)
        resp.raise_for_status()
        return resp.json()
