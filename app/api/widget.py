import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import Message as AgentMessage
from app.agents.router import AgentRouter
from app.core.assignment import assign_conversation
from app.core.config import settings
from app.core.db import get_session
from app.core.geo import is_allowed_region
from app.core.otp import OtpRateLimited, normalize_phone, send_otp, verify_otp
from app.runtime.form_types import validate_field, validate_form
from app.models.bot import Bot
from app.models.conversation import (
    Assignment,
    AssignmentMode,
    Conversation,
    ConversationStatus,
    Message,
    MessageSender,
)
from app.models.flow import Flow
from app.models.lead import Lead, LeadUtm
from app.models.site import Site

import valkey.asyncio as _valkey
from app.runtime.engine import advance
from app.schemas.widget import (
    MessageOut,
    PollRequest,
    PollResponse,
    ReplyRequest,
    SessionStart,
    StepResponse,
    WidgetMessageRequest,
)
from app.models.user import User

router = APIRouter(prefix="/widget", tags=["widget"])
_ai_router = AgentRouter()

from pathlib import Path
_WIDGET_UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "public" / "uploads"
_WIDGET_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
_WIDGET_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".mp4", ".webm", ".mov"}
_WIDGET_MAX_BYTES = 10 * 1024 * 1024  # 10 MB for visitors

# --- Valkey-backed widget rate limits ------------------------------------
# Tight enough to deter LLM-cost abuse and disk DoS, loose enough that a
# normal human chat never trips them. Tuned per action below.
_WIDGET_RL_PREFIX = f"{settings.valkey_prefix}widget:"
_widget_vk: _valkey.Valkey | None = None

# The chatbot-api's own host. /test/<bot_key> is served from here for admin
# previewing, so its Origin must always pass — otherwise tightening a site's
# allowed_origins silently breaks the preview UX.
_PUBLIC_BASE_ORIGIN = (settings.public_base_url or "").rstrip("/")


def _wvk() -> _valkey.Valkey:
    global _widget_vk
    if _widget_vk is None:
        _widget_vk = _valkey.from_url(settings.valkey_url, decode_responses=True)
    return _widget_vk


async def _enforce_origin(
    request: Request, site_id: uuid.UUID | None, db: AsyncSession
) -> None:
    """403 if the Origin header doesn't match the site's allowed_origins.

    Permissive defaults: no Origin header (server-to-server, native app, or
    no-CORS context) and sites without an allowed_origins list both pass.
    The migration backfills the list from each site's existing `domain`, so
    every site is gated immediately on rollout without admin action.
    Our own PUBLIC_BASE_URL is always allowed so the /test/<bot_key> preview
    page keeps working without admins having to whitelist us on every site.
    """
    origin = request.headers.get("origin")
    if not origin or site_id is None:
        return
    if _PUBLIC_BASE_ORIGIN and origin.rstrip("/") == _PUBLIC_BASE_ORIGIN:
        return
    site = await db.get(Site, site_id)
    if not site or not site.allowed_origins:
        return
    if origin not in site.allowed_origins:
        raise HTTPException(status_code=403, detail="origin not allowed")


async def _enforce_origin_for_conv(
    request: Request, conv: Conversation, db: AsyncSession
) -> None:
    if not request.headers.get("origin"):
        return
    bot = await db.get(Bot, conv.bot_id)
    await _enforce_origin(request, bot.site_id if bot else None, db)


def _check_visitor_match(conv: Conversation, visitor_id: str | None) -> None:
    """Prevent IDOR — a leaked conversation_id must NOT let a third party
    read the transcript, close the chat, submit CSAT, or trigger the doc-click
    email. The widget stores visitor_id in localStorage from /widget/session
    and is expected to echo it on every per-conversation call.

    We return 404 (not 403) so an attacker can't distinguish "wrong owner"
    from "no such conversation".
    """
    if not visitor_id or not secrets.compare_digest(
        str(conv.visitor_id or ""), str(visitor_id)
    ):
        raise HTTPException(status_code=404, detail="conversation not found")


async def _rate_limit(
    request: Request,
    *,
    action: str,
    conversation_id: uuid.UUID | None = None,
    per_ip_max: int = 60,
    per_conv_max: int = 30,
    window: int = 60,
) -> None:
    """Token-bucket rate limit on widget calls.

    EXPIRE is set only on first INCR so the window doesn't slide forward
    on every call. 429 on over-limit.
    """
    vk = _wvk()
    ip = request.client.host if request.client else "unknown"

    ip_key = f"{_WIDGET_RL_PREFIX}ip:{action}:{ip}"
    n = await vk.incr(ip_key)
    if n == 1:
        await vk.expire(ip_key, window)
    if n > per_ip_max:
        raise HTTPException(status_code=429, detail="too many requests")

    if conversation_id is not None:
        c_key = f"{_WIDGET_RL_PREFIX}conv:{action}:{conversation_id}"
        m = await vk.incr(c_key)
        if m == 1:
            await vk.expire(c_key, window)
        if m > per_conv_max:
            raise HTTPException(status_code=429, detail="too many requests")


async def _get_flow_for_bot(bot_id: uuid.UUID, db: AsyncSession) -> Flow:
    """Prefer a published flow; fall back to the latest draft so dev/preview works."""
    result = await db.execute(
        select(Flow)
        .where(Flow.bot_id == bot_id, Flow.is_published.is_(True))
        .order_by(Flow.created_at.desc())
        .limit(1)
    )
    flow = result.scalars().first()
    if flow:
        return flow
    result = await db.execute(
        select(Flow).where(Flow.bot_id == bot_id).order_by(Flow.created_at.desc()).limit(1)
    )
    flow = result.scalars().first()
    if not flow:
        raise HTTPException(status_code=404, detail="no flow configured for bot")
    return flow


_FEEDBACK_ELIGIBLE_KINDS = {"text", "image", "video", "document", "carousel"}


async def _persist_outputs(
    db: AsyncSession, conv: Conversation, outputs: list[dict]
) -> None:
    """Persist runtime outputs as Message rows. Each output dict is mutated
    in place to include `message_id` for kinds the visitor can rate — this
    lets the widget attach feedback buttons without waiting for the next poll
    to assign IDs server-side."""
    for out in outputs:
        kind = out.get("kind", "text")
        msg = Message(
            id=uuid.uuid4(),
            conversation_id=conv.id,
            sender=MessageSender.bot,
            kind=kind,
            body=(out.get("config") or {}).get("body"),
            payload=out,
        )
        db.add(msg)
        if kind in _FEEDBACK_ELIGIBLE_KINDS:
            out["message_id"] = str(msg.id)


async def _handle_otp_side_effects(
    request: Request | None, ctx: dict, reply_payload: dict | None
) -> list[dict]:
    """Send OTP on entry, verify OTP on reply. Returns extra outputs to append.

    Sets `otp_verified` in the conversation context so the engine advances on
    the next call. Increments `otp_attempts` on failure; after `max_attempts`
    the lead is marked unverified and the flow advances regardless.

    Pass `request=None` to skip the region check (e.g. admin preview).
    """
    extras: list[dict] = []
    awaiting = ctx.get("awaiting") or {}
    awaiting_type = awaiting.get("type")

    # --- SEND: runtime flagged pending_otp_send on entry to the otp node
    pending = ctx.pop("pending_otp_send", None)
    if pending:
        ok, reason = (True, "") if request is None else is_allowed_region(request)
        if not ok:
            extras.append(
                {"kind": "text", "config": {"body": "OTP is unavailable in your region."}}
            )
            # Skip OTP: mark as verified=false and let reply-handling bypass it.
            # We don't block the flow entirely; the admin can gate downstream
            # nodes on `answers.otp_ok` if they want strictness.
            ctx["otp_blocked"] = reason
        else:
            phone = normalize_phone(pending.get("phone") or "")
            if not phone:
                extras.append(
                    {"kind": "text", "config": {"body": "We couldn't read your phone number. Please start again."}}
                )
            else:
                ip = request.client.host if request and request.client else None
                try:
                    await send_otp(phone, ip=ip)
                    ctx["otp_sent_for"] = phone
                    ctx["otp_attempts"] = 0
                except OtpRateLimited:
                    # Don't reveal whether the cap was per-phone or per-IP —
                    # surface a generic message so attackers can't probe.
                    extras.append(
                        {"kind": "text", "config": {"body": "Too many OTP requests. Please try again later."}}
                    )
                except Exception:
                    extras.append(
                        {"kind": "text", "config": {"body": "Couldn't send OTP right now. Please try later."}}
                    )

    # --- VERIFY: reply came in for an otp-awaiting node
    if reply_payload is not None and awaiting_type == "otp":
        otp_raw = str(reply_payload.get("value") or reply_payload.get("otp") or "").strip()
        phone = ctx.get("otp_sent_for")
        ctx["otp_attempts"] = (ctx.get("otp_attempts") or 0) + 1
        ok = False
        if phone and otp_raw:
            try:
                ok = await verify_otp(phone, otp_raw)
            except Exception:
                ok = False
        if ok:
            ctx["otp_verified"] = True
            ctx["answers"].setdefault("otp", {})
            ctx["answers"]["otp"]["verified"] = True
            extras.append({"kind": "text", "config": {"body": "Verified ✓"}})
        else:
            if ctx["otp_attempts"] >= settings.otp_max_attempts:
                extras.append(
                    {"kind": "text", "config": {"body": "Too many incorrect attempts. Moving on."}}
                )
                ctx["otp_verified"] = True  # unblock the flow
                ctx["answers"].setdefault("otp", {})
                ctx["answers"]["otp"]["verified"] = False
            else:
                left = settings.otp_max_attempts - ctx["otp_attempts"]
                extras.append(
                    {"kind": "text", "config": {"body": f"Incorrect OTP. {left} attempt(s) left."}}
                )
                # Re-surface the OTP input
                extras.append({"kind": "otp", "config": {"phone": phone, "length": 6}})
    return extras


@router.get("/persona/{bot_key}")
async def get_persona(
    bot_key: str, request: Request, db: AsyncSession = Depends(get_session)
) -> dict:
    """Public endpoint — lets the widget show the bot's avatar/name/branding
    on the launcher before the visitor opens the chat (no session yet)."""
    # Loose cap: defends against bot-key enumeration scraping.
    await _rate_limit(request, action="persona", per_ip_max=120, window=60)
    bot_result = await db.execute(select(Bot).where(Bot.public_key == bot_key))
    bot = bot_result.scalars().first()
    if not bot or not bot.is_active:
        raise HTTPException(status_code=404, detail="bot not found")
    return {
        "name": bot.persona_name,
        "avatar": bot.persona_avatar,
        "footer_text": bot.widget_footer_text,
        "theme_color": bot.theme_color,
    }


@router.post("/session", response_model=StepResponse)
async def start_session(
    payload: SessionStart,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> StepResponse:
    # Per-IP rate limit; no conversation_id yet (one is about to be created).
    await _rate_limit(request, action="session", per_ip_max=30, window=60)

    bot_result = await db.execute(select(Bot).where(Bot.public_key == payload.bot_key))
    bot = bot_result.scalars().first()
    if not bot or not bot.is_active:
        raise HTTPException(status_code=404, detail="bot not found")

    await _enforce_origin(request, bot.site_id, db)

    flow = await _get_flow_for_bot(bot.id, db)

    visitor_id = payload.visitor_id or secrets.token_urlsafe(16)
    conv = None
    if payload.visitor_id:
        res = await db.execute(
            select(Conversation)
            .where(Conversation.bot_id == bot.id, Conversation.visitor_id == payload.visitor_id)
            .where(Conversation.status != ConversationStatus.closed)
            .order_by(Conversation.created_at.desc())
            .limit(1)
        )
        conv = res.scalars().first()

    is_resume = conv is not None and bool(conv.context.get("awaiting") or conv.context.get("current_node_id"))

    if conv is None:
        conv = Conversation(
            bot_id=bot.id,
            visitor_id=visitor_id,
            context={"flow_id": str(flow.id), "utm": (payload.utm.model_dump() if payload.utm else {})},
        )
        db.add(conv)
        await db.flush()

    if is_resume:
        # Returning visitor (same visitor_id, open conversation). Replay the
        # stored bot messages so they see the thread they were on, then hand
        # back the current awaiting descriptor. Do NOT re-advance — that would
        # append duplicates of the awaiting node's outputs.
        import json as _json
        from app.runtime.engine import AdvanceResult
        past = (
            await db.execute(
                select(Message)
                .where(Message.conversation_id == conv.id, Message.sender == MessageSender.bot)
                .order_by(Message.created_at.asc())
            )
        ).scalars().all()
        # Dedup: earlier bugs caused /widget/session to re-persist the awaiting
        # node's outputs on every reload. Collapse identical payloads so returning
        # visitors don't see the same bubble stacked 3 times.
        seen_keys: set[str] = set()
        outputs_replay: list[dict] = []
        for m in past:
            if not (isinstance(m.payload, dict) and m.payload.get("kind")):
                continue
            key = _json.dumps(m.payload, sort_keys=True, default=str)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            outputs_replay.append(m.payload)
        result = AdvanceResult(
            outputs=outputs_replay,
            awaiting=conv.context.get("awaiting"),
            ended=conv.status == ConversationStatus.closed,
        )
        # Don't call _persist_outputs — these are already in the DB from before.
    else:
        result = await advance(flow.definition, conv.context, reply=None)
        extra = await _handle_otp_side_effects(request, conv.context, reply_payload=None)
        result.outputs.extend(extra)
        await _persist_outputs(db, conv, result.outputs)

    # Handoff: assign to an agent, fall back to AI (if the node asked for it), or queue.
    # Only relevant for fresh conversations; resume path doesn't re-run the engine.
    handoff = None if is_resume else conv.context.pop("pending_handoff", None)
    takeover = None if is_resume else conv.context.pop("pending_ai_takeover", None)
    if handoff:
        bot = await db.get(Bot, conv.bot_id)
        assigned = False
        if bot and bot.auto_assign:
            await assign_conversation(
                db, conv, user_id=None, mode=AssignmentMode.round_robin, assigned_by=None
            )
            assigned = conv.status == ConversationStatus.assigned
        if not assigned:
            if handoff.get("ai_fallback"):
                conv.status = ConversationStatus.ai
                conv.context["ai_system_prompt"] = handoff.get("ai_system_prompt") or (
                    "You are a helpful customer support assistant."
                )
            else:
                conv.status = ConversationStatus.queued
                msg = (handoff.get("unavailable_message") or "").strip()
                if msg:
                    bubble = {"kind": "text", "config": {"body": msg}}
                    result.outputs.append(bubble)
                    db.add(
                        Message(
                            conversation_id=conv.id,
                            sender=MessageSender.bot,
                            kind="text",
                            body=msg,
                            payload=bubble,
                        )
                    )
    elif takeover:
        conv.status = ConversationStatus.ai
        conv.context["ai_system_prompt"] = takeover.get("system_prompt") or (
            "You are a helpful customer support assistant."
        )
    elif result.ended:
        conv.status = ConversationStatus.closed
        conv.closed_at = datetime.now(timezone.utc)

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(conv, "context")

    await db.commit()
    await db.refresh(conv)

    bot_row = await db.get(Bot, conv.bot_id)
    return StepResponse(
        conversation_id=conv.id,
        visitor_id=conv.visitor_id,
        outputs=result.outputs,
        awaiting=result.awaiting,
        ended=result.ended,
        status=conv.status.value,
        persona={
            "name": bot_row.persona_name,
            "avatar": bot_row.persona_avatar,
            "footer_text": bot_row.widget_footer_text,
            "theme_color": bot_row.theme_color,
        } if bot_row else None,
    )


@router.post("/poll", response_model=PollResponse)
async def poll(
    payload: PollRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> PollResponse:
    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, payload.visitor_id)
    await _enforce_origin_for_conv(request, conv, db)
    # Polling can fire as often as every 2s while the widget is open. Cap
    # well above legitimate usage but tight enough to stop scraping floods.
    await _rate_limit(
        request,
        action="poll",
        conversation_id=conv.id,
        per_ip_max=240,
        per_conv_max=120,
        window=60,
    )

    q = select(Message).where(Message.conversation_id == conv.id)
    if payload.since_id:
        pivot = await db.get(Message, payload.since_id)
        if pivot:
            q = q.where(Message.created_at > pivot.created_at)
    q = q.order_by(Message.created_at.asc())
    msgs = (await db.execute(q)).scalars().all()

    agent_name = None
    if conv.status == ConversationStatus.assigned:
        a = (
            await db.execute(
                select(Assignment)
                .where(Assignment.conversation_id == conv.id)
                .order_by(Assignment.created_at.desc())
                .limit(1)
            )
        ).scalars().first()
        if a:
            user = await db.get(User, a.user_id)
            agent_name = user.display_name if user else None

    return PollResponse(
        status=conv.status.value,
        agent_name=agent_name,
        messages=[
            MessageOut(
                id=m.id,
                sender=m.sender.value,
                kind=m.kind,
                body=m.body,
                payload=m.payload or {},
                created_at=m.created_at.isoformat(),
            )
            for m in msgs
        ],
    )


class _CloseRequest(BaseModel):
    conversation_id: uuid.UUID
    visitor_id: str | None = None


@router.post("/close", status_code=204)
async def visitor_close(
    payload: _CloseRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> None:
    """Visitor-initiated end of chat. Closes the conversation and drops a
    system message so the agent's inbox sees the disconnect on next poll."""
    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, payload.visitor_id)
    await _enforce_origin_for_conv(request, conv, db)
    await _rate_limit(request, action="close", conversation_id=conv.id,
                      per_ip_max=10, per_conv_max=3, window=60)
    if conv.status == ConversationStatus.closed:
        return
    conv.status = ConversationStatus.closed
    conv.closed_at = datetime.now(timezone.utc)
    db.add(
        Message(
            conversation_id=conv.id,
            sender=MessageSender.system,
            kind="system",
            body="Visitor ended the chat",
            payload={"event": "visitor_closed"},
        )
    )
    await db.commit()


class _CsatRequest(BaseModel):
    conversation_id: uuid.UUID
    visitor_id: str | None = None
    positive: bool
    comment: str | None = None


@router.post("/csat", status_code=204)
async def visitor_csat(
    payload: _CsatRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> None:
    """Visitor-submitted satisfaction rating. One per conversation; second
    submission overwrites the first (cheap and forgiving)."""
    from app.models.csat import CsatRating

    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, payload.visitor_id)
    await _enforce_origin_for_conv(request, conv, db)
    await _rate_limit(request, action="csat", conversation_id=conv.id,
                      per_ip_max=20, per_conv_max=5, window=60)
    # Pull the latest assignee (the agent at close time) for fast rollups
    last_assignment = (
        await db.execute(
            select(Assignment)
            .where(Assignment.conversation_id == conv.id)
            .order_by(Assignment.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    agent_user_id = last_assignment.user_id if last_assignment else None

    existing = (
        await db.execute(select(CsatRating).where(CsatRating.conversation_id == conv.id))
    ).scalars().first()
    if existing:
        existing.positive = payload.positive
        existing.comment = (payload.comment or None)
        existing.agent_user_id = agent_user_id
    else:
        db.add(
            CsatRating(
                conversation_id=conv.id,
                agent_user_id=agent_user_id,
                positive=payload.positive,
                comment=(payload.comment or None),
            )
        )
    await db.commit()


@router.get("/csat/{conversation_id}")
async def visitor_csat_status(
    conversation_id: uuid.UUID,
    request: Request,
    visitor_id: str | None = None,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Lets the widget skip the prompt if a rating was already submitted
    (e.g. the visitor reloaded the page after rating)."""
    from app.models.csat import CsatRating
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, visitor_id)
    await _enforce_origin_for_conv(request, conv, db)
    row = (
        await db.execute(select(CsatRating).where(CsatRating.conversation_id == conversation_id))
    ).scalars().first()
    return {"submitted": bool(row), "positive": row.positive if row else None}


_MESSAGE_FEEDBACK_COMMENT_MAX = 1000


class _MessageFeedbackRequest(BaseModel):
    conversation_id: uuid.UUID
    message_id: uuid.UUID
    visitor_id: str | None = None
    rating: str  # 'up' | 'down'
    comment: str | None = None


@router.post("/message-feedback", status_code=204)
async def visitor_message_feedback(
    payload: _MessageFeedbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> None:
    """Visitor thumbs-up/down on a specific bot message. Upsert per
    (message_id, visitor_id) — resubmitting changes the rating/comment.
    Comments are persisted only on 'down' (positive feedback rarely needs text)."""
    from app.models.message_feedback import MessageFeedback

    if payload.rating not in ("up", "down"):
        raise HTTPException(status_code=422, detail="rating must be 'up' or 'down'")

    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, payload.visitor_id)
    await _enforce_origin_for_conv(request, conv, db)
    await _rate_limit(request, action="msgfb", conversation_id=conv.id,
                      per_ip_max=60, per_conv_max=30, window=60)

    msg = await db.get(Message, payload.message_id)
    if not msg or msg.conversation_id != conv.id:
        raise HTTPException(status_code=404, detail="message not found")
    if msg.sender != MessageSender.bot:
        # Visitors can only rate bot answers — rating their own or an agent's
        # message would be confusing and isn't a use case we want to support.
        raise HTTPException(status_code=422, detail="only bot messages can be rated")

    comment = None
    if payload.rating == "down" and payload.comment:
        comment = payload.comment.strip()[:_MESSAGE_FEEDBACK_COMMENT_MAX] or None

    existing = (
        await db.execute(
            select(MessageFeedback).where(
                MessageFeedback.message_id == msg.id,
                MessageFeedback.visitor_id == payload.visitor_id,
            )
        )
    ).scalars().first()
    if existing:
        existing.rating = payload.rating
        existing.comment = comment
    else:
        db.add(
            MessageFeedback(
                message_id=msg.id,
                conversation_id=conv.id,
                visitor_id=str(payload.visitor_id),
                rating=payload.rating,
                comment=comment,
            )
        )
    await db.commit()


@router.get("/message-feedback/{conversation_id}")
async def visitor_message_feedback_status(
    conversation_id: uuid.UUID,
    request: Request,
    visitor_id: str | None = None,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Returns this visitor's own votes on the conversation's messages so the
    widget can restore button state on reload."""
    from app.models.message_feedback import MessageFeedback
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, visitor_id)
    await _enforce_origin_for_conv(request, conv, db)
    rows = (
        await db.execute(
            select(MessageFeedback).where(
                MessageFeedback.conversation_id == conversation_id,
                MessageFeedback.visitor_id == str(visitor_id),
            )
        )
    ).scalars().all()
    return {
        "feedbacks": [
            {
                "message_id": str(r.message_id),
                "rating": r.rating,
                "comment": r.comment,
            }
            for r in rows
        ]
    }


from fastapi import File as _FFile
from fastapi import UploadFile as _UploadFile


@router.post("/upload")
async def visitor_upload(
    conversation_id: uuid.UUID,
    request: Request,
    visitor_id: str | None = None,
    file: _UploadFile = _FFile(...),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Accept a file upload scoped to an active conversation.

    Form-field type=file uses this: widget uploads first, then submits the
    resulting URL as the field value. Conversation must exist and not be closed,
    which keeps this endpoint from becoming a general public file dump.
    """
    import secrets as _s
    from pathlib import Path as _P

    conv = await db.get(Conversation, conversation_id)
    if not conv or conv.status == ConversationStatus.closed:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, visitor_id)

    await _enforce_origin_for_conv(request, conv, db)
    # Tighter cap on uploads — each one writes to disk and can be expensive.
    await _rate_limit(
        request,
        action="upload",
        conversation_id=conv.id,
        per_ip_max=20,
        per_conv_max=5,
        window=60,
    )

    ext = _P(file.filename or "").suffix.lower()
    if ext not in _WIDGET_ALLOWED_EXTS:
        raise HTTPException(status_code=415, detail=f"unsupported extension {ext!r}")

    # Content-Type sanity check. Without this an attacker can rename .exe to
    # .pdf and use /static/uploads as a public phishing-payload host.
    ctype = (file.content_type or "").lower()
    if ext in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
        if not ctype.startswith("image/"):
            raise HTTPException(status_code=415, detail=f"content-type mismatch {ctype!r}")
    elif ext in {".mp4", ".webm", ".mov"}:
        if not ctype.startswith("video/"):
            raise HTTPException(status_code=415, detail=f"content-type mismatch {ctype!r}")
    elif ext == ".pdf":
        if ctype not in {"application/pdf", "application/octet-stream"}:
            raise HTTPException(status_code=415, detail=f"content-type mismatch {ctype!r}")

    uid = _s.token_hex(16)
    dest = _WIDGET_UPLOAD_ROOT / f"{uid}{ext}"
    total = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1 << 16):
            total += len(chunk)
            if total > _WIDGET_MAX_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="file too large (max 10 MB)")
            out.write(chunk)
    return {"url": f"/static/uploads/{dest.name}", "size": total}


import re as _re
from fastapi.responses import FileResponse as _FileResponse

# Random-hex filename pattern produced by both upload paths (admin + widget).
_DL_FILENAME_RE = _re.compile(r"^[0-9a-f]{16,}\.[A-Za-z0-9]+$")


_EMAIL_RE = _re.compile(r"^[\w.+-]+@[\w-]+\.[\w.-]+$")


def _find_visitor_email(answers: dict | None) -> str | None:
    """Best-effort extraction of the visitor's email from the conversation
    `answers` dict. Looks at common keys, then any nested `form` map, then
    any string value that matches an email-shaped regex."""
    if not isinstance(answers, dict):
        return None
    for key in ("email", "Email", "email_address", "emailAddress"):
        v = answers.get(key)
        if isinstance(v, str) and _EMAIL_RE.match(v.strip()):
            return v.strip()
    form = answers.get("form")
    if isinstance(form, dict):
        for v in form.values():
            if isinstance(v, str) and _EMAIL_RE.match(v.strip()):
                return v.strip()
    for v in answers.values():
        if isinstance(v, str) and _EMAIL_RE.match(v.strip()):
            return v.strip()
    return None


def _parse_cc_list(raw: str | list | None) -> list[str]:
    """Accept either a comma/newline-separated string or a list."""
    if not raw:
        return []
    if isinstance(raw, list):
        items = raw
    else:
        items = _re.split(r"[,\n;]+", str(raw))
    return [x.strip() for x in items if x and isinstance(x, str) and _EMAIL_RE.match(x.strip())]


class DocumentClickRequest(BaseModel):
    conversation_id: uuid.UUID
    visitor_id: str | None = None
    node_id: str


@router.post("/document-clicked")
async def widget_document_clicked(
    payload: DocumentClickRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> dict:
    # Tight cap — this endpoint triggers an email send; unbounded calls = mail spam.
    await _rate_limit(
        request,
        action="docclick",
        conversation_id=payload.conversation_id,
        per_ip_max=20,
        per_conv_max=10,
        window=60,
    )
    """Fired by the widget when a visitor clicks the download button on a
    document bubble. Sends a configured email (if enabled on that node) and
    de-dupes per-conversation so multiple clicks don't fan out emails.
    """
    import logging
    log = logging.getLogger(__name__)

    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, payload.visitor_id)
    await _enforce_origin_for_conv(request, conv, db)

    flow = await _get_flow_for_bot(conv.bot_id, db)
    nodes = (flow.definition or {}).get("nodes") or []
    node = next(
        (n for n in nodes if n.get("id") == payload.node_id and n.get("type") == "document"),
        None,
    )
    if not node:
        return {"ok": True, "skipped": "node not found"}

    cfg = node.get("config") or {}
    if not cfg.get("send_email"):
        return {"ok": True, "skipped": "email disabled"}

    # Per-conversation de-dup: don't email twice for the same node.
    sent_set = set((conv.context or {}).get("emailed_doc_nodes") or [])
    if payload.node_id in sent_set:
        return {"ok": True, "skipped": "already sent"}

    customer_email = _find_visitor_email((conv.context or {}).get("answers"))
    cc_list = _parse_cc_list(cfg.get("cc_list"))
    if not customer_email:
        log.info("doc-click: no visitor email captured for conv=%s; skipping", conv.id)
        return {"ok": True, "skipped": "no visitor email"}

    file_url = (cfg.get("url") or "").strip()
    abs_url = file_url
    if file_url.startswith("/"):
        # Reuse public_base_url if configured; otherwise use whatever is on the request.
        base = (getattr(settings, "public_base_url", "") or "").rstrip("/")
        abs_url = f"{base}{file_url}" if base else file_url

    title = cfg.get("title") or cfg.get("original_filename") or "your document"
    subject = (cfg.get("email_subject") or f"Your brochure: {title}").strip()
    body_text = (
        cfg.get("email_body")
        or f"Hi,\n\nThank you for your interest. You can access {title} here:\n{abs_url}\n\nRegards"
    )

    attachments: list[tuple[str, bytes, str]] = []
    try:
        if file_url.startswith("/static/uploads/"):
            fname = file_url.rsplit("/", 1)[-1]
            path = _WIDGET_UPLOAD_ROOT / fname
            if path.exists() and path.stat().st_size <= 10 * 1024 * 1024:
                with path.open("rb") as f:
                    data = f.read()
                attachments.append((
                    cfg.get("original_filename") or fname,
                    data,
                    cfg.get("content_type") or "application/octet-stream",
                ))
    except Exception as e:
        log.warning("doc-click attachment build failed: %s", e)

    from app.core.email_sender import send_email
    sent = await send_email(
        to=customer_email,
        subject=subject,
        body_text=body_text,
        cc=cc_list or None,
        attachments=attachments or None,
    )
    if sent:
        ctx = conv.context or {}
        sent_list = list(ctx.get("emailed_doc_nodes") or [])
        if payload.node_id not in sent_list:
            sent_list.append(payload.node_id)
            ctx["emailed_doc_nodes"] = sent_list
            conv.context = ctx
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(conv, "context")
            await db.commit()
    return {"ok": True, "sent": sent, "to": customer_email, "cc": cc_list, "attached": bool(attachments)}


@router.get("/download/{filename}")
async def download_upload(filename: str, name: str | None = None):
    """Serve an uploaded file as a forced attachment with the original filename.

    Bypasses Chrome's inline PDF viewer (which can drop the extension when
    saving) and works cross-origin where the <a download> attribute is ignored.
    """
    if not _DL_FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="invalid filename")
    path = _WIDGET_UPLOAD_ROOT / filename
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="not found")
    if _WIDGET_UPLOAD_ROOT.resolve() not in resolved.parents:
        raise HTTPException(status_code=400, detail="invalid path")

    safe = _re.sub(r"[^\w.\-]+", "_", name) if name else filename
    if not safe or safe in {".", ".."}:
        safe = filename
    return _FileResponse(
        resolved,
        filename=safe,
        media_type="application/octet-stream",
    )


@router.post("/message", response_model=MessageOut)
async def send_message(
    payload: WidgetMessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> MessageOut:
    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, payload.visitor_id)
    if conv.status not in (
        ConversationStatus.queued,
        ConversationStatus.assigned,
        ConversationStatus.ai,
    ):
        raise HTTPException(status_code=409, detail="not in chat mode")

    await _enforce_origin_for_conv(request, conv, db)
    # /message hits the LLM in AI mode — keep this tight.
    await _rate_limit(
        request,
        action="message",
        conversation_id=conv.id,
        per_ip_max=60,
        per_conv_max=30,
        window=60,
    )
    msg = Message(
        conversation_id=conv.id,
        sender=MessageSender.visitor,
        kind="text",
        body=payload.text,
        payload={"text": payload.text},
    )
    db.add(msg)
    await db.flush()

    # AI mode: generate + persist a bot reply inline so the next poll picks it up.
    if conv.status == ConversationStatus.ai:
        history = (
            await db.execute(
                select(Message)
                .where(Message.conversation_id == conv.id)
                .order_by(Message.created_at.asc())
            )
        ).scalars().all()
        # Include the message we just added (still in this session); also clip history
        # to recent N to keep prompts small and fast.
        agent_messages: list[AgentMessage] = []
        for m in history[-12:]:
            if m.sender == MessageSender.visitor and m.body:
                agent_messages.append(AgentMessage(role="user", content=m.body))
            elif m.sender == MessageSender.bot and m.body:
                agent_messages.append(AgentMessage(role="assistant", content=m.body))
        try:
            reply_text, agent_used = await _ai_router.reply(
                agent_messages, system=conv.context.get("ai_system_prompt")
            )
        except Exception as e:
            reply_text, agent_used = ("Sorry, I'm having trouble right now.", "error")
        db.add(
            Message(
                conversation_id=conv.id,
                sender=MessageSender.bot,
                kind="text",
                body=reply_text,
                payload={"text": reply_text, "ai": True, "model": agent_used},
            )
        )

    await db.commit()
    await db.refresh(msg)
    return MessageOut(
        id=msg.id,
        sender=msg.sender.value,
        kind=msg.kind,
        body=msg.body,
        payload=msg.payload or {},
        created_at=msg.created_at.isoformat(),
    )


@router.post("/reply", response_model=StepResponse)
async def reply(
    payload: ReplyRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> StepResponse:
    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
    _check_visitor_match(conv, payload.visitor_id)
    if conv.status == ConversationStatus.closed:
        raise HTTPException(status_code=410, detail="conversation closed")

    await _enforce_origin_for_conv(request, conv, db)
    await _rate_limit(
        request,
        action="reply",
        conversation_id=conv.id,
        per_ip_max=60,
        per_conv_max=30,
        window=60,
    )

    flow = await _get_flow_for_bot(conv.bot_id, db)

    # Save the visitor's reply as a Message
    awaiting = conv.context.get("awaiting") or {}
    visitor_kind = awaiting.get("type", "input")
    visitor_body = None
    if visitor_kind == "buttons":
        visitor_body = str(payload.payload.get("value", ""))
    elif visitor_kind == "form":
        # Validate form values server-side per field type; reject with 422 on failure
        fields = ((awaiting.get("config") or {}).get("fields") or [])
        raw = payload.payload.get("values") or {}
        cleaned, errors = validate_form(fields, raw)
        if errors:
            raise HTTPException(status_code=422, detail={"field_errors": errors})
        # Replace raw values with normalized ones for downstream nodes
        payload.payload["values"] = cleaned
        visitor_body = None
    elif visitor_kind == "schedule":
        cfg_ = awaiting.get("config") or {}
        field_key = cfg_.get("field") or "site_visit"
        value = str(payload.payload.get("value", "")).strip()
        if not value:
            raise HTTPException(status_code=422, detail={"field_errors": {field_key: "please pick a date"}})
        payload.payload["value"] = value
        visitor_body = value
    elif visitor_kind == "input":
        cfg_ = awaiting.get("config") or {}
        field_key = cfg_.get("field") or "input"
        fake_field = {
            "name": field_key,
            "type": cfg_.get("type") or "text",
            "label": cfg_.get("label") or cfg_.get("prompt") or field_key,
            "required": cfg_.get("required", True),
            "min": cfg_.get("min"),
            "max": cfg_.get("max"),
            "options": cfg_.get("options") or [],
        }
        ok, err, value = validate_field(fake_field, str(payload.payload.get("value", "")))
        if not ok:
            raise HTTPException(status_code=422, detail={"field_errors": {field_key: err or "invalid"}})
        payload.payload["value"] = value
        visitor_body = value
    else:
        visitor_body = str(payload.payload.get("value", ""))
    db.add(
        Message(
            conversation_id=conv.id,
            sender=MessageSender.visitor,
            kind=visitor_kind,
            body=visitor_body,
            payload=payload.payload,
        )
    )

    # Upsert a Lead for this conversation (form + input nodes both contribute).
    # Name/phone/email are common enough to get their own columns; any other
    # answer is captured in the `fields` JSONB for later analysis.
    lead_sv = await db.execute(
        select(Lead).where(Lead.conversation_id == conv.id).limit(1)
    )
    lead = lead_sv.scalars().first()

    form_values = payload.payload.get("values") or {} if visitor_kind == "form" else {}
    field_key = (awaiting.get("config") or {}).get("field") if visitor_kind == "input" else None
    input_value = payload.payload.get("value") if visitor_kind == "input" else None

    if visitor_kind in ("form", "input", "schedule"):
        if lead is None:
            lead = Lead(
                bot_id=conv.bot_id,
                conversation_id=conv.id,
                fields={},
            )
            db.add(lead)
            await db.flush()
            utm = conv.context.get("utm") or {}
            db.add(
                LeadUtm(
                    lead_id=lead.id,
                    utm_source=utm.get("utm_source"),
                    utm_medium=utm.get("utm_medium"),
                    utm_campaign=utm.get("utm_campaign"),
                    utm_term=utm.get("utm_term"),
                    utm_content=utm.get("utm_content"),
                    gclid=utm.get("gclid"),
                    fbclid=utm.get("fbclid"),
                    referrer=utm.get("referrer"),
                    landing_url=utm.get("landing_url"),
                    ip=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                )
            )

        # Merge answer(s) into lead.fields + promote name/phone/email to columns
        merged_fields = dict(lead.fields or {})
        if visitor_kind == "form":
            merged_fields.update(form_values)
            if form_values.get("name"):  lead.name  = str(form_values["name"])[:255]
            if form_values.get("phone"): lead.phone = str(form_values["phone"])
            if form_values.get("email"): lead.email = str(form_values["email"])[:255]
        elif visitor_kind == "input" and field_key:
            merged_fields[field_key] = input_value
            if field_key == "name"  and input_value: lead.name  = str(input_value)[:120]
            if field_key == "phone" and input_value: lead.phone = str(input_value)[:20]
            if field_key == "email" and input_value: lead.email = str(input_value)[:255]
        elif visitor_kind == "schedule":
            sched_cfg = awaiting.get("config") or {}
            sched_field = sched_cfg.get("field") or "site_visit"
            merged_fields[sched_field] = payload.payload.get("value")
        lead.fields = merged_fields
        from sqlalchemy.orm.attributes import flag_modified as _fm
        _fm(lead, "fields")

    # OTP verify happens BEFORE advance() so the engine sees otp_verified in ctx
    otp_extras = await _handle_otp_side_effects(request, conv.context, reply_payload=payload.payload)
    result = await advance(flow.definition, conv.context, reply=payload.payload)
    # OTP send extras (for a new otp node just entered) come from advance-time hook too
    send_extras = await _handle_otp_side_effects(request, conv.context, reply_payload=None)
    result.outputs = otp_extras + result.outputs + send_extras
    await _persist_outputs(db, conv, result.outputs)

    # Mark the lead as phone-verified if the OTP just passed
    if conv.context.get("answers", {}).get("otp", {}).get("verified") is True:
        lead_result = await db.execute(
            select(Lead).where(Lead.conversation_id == conv.id).order_by(Lead.created_at.desc()).limit(1)
        )
        lead = lead_result.scalars().first()
        if lead and not lead.phone_verified:
            lead.phone_verified = True

    handoff = conv.context.pop("pending_handoff", None)
    takeover = conv.context.pop("pending_ai_takeover", None)
    if handoff:
        bot = await db.get(Bot, conv.bot_id)
        assigned = False
        if bot and bot.auto_assign:
            await assign_conversation(
                db, conv, user_id=None, mode=AssignmentMode.round_robin, assigned_by=None
            )
            assigned = conv.status == ConversationStatus.assigned
        if not assigned:
            if handoff.get("ai_fallback"):
                conv.status = ConversationStatus.ai
                conv.context["ai_system_prompt"] = handoff.get("ai_system_prompt") or (
                    "You are a helpful customer support assistant."
                )
            else:
                conv.status = ConversationStatus.queued
                msg = (handoff.get("unavailable_message") or "").strip()
                if msg:
                    bubble = {"kind": "text", "config": {"body": msg}}
                    result.outputs.append(bubble)
                    db.add(
                        Message(
                            conversation_id=conv.id,
                            sender=MessageSender.bot,
                            kind="text",
                            body=msg,
                            payload=bubble,
                        )
                    )
    elif takeover:
        conv.status = ConversationStatus.ai
        conv.context["ai_system_prompt"] = takeover.get("system_prompt") or (
            "You are a helpful customer support assistant."
        )
    elif result.ended:
        conv.status = ConversationStatus.closed
        conv.closed_at = datetime.now(timezone.utc)

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(conv, "context")

    await db.commit()
    await db.refresh(conv)

    return StepResponse(
        conversation_id=conv.id,
        visitor_id=conv.visitor_id,
        outputs=result.outputs,
        awaiting=result.awaiting,
        ended=(conv.status == ConversationStatus.closed),
        status=conv.status.value,
    )
