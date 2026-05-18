import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, Request

from app.agents.base import Message
from app.agents.router import AgentRouter
from app.channels import whatsapp_send

log = logging.getLogger(__name__)
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

    # Fail closed: with no configured secret the endpoint would otherwise be an
    # open relay into Groq/Gemini and outbound Chat360 SMS. Refuse traffic
    # until the secret is configured in /admin/settings.
    if not cfg["webhook_secret"]:
        log.warning("WhatsApp webhook hit with no CHAT360_WEBHOOK_SECRET configured; refusing.")
        raise HTTPException(status_code=503, detail="whatsapp webhook not configured")
    # constant-time compare to avoid leaking the secret via timing.
    if not x_webhook_secret or not hmac.compare_digest(
        x_webhook_secret, cfg["webhook_secret"]
    ):
        raise HTTPException(status_code=401, detail="bad webhook secret")

    payload = await request.json()
    parsed = _extract_inbound(payload)
    if not parsed:
        return {"ok": True, "handled": False}

    from_number, text = parsed
    reply, agent_used = await _agent_router.reply([Message(role="user", content=text)])

    sent = None
    send_error = None
    if cfg["api_key"] and cfg["from_number"] and cfg["session_message_url"]:
        try:
            sent = await whatsapp_send.send_text(from_number, reply)
        except Exception as e:
            # Always ack the inbound webhook — a 500 here would make the provider
            # retry and duplicate the conversation. Log loudly instead.
            log.exception("WhatsApp outbound send failed for %s", from_number)
            send_error = str(e)

    return {
        "ok": True,
        "agent": agent_used,
        "reply": reply,
        "whatsapp": sent,
        "send_error": send_error,
    }
