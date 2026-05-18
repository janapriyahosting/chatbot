"""Global app settings (admin-only). Currently exposes:
- working hours (drives the round-robin agent picker)
- SMTP credentials (used by the email_sender module)
- Microsoft 365 / Entra ID OAuth credentials (used for SSO)
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as env_settings
from app.core.crypto import encrypt
from app.core.db import get_session
from app.core.security import require_role
from app.core.working_hours import SETTING_KEY as HOURS_KEY
from app.models.app_setting import AppSetting
from app.models.user import UserRole

router = APIRouter(prefix="/api/settings", tags=["settings"])

SMTP_KEY = "smtp"
O365_KEY = "o365"
WHATSAPP_KEY = "whatsapp"
GIT_KEY = "git"
_MASK = "********"


async def _load(db: AsyncSession, key: str) -> dict:
    row = (await db.execute(select(AppSetting).where(AppSetting.key == key))).scalars().first()
    return dict(row.value) if row and isinstance(row.value, dict) else {}


async def _save(db: AsyncSession, key: str, value: dict) -> None:
    row = (await db.execute(select(AppSetting).where(AppSetting.key == key))).scalars().first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))
    await db.commit()


# ---------------- working hours ----------------

class WorkingHoursPayload(BaseModel):
    schedule: dict


@router.get(
    "/working-hours",
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)
async def get_working_hours(db: AsyncSession = Depends(get_session)) -> dict:
    return {"schedule": await _load(db, HOURS_KEY)}


@router.put(
    "/working-hours",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def put_working_hours(
    payload: WorkingHoursPayload, db: AsyncSession = Depends(get_session)
) -> dict:
    await _save(db, HOURS_KEY, payload.schedule)
    return {"schedule": payload.schedule}


# ---------------- SMTP ----------------

class SmtpPayload(BaseModel):
    host: str = ""
    port: int = 587
    username: str = ""
    # Empty = keep existing (don't overwrite with blank). Use "__clear__" to wipe.
    password: str = ""
    from_addr: str = ""
    # None = keep existing — avoids the case where a partial form save (e.g. an
    # admin only meaning to fix the username) silently clobbers a working
    # STARTTLS config back to False.
    use_tls: bool | None = None
    use_ssl: bool | None = None


@router.get(
    "/smtp",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def get_smtp(db: AsyncSession = Depends(get_session)) -> dict:
    cfg = await _load(db, SMTP_KEY)
    return {
        "host": cfg.get("host", env_settings.smtp_host),
        "port": cfg.get("port", env_settings.smtp_port),
        "username": cfg.get("username", env_settings.smtp_username),
        "password_set": bool(cfg.get("password") or env_settings.smtp_password),
        "from_addr": cfg.get("from_addr", env_settings.smtp_from),
        "use_tls": cfg.get("use_tls", env_settings.smtp_use_tls),
        "use_ssl": cfg.get("use_ssl", env_settings.smtp_use_ssl),
    }


@router.put(
    "/smtp",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def put_smtp(payload: SmtpPayload, db: AsyncSession = Depends(get_session)) -> dict:
    cfg = await _load(db, SMTP_KEY)
    cfg["host"] = payload.host
    cfg["port"] = payload.port
    cfg["username"] = payload.username
    cfg["from_addr"] = payload.from_addr
    if payload.use_tls is not None:
        cfg["use_tls"] = payload.use_tls
    if payload.use_ssl is not None:
        cfg["use_ssl"] = payload.use_ssl
    if payload.password == "__clear__":
        cfg["password"] = ""
    elif payload.password:
        cfg["password"] = encrypt(payload.password)
    # else: leave existing password alone
    await _save(db, SMTP_KEY, cfg)
    return {"ok": True}


# ---------------- O365 ----------------

class O365Payload(BaseModel):
    tenant_id: str = ""
    client_id: str = ""
    client_secret: str = ""  # Empty = keep existing; "__clear__" wipes.
    redirect_path: str = "/auth/o365/callback"


@router.get(
    "/o365",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def get_o365(db: AsyncSession = Depends(get_session)) -> dict:
    cfg = await _load(db, O365_KEY)
    return {
        "tenant_id": cfg.get("tenant_id", env_settings.o365_tenant_id),
        "client_id": cfg.get("client_id", env_settings.o365_client_id),
        "secret_set": bool(cfg.get("client_secret") or env_settings.o365_client_secret),
        "redirect_path": cfg.get("redirect_path", env_settings.o365_redirect_path),
    }


@router.put(
    "/o365",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def put_o365(payload: O365Payload, db: AsyncSession = Depends(get_session)) -> dict:
    cfg = await _load(db, O365_KEY)
    cfg["tenant_id"] = payload.tenant_id
    cfg["client_id"] = payload.client_id
    cfg["redirect_path"] = payload.redirect_path or "/auth/o365/callback"
    if payload.client_secret == "__clear__":
        cfg["client_secret"] = ""
    elif payload.client_secret:
        cfg["client_secret"] = encrypt(payload.client_secret)
    await _save(db, O365_KEY, cfg)
    return {"ok": True}


# ---------------- WhatsApp ----------------

class WhatsAppPayload(BaseModel):
    api_key: str = ""              # Empty = keep existing; "__clear__" wipes.
    from_number: str = ""
    webhook_secret: str = ""       # Empty = keep existing; "__clear__" wipes.
    session_message_url: str = ""


@router.get(
    "/whatsapp",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def get_whatsapp(db: AsyncSession = Depends(get_session)) -> dict:
    cfg = await _load(db, WHATSAPP_KEY)
    # Empty stored values fall back to env, matching the runtime loader so the
    # UI never shows "not set" while requests actually pick up env defaults.
    def pick(key: str, env_default: str) -> str:
        v = cfg.get(key)
        return v if v not in (None, "") else env_default
    return {
        "api_key_set": bool(cfg.get("api_key") or env_settings.whatsapp_api_key),
        "from_number": pick("from_number", env_settings.whatsapp_from),
        "webhook_secret_set": bool(
            cfg.get("webhook_secret") or env_settings.whatsapp_webhook_secret
        ),
        "session_message_url": pick(
            "session_message_url", env_settings.whatsapp_session_message_url
        ),
    }


@router.put(
    "/whatsapp",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def put_whatsapp(
    payload: WhatsAppPayload, db: AsyncSession = Depends(get_session)
) -> dict:
    cfg = await _load(db, WHATSAPP_KEY)
    cfg["from_number"] = payload.from_number
    cfg["session_message_url"] = payload.session_message_url

    if payload.api_key == "__clear__":
        cfg["api_key"] = ""
    elif payload.api_key:
        cfg["api_key"] = encrypt(payload.api_key)

    if payload.webhook_secret == "__clear__":
        cfg["webhook_secret"] = ""
    elif payload.webhook_secret:
        cfg["webhook_secret"] = encrypt(payload.webhook_secret)

    await _save(db, WHATSAPP_KEY, cfg)
    return {"ok": True}


# ---------------- GitHub (personal access token for `git push`) ----------------

class GitPayload(BaseModel):
    token: str = ""        # Empty = keep existing; "__clear__" wipes.


@router.get(
    "/git",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def get_git(db: AsyncSession = Depends(get_session)) -> dict:
    cfg = await _load(db, GIT_KEY)
    return {"token_set": bool(cfg.get("token"))}


@router.put(
    "/git",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def put_git(payload: GitPayload, db: AsyncSession = Depends(get_session)) -> dict:
    cfg = await _load(db, GIT_KEY)
    if payload.token == "__clear__":
        cfg["token"] = ""
    elif payload.token:
        cfg["token"] = encrypt(payload.token)
    await _save(db, GIT_KEY, cfg)
    return {"ok": True}
