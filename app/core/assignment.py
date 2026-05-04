"""Conversation assignment (round-robin + manual)."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

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


async def _pick_round_robin_agent(db: AsyncSession) -> User | None:
    """Pick the LRU available agent. If the office is currently outside its
    configured working hours, returns None (the conversation will queue)."""
    if not await is_office_open(db):
        return None
    result = await db.execute(
        select(User)
        .where(User.role == UserRole.agent, User.is_active.is_(True), User.is_available.is_(True))
        .order_by(User.last_assigned_at.asc().nulls_first(), User.created_at.asc())
        .limit(1)
    )
    return result.scalars().first()


async def assign_conversation(
    db: AsyncSession,
    conv: Conversation,
    *,
    user_id: uuid.UUID | None,
    mode: AssignmentMode,
    assigned_by: uuid.UUID | None,
) -> Assignment | None:
    """Assign `conv` to a user.

    If `user_id` is None, picks round-robin. Returns None if no agent is available
    (and leaves the conversation queued).
    """
    agent: User | None
    if user_id is None:
        agent = await _pick_round_robin_agent(db)
        if agent is None:
            conv.status = ConversationStatus.queued
            return None
    else:
        agent = await db.get(User, user_id)
        if not agent or agent.role not in (UserRole.agent, UserRole.supervisor):
            raise ValueError("target user is not an agent or supervisor")

    now = datetime.now(timezone.utc)
    await db.execute(update(User).where(User.id == agent.id).values(last_assigned_at=now))

    assignment = Assignment(
        conversation_id=conv.id,
        user_id=agent.id,
        mode=mode,
        assigned_by=assigned_by,
    )
    db.add(assignment)
    conv.status = ConversationStatus.assigned
    db.add(
        Message(
            conversation_id=conv.id,
            sender=MessageSender.system,
            kind="system",
            body=f"Assigned to {agent.display_name}",
            payload={"event": "assigned", "user_id": str(agent.id)},
        )
    )
    return assignment


async def current_assignment(db: AsyncSession, conv_id: uuid.UUID) -> Assignment | None:
    result = await db.execute(
        select(Assignment)
        .where(Assignment.conversation_id == conv_id)
        .order_by(Assignment.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()
