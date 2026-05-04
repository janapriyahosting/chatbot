"""Global app settings (admin-only). Currently exposes the office working
hours used by the round-robin agent picker."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import require_role
from app.core.working_hours import SETTING_KEY
from app.models.app_setting import AppSetting
from app.models.user import UserRole

router = APIRouter(prefix="/settings", tags=["settings"])


class WorkingHoursPayload(BaseModel):
    # {"mon": {"start": "09:00", "end": "18:00"}, ...} — see working_hours.py
    schedule: dict


@router.get(
    "/working-hours",
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)
async def get_working_hours(db: AsyncSession = Depends(get_session)) -> dict:
    row = (await db.execute(select(AppSetting).where(AppSetting.key == SETTING_KEY))).scalars().first()
    return {"schedule": row.value if row else {}}


@router.put(
    "/working-hours",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def put_working_hours(
    payload: WorkingHoursPayload, db: AsyncSession = Depends(get_session)
) -> dict:
    row = (await db.execute(select(AppSetting).where(AppSetting.key == SETTING_KEY))).scalars().first()
    if row:
        row.value = payload.schedule
    else:
        db.add(AppSetting(key=SETTING_KEY, value=payload.schedule))
    await db.commit()
    return {"schedule": payload.schedule}
