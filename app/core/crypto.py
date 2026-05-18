"""Symmetric encryption envelope for admin-managed secrets stored in the
`app_setting` table (SMTP password, O365 client_secret, WhatsApp api_key /
webhook_secret, GitHub PAT).

The key (`SECRETS_KEY`) is a 32-byte url-safe base64 Fernet key kept in
.env (mode 600, gitignored). Encrypted values carry an "enc:" prefix so
legacy plaintext rows from before the rollout remain readable until
migrated by `scripts/encrypt_settings.py`.

Failure modes:
- Plaintext write while SECRETS_KEY is unset: raises (refuse silent regress).
- Encrypted read while SECRETS_KEY is unset: returns "" + logs.
- Corrupt token: returns "" + logs (operator re-enters via /settings).
"""
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

log = logging.getLogger(__name__)

_PREFIX = "enc:"
_fernet: Fernet | None = None


def _f() -> Fernet | None:
    global _fernet
    if _fernet is not None:
        return _fernet
    key = (settings.secrets_key or "").strip()
    if not key:
        return None
    _fernet = Fernet(key.encode())
    return _fernet


def is_encrypted(value: str | None) -> bool:
    return bool(value) and value.startswith(_PREFIX)


def encrypt(plaintext: str) -> str:
    """Encrypt a string for at-rest storage. Empty input passes through.
    Already-encrypted input is returned unchanged (idempotent)."""
    if not plaintext:
        return plaintext
    if plaintext.startswith(_PREFIX):
        return plaintext
    f = _f()
    if f is None:
        raise RuntimeError(
            "SECRETS_KEY not configured; refusing to store secret in plaintext"
        )
    token = f.encrypt(plaintext.encode()).decode()
    return _PREFIX + token


def decrypt(value: str | None) -> str:
    """Reverse of `encrypt`. Unprefixed input is returned as-is so legacy
    plaintext rows still work during the rollout window."""
    if not value:
        return ""
    if not value.startswith(_PREFIX):
        return value
    f = _f()
    if f is None:
        log.error("encrypted secret in DB but SECRETS_KEY not configured")
        return ""
    try:
        return f.decrypt(value[len(_PREFIX):].encode()).decode()
    except InvalidToken:
        log.exception("Failed to decrypt secret (corrupted token or wrong key)")
        return ""
