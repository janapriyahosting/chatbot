"""Admin user management."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import UserOut
from app.core.db import get_session
from app.core.security import current_user, hash_password, require_role
from app.models.user import User, UserRole


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str
    role: UserRole
    password: str


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    display_name: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    is_available: bool | None = None
    password: str | None = None


router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "",
    response_model=list[UserOut],
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)
async def list_users(db: AsyncSession = Depends(get_session)) -> list[User]:
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return list(result.scalars().all())


@router.post(
    "",
    response_model=UserOut,
    status_code=201,
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def create_user(payload: UserCreate, db: AsyncSession = Depends(get_session)) -> User:
    user = User(
        email=payload.email,
        display_name=payload.display_name,
        role=payload.role,
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "email already exists")
    await db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    me: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> None:
    if me.role != UserRole.admin:
        raise HTTPException(403, "forbidden")
    if me.id == user_id:
        raise HTTPException(400, "you cannot delete your own account")
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "not found")
    await db.delete(target)
    await db.commit()


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    me: User = Depends(current_user),
    db: AsyncSession = Depends(get_session),
) -> User:
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "not found")

    # Self-service: anyone can toggle their own availability. Everything else: admin.
    self_only = target.id == me.id and set(payload.model_dump(exclude_unset=True).keys()) <= {
        "is_available",
    }
    if not self_only and me.role != UserRole.admin:
        raise HTTPException(403, "forbidden")

    data = payload.model_dump(exclude_unset=True)
    pw = data.pop("password", None)
    for k, v in data.items():
        setattr(target, k, v)
    if pw:
        target.password_hash = hash_password(pw)
    await db.commit()
    await db.refresh(target)
    return target
