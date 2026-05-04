from fastapi import APIRouter, Header, HTTPException, Request

from app.agents.base import Message
from app.agents.router import AgentRouter
from app.channels import chat360
from app.core.config import settings

router = APIRouter(prefix="/webhook/whatsapp", tags=["whatsapp"])
_agent_router = AgentRouter()


def _extract_inbound(payload: dict) -> tuple[str, str] | None:
    """Best-effort extraction of (from_number, text) from a Chat360 inbound webhook.

    Chat360 webhook shapes vary by account config, so we probe common keys
    and fall back to None so the endpoint can ack without crashing.
    """
    for key in ("from", "sender", "mobile", "phone", "wa_id"):
        frm = payload.get(key)
        if frm:
            break
    else:
        frm = None

    text = None
    if isinstance(payload.get("text"), dict):
        text = payload["text"].get("body")
    text = text or payload.get("message") or payload.get("body")

    if frm and text:
        return str(frm), str(text)
    return None


@router.post("")
async def inbound(request: Request, x_webhook_secret: str | None = Header(default=None)):
    if settings.chat360_webhook_secret and x_webhook_secret != settings.chat360_webhook_secret:
        raise HTTPException(status_code=401, detail="bad webhook secret")

    payload = await request.json()
    parsed = _extract_inbound(payload)
    if not parsed:
        return {"ok": True, "handled": False}

    from_number, text = parsed
    reply, agent_used = await _agent_router.reply([Message(role="user", content=text)])

    sent = None
    if settings.chat360_api_key and settings.chat360_from:
        sent = await chat360.send_text(from_number, reply)

    return {"ok": True, "agent": agent_used, "reply": reply, "chat360": sent}
