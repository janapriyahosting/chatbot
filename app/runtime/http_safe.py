"""SSRF guard for outbound HTTP from flow `api` nodes.

Admins (or a compromised admin account) author flow definitions that can
issue HTTP requests at runtime. Without guarding, an attacker can hit
internal services (169.254.169.254 cloud metadata, 127.0.0.1, RFC1918
peers) and exfiltrate the response via the visitor reply path.

Defenses applied here:
- scheme whitelist (http, https)
- DNS pre-resolution: every address returned by getaddrinfo must be public
- redirects disabled (a 302 to a private IP would otherwise bypass step 2)
- response body capped (truncated, not errored — flows that legitimately
  pull big blobs shouldn't be flooding the visitor reply anyway)
- short timeout

Residual risk: DNS rebinding between _check_hostname_public() and httpx's
own resolve-and-connect can swap the resolved IP. Closing that fully needs
a custom transport that pins the validated IP. Out of scope for now; flag
in audit if this becomes an internet-exposed risk.
"""
import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

import httpx

MAX_RESPONSE_BYTES = 1 * 1024 * 1024
DEFAULT_TIMEOUT = 15.0
ALLOWED_SCHEMES = ("http", "https")


class UnsafeRequest(Exception):
    """The request target failed the SSRF allowlist."""


def _validate_url(url: str) -> str:
    if not url or not isinstance(url, str):
        raise UnsafeRequest("missing url")
    parsed = urlparse(url)
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise UnsafeRequest(f"scheme not allowed: {parsed.scheme!r}")
    if not parsed.hostname:
        raise UnsafeRequest("no hostname")
    return parsed.hostname


def _check_hostname_public(hostname: str) -> None:
    # Hostnames given as a literal IP get checked directly (skip DNS).
    try:
        ipaddress.ip_address(hostname)
        targets = [hostname]
    except ValueError:
        try:
            results = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        except socket.gaierror as e:
            raise UnsafeRequest(f"dns lookup failed: {e}")
        targets = [r[4][0] for r in results]

    for ip_str in targets:
        try:
            addr = ipaddress.ip_address(ip_str)
        except ValueError:
            raise UnsafeRequest(f"could not parse resolved ip {ip_str!r}")
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        ):
            raise UnsafeRequest(
                f"hostname {hostname!r} resolves to non-public ip {ip_str}"
            )


async def safe_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json: Any = None,
    data: Any = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> tuple[int, dict[str, str], bytes]:
    """Outbound HTTP after SSRF validation.

    Returns (status, response_headers, body_bytes_up_to_cap).
    """
    hostname = _validate_url(url)
    _check_hostname_public(hostname)

    kwargs: dict[str, Any] = {
        "method": method,
        "url": url,
        "headers": headers or {},
    }
    if json is not None:
        kwargs["json"] = json
    elif data is not None:
        kwargs["data"] = data

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        async with client.stream(**kwargs) as r:
            chunks: list[bytes] = []
            seen = 0
            async for chunk in r.aiter_bytes():
                room = MAX_RESPONSE_BYTES - seen
                if room <= 0:
                    break
                if len(chunk) > room:
                    chunks.append(chunk[:room])
                    break
                chunks.append(chunk)
                seen += len(chunk)
            return r.status_code, dict(r.headers), b"".join(chunks)
