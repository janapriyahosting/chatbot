"""Request geofencing.

Trust-the-proxy model: we do not maintain a CIDR list. Upstream (Cloudflare, or
nginx with GeoIP2) sets a country header and we gate on it. This keeps the app
itself out of the business of IP→country lookups, which would otherwise require
a licensed MaxMind DB or an external API call on every request.
"""
import ipaddress

from fastapi import Request

from app.core.config import settings


def _is_private(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return addr.is_loopback or addr.is_private or addr.is_link_local


def is_allowed_region(request: Request) -> tuple[bool, str]:
    """Return (allowed, reason). Always allows private/loopback addresses so
    localhost development and same-host service-to-service traffic work."""
    client = request.client.host if request.client else ""
    if _is_private(client):
        return True, "private-ip"

    allow = {c.strip().upper() for c in settings.geofence_allow.split(",") if c.strip()}
    header_value = request.headers.get(settings.geofence_header, "").upper()
    if header_value:
        if header_value in allow:
            return True, f"header={header_value}"
        return False, f"header={header_value} not in {sorted(allow)}"

    # No header set.
    if settings.geofence_strict:
        return False, "no-geo-header (strict mode)"
    return True, "no-geo-header (non-strict)"
