"""Admin-only system operations: service restart, process status, git push.

Restarting requires a NOPASSWD sudoers rule for the user that runs uvicorn:
    narendhar ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart chatbot-api

`git push` uses a GitHub Personal Access Token stored via /api/settings/git
(admin-only). The token is injected into an HTTPS remote URL just for the
push; output is sanitised so the token can't appear in error messages.
"""
import logging
import shutil
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auto_close import close_stale_bot_convs
from app.core.db import get_session
from app.core.security import require_role
from app.models.app_setting import AppSetting
from app.models.conversation import Conversation, ConversationStatus
from app.models.user import UserRole

router = APIRouter(prefix="/api/admin", tags=["admin-ops"])
log = logging.getLogger(__name__)

PROCESS_STARTED = time.time()
SERVICE_NAME = "chatbot-api"
REPO_DIR = str(Path(__file__).resolve().parent.parent.parent)


def _sudoers_ok() -> tuple[bool, str]:
    """Return (allowed, message). Uses `sudo -nl <cmd>` which doesn't actually run it —
    just checks whether the invoking user has NOPASSWD permission for that exact command.
    """
    sudo = shutil.which("sudo")
    systemctl = shutil.which("systemctl")
    if not sudo or not systemctl:
        return False, "sudo or systemctl not found on PATH"
    try:
        r = subprocess.run(
            [sudo, "-nl", systemctl, "restart", SERVICE_NAME],
            capture_output=True, timeout=3, text=True,
        )
    except subprocess.TimeoutExpired:
        return False, "sudo precheck timed out"
    if r.returncode == 0:
        return True, ""
    return False, (
        "Restart is not authorised. Add a sudoers rule:\n"
        f"  ALL=(ALL) NOPASSWD: {systemctl} restart {SERVICE_NAME}"
    )


@router.get("/status", dependencies=[Depends(require_role(UserRole.admin))])
async def status() -> dict:
    ok, msg = _sudoers_ok()
    return {
        "started_at": int(PROCESS_STARTED),
        "uptime_seconds": int(time.time() - PROCESS_STARTED),
        "service_name": SERVICE_NAME,
        "restart_authorised": ok,
        "restart_blocker": msg,
    }


@router.post("/restart", dependencies=[Depends(require_role(UserRole.admin))])
async def restart() -> dict:
    ok, msg = _sudoers_ok()
    if not ok:
        raise HTTPException(status_code=503, detail=msg)

    sudo = shutil.which("sudo")
    systemctl = shutil.which("systemctl")
    # Detach so the spawned process survives this uvicorn process being killed
    # by the restart it's about to trigger. The 1s sleep lets this HTTP
    # response flush before systemd sends SIGTERM.
    subprocess.Popen(
        ["/bin/sh", "-c", f"sleep 1 && {sudo} -n {systemctl} restart {SERVICE_NAME}"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    log.warning("admin restart scheduled by API")
    return {"ok": True, "scheduled": True}


# ---------------- Git push ----------------

def _ssh_to_https(ssh_url: str, token: str) -> str:
    """Convert git@github.com:owner/repo.git to https://x-access-token:T@github.com/owner/repo.git
    so we can push without the SSH key. https URLs pass through untouched.
    """
    s = ssh_url.strip()
    if s.startswith("git@") and ":" in s:
        host_path = s[4:]
        host, path = host_path.split(":", 1)
        return f"https://x-access-token:{token}@{host}/{path}"
    if s.startswith("https://"):
        # Inject token into the existing https URL
        return s.replace("https://", f"https://x-access-token:{token}@", 1)
    return s


def _sanitise(text: str, token: str) -> str:
    """Strip the PAT from any output we return to the client."""
    if token and token in text:
        return text.replace(token, "<token>")
    return text


@router.post("/git-push", dependencies=[Depends(require_role(UserRole.admin))])
async def git_push(db: AsyncSession = Depends(get_session)) -> dict:
    row = (await db.execute(select(AppSetting).where(AppSetting.key == "git"))).scalars().first()
    cfg = dict(row.value) if row and isinstance(row.value, dict) else {}
    token = cfg.get("token") or ""
    if not token:
        raise HTTPException(status_code=400, detail="GitHub token is not configured")

    git = shutil.which("git")
    if not git:
        raise HTTPException(status_code=500, detail="git not found on PATH")

    # Resolve current remote URL and current branch
    try:
        remote = subprocess.run(
            [git, "-C", REPO_DIR, "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5,
        )
        branch = subprocess.run(
            [git, "-C", REPO_DIR, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=503, detail="git config probe timed out")

    if remote.returncode != 0 or branch.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"git config probe failed: {remote.stderr or branch.stderr}",
        )

    https_url = _ssh_to_https(remote.stdout.strip(), token)
    branch_name = branch.stdout.strip() or "main"

    try:
        push = subprocess.run(
            [git, "-C", REPO_DIR, "push", https_url, branch_name],
            capture_output=True, text=True, timeout=60,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=503, detail="git push timed out")

    out = _sanitise(push.stdout + push.stderr, token).strip()
    if push.returncode != 0:
        log.warning("admin git push failed: %s", out)
        return {"ok": False, "branch": branch_name, "output": out}

    log.warning("admin git push succeeded for branch %s", branch_name)
    return {"ok": True, "branch": branch_name, "output": out}


# ---------------- Auto-close stale conversations ----------------

@router.get("/stale-conversations", dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))])
async def stale_conversations_count(
    older_than_hours: int = Query(24, ge=1, le=720),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Preview: how many bot-state conversations are older than the threshold.
    `bot` only — `queued`/`assigned` need human attention; we don't touch them.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=older_than_hours)
    rows = (await db.execute(
        select(Conversation)
        .where(Conversation.status == ConversationStatus.bot)
        .where(Conversation.updated_at < cutoff)
    )).scalars().all()
    return {"count": len(rows), "older_than_hours": older_than_hours}


@router.post("/auto-close-stale", dependencies=[Depends(require_role(UserRole.admin))])
async def auto_close_stale(
    older_than_hours: int = Query(24, ge=1, le=720),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Close every conversation in `bot` state whose last activity (`updated_at`)
    is older than the threshold. Same logic the hourly background loop runs —
    just with a configurable threshold instead of the loop's default 24h.
    """
    n = await close_stale_bot_convs(db, older_than_hours, actor="auto-close-stale")
    await db.commit()
    log.warning("auto-close-stale closed %d bot conversations older than %dh", n, older_than_hours)
    return {"closed": n, "older_than_hours": older_than_hours}
