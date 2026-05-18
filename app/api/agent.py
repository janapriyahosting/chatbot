"""Endpoints for the agent console + supervisor inbox."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import valkey.asyncio as _valkey

from app.agents.base import Message as AgentMessage
from app.agents.groq_agent import GroqAgent
from app.core.assignment import assign_conversation, current_assignment
from app.core.config import settings as _env_settings
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

router = APIRouter(prefix="/api/agent", tags=["agent"])


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
        closed_at=conv.closed_at,
        last_message_at=last.created_at if last else None,
        last_body=last.body if last else None,
        assigned_to_name=assigned_name,
    )


CLOSED_VISIBILITY_HOURS = 24


def _scope_filter(scope: str, user: User):
    """Return (where-clause-list-or-builder, ok_for_role).

    The builder applies extra joins (for scope=mine) and is invoked with
    a base `select(Conversation)` query — used by both list and counts.
    """
    if scope == "mine":
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
        def apply(q):
            return q.join(latest, Conversation.id == latest.c.conversation_id).where(
                Conversation.status == ConversationStatus.assigned
            )
        return apply
    if scope == "queue":
        return lambda q: q.where(Conversation.status == ConversationStatus.queued)
    if scope == "all":
        return lambda q: q.where(
            or_(
                Conversation.status == ConversationStatus.queued,
                Conversation.status == ConversationStatus.assigned,
            )
        )
    if scope == "closed":
        cutoff = datetime.now(timezone.utc) - timedelta(hours=CLOSED_VISIBILITY_HOURS)
        def apply(q):
            q = q.where(Conversation.status == ConversationStatus.closed)
            q = q.where(Conversation.closed_at >= cutoff)
            if not _is_supervisor(user):
                # Agents only see closed convs they had handled
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
                q = q.join(latest, Conversation.id == latest.c.conversation_id)
            return q
        return apply
    raise HTTPException(400, "bad scope")


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    scope: str = "mine",
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> list[ConversationOut]:
    """scope=mine | queue | all | closed.
    queue and all are supervisor-only. closed shows the last 24h."""
    if scope in ("queue", "all") and not _is_supervisor(user):
        raise HTTPException(403, "supervisor only")

    apply = _scope_filter(scope, user)
    q = apply(select(Conversation))
    if scope == "closed":
        q = q.order_by(Conversation.closed_at.desc())
    else:
        q = q.order_by(Conversation.created_at.desc())
    q = q.limit(200)
    convs = (await db.execute(q)).scalars().all()
    return [await _conv_summary(db, c) for c in convs]


@router.get("/conversations/counts")
async def conversation_counts(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> dict[str, int]:
    """Return counts for each scope the caller can see."""
    out: dict[str, int] = {}
    scopes = ["mine", "closed"]
    if _is_supervisor(user):
        scopes += ["queue", "all"]
    for s in scopes:
        apply = _scope_filter(s, user)
        q = apply(select(func.count()).select_from(Conversation))
        out[s] = (await db.execute(q)).scalar_one()
    return out


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

    from app.models.csat import CsatRating
    msgs = (
        await db.execute(
            select(Message).where(Message.conversation_id == conv_id).order_by(Message.created_at.asc())
        )
    ).scalars().all()
    csat_row = (
        await db.execute(select(CsatRating).where(CsatRating.conversation_id == conv_id))
    ).scalars().first()
    csat = (
        {"positive": csat_row.positive, "comment": csat_row.comment, "created_at": csat_row.created_at.isoformat()}
        if csat_row else None
    )
    return ConversationDetail(
        id=conv.id,
        bot_id=conv.bot_id,
        visitor_id=conv.visitor_id,
        status=conv.status.value,
        created_at=conv.created_at,
        closed_at=conv.closed_at,
        assigned_user_id=assigned_user_id,
        assigned_to_name=assigned_name,
        csat=csat,
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

    if payload.attachment_url and payload.attachment_kind in ("image", "document"):
        kind = payload.attachment_kind
        body = payload.text or payload.attachment_filename or ""
        msg_payload: dict = {
            "url": payload.attachment_url,
            "filename": payload.attachment_filename,
            "agent_name": user.display_name,
        }
        if payload.text:
            msg_payload["caption"] = payload.text
    else:
        if not payload.text:
            raise HTTPException(400, "empty message")
        kind = "text"
        body = payload.text
        msg_payload = {"text": payload.text, "agent_name": user.display_name}
    msg = Message(
        conversation_id=conv.id,
        sender=MessageSender.agent,
        sender_user_id=user.id,
        kind=kind,
        body=body,
        payload=msg_payload,
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
    conv.closed_at = datetime.now(timezone.utc)
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


class PolishRequest(BaseModel):
    text: str
    tone: str | None = None  # e.g. "friendly", "formal" — optional


class PolishResponse(BaseModel):
    text: str


_POLISH_SYSTEM = (
    "You rewrite a customer-support agent's draft message so it is clear "
    "and grammatically correct, in plain English. Keep the meaning and "
    "any factual content (names, dates, numbers, links) exactly the same. "
    "Reply with ONLY the rewritten message — no preamble, no quotes."
)

_TONE_HINTS = {
    "friendly":   "Use a friendly, warm tone.",
    "formal":     "Use a formal, professional tone.",
    "concise":    "Be concise — cut filler words while preserving meaning.",
    "empathetic": "Acknowledge the customer's feelings and use an empathetic tone.",
    "apologetic": "Open with a sincere apology and use a contrite tone.",
}


_polish_vk: _valkey.Valkey | None = None


def _polish_vk_client() -> _valkey.Valkey:
    global _polish_vk
    if _polish_vk is None:
        _polish_vk = _valkey.from_url(_env_settings.valkey_url, decode_responses=True)
    return _polish_vk


@router.post("/polish", response_model=PolishResponse)
async def polish(
    payload: PolishRequest, user: User = Depends(current_user)
) -> PolishResponse:
    """Rewrite the agent's draft via Groq. Any logged-in user can call this."""
    # Per-user Groq quota guard. A compromised low-trust agent token would
    # otherwise be able to loop this endpoint and drain the LLM credit pool.
    vk = _polish_vk_client()
    key = f"{_env_settings.valkey_prefix}polish:user:{user.id}"
    n = await vk.incr(key)
    if n == 1:
        await vk.expire(key, 60)
    if n > 30:
        raise HTTPException(status_code=429, detail="polish rate limit (30/min) exceeded")

    draft = (payload.text or "").strip()
    if not draft:
        raise HTTPException(400, "text is empty")
    tone = (payload.tone or "friendly").strip().lower()
    hint = _TONE_HINTS.get(tone) or f"Use a {tone} tone."
    system = _POLISH_SYSTEM + " " + hint
    try:
        agent = GroqAgent()
        out = await agent.reply([AgentMessage(role="user", content=draft)], system=system)
    except Exception as e:
        raise HTTPException(503, f"polish unavailable: {e}")
    return PolishResponse(text=(out or draft).strip())
