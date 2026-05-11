import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import require_role
from app.models.site import Site
from app.models.user import UserRole
from app.schemas.bot import SiteCreate, SiteOut, SiteUpdate

router = APIRouter(
    prefix="/api/sites",
    tags=["sites"],
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)


def _default_allowed_origins(domain: str) -> list[str]:
    """https + http of the domain — what the backfill migration sets too."""
    return [f"https://{domain}", f"http://{domain}"]


@router.post("", response_model=SiteOut, status_code=201)
async def create_site(payload: SiteCreate, db: AsyncSession = Depends(get_session)) -> Site:
    origins = payload.allowed_origins or _default_allowed_origins(payload.domain)
    site = Site(name=payload.name, domain=payload.domain, allowed_origins=origins)
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


@router.patch("/{site_id}", response_model=SiteOut)
async def update_site(
    site_id: uuid.UUID,
    payload: SiteUpdate,
    db: AsyncSession = Depends(get_session),
) -> Site:
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="site not found")
    if payload.name is not None:
        site.name = payload.name
    if payload.domain is not None:
        site.domain = payload.domain
    if payload.allowed_origins is not None:
        site.allowed_origins = payload.allowed_origins
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="domain already registered")
    await db.refresh(site)
    return site
