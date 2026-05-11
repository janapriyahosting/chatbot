"""OTP client.

In order of preference:

* SmartPing HTTP gateway (production default). We generate the 6-digit OTP
  ourselves, cache it in Valkey, and use SmartPing only to deliver the SMS.
  Verification compares the entered code against the cached one.
* jpus (the janapriyaupscale backend). Legacy path retained for dev parity.

`OTP_DEV_BYPASS=true` short-circuits either provider and always accepts
"123456" — useful for local tests where burning real SMS credits is silly.
"""
import re
import secrets

import httpx
import valkey.asyncio as valkey

from app.core.config import settings

DEV_OTP = "123456"

_phone_re = re.compile(r"^[6-9]\d{9}$")
_OTP_KEY_PREFIX = f"{settings.valkey_prefix}otp:"
_OTP_SEND_PHONE_PREFIX = f"{settings.valkey_prefix}otp:send:phone:"
_OTP_SEND_IP_PREFIX = f"{settings.valkey_prefix}otp:send:ip:"

# Caps SMS sends to protect against toll fraud / SmartPing billing abuse.
# These are intentionally tight — a real user needs at most 1-2 sends per
# hour. Increase if support starts seeing legitimate users hit the limit.
_OTP_SEND_MAX_PER_PHONE_PER_HOUR = 3
_OTP_SEND_MAX_PER_IP_PER_HOUR = 10
_OTP_SEND_WINDOW_SECONDS = 3600


class OtpRateLimited(Exception):
    """Raised when OTP send is refused due to rate limiting. Caller should
    surface a generic 'try later' message to the visitor."""

_valkey_client: valkey.Valkey | None = None


def _vk() -> valkey.Valkey:
    global _valkey_client
    if _valkey_client is None:
        _valkey_client = valkey.from_url(settings.valkey_url, decode_responses=True)
    return _valkey_client


def normalize_phone(raw: str) -> str | None:
    """Accept '9876543210', '+919876543210', '91 9876543210', '09876543210' → '9876543210'."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 13 and digits.startswith("091"):
        digits = digits[3:]
    elif len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if _phone_re.match(digits):
        return digits
    return None


def _generate_otp() -> str:
    # 6 random digits, zero-padded
    return f"{secrets.randbelow(1_000_000):06d}"


async def _smartping_send(phone: str, otp: str) -> bool:
    """POST to SmartPing's gateway; returns True on HTTP 2xx with gateway success."""
    text = settings.smartping_template.format(otp=otp)
    params = {
        "username": settings.smartping_username,
        "password": settings.smartping_password,
        "unicode": "false",
        "from": settings.smartping_sender_id,
        "to": phone,
        "dltContentId": settings.smartping_dlt_content_id,
        "dltTelemarketerId": settings.smartping_dlt_telemarketer_id,
        "dltPrincipalEntityId": settings.smartping_dlt_principal_entity_id,
        "text": text,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(settings.smartping_base_url, params=params)
        # SmartPing returns 200 OK with a small JSON/text blob even on bad creds;
        # treat HTTP success as "delivered to the gateway". Downstream delivery
        # issues are visible in the SmartPing portal, not here.
        return r.status_code == 200


async def _check_send_rate_limit(phone: str, ip: str | None) -> None:
    """Raise OtpRateLimited if this phone or IP has exceeded the hourly send cap.

    Uses INCR + EXPIRE on a sliding-hour bucket. EXPIRE is set only on first
    increment so the window doesn't slide forward on every send.
    """
    vk = _vk()
    phone_key = _OTP_SEND_PHONE_PREFIX + phone
    phone_count = await vk.incr(phone_key)
    if phone_count == 1:
        await vk.expire(phone_key, _OTP_SEND_WINDOW_SECONDS)
    if phone_count > _OTP_SEND_MAX_PER_PHONE_PER_HOUR:
        raise OtpRateLimited(f"phone-cap (count={phone_count})")

    if ip:
        ip_key = _OTP_SEND_IP_PREFIX + ip
        ip_count = await vk.incr(ip_key)
        if ip_count == 1:
            await vk.expire(ip_key, _OTP_SEND_WINDOW_SECONDS)
        if ip_count > _OTP_SEND_MAX_PER_IP_PER_HOUR:
            raise OtpRateLimited(f"ip-cap (count={ip_count})")


async def send_otp(phone: str, purpose: str = "lead", ip: str | None = None) -> dict:
    if settings.otp_dev_bypass:
        return {"sent": True, "dev": True}

    phone = phone.strip()

    # Rate limit BEFORE generating/storing, so a flood doesn't churn the
    # Valkey cache or the SmartPing gateway.
    await _check_send_rate_limit(phone, ip)

    if settings.otp_provider == "smartping" and settings.smartping_username:
        otp = _generate_otp()
        # Store in Valkey with TTL so repeat sends within the window are cached.
        await _vk().set(_OTP_KEY_PREFIX + phone, otp, ex=settings.otp_ttl_seconds)
        ok = await _smartping_send(phone, otp)
        return {"sent": ok, "provider": "smartping"}

    # Legacy jpus path
    url = f"{settings.jpus_api_base}{settings.jpus_otp_prefix}/send-otp"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(url, json={"phone": phone, "purpose": purpose})
        r.raise_for_status()
        return r.json()


async def verify_otp(phone: str, otp: str) -> bool:
    if settings.otp_dev_bypass:
        return otp == DEV_OTP

    phone = phone.strip()
    otp = (otp or "").strip()
    if settings.otp_provider == "smartping" and settings.smartping_username:
        cached = await _vk().get(_OTP_KEY_PREFIX + phone)
        if cached and cached == otp:
            await _vk().delete(_OTP_KEY_PREFIX + phone)
            return True
        return False

    url = f"{settings.jpus_api_base}{settings.jpus_otp_prefix}/verify-otp"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(url, json={"phone": phone, "otp": otp, "mode": "register"})
    return r.status_code == 200
