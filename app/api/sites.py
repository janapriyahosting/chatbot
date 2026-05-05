from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import require_role
from app.models.site import Site
from app.models.user import UserRole
from app.schemas.bot import SiteCreate, SiteOut

router = APIRouter(
    prefix="/api/sites",
    tags=["sites"],
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)


@router.post("", response_model=SiteOut, status_code=201)
async def create_site(payload: SiteCreate, db: AsyncSession = Depends(get_session)) -> Site:
    site = Site(name=payload.name, domain=payload.domain)
    db.add(site)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="domain already registered")
    await db.refresh(site)
    return site


@router.get("", response_model=list[SiteOut])
async def list_sites(db: AsyncSession = Depends(get_session)) -> list[Site]:
    result = await db.execute(select(Site).order_by(Site.created_at.desc()))
    return list(result.scalars().all())
