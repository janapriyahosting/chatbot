"""Endpoints for the agent console + supervisor inbox."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.assignment import assign_conversation, current_assignment
from app.core.db import get_session
from app.core.security import current_user, require_role
from app.models.conversation import (
    Assignment,
    AssignmentMode,
    Conversation,
    ConversationStatus,
    Message,
    MessageSender,
)
from app.models.user import User, UserRole
from app.schemas.agent import (
    AgentMessageRequest,
    AssignRequest,
    ConversationDetail,
    ConversationOut,
    MessageOut,
)

router = APIRouter(prefix="/agent", tags=["agent"])


def _is_supervisor(user: User) -> bool:
    return user.role in (UserRole.admin, UserRole.supervisor)


async def _conv_summary(db: AsyncSession, conv: Conversation) -> ConversationOut:
    last = (
        await db.execute(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    assignment = await current_assignment(db, conv.id)
    assigned_name = None
    if assignment:
        user = await db.get(User, assignment.user_id)
        assigned_name = user.display_name if user else None
    return ConversationOut(
        id=conv.id,
        bot_id=conv.bot_id,
        visitor_id=conv.visitor_id,
        status=conv.status.value,
        created_at=conv.created_at,
        last_message_at=last.created_at if last else None,
        last_body=last.body if last else None,
        assigned_to_name=assigned_name,
    )


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    scope: str = "mine",
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> list[ConversationOut]:
    """scope=mine: my assigned convs; scope=queue: queued (supervisor only);
    scope=all: both mine and queued (supervisor only)."""
    if scope in ("queue", "all") and not _is_supervisor(user):
        raise HTTPException(403, "supervisor only")

    q = select(Conversation)
    if scope == "mine":
        # Conversations where the latest assignment is me and status is assigned
        sub = (
            select(Assignment.conversation_id, func.max(Assignment.created_at).label("mx"))
            .group_by(Assignment.conversation_id)
            .subquery()
        )
        latest = (
            select(Assignment)
            .join(sub, (Assignment.conversation_id == sub.c.conversation_id) & (Assignment.created_at == sub.c.mx))
            .where(Assignment.user_id == user.id)
            .subquery()
        )
        q = q.join(latest, Conversation.id == latest.c.conversation_id).where(
            Conversation.status == ConversationStatus.assigned
        )
    elif scope == "queue":
        q = q.where(Conversation.status == ConversationStatus.queued)
    elif scope == "all":
        # Supervisor overview: queued + assigned
        q = q.where(
            or_(
                Conversation.status == ConversationStatus.queued,
                Conversation.status == ConversationStatus.assigned,
            )
        )
    else:
        raise HTTPException(400, "bad scope")

    q = q.order_by(Conversation.created_at.desc()).limit(200)
    convs = (await db.execute(q)).scalars().all()
    return [await _conv_summary(db, c) for c in convs]


@router.get("/conversations/{conv_id}", response_model=ConversationDetail)
async def get_conversation(
    conv_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> ConversationDetail:
    conv = await db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "not found")

    assignment = await current_assignment(db, conv.id)
    assigned_user_id = assignment.user_id if assignment else None
    assigned_name = None
    if assignment:
        target = await db.get(User, assignment.user_id)
        assigned_name = target.display_name if target else None

    # Access control: supervisor sees all; agent only sees their own assigned convs
    if not _is_supervisor(user):
        if assigned_user_id != user.id:
            raise HTTPException(403, "not your conversation")

    msgs = (
        await db.execute(
            select(Message).where(Message.conversation_id == conv_id).order_by(Message.created_at.asc())
        )
    ).scalars().all()
    return ConversationDetail(
        id=conv.id,
        bot_id=conv.bot_id,
        visitor_id=conv.visitor_id,
        status=conv.status.value,
        created_at=conv.created_at,
        assigned_user_id=assigned_user_id,
        assigned_to_name=assigned_name,
        messages=[
            MessageOut(
                id=m.id,
                sender=m.sender.value,
                kind=m.kind,
                body=m.body,
                payload=m.payload or {},
                created_at=m.created_at,
            )
            for m in msgs
        ],
    )


@router.post("/conversations/{conv_id}/message", response_model=MessageOut)
async def post_message(
    conv_id: uuid.UUID,
    payload: AgentMessageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> MessageOut:
    conv = await db.get(Conversation, conv_id)
    if not conv or conv.status not in (ConversationStatus.assigned, ConversationStatus.queued):
        raise HTTPException(409, "conversation not in agent mode")

    assignment = await current_assignment(db, conv.id)
    if not _is_supervisor(user):
        if not assignment or assignment.user_id != user.id:
            raise HTTPException(403, "not your conversation")

    msg = Message(
        conversation_id=conv.id,
        sender=MessageSender.agent,
        sender_user_id=user.id,
        kind="text",
        body=payload.text,
        payload={"text": payload.text, "agent_name": user.display_name},
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return MessageOut(
        id=msg.id,
        sender=msg.sender.value,
        kind=msg.kind,
        body=msg.body,
        payload=msg.payload or {},
        created_at=msg.created_at,
    )


@router.post("/conversations/{conv_id}/close")
async def close_conversation(
    conv_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    conv = await db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "not found")
    assignment = await current_assignment(db, conv.id)
    if not _is_supervisor(user):
        if not assignment or assignment.user_id != user.id:
            raise HTTPException(403, "not your conversation")
    conv.status = ConversationStatus.closed
    db.add(
        Message(
            conversation_id=conv.id,
            sender=MessageSender.system,
            kind="system",
            body="Chat closed",
            payload={"event": "closed", "user_id": str(user.id)},
        )
    )
    await db.commit()
    return {"ok": True}


@router.get(
    "/search",
    response_model=list[ConversationOut],
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)
async def search(
    q: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_session),
) -> list[ConversationOut]:
    """Match by visitor_id, by message body, or by captured lead phone/email/name."""
    term = f"%{q.strip()}%"
    if not q.strip():
        return []

    # Gather conversation ids matching any of the three strategies
    by_visitor = await db.execute(
        select(Conversation.id).where(Conversation.visitor_id.ilike(term))
    )
    by_message = await db.execute(
        select(Message.conversation_id).where(Message.body.ilike(term)).distinct()
    )
    from app.models.lead import Lead
    by_lead = await db.execute(
        select(Lead.conversation_id)
        .where(
            or_(
                Lead.phone.ilike(term),
                Lead.email.ilike(term),
                Lead.name.ilike(term),
            )
        )
        .where(Lead.conversation_id.is_not(None))
    )

    conv_ids: set = set()
    for row in by_visitor:
        conv_ids.add(row[0])
    for row in by_message:
        conv_ids.add(row[0])
    for row in by_lead:
        if row[0]:
            conv_ids.add(row[0])

    if not conv_ids:
        return []

    convs = (
        await db.execute(
            select(Conversation)
            .where(Conversation.id.in_(conv_ids))
            .order_by(Conversation.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [await _conv_summary(db, c) for c in convs]


@router.post(
    "/conversations/{conv_id}/assign",
    response_model=ConversationOut,
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)
async def assign(
    conv_id: uuid.UUID,
    payload: AssignRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> ConversationOut:
    conv = await db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "not found")
    if conv.status == ConversationStatus.closed:
        raise HTTPException(409, "conversation closed")

    mode = AssignmentMode.round_robin if payload.user_id is None else AssignmentMode.manual
    try:
        res = await assign_conversation(
            db, conv, user_id=payload.user_id, mode=mode, assigned_by=user.id
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if res is None:
        raise HTTPException(409, "no available agent")
    await db.commit()
    await db.refresh(conv)
    return await _conv_summary(db, conv)
