"""Tiny SMTP wrapper. Loads config from the app_setting table (set via the
admin Settings page); falls back to .env values. Empty host = no-op.
"""
import logging
from email.message import EmailMessage

import aiosmtplib
from sqlalchemy import select

from app.core.config import settings as env_settings
from app.core.crypto import decrypt
from app.core.db import SessionLocal
from app.models.app_setting import AppSetting

log = logging.getLogger(__name__)

_KEY = "smtp"


async def _load_smtp_config() -> dict:
    """Resolve runtime SMTP config: DB row > env. Returns a flat dict."""
    db_cfg: dict = {}
    try:
        async with SessionLocal() as db:
            row = (await db.execute(select(AppSetting).where(AppSetting.key == _KEY))).scalars().first()
            if row and isinstance(row.value, dict):
                db_cfg = row.value
    except Exception as e:
        log.warning("smtp config DB load failed (using env): %s", e)

    def pick(key: str, env_default):
        v = db_cfg.get(key)
        return v if v not in (None, "") else env_default

    return {
        "host": pick("host", env_settings.smtp_host),
        "port": int(pick("port", env_settings.smtp_port) or 0),
        "username": pick("username", env_settings.smtp_username),
        "password": decrypt(pick("password", env_settings.smtp_password)),
        "from_addr": pick("from_addr", env_settings.smtp_from),
        "use_tls": bool(pick("use_tls", env_settings.smtp_use_tls)),
        "use_ssl": bool(pick("use_ssl", env_settings.smtp_use_ssl)),
    }


async def send_email(
    to: str | list[str],
    subject: str,
    body_text: str,
    body_html: str | None = None,
    cc: list[str] | None = None,
    attachments: list[tuple[str, bytes, str]] | None = None,
) -> bool:
    """Send a transactional email. Never raises — best-effort delivery only.

    `attachments` is a list of (filename, raw_bytes, mime_type) tuples.
    """
    cfg = await _load_smtp_config()
    if not (cfg["host"] and cfg["username"] and cfg["password"]):
        log.debug("SMTP not configured; skipping send to %s", to)
        return False

    if isinstance(to, str):
        to = [to]
    cc = [c for c in (cc or []) if c]
    msg = EmailMessage()
    msg["From"] = cfg["from_addr"] or cfg["username"]
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")
    for fname, data, mime in attachments or []:
        maintype, _, subtype = (mime or "application/octet-stream").partition("/")
        msg.add_attachment(
            data,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=fname,
        )

    try:
        if cfg["use_ssl"]:
            await aiosmtplib.send(
                msg,
                hostname=cfg["host"],
                port=cfg["port"],
                username=cfg["username"],
                password=cfg["password"],
                use_tls=True,
                timeout=15,
            )
        else:
            await aiosmtplib.send(
                msg,
                hostname=cfg["host"],
                port=cfg["port"],
                username=cfg["username"],
                password=cfg["password"],
                start_tls=cfg["use_tls"],
                timeout=15,
            )
        log.info("email sent to %s subject=%r", to, subject)
        return True
    except Exception as e:
        log.warning("email send failed (to=%s subject=%r): %s", to, subject, e)
        return False
