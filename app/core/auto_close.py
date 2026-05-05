"""Background task + helper that closes stale `bot`-state conversations.

A conversation is closed when:
- Its status is `bot` (visitor still on the flow, never reached an agent), AND
- Its `updated_at` is older than `STALE_THRESHOLD_HOURS`.

Queued / assigned chats are never touched here — those need human attention.
The same helper is exposed via /api/admin/auto-close-stale so admins can
trigger a manual close (with a configurable threshold) from the UI.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.conversation import (
    Conversation,
    ConversationStatus,
    Message,
    MessageSender,
)

log = logging.getLogger(__name__)

# Defaults for the background loop. The admin endpoint takes its own
# threshold so manual sweeps can be tighter or looser.
STALE_THRESHOLD_HOURS = 24
TICK_SECONDS = 3600  # once an hour — these are stale chats, not time-critical


async def close_stale_bot_convs(
    db: AsyncSession,
    older_than_hours: int,
    actor: str,
) -> int:
    """Close every bot-state conversation older than the threshold. Writes a
    system "Chat closed" message on each so the close is visible in the inbox
    transcript. Returns the number closed. Caller is responsible for commit.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=older_than_hours)
    rows = (await db.execute(
        select(Conversation)
        .where(Conversation.status == ConversationStatus.bot)
        .where(Conversation.updated_at < cutoff)
    )).scalars().all()
    now = datetime.now(timezone.utc)
    for conv in rows:
        conv.status = ConversationStatus.closed
        conv.closed_at = now
        db.add(Message(
            conversation_id=conv.id,
            sender=MessageSender.system,
            kind="system",
            body="Chat closed",
            payload={"event": "closed", "actor": actor, "older_than_hours": older_than_hours},
        ))
    return len(rows)


async def _scan_once() -> None:
    async with SessionLocal() as db:
        n = await close_stale_bot_convs(db, STALE_THRESHOLD_HOURS, actor="auto-close-loop")
        if n:
            await db.commit()
            log.info("auto-close loop closed %d stale bot conversations", n)


async def auto_close_loop() -> None:
    """Run forever. Cancellation via task.cancel() is the stop signal."""
    log.info("auto-close loop started (threshold=%dh, tick=%ds)", STALE_THRESHOLD_HOURS, TICK_SECONDS)
    while True:
        try:
            await _scan_once()
        except Exception:
            log.exception("auto-close scan failed")
        await asyncio.sleep(TICK_SECONDS)
