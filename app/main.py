import asyncio
import html as _html
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.agents.base import Message
from app.agents.router import AgentRouter
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
    task = asyncio.create_task(reassign_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="ChatBot", version="0.1.0", lifespan=lifespan)

# CORS: widget runs on customer domains, so it must cross-origin to our API.
# Admin routes (/sites, /bots, /flows) get proper auth in Phase 3 — for now
# the open CORS is fine on a dev box but MUST be tightened before prod exposure.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)

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

_ADMIN_DIST = Path(__file__).resolve().parent.parent / "admin" / "dist"
if _ADMIN_DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=_ADMIN_DIST / "assets"),
        name="admin_assets",
    )

    from fastapi.responses import FileResponse

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def _admin_spa(full_path: str = "") -> FileResponse:
        # Serve index.html for any unmatched path so BrowserRouter can handle
        # client-side routing (e.g., /bots/<uuid>/flows/<uuid>).
        # no-store on index.html so a fresh deploy's hashed bundles are picked
        # up immediately — the bundles themselves are content-addressed.
        return FileResponse(
            _ADMIN_DIST / "index.html",
            headers={"Cache-Control": "no-store"},
        )

_agent_router = AgentRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    system: str | None = None
    force: str | None = None  # "groq" | "gemini"


class ChatResponse(BaseModel):
    reply: str
    agent: str


@app.get("/test/{bot_key}", include_in_schema=False, response_class=HTMLResponse)
async def widget_test(bot_key: str, title: str = "Chat with us") -> HTMLResponse:
    """Bare host page with the widget pre-embedded — change bot_key in the URL
    to test a different bot/flow without re-integrating the embed script."""
    bot_key_e = _html.escape(bot_key, quote=True)
    title_e = _html.escape(title, quote=True)
    body = f"""<!doctype html><html><head><meta charset="utf-8"/>
<title>Widget test — {bot_key_e}</title>
<link rel="icon" type="image/png" href="/static/favicon.png"/>
<style>body{{font-family:-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#111}}
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


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    msgs = [Message(role=m.role, content=m.content) for m in req.messages]
    reply, agent_used = await _agent_router.reply(msgs, system=req.system, force=req.force)
    return ChatResponse(reply=reply, agent=agent_used)
