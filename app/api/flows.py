import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import require_role
from app.models.bot import Bot
from app.models.flow import Flow, FlowVersion
from app.models.user import UserRole
from app.api.widget import _handle_otp_side_effects
from app.runtime.engine import advance
from app.runtime.validate import validate_flow
from app.schemas.flow import FlowCreate, FlowOut, FlowPreviewRequest, FlowUpdate

router = APIRouter(
    prefix="/api/bots/{bot_id}/flows",
    tags=["flows"],
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)


async def _get_bot(bot_id: uuid.UUID, db: AsyncSession) -> Bot:
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="bot not found")
    return bot


def _validate_definition(definition: dict) -> list[str]:
    errors, warnings = validate_flow(definition)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    return warnings


@router.post("", response_model=FlowOut, status_code=201)
async def create_flow(
    bot_id: uuid.UUID,
    payload: FlowCreate,
    db: AsyncSession = Depends(get_session),
) -> Flow:
    await _get_bot(bot_id, db)
    definition = payload.definition.model_dump()
    warnings = _validate_definition(definition)

    flow = Flow(
        bot_id=bot_id,
        name=payload.name,
        definition=definition,
        current_version=1,
    )
    db.add(flow)
    await db.flush()
    db.add(FlowVersion(flow_id=flow.id, version=1, definition=definition))
    await db.commit()
    await db.refresh(flow)
    out = FlowOut.model_validate(flow)
    out.warnings = warnings
    return out


@router.get("", response_model=list[FlowOut])
async def list_flows(
    bot_id: uuid.UUID, db: AsyncSession = Depends(get_session)
) -> list[Flow]:
    await _get_bot(bot_id, db)
    result = await db.execute(
        select(Flow).where(Flow.bot_id == bot_id).order_by(Flow.created_at.desc())
    )
    return list(result.scalars().all())


@router.get("/{flow_id}", response_model=FlowOut)
async def get_flow(
    bot_id: uuid.UUID,
    flow_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
) -> Flow:
    flow = await db.get(Flow, flow_id)
    if not flow or flow.bot_id != bot_id:
        raise HTTPException(status_code=404, detail="flow not found")
    return flow


@router.patch("/{flow_id}", response_model=FlowOut)
async def update_flow(
    bot_id: uuid.UUID,
    flow_id: uuid.UUID,
    payload: FlowUpdate,
    db: AsyncSession = Depends(get_session),
) -> Flow:
    flow = await db.get(Flow, flow_id)
    if not flow or flow.bot_id != bot_id:
        raise HTTPException(status_code=404, detail="flow not found")

    if payload.name is not None:
        flow.name = payload.name

    warnings: list[str] = []
    if payload.definition is not None:
        definition = payload.definition.model_dump()
        warnings = _validate_definition(definition)
        flow.definition = definition
        flow.current_version += 1
        db.add(
            FlowVersion(
                flow_id=flow.id,
                version=flow.current_version,
                definition=definition,
            )
        )

    await db.commit()
    await db.refresh(flow)
    out = FlowOut.model_validate(flow)
    out.warnings = warnings
    return out


@router.post("/{flow_id}/publish", response_model=FlowOut)
async def publish_flow(
    bot_id: uuid.UUID,
    flow_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
) -> Flow:
    flow = await db.get(Flow, flow_id)
    if not flow or flow.bot_id != bot_id:
        raise HTTPException(status_code=404, detail="flow not found")
    flow.is_published = True
    await db.commit()
    await db.refresh(flow)
    return flow


@router.post("/preview")
async def preview_flow(
    bot_id: uuid.UUID,
    payload: FlowPreviewRequest,
) -> dict:
    """Runs one step of a draft flow without persisting anything.

    The editor calls this repeatedly as the user clicks through the preview,
    passing back the latest context so state builds up turn by turn.
    """
    definition = payload.definition.model_dump()
    errors, _ = validate_flow(definition)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    ctx = payload.context or {}
    otp_pre = await _handle_otp_side_effects(None, ctx, reply_payload=payload.reply)
    result = await advance(definition, ctx, reply=payload.reply)
    otp_post = await _handle_otp_side_effects(None, ctx, reply_payload=None)
    result.outputs = otp_pre + result.outputs + otp_post
    return {
        "outputs": result.outputs,
        "awaiting": result.awaiting,
        "ended": result.ended,
        "context": ctx,
    }
