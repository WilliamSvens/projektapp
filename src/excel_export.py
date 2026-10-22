from __future__ import annotations

from io import BytesIO

import pandas as pd

from src.db import export_rows
from src.templates import PROJECT_TYPES


SHEET_NAMES = {
    "projects": "Projekt",
    "steps": "Steg",
    "comments": "Kommentarer",
    "photos": "Foton",
    "apartments": "Lägenheter",
}


def _rows_to_frame(rows) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame([dict(row) for row in rows])


def build_workbook(combined: bool = False) -> bytes:
    data = export_rows()
    projects = _rows_to_frame(data["projects"])
    if not projects.empty:
        projects["project_type"] = projects["project_type"].map(
            lambda value: PROJECT_TYPES.get(value, value)
        )

    frames = {
        "projects": projects,
        "steps": _rows_to_frame(data["steps"]),
        "comments": _rows_to_frame(data["comments"]),
        "photos": _rows_to_frame(data["photos"]),
        "apartments": _rows_to_frame(data["apartments"]),
    }

    buffer = BytesIO()
    if combined:
        combined_frames = []
        for key, frame in frames.items():
            if frame.empty:
                continue
            tagged = frame.copy()
            tagged.insert(0, "flik", SHEET_NAMES[key])
            combined_frames.append(tagged)
        out = pd.concat(combined_frames, ignore_index=True) if combined_frames else pd.DataFrame()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            out.to_excel(writer, index=False, sheet_name="Allt")
    else:
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            for key, frame in frames.items():
                frame.to_excel(writer, index=False, sheet_name=SHEET_NAMES[key])
    return buffer.getvalue()
