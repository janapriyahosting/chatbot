import httpx

from app.core.config import settings

SESSION_MESSAGE_URL = "https://app.chat360.io/api/whatsapp/whatsapp-session-messages"


async def send_text(to: str, body: str) -> dict:
    """Send a WhatsApp session text message via Chat360."""
    if not settings.chat360_api_key or not settings.chat360_from:
        raise RuntimeError("CHAT360_API_KEY and CHAT360_FROM must be set to send messages")
    payload = {
        "api_key": settings.chat360_api_key,
        "from": settings.chat360_from,
        "recipient_type": "individual",
        "to": to,
        "type": "text",
        "text": {"body": body},
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(SESSION_MESSAGE_URL, json=payload)
        resp.raise_for_status()
        return resp.json()
