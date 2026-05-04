"""Background task that reassigns chats whose agent has gone silent.

Runs every 30s. A conversation is reassigned when:
- Its status is `assigned`, AND
- The most recent assignment is older than IDLE_THRESHOLD_SECONDS, AND
- There has been no agent message on it for IDLE_THRESHOLD_SECONDS.

We exclude the current assignee from the next round-robin pick to avoid
ping-pong when only one agent is available.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.core.working_hours import is_office_open
from app.models.conversation import (
    Assignment,
    AssignmentMode,
    Conversation,
    ConversationStatus,
    Message,
    MessageSender,
)
from app.models.user import User, UserRole

log = logging.getLogger(__name__)

IDLE_THRESHOLD_SECONDS = 120
TICK_SECONDS = 30


async def _pick_next_agent(db: AsyncSession, exclude_id) -> User | None:
    if not await is_office_open(db):
        return None
    q = (
        select(User)
        .where(User.role == UserRole.agent)
        .where(User.is_active.is_(True))
        .where(User.is_available.is_(True))
        .where(User.id != exclude_id)
        .order_by(User.last_assigned_at.asc().nulls_first(), User.created_at.asc())
        .limit(1)
    )
    return (await db.execute(q)).scalars().first()


async def _reassign_one(db: AsyncSession, conv: Conversation) -> bool:
    """Reassign a single stale conversation. Returns True if reassigned."""
    # Find current assignee
    cur = (
        await db.execute(
            select(Assignment)
            .where(Assignment.conversation_id == conv.id)
            .order_by(Assignment.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    if not cur:
        return False
    next_agent = await _pick_next_agent(db, exclude_id=cur.user_id)
    if next_agent is None:
        # Nobody else available — leave the conversation with the current agent
        # rather than queueing it (visitor won't see any change).
        return False
    now = datetime.now(timezone.utc)
    await db.execute(update(User).where(User.id == next_agent.id).values(last_assigned_at=now))
    db.add(
        Assignment(
            conversation_id=conv.id,
            user_id=next_agent.id,
            mode=AssignmentMode.round_robin,
            assigned_by=None,
        )
    )
    db.add(
        Message(
            conversation_id=conv.id,
            sender=MessageSender.system,
            kind="system",
            body=f"Reassigned to {next_agent.display_name} (previous agent idle)",
            payload={"event": "reassigned", "user_id": str(next_agent.id), "reason": "idle"},
        )
    )
    return True


async def _scan_once() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=IDLE_THRESHOLD_SECONDS)
    async with SessionLocal() as db:
        # Pull every assigned conversation. The total is small in practice (an
        # office of agents handling tens of live chats), so loading all is fine.
        convs = (
            await db.execute(
                select(Conversation).where(Conversation.status == ConversationStatus.assigned)
            )
        ).scalars().all()
        any_changes = False
        for conv in convs:
            # Latest assignment time
            cur = (
                await db.execute(
                    select(Assignment)
                    .where(Assignment.conversation_id == conv.id)
                    .order_by(Assignment.created_at.desc())
                    .limit(1)
                )
            ).scalars().first()
            if not cur or cur.created_at > cutoff:
                continue  # not assigned long enough yet
            # Last agent message on this conv
            last_agent_msg = (
                await db.execute(
                    select(Message)
                    .where(Message.conversation_id == conv.id, Message.sender == MessageSender.agent)
                    .order_by(Message.created_at.desc())
                    .limit(1)
                )
            ).scalars().first()
            if last_agent_msg and last_agent_msg.created_at > cutoff:
                continue  # agent has spoken recently — fine
            # Idle threshold met. Try to reassign.
            if await _reassign_one(db, conv):
                any_changes = True
        if any_changes:
            await db.commit()


async def reassign_loop() -> None:
    """Run forever. Cancellation via task.cancel() is the stop signal."""
    log.info("reassign loop started (idle=%ds, tick=%ds)", IDLE_THRESHOLD_SECONDS, TICK_SECONDS)
    while True:
        try:
            await _scan_once()
        except Exception:
            log.exception("reassign scan failed")
        await asyncio.sleep(TICK_SECONDS)
