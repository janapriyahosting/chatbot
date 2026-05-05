"""Admin/supervisor analytics."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import require_role
from app.models.conversation import Assignment, Conversation, ConversationStatus, Message, MessageSender
from app.models.lead import Lead, LeadUtm
from app.models.user import User, UserRole

router = APIRouter(
    prefix="/api/analytics",
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


@router.get("/agents")
async def agent_metrics(
    days: int = 7,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Per-agent performance metrics over the last `days` days.

    Columns:
      chats_handled       distinct conversations assigned in period
      chats_closed        conversations they were the last assignee on at close
      messages_sent       agent messages they wrote in period
      first_response_p50  median seconds from assignment → their first reply
      first_response_p90  p90 same metric
      close_time_p50      median seconds from assignment → conversation closed
      reassigned_away     conversations that were taken away from them by a later
                          assignment within ~3 minutes (i.e. idle reassignments)
    """
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=max(1, min(days, 90)))

    # All agents (active or not — we still want to show their totals)
    agents = (await db.execute(select(User).where(User.role == UserRole.agent))).scalars().all()
    rows: dict = {str(a.id): {
        "id": str(a.id),
        "email": a.email,
        "display_name": a.display_name,
        "is_active": a.is_active,
        "is_available": a.is_available,
        "chats_handled": 0,
        "chats_closed": 0,
        "messages_sent": 0,
        "first_response_p50": None,
        "first_response_p90": None,
        "close_time_p50": None,
        "reassigned_away": 0,
        "csat_count": 0,
        "csat_positive": 0,
        "csat_pct": None,
    } for a in agents}
    if not rows:
        return {"period_days": days, "since": since.isoformat(), "rows": []}

    # 1) chats_handled: distinct conversations assigned in period
    q1 = (
        select(Assignment.user_id, func.count(func.distinct(Assignment.conversation_id)))
        .where(Assignment.created_at >= since)
        .group_by(Assignment.user_id)
    )
    for uid, n in (await db.execute(q1)).all():
        if str(uid) in rows:
            rows[str(uid)]["chats_handled"] = int(n)

    # 2) messages_sent
    q2 = (
        select(Message.sender_user_id, func.count())
        .where(
            Message.sender == MessageSender.agent,
            Message.sender_user_id.is_not(None),
            Message.created_at >= since,
        )
        .group_by(Message.sender_user_id)
    )
    for uid, n in (await db.execute(q2)).all():
        if str(uid) in rows:
            rows[str(uid)]["messages_sent"] = int(n)

    # 3) chats_closed: count conversations closed in period grouped by their
    #    most-recent assignee.
    q3 = text(
        """
        WITH closed AS (
            SELECT id AS conv_id FROM chatbot.conversation
            WHERE status = 'closed' AND closed_at >= :since
        ),
        latest AS (
            SELECT a.conversation_id, a.user_id,
                   ROW_NUMBER() OVER (PARTITION BY a.conversation_id ORDER BY a.created_at DESC) AS rn
            FROM chatbot.assignment a
            WHERE a.conversation_id IN (SELECT conv_id FROM closed)
        )
        SELECT user_id, COUNT(*) FROM latest WHERE rn = 1 GROUP BY user_id
        """
    )
    for uid, n in (await db.execute(q3, {"since": since})).all():
        if str(uid) in rows:
            rows[str(uid)]["chats_closed"] = int(n)

    # 4) first_response: time from each in-period assignment to that agent's
    #    first message on that conversation thereafter. Aggregate per agent.
    q4 = text(
        """
        WITH paired AS (
            SELECT a.user_id,
                   EXTRACT(epoch FROM (
                       (SELECT MIN(m.created_at) FROM chatbot.message m
                        WHERE m.conversation_id = a.conversation_id
                          AND m.sender = 'agent'
                          AND m.sender_user_id = a.user_id
                          AND m.created_at >= a.created_at)
                       - a.created_at
                   )) AS dt
            FROM chatbot.assignment a
            WHERE a.created_at >= :since
        )
        SELECT user_id,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt) AS p50,
               PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY dt) AS p90
        FROM paired WHERE dt IS NOT NULL AND dt >= 0
        GROUP BY user_id
        """
    )
    for uid, p50, p90 in (await db.execute(q4, {"since": since})).all():
        if str(uid) in rows:
            rows[str(uid)]["first_response_p50"] = round(float(p50)) if p50 is not None else None
            rows[str(uid)]["first_response_p90"] = round(float(p90)) if p90 is not None else None

    # 5) close_time: per conversation closed in period, time from FIRST in-period
    #    assignment to closed_at. Group by latest assignee.
    q5 = text(
        """
        WITH closed AS (
            SELECT id AS conv_id, closed_at FROM chatbot.conversation
            WHERE status = 'closed' AND closed_at >= :since
        ),
        first_assign AS (
            SELECT conversation_id, MIN(created_at) AS first_at
            FROM chatbot.assignment
            WHERE conversation_id IN (SELECT conv_id FROM closed)
            GROUP BY conversation_id
        ),
        latest_assign AS (
            SELECT a.conversation_id, a.user_id,
                   ROW_NUMBER() OVER (PARTITION BY a.conversation_id ORDER BY a.created_at DESC) AS rn
            FROM chatbot.assignment a
            WHERE a.conversation_id IN (SELECT conv_id FROM closed)
        )
        SELECT la.user_id,
               PERCENTILE_CONT(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM (c.closed_at - fa.first_at))
               ) AS p50
        FROM closed c
        JOIN first_assign fa  ON fa.conversation_id = c.conv_id
        JOIN latest_assign la ON la.conversation_id = c.conv_id AND la.rn = 1
        GROUP BY la.user_id
        """
    )
    for uid, p50 in (await db.execute(q5, {"since": since})).all():
        if str(uid) in rows:
            rows[str(uid)]["close_time_p50"] = round(float(p50)) if p50 is not None else None

    # 6) reassigned_away: per agent, count conversations where a later assignment
    #    to a different user followed within 3 minutes.
    q6 = text(
        """
        WITH ordered AS (
            SELECT a.conversation_id, a.user_id, a.created_at,
                   LEAD(a.user_id) OVER (PARTITION BY a.conversation_id ORDER BY a.created_at) AS next_user,
                   LEAD(a.created_at) OVER (PARTITION BY a.conversation_id ORDER BY a.created_at) AS next_at
            FROM chatbot.assignment a
            WHERE a.created_at >= :since
        )
        SELECT user_id, COUNT(DISTINCT conversation_id)
        FROM ordered
        WHERE next_user IS NOT NULL
          AND next_user <> user_id
          AND EXTRACT(epoch FROM (next_at - created_at)) <= 600
        GROUP BY user_id
        """
    )
    for uid, n in (await db.execute(q6, {"since": since})).all():
        if str(uid) in rows:
            rows[str(uid)]["reassigned_away"] = int(n)

    # 7) CSAT: per agent_user_id (denormalized on csat_rating), counts in period.
    q7 = text(
        """
        SELECT agent_user_id,
               COUNT(*),
               SUM(CASE WHEN positive THEN 1 ELSE 0 END)
        FROM chatbot.csat_rating
        WHERE created_at >= :since AND agent_user_id IS NOT NULL
        GROUP BY agent_user_id
        """
    )
    for uid, total, pos in (await db.execute(q7, {"since": since})).all():
        if str(uid) in rows:
            r = rows[str(uid)]
            r["csat_count"] = int(total)
            r["csat_positive"] = int(pos or 0)
            r["csat_pct"] = round(100 * (pos or 0) / total) if total else None

    # Sort by chats_handled desc for default order
    sorted_rows = sorted(rows.values(), key=lambda r: r["chats_handled"], reverse=True)
    return {"period_days": days, "since": since.isoformat(), "rows": sorted_rows}
