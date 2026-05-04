"""Microsoft 365 / Entra ID OAuth login (strict allowlist).

Flow:
1. /auth/o365/login    — random state cookie, redirect to Microsoft authorize.
2. /auth/o365/callback — exchange code for tokens, fetch user email from
   Microsoft Graph, look up a local User by email, issue our JWT.

The local user must already exist in /admin/users and be active. If the
Microsoft account isn't found locally, we redirect back to login with an
error fragment so the SPA can show a friendly message.
"""
import logging
import secrets
import urllib.parse

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as env_settings
from app.core.db import get_session
from app.core.security import make_token
from app.models.app_setting import AppSetting
from app.models.user import User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/o365", tags=["auth"])

_AUTHORITY = "https://login.microsoftonline.com"
_GRAPH_ME = "https://graph.microsoft.com/v1.0/me"
_STATE_COOKIE = "cb_o365_state"
_SETTING_KEY = "o365"


async def _load_o365_config(db: AsyncSession) -> dict:
    """DB-first, env-fallback config."""
    db_cfg: dict = {}
    try:
        row = (await db.execute(select(AppSetting).where(AppSetting.key == _SETTING_KEY))).scalars().first()
        if row and isinstance(row.value, dict):
            db_cfg = row.value
    except Exception as e:
        log.warning("o365 config DB load failed (using env): %s", e)

    def pick(k, env_default):
        v = db_cfg.get(k)
        return v if v not in (None, "") else env_default

    return {
        "tenant_id": pick("tenant_id", env_settings.o365_tenant_id),
        "client_id": pick("client_id", env_settings.o365_client_id),
        "client_secret": pick("client_secret", env_settings.o365_client_secret),
        "redirect_path": pick("redirect_path", env_settings.o365_redirect_path),
    }


def _is_configured(cfg: dict) -> bool:
    return bool(cfg["tenant_id"] and cfg["client_id"] and cfg["client_secret"])


def _redirect_uri(cfg: dict) -> str:
    return f"{env_settings.public_base_url.rstrip('/')}{cfg['redirect_path']}"


def _login_url(error: str | None = None, token: str | None = None) -> str:
    """Build the SPA URL to redirect back to after the callback handles the
    Microsoft response. We pass info via the fragment (#) so it never hits
    the server logs and isn't sent on subsequent requests."""
    base = f"{env_settings.public_base_url.rstrip('/')}/admin/login"
    parts = []
    if error:
        parts.append(f"error={urllib.parse.quote(error)}")
    if token:
        parts.append(f"token={urllib.parse.quote(token)}")
    return base + ("#" + "&".join(parts) if parts else "")


@router.get("/login")
async def o365_login(db: AsyncSession = Depends(get_session)) -> Response:
    cfg = await _load_o365_config(db)
    if not _is_configured(cfg):
        raise HTTPException(503, "Microsoft sign-in is not configured")
    state = secrets.token_urlsafe(24)
    qs = urllib.parse.urlencode({
        "client_id": cfg["client_id"],
        "response_type": "code",
        "redirect_uri": _redirect_uri(cfg),
        "response_mode": "query",
        "scope": "openid profile email User.Read",
        "state": state,
        "prompt": "select_account",
    })
    auth_url = f"{_AUTHORITY}/{cfg['tenant_id']}/oauth2/v2.0/authorize?{qs}"
    resp = RedirectResponse(auth_url, status_code=302)
    resp.set_cookie(
        _STATE_COOKIE, state,
        max_age=600, httponly=True, samesite="lax",
        secure=env_settings.public_base_url.startswith("https"),
        path=cfg["redirect_path"],
    )
    return resp


@router.get("/callback")
async def o365_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    cb_o365_state: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_session),
) -> Response:
    if error:
        return RedirectResponse(_login_url(error=error_description or error))
    if not code or not state:
        return RedirectResponse(_login_url(error="Missing code/state"))
    if not cb_o365_state or cb_o365_state != state:
        return RedirectResponse(_login_url(error="State mismatch — please try again"))

    cfg = await _load_o365_config(db)
    if not _is_configured(cfg):
        return RedirectResponse(_login_url(error="Microsoft sign-in is not configured"))
    # Exchange code for tokens
    token_url = f"{_AUTHORITY}/{cfg['tenant_id']}/oauth2/v2.0/token"
    data = {
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "scope": "openid profile email User.Read",
        "code": code,
        "redirect_uri": _redirect_uri(cfg),
        "grant_type": "authorization_code",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            tr = await client.post(token_url, data=data)
            tr.raise_for_status()
            tokens = tr.json()
            access_token = tokens.get("access_token")
            if not access_token:
                return RedirectResponse(_login_url(error="No access_token from Microsoft"))
            mr = await client.get(
                _GRAPH_ME,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            mr.raise_for_status()
            me = mr.json()
    except httpx.HTTPError as e:
        log.warning("o365 token/graph exchange failed: %s", e)
        return RedirectResponse(_login_url(error="Microsoft token exchange failed"))

    email = (me.get("mail") or me.get("userPrincipalName") or "").lower().strip()
    if not email:
        return RedirectResponse(_login_url(error="Microsoft account has no email"))

    # Strict allowlist: must already exist locally and be active.
    user = (await db.execute(select(User).where(User.email == email))).scalars().first()
    if not user:
        return RedirectResponse(_login_url(error=f"{email} is not an authorized user — contact admin"))
    if not user.is_active:
        return RedirectResponse(_login_url(error="Your account is disabled"))

    jwt = make_token(str(user.id), user.role.value)
    resp = RedirectResponse(_login_url(token=jwt))
    resp.delete_cookie(_STATE_COOKIE, path=cfg["redirect_path"])
    return resp


@router.get("/status")
async def o365_status(db: AsyncSession = Depends(get_session)) -> dict:
    """Lets the SPA know whether to show the 'Sign in with Microsoft' button."""
    cfg = await _load_o365_config(db)
    return {"enabled": _is_configured(cfg)}
