"""File uploads for flow media (images/videos embedded in nodes)."""
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi import File as FFile

from app.core.security import require_role
from app.models.user import UserRole

router = APIRouter(
    prefix="/uploads",
    tags=["uploads"],
    dependencies=[Depends(require_role(UserRole.admin, UserRole.supervisor))],
)

_ROOT = Path(__file__).resolve().parent.parent.parent / "public" / "uploads"
_ROOT.mkdir(parents=True, exist_ok=True)

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
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
_MAX_BYTES = 25 * 1024 * 1024  # 25 MB — comfortably fits most brochures


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
                raise HTTPException(status_code=413, detail="file too large (max 20 MB)")
            out.write(chunk)

    return {
        "url": f"/static/uploads/{dest.name}",
        "filename": dest.name,
        "original_filename": file.filename or dest.name,
        "size": total,
        "content_type": ctype,
    }
