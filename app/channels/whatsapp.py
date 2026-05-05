from fastapi import APIRouter, Header, HTTPException, Request

from app.agents.base import Message
from app.agents.router import AgentRouter
from app.channels import whatsapp_send

router = APIRouter(prefix="/webhook/whatsapp", tags=["whatsapp"])
_agent_router = AgentRouter()


def _extract_inbound(payload: dict) -> tuple[str, str] | None:
    """Best-effort extraction of (from_number, text) from a WhatsApp inbound webhook.

    Webhook shapes vary by provider/account config, so we probe common keys
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
    cfg = await whatsapp_send._load_whatsapp_config()

    if cfg["webhook_secret"] and x_webhook_secret != cfg["webhook_secret"]:
        raise HTTPException(status_code=401, detail="bad webhook secret")

    payload = await request.json()
    parsed = _extract_inbound(payload)
    if not parsed:
        return {"ok": True, "handled": False}

    from_number, text = parsed
    reply, agent_used = await _agent_router.reply([Message(role="user", content=text)])

    sent = None
    if cfg["api_key"] and cfg["from_number"] and cfg["session_message_url"]:
        sent = await whatsapp_send.send_text(from_number, reply)

    return {"ok": True, "agent": agent_used, "reply": reply, "whatsapp": sent}
