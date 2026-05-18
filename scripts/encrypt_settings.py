"""One-shot migration: encrypt plaintext secrets stored in `app_setting`.

Run once after adding SECRETS_KEY to .env. Safe to re-run — already-encrypted
values (prefix `enc:`) are skipped. Targets the same fields the runtime
encrypts on write: SMTP password, O365 client_secret, WhatsApp api_key +
webhook_secret, GitHub PAT.

Usage:
    .venv/bin/python -m scripts.encrypt_settings
"""
import asyncio

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.core.crypto import encrypt, is_encrypted
from app.core.db import SessionLocal
from app.models.app_setting import AppSetting

# Map of setting key -> field names within that row's `value` dict that
# contain secrets.
_SENSITIVE = {
    "smtp": ["password"],
    "o365": ["client_secret"],
    "whatsapp": ["api_key", "webhook_secret"],
    "git": ["token"],
}


async def main() -> None:
    async with SessionLocal() as db:
        rows = (await db.execute(select(AppSetting))).scalars().all()
        touched = 0
        for row in rows:
            fields = _SENSITIVE.get(row.key)
            if not fields or not isinstance(row.value, dict):
                continue
            changed = False
            new_value = dict(row.value)
            for f in fields:
                v = new_value.get(f)
                if isinstance(v, str) and v and not is_encrypted(v):
                    new_value[f] = encrypt(v)
                    changed = True
            if changed:
                row.value = new_value
                flag_modified(row, "value")
                touched += 1
                print(f"  encrypted: {row.key} ({', '.join(fields)})")
        await db.commit()
        print(f"\nDone. {touched} row(s) updated.")


if __name__ == "__main__":
    asyncio.run(main())
