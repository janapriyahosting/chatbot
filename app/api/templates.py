"""CRUD for canned-reply message templates used in the agent inbox."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import current_user, require_role
from app.models.template import MessageTemplate
from app.models.user import User, UserRole

router = APIRouter(prefix="/templates", tags=["templates"])


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    body: str
    sort_order: int


class TemplateUpsert(BaseModel):
    title: str
    body: str
    sort_order: int = 0


@router.get("", response_model=list[TemplateOut])
async def list_templates(
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> list[MessageTemplate]:
    """Any authenticated staff member can list templates."""
    rows = (
        await db.execute(
            select(MessageTemplate).order_by(
                MessageTemplate.sort_order.asc(), MessageTemplate.created_at.asc()
            )
        )
    ).scalars().all()
    return list(rows)


@router.post(
    "",
    response_model=TemplateOut,
    status_code=201,
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)
async def create_template(
    payload: TemplateUpsert, db: AsyncSession = Depends(get_session)
) -> MessageTemplate:
    t = MessageTemplate(title=payload.title, body=payload.body, sort_order=payload.sort_order)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@router.patch(
    "/{template_id}",
    response_model=TemplateOut,
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)
async def update_template(
    template_id: uuid.UUID,
    payload: TemplateUpsert,
    db: AsyncSession = Depends(get_session),
) -> MessageTemplate:
    t = await db.get(MessageTemplate, template_id)
    if not t:
        raise HTTPException(404, "not found")
    t.title = payload.title
    t.body = payload.body
    t.sort_order = payload.sort_order
    await db.commit()
    await db.refresh(t)
    return t


@router.delete(
    "/{template_id}",
    status_code=204,
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)
async def delete_template(
    template_id: uuid.UUID, db: AsyncSession = Depends(get_session)
) -> None:
    t = await db.get(MessageTemplate, template_id)
    if not t:
        raise HTTPException(404, "not found")
    await db.delete(t)
    await db.commit()
