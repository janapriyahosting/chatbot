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
    """
    origin = request.headers.get("origin")
    if not origin or site_id is None:
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


async def _persist_outputs(
    db: AsyncSession, conv: Conversation, outputs: list[dict]
) -> None:
    for out in outputs:
        db.add(
            Message(
                conversation_id=conv.id,
                sender=MessageSender.bot,
                kind=out.get("kind", "text"),
                body=(out.get("config") or {}).get("body"),
                payload=out,
            )
        )


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
async def get_persona(bot_key: str, db: AsyncSession = Depends(get_session)) -> dict:
    """Public endpoint — lets the widget show the bot's avatar/name/branding
    on the launcher before the visitor opens the chat (no session yet)."""
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
async def poll(payload: PollRequest, db: AsyncSession = Depends(get_session)) -> PollResponse:
    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")

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


@router.post("/close", status_code=204)
async def visitor_close(
    payload: _CloseRequest, db: AsyncSession = Depends(get_session)
) -> None:
    """Visitor-initiated end of chat. Closes the conversation and drops a
    system message so the agent's inbox sees the disconnect on next poll."""
    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
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
    positive: bool
    comment: str | None = None


@router.post("/csat", status_code=204)
async def visitor_csat(
    payload: _CsatRequest, db: AsyncSession = Depends(get_session)
) -> None:
    """Visitor-submitted satisfaction rating. One per conversation; second
    submission overwrites the first (cheap and forgiving)."""
    from app.models.csat import CsatRating

    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
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
    conversation_id: uuid.UUID, db: AsyncSession = Depends(get_session)
) -> dict:
    """Lets the widget skip the prompt if a rating was already submitted
    (e.g. the visitor reloaded the page after rating)."""
    from app.models.csat import CsatRating
    row = (
        await db.execute(select(CsatRating).where(CsatRating.conversation_id == conversation_id))
    ).scalars().first()
    return {"submitted": bool(row), "positive": row.positive if row else None}


from fastapi import File as _FFile
from fastapi import UploadFile as _UploadFile


@router.post("/upload")
async def visitor_upload(
    conversation_id: uuid.UUID,
    request: Request,
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


@router.post("/message", response_model=MessageOut)
async def send_message(
    payload: WidgetMessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> MessageOut:
    conv = await db.get(Conversation, payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="conversation not found")
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
