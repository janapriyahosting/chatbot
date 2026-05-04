import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import require_role
from app.models.bot import Bot
from app.models.user import UserRole
from app.schemas.bot import BotCreate, BotOut, BotUpdate

router = APIRouter(
    prefix="/bots",
    tags=["bots"],
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)


def _new_public_key() -> str:
    return "bot_" + secrets.token_urlsafe(24)


@router.post("", response_model=BotOut, status_code=201)
async def create_bot(payload: BotCreate, db: AsyncSession = Depends(get_session)) -> Bot:
    bot = Bot(
        site_id=payload.site_id,
        name=payload.name,
        channel=payload.channel,
        public_key=_new_public_key(),
    )
    db.add(bot)
    await db.commit()
    await db.refresh(bot)
    return bot


@router.get("", response_model=list[BotOut])
async def list_bots(db: AsyncSession = Depends(get_session)) -> list[Bot]:
    result = await db.execute(select(Bot).order_by(Bot.created_at.desc()))
    return list(result.scalars().all())


@router.get("/{bot_id}", response_model=BotOut)
async def get_bot(bot_id: uuid.UUID, db: AsyncSession = Depends(get_session)) -> Bot:
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="bot not found")
    return bot


@router.patch("/{bot_id}", response_model=BotOut)
async def update_bot(
    bot_id: uuid.UUID, payload: BotUpdate, db: AsyncSession = Depends(get_session)
) -> Bot:
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="bot not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(bot, field, value)
    await db.commit()
    await db.refresh(bot)
    return bot


@router.delete("/{bot_id}", status_code=204)
async def delete_bot(
    bot_id: uuid.UUID, db: AsyncSession = Depends(get_session)
) -> None:
    """Hard-delete a bot. CASCADE FKs remove flows, conversations, leads, etc."""
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="bot not found")
    await db.delete(bot)
    await db.commit()
