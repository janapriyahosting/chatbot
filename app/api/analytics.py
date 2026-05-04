"""Admin/supervisor analytics."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import require_role
from app.models.conversation import Conversation, Message, MessageSender
from app.models.lead import Lead, LeadUtm
from app.models.user import User, UserRole

router = APIRouter(
    prefix="/analytics",
    tags=["analytics"],
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)


async def _count(db: AsyncSession, stmt) -> int:
    return int((await db.execute(stmt)).scalar() or 0)


@router.get("")
async def overview(
    bot_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_session),
) -> dict:
    now = datetime.now(timezone.utc)
    d1 = now - timedelta(days=1)
    d7 = now - timedelta(days=7)
    d30 = now - timedelta(days=30)
    d14 = now - timedelta(days=14)

    conv_base = select(func.count(Conversation.id))
    lead_base = select(func.count(Lead.id))
    msg_base = select(func.count(Message.id))
    if bot_id:
        conv_base = conv_base.where(Conversation.bot_id == bot_id)
        lead_base = lead_base.where(Lead.bot_id == bot_id)

    conv_total = await _count(db, conv_base)
    conv_24h = await _count(db, conv_base.where(Conversation.created_at >= d1))
    conv_7d = await _count(db, conv_base.where(Conversation.created_at >= d7))
    conv_30d = await _count(db, conv_base.where(Conversation.created_at >= d30))

    lead_total = await _count(db, lead_base)
    lead_7d = await _count(db, lead_base.where(Lead.created_at >= d7))
    lead_verified = await _count(db, lead_base.where(Lead.phone_verified.is_(True)))

    # Message breakdown by sender (last 30d)
    msg_rows = (
        await db.execute(
            select(Message.sender, func.count(Message.id))
            .where(Message.created_at >= d30)
            .group_by(Message.sender)
        )
    ).all()
    by_sender = {str(r[0].value if hasattr(r[0], "value") else r[0]): int(r[1]) for r in msg_rows}

    # Top UTM sources among leads in last 30d
    utm_rows = (
        await db.execute(
            select(LeadUtm.utm_source, func.count(LeadUtm.id))
            .where(LeadUtm.created_at >= d30)
            .where(LeadUtm.utm_source.is_not(None))
            .group_by(LeadUtm.utm_source)
            .order_by(func.count(LeadUtm.id).desc())
            .limit(8)
        )
    ).all()
    top_utm = [{"source": r[0], "count": int(r[1])} for r in utm_rows]

    # Conversations per day for last 14 days
    day_rows = (
        await db.execute(
            select(
                func.date_trunc("day", Conversation.created_at).label("day"),
                func.count(Conversation.id),
            )
            .where(Conversation.created_at >= d14)
            .group_by("day")
            .order_by("day")
        )
    ).all()
    daily = [
        {"day": r[0].date().isoformat(), "count": int(r[1])}
        for r in day_rows
    ]

    # Agent availability
    agent_total = await _count(
        db, select(func.count(User.id)).where(User.role == UserRole.agent, User.is_active.is_(True))
    )
    agent_available = await _count(
        db,
        select(func.count(User.id)).where(
            User.role == UserRole.agent,
            User.is_active.is_(True),
            User.is_available.is_(True),
        ),
    )

    return {
        "conversations": {
            "total": conv_total,
            "last_24h": conv_24h,
            "last_7d": conv_7d,
            "last_30d": conv_30d,
        },
        "leads": {
            "total": lead_total,
            "last_7d": lead_7d,
            "verified": lead_verified,
            "verified_pct": round(100 * lead_verified / lead_total, 1) if lead_total else 0.0,
        },
        "messages_by_sender_30d": by_sender,
        "top_utm_sources_30d": top_utm,
        "conversations_per_day_14d": daily,
        "agents": {"total": agent_total, "available": agent_available},
    }
