from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from src.db import UPLOAD_DIR, delete_photo


def photo_path(stored_name: str) -> Path:
    return UPLOAD_DIR / stored_name


def save_upload(project_id: int, step_id: int, original_name: str, data: bytes) -> str:
    suffix = Path(original_name).suffix.lower() or ".jpg"
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"}:
        suffix = ".jpg"
    stored_name = f"{project_id}/{step_id}/{uuid4().hex}{suffix}"
    dest = photo_path(stored_name)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return stored_name


def remove_photo(photo_id: int) -> None:
    row = delete_photo(photo_id)
    if row is None:
        return
    path = photo_path(row["stored_name"])
    if path.exists():
        path.unlink()
