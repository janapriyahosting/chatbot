"""File uploads for flow media (images/videos embedded in nodes)."""
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi import File as FFile
from pydantic import BaseModel

from app.core.security import require_role
from app.models.user import UserRole

router = APIRouter(
    prefix="/uploads",
    tags=["uploads"],
    # Any authenticated staff member can upload — agents need it to attach
    # files in live chat; admin/supervisor use it for flow media.
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor, UserRole.agent))],
)

_ROOT = Path(__file__).resolve().parent.parent.parent / "public" / "uploads"
_ROOT.mkdir(parents=True, exist_ok=True)

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
_VIDEO_EXTS = {".mp4", ".webm", ".mov"}
_DOCUMENT_EXTS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".csv", ".zip", ".rtf", ".odt", ".ods",
}
_ALLOWED = _IMAGE_EXTS | _VIDEO_EXTS | _DOCUMENT_EXTS
_DOCUMENT_MIMES = {
    "application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/rtf", "application/zip",
    "application/octet-stream",  # common fallback from browsers
    "text/plain", "text/csv", "text/rtf",
}
_MAX_BYTES = 100 * 1024 * 1024  # 100 MB


@router.post("")
async def upload(file: UploadFile = FFile(...)) -> dict:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _ALLOWED:
        raise HTTPException(status_code=415, detail=f"unsupported extension {ext!r}")

    ctype = file.content_type or mimetypes.guess_type(file.filename or "")[0] or ""
    if not (ctype.startswith("image/") or ctype.startswith("video/") or ctype in _DOCUMENT_MIMES):
        raise HTTPException(status_code=415, detail=f"unsupported content-type {ctype!r}")

    # Stream + size cap
    uid = uuid.uuid4().hex
    dest = _ROOT / f"{uid}{ext}"
    total = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1 << 16):
            total += len(chunk)
            if total > _MAX_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="file too large (max 100 MB)")
            out.write(chunk)

    return {
        "url": f"/static/uploads/{dest.name}",
        "filename": dest.name,
        "original_filename": file.filename or dest.name,
        "size": total,
        "content_type": ctype,
    }


def _classify(ext: str) -> str:
    if ext in _IMAGE_EXTS:
        return "image"
    if ext in _VIDEO_EXTS:
        return "video"
    if ext in _DOCUMENT_EXTS:
        return "document"
    return "other"


# Files we created are always {32 hex chars}{ext}; reject anything else
# on DELETE so a path-traversal attempt can't escape _ROOT.
_FILENAME_RE = re.compile(r"^[0-9a-f]{32}\.[A-Za-z0-9]+$")


@router.get("/list")
async def list_uploads(kind: str | None = None) -> list[dict]:
    """List every file currently in public/uploads/. Newest first.

    Optional `kind` filter: image | video | document.
    """
    items: list[dict] = []
    for p in _ROOT.iterdir():
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        k = _classify(ext)
        if kind and k != kind:
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        items.append({
            "filename": p.name,
            "url": f"/static/uploads/{p.name}",
            "kind": k,
            "extension": ext,
            "size": st.st_size,
            "uploaded_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
        })
    items.sort(key=lambda x: x["uploaded_at"], reverse=True)
    return items


class _DeleteBody(BaseModel):
    filename: str


@router.post(
    "/delete",
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)
async def delete_upload(body: _DeleteBody) -> dict:
    """Delete by POST so the URL can be exact-matched in nginx — the static
    /uploads/ prefix would otherwise intercept DELETE on /uploads/<filename>.
    """
    filename = body.filename
    if not _FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="invalid filename")
    path = _ROOT / filename
    # Defence in depth — confirm the resolved path is still inside _ROOT
    # even after symlink resolution.
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="not found")
    if _ROOT.resolve() not in resolved.parents:
        raise HTTPException(status_code=400, detail="invalid path")
    resolved.unlink()
    return {"ok": True, "deleted": filename}
