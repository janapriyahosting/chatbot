"""Seed (or reset password of) the first admin user.

Usage:
    .venv/bin/python scripts/seed_admin.py --email admin@example.com --password "hunter2" --name "Admin"
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models.user import User, UserRole


async def main(email: str, password: str, name: str) -> None:
    async with SessionLocal() as db:
        existing = (await db.execute(select(User).where(User.email == email))).scalars().first()
        if existing:
            existing.password_hash = hash_password(password)
            existing.role = UserRole.admin
            existing.is_active = True
            print(f"updated existing user id={existing.id}")
        else:
            user = User(
                email=email,
                display_name=name,
                password_hash=hash_password(password),
                role=UserRole.admin,
                is_active=True,
            )
            db.add(user)
            await db.flush()
            print(f"created admin id={user.id}")
        await db.commit()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--name", default="Admin")
    args = parser.parse_args()
    asyncio.run(main(args.email, args.password, args.name))
