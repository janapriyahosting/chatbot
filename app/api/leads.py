"""Lead listing + CSV export."""
import csv
import io
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import require_role
from app.models.lead import Lead, LeadUtm
from app.models.user import UserRole

router = APIRouter(
    prefix="/api/leads",
    tags=["leads"],
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)


# Cells starting with =, +, -, @, tab, or CR are interpreted as formulas by
# Excel/LibreOffice — visitor-supplied values like `=cmd|'/c calc'!A1` would
# execute on the admin's workstation when the export is opened. Prefix with
# a single quote to defang while leaving the displayed value intact.
_CSV_DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(v: object) -> str:
    s = "" if v is None else str(v)
    if s and s[0] in _CSV_DANGEROUS_PREFIXES:
        return "'" + s
    return s


def _iso(dt: datetime | None) -> str:
    return dt.isoformat() if dt else ""


@router.get("")
async def list_leads(
    bot_id: uuid.UUID | None = None,
    limit: int = Query(default=200, le=1000),
    db: AsyncSession = Depends(get_session),
) -> list[dict]:
    q = select(Lead).order_by(Lead.created_at.desc()).limit(limit)
    if bot_id:
        q = q.where(Lead.bot_id == bot_id)
    leads = (await db.execute(q)).scalars().all()
    result = []
    for l in leads:
        utm = (
            await db.execute(select(LeadUtm).where(LeadUtm.lead_id == l.id))
        ).scalars().first()
        result.append(
            {
                "id": str(l.id),
                "bot_id": str(l.bot_id),
                "conversation_id": str(l.conversation_id) if l.conversation_id else None,
                "created_at": _iso(l.created_at),
                "name": l.name,
                "phone": l.phone,
                "email": l.email,
                "phone_verified": l.phone_verified,
                "fields": l.fields or {},
                "utm_source": utm.utm_source if utm else None,
                "utm_medium": utm.utm_medium if utm else None,
                "utm_campaign": utm.utm_campaign if utm else None,
                "gclid": utm.gclid if utm else None,
                "referrer": utm.referrer if utm else None,
                "landing_url": utm.landing_url if utm else None,
            }
        )
    return result


@router.get(".csv")
async def export_csv(
    bot_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_session),
) -> Response:
    q = select(Lead).order_by(Lead.created_at.desc())
    if bot_id:
        q = q.where(Lead.bot_id == bot_id)
    leads = (await db.execute(q)).scalars().all()

    # Pull all UTM rows in one query and index by lead_id
    lead_ids = [l.id for l in leads]
    utms: dict[uuid.UUID, LeadUtm] = {}
    if lead_ids:
        rows = (
            await db.execute(select(LeadUtm).where(LeadUtm.lead_id.in_(lead_ids)))
        ).scalars().all()
        utms = {u.lead_id: u for u in rows}

    COLS = [
        "created_at", "name", "phone", "email", "phone_verified",
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "gclid", "fbclid", "referrer", "landing_url",
        "bot_id", "conversation_id", "fields_json",
    ]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLS)
    for l in leads:
        u = utms.get(l.id)
        w.writerow([
            _iso(l.created_at),
            _csv_safe(l.name), _csv_safe(l.phone), _csv_safe(l.email),
            "yes" if l.phone_verified else "no",
            _csv_safe(u.utm_source if u else ""),
            _csv_safe(u.utm_medium if u else ""),
            _csv_safe(u.utm_campaign if u else ""),
            _csv_safe(u.utm_term if u else ""),
            _csv_safe(u.utm_content if u else ""),
            _csv_safe(u.gclid if u else ""),
            _csv_safe(u.fbclid if u else ""),
            _csv_safe(u.referrer if u else ""),
            _csv_safe(u.landing_url if u else ""),
            str(l.bot_id),
            str(l.conversation_id) if l.conversation_id else "",
            _csv_safe(json.dumps(l.fields or {}, ensure_ascii=False)),
        ])

    filename = "leads" + (f"-{bot_id}" if bot_id else "") + ".csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"content-disposition": f'attachment; filename="{filename}"'},
    )
