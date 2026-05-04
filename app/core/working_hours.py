"""Global office working hours.

Single org-wide schedule stored in the `app_setting` table under the key
`working_hours`. Shape (all times in Asia/Kolkata):

    {
        "mon": {"start": "09:00", "end": "18:00"},
        "tue": {"start": "09:00", "end": "18:00"},
        ...
    }

A missing day = "office closed". An empty/null schedule = "always open".
"""
from datetime import datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting

TZ = ZoneInfo("Asia/Kolkata")
_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
SETTING_KEY = "working_hours"


def _parse_hhmm(s: str) -> time | None:
    try:
        h, m = s.split(":")
        return time(hour=int(h), minute=int(m))
    except (ValueError, AttributeError):
        return None


def is_within_hours(working_hours: dict | None, now: datetime | None = None) -> bool:
    """Return True if `now` (default: current time in Asia/Kolkata) is inside
    the office's working window. None/empty schedule -> always True."""
    if not working_hours:
        return True
    if now is None:
        now = datetime.now(TZ)
    else:
        now = now.astimezone(TZ)
    day_key = _DAYS[now.weekday()]
    win = working_hours.get(day_key)
    if not isinstance(win, dict):
        return False  # day off
    start = _parse_hhmm(str(win.get("start", "")))
    end = _parse_hhmm(str(win.get("end", "")))
    if not start or not end:
        return False
    cur = now.time()
    if start <= end:
        return start <= cur <= end
    # Overnight window (e.g. 22:00 → 06:00)
    return cur >= start or cur <= end


async def load_working_hours(db: AsyncSession) -> dict | None:
    row = (await db.execute(select(AppSetting).where(AppSetting.key == SETTING_KEY))).scalars().first()
    return row.value if row else None


async def is_office_open(db: AsyncSession, now: datetime | None = None) -> bool:
    return is_within_hours(await load_working_hours(db), now)
