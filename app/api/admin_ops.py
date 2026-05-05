"""Admin-only system operations: service restart, process status.

Restarting requires a NOPASSWD sudoers rule for the user that runs uvicorn:
    narendhar ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart chatbot-api
"""
import logging
import shutil
import subprocess
import time

from fastapi import APIRouter, Depends, HTTPException

from app.core.security import require_role
from app.models.user import UserRole

router = APIRouter(prefix="/api/admin", tags=["admin-ops"])
log = logging.getLogger(__name__)

PROCESS_STARTED = time.time()
SERVICE_NAME = "chatbot-api"


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
