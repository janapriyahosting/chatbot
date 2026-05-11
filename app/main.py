import asyncio
import html as _html
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.auto_close import auto_close_loop
from app.core.reassign import reassign_loop
from app.api.admin_ops import router as admin_ops_router
from app.api.agent import router as agent_router
from app.api.auth import router as auth_router
from app.api.bots import router as bots_router
from app.api.flows import router as flows_router
from app.api.analytics import router as analytics_router
from app.api.api_keys import router as api_keys_router
from app.api.leads import router as leads_router
from app.api.oauth_o365 import router as o365_router
from app.api.settings import router as settings_router
from app.api.sites import router as sites_router
from app.api.templates import router as templates_router
from app.api.uploads import router as uploads_router
from app.api.users import router as users_router
from app.api.widget import router as widget_router
from app.channels.whatsapp import router as whatsapp_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Background tasks
    tasks = [
        asyncio.create_task(reassign_loop()),
        asyncio.create_task(auto_close_loop()),
    ]
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            try:
                await t
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title="ChatBot",
    version="0.1.0",
    lifespan=lifespan,
    # OpenAPI surface is gated — leaving it on in prod enumerates every admin
    # route and schema to unauthenticated callers. Flip DOCS_ENABLED=true in
    # dev/staging .env if you want /docs back.
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

# --- CORS + security headers --------------------------------------------
# Path-aware CORS: the widget loads on customer domains so /widget/* and
# /webhook/* must accept any Origin, but admin endpoints (/api/*, /auth/*,
# the SPA itself) are locked to PUBLIC_BASE_URL. Combined with security
# headers on every response.

_PUBLIC_CORS_PREFIXES = ("/widget/", "/webhook/", "/static/", "/assets/")
_ADMIN_ORIGIN = settings.public_base_url.rstrip("/")

_CSP_HTML = (
    "default-src 'self'; "
    "img-src 'self' data: blob: https:; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "script-src 'self'; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


def _is_public_cors_path(path: str) -> bool:
    if path == "/health" or path.startswith("/test/"):
        return True
    return path.startswith(_PUBLIC_CORS_PREFIXES)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    origin = request.headers.get("origin", "")
    path = request.url.path

    allowed_origin: str | None = None
    if origin:
        if _is_public_cors_path(path):
            allowed_origin = origin
        elif origin.rstrip("/") == _ADMIN_ORIGIN:
            allowed_origin = origin

    if request.method == "OPTIONS" and origin and "access-control-request-method" in request.headers:
        if not allowed_origin:
            return Response(status_code=403)
        return Response(
            status_code=204,
            headers={
                "Access-Control-Allow-Origin": allowed_origin,
                "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": request.headers.get(
                    "access-control-request-headers",
                    "Authorization, Content-Type, X-API-Key, X-Webhook-Secret",
                ),
                "Access-Control-Max-Age": "600",
                "Vary": "Origin",
            },
        )

    response = await call_next(request)

    if allowed_origin:
        response.headers["Access-Control-Allow-Origin"] = allowed_origin
        response.headers.setdefault("Vary", "Origin")

    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
    )
    response.headers.setdefault(
        "Permissions-Policy",
        "geolocation=(), camera=(), microphone=(), interest-cohort=()",
    )

    if response.headers.get("content-type", "").startswith("text/html"):
        response.headers.setdefault("Content-Security-Policy", _CSP_HTML)

    return response

_PUBLIC = Path(__file__).resolve().parent.parent / "public"
app.mount("/static", StaticFiles(directory=_PUBLIC), name="static")

# Register all API routers FIRST so the SPA catch-all (registered last,
# below) doesn't shadow specific paths like /api/admin/status.
app.include_router(admin_ops_router)
app.include_router(auth_router)
app.include_router(whatsapp_router)
app.include_router(sites_router)
app.include_router(bots_router)
app.include_router(flows_router)
app.include_router(widget_router)
app.include_router(users_router)
app.include_router(agent_router)
app.include_router(uploads_router)
app.include_router(leads_router)
app.include_router(analytics_router)
app.include_router(api_keys_router)
app.include_router(templates_router)
app.include_router(settings_router)
app.include_router(o365_router)

@app.get("/test/{bot_key}", include_in_schema=False, response_class=HTMLResponse)
async def widget_test(bot_key: str, title: str = "Chat with us") -> HTMLResponse:
    """Bare host page with the widget pre-embedded — change bot_key in the URL
    to test a different bot/flow without re-integrating the embed script."""
    bot_key_e = _html.escape(bot_key, quote=True)
    title_e = _html.escape(title, quote=True)
    body = f"""<!doctype html><html><head><meta charset="utf-8"/>
<title>Widget test — {bot_key_e}</title>
<link rel="icon" type="image/png" href="/static/favicon.png"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap" rel="stylesheet"/>
<style>body{{font-family:"Lato",-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#111}}
code{{background:#f3f4f6;padding:2px 6px;border-radius:4px}}</style></head>
<body><h1>Widget test page</h1>
<p>Bot key: <code>{bot_key_e}</code></p>
<p>Click the bubble at the bottom-right to chat. Append <code>?utm_source=...&amp;utm_campaign=...</code> to test UTM capture.</p>
<script src="/static/widget.js" data-bot-id="{bot_key_e}" data-title="{title_e}"></script>
</body></html>"""
    return HTMLResponse(body)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# SPA catch-all MUST be registered last — anything above this line is a real
# route; anything not matched falls through to React Router via index.html.
_ADMIN_DIST = Path(__file__).resolve().parent.parent / "admin" / "dist"
if _ADMIN_DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=_ADMIN_DIST / "assets"),
        name="admin_assets",
    )

    from fastapi.responses import FileResponse

    # PWA shell files served from /. They must be at the root URL (not under
    # /assets/) so the service-worker scope spans the whole app and the
    # manifest can be discovered by the browser.
    _PWA_FILES = {
        "manifest.webmanifest": "application/manifest+json",
        "sw.js": "application/javascript",
        "icon-192.png": "image/png",
        "icon-512.png": "image/png",
        "icon-maskable-512.png": "image/png",
    }

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def _admin_spa(full_path: str = "") -> FileResponse:
        # PWA static files: serve from disk with no-store so a fresh sw.js or
        # manifest is picked up immediately. The service worker is how installed
        # apps update themselves — stale-caching it would brick deploys.
        if full_path in _PWA_FILES:
            target = _ADMIN_DIST / full_path
            if target.is_file():
                return FileResponse(
                    target,
                    media_type=_PWA_FILES[full_path],
                    headers={"Cache-Control": "no-store"},
                )
        # SPA fallback: serve index.html for any unmatched path so BrowserRouter
        # can handle client-side routing (e.g., /bots/<uuid>/flows/<uuid>).
        # no-store on index.html so a fresh deploy's hashed bundles are picked
        # up immediately — the bundles themselves are content-addressed.
        return FileResponse(
            _ADMIN_DIST / "index.html",
            headers={"Cache-Control": "no-store"},
        )
