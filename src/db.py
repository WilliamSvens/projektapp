from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "app.db"
UPLOAD_DIR = DATA_DIR / "uploads"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                project_type TEXT NOT NULL,
                address TEXT DEFAULT '',
                customer TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pågående',
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                subcategory TEXT,
                title TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                step_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (step_id) REFERENCES steps(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                step_id INTEGER NOT NULL,
                stored_name TEXT NOT NULL,
                original_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (step_id) REFERENCES steps(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS apartments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                unit_number TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                notes TEXT DEFAULT '',
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            """
        )


def create_project(
    name: str,
    project_type: str,
    address: str,
    customer: str,
    notes: str,
    steps: list[tuple[str, str | None, str]],
) -> int:
    ts = now_iso()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO projects (name, project_type, address, customer, status, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pågående', ?, ?, ?)
            """,
            (name.strip(), project_type, address.strip(), customer.strip(), notes.strip(), ts, ts),
        )
        project_id = int(cur.lastrowid)
        conn.executemany(
            """
            INSERT INTO steps (project_id, category, subcategory, title, done, sort_order)
            VALUES (?, ?, ?, ?, 0, ?)
            """,
            [
                (project_id, category, subcategory, title, index)
                for index, (category, subcategory, title) in enumerate(steps)
            ],
        )
    return project_id


def list_projects() -> list[sqlite3.Row]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                p.*,
                COALESCE(SUM(s.done), 0) AS done_steps,
                COUNT(s.id) AS total_steps
            FROM projects p
            LEFT JOIN steps s ON s.project_id = p.id
            GROUP BY p.id
            ORDER BY p.updated_at DESC
            """
        ).fetchall()
    return rows


def get_project(project_id: int) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()


def update_project(
    project_id: int,
    *,
    name: str | None = None,
    address: str | None = None,
    customer: str | None = None,
    status: str | None = None,
    notes: str | None = None,
) -> None:
    project = get_project(project_id)
    if project is None:
        return
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE projects
            SET name = ?, address = ?, customer = ?, status = ?, notes = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                name if name is not None else project["name"],
                address if address is not None else project["address"],
                customer if customer is not None else project["customer"],
                status if status is not None else project["status"],
                notes if notes is not None else project["notes"],
                now_iso(),
                project_id,
            ),
        )


def delete_project(project_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    upload_folder = UPLOAD_DIR / str(project_id)
    if upload_folder.exists():
        shutil.rmtree(upload_folder, ignore_errors=True)


def list_steps(project_id: int) -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT * FROM steps
            WHERE project_id = ?
            ORDER BY sort_order, id
            """,
            (project_id,),
        ).fetchall()


def add_step(project_id: int, category: str, subcategory: str | None, title: str) -> None:
    with get_conn() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM steps WHERE project_id = ?",
            (project_id,),
        ).fetchone()[0]
        conn.execute(
            """
            INSERT INTO steps (project_id, category, subcategory, title, done, sort_order)
            VALUES (?, ?, ?, ?, 0, ?)
            """,
            (project_id, category.strip(), subcategory.strip() if subcategory else None, title.strip(), max_order + 1),
        )
        conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now_iso(), project_id))


def set_step_done(step_id: int, done: bool) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE steps SET done = ? WHERE id = ?", (1 if done else 0, step_id))
        conn.execute(
            """
            UPDATE projects SET updated_at = ?
            WHERE id = (SELECT project_id FROM steps WHERE id = ?)
            """,
            (now_iso(), step_id),
        )


def list_comments(step_id: int) -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM comments WHERE step_id = ? ORDER BY created_at DESC, id DESC",
            (step_id,),
        ).fetchall()


def add_comment(step_id: int, body: str) -> None:
    text = body.strip()
    if not text:
        return
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO comments (step_id, body, created_at) VALUES (?, ?, ?)",
            (step_id, text, now_iso()),
        )
        conn.execute(
            """
            UPDATE projects SET updated_at = ?
            WHERE id = (SELECT project_id FROM steps WHERE id = ?)
            """,
            (now_iso(), step_id),
        )


def list_photos(step_id: int) -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM photos WHERE step_id = ? ORDER BY created_at DESC, id DESC",
            (step_id,),
        ).fetchall()


def add_photo(step_id: int, stored_name: str, original_name: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO photos (step_id, stored_name, original_name, created_at) VALUES (?, ?, ?, ?)",
            (step_id, stored_name, original_name, now_iso()),
        )
        conn.execute(
            """
            UPDATE projects SET updated_at = ?
            WHERE id = (SELECT project_id FROM steps WHERE id = ?)
            """,
            (now_iso(), step_id),
        )


def delete_photo(photo_id: int) -> sqlite3.Row | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if row is None:
            return None
        conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
        return row


def list_apartments(project_id: int) -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM apartments WHERE project_id = ? ORDER BY unit_number COLLATE NOCASE, id",
            (project_id,),
        ).fetchall()


def add_apartment(project_id: int, unit_number: str) -> None:
    number = unit_number.strip()
    if not number:
        return
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO apartments (project_id, unit_number, done, notes) VALUES (?, ?, 0, '')",
            (project_id, number),
        )
        conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now_iso(), project_id))


def set_apartment(apartment_id: int, done: bool, notes: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE apartments SET done = ?, notes = ? WHERE id = ?",
            (1 if done else 0, notes, apartment_id),
        )
        conn.execute(
            """
            UPDATE projects SET updated_at = ?
            WHERE id = (SELECT project_id FROM apartments WHERE id = ?)
            """,
            (now_iso(), apartment_id),
        )


def export_rows() -> dict[str, list[sqlite3.Row]]:
    with get_conn() as conn:
        return {
            "projects": conn.execute("SELECT * FROM projects ORDER BY id").fetchall(),
            "steps": conn.execute("SELECT * FROM steps ORDER BY project_id, sort_order, id").fetchall(),
            "comments": conn.execute("SELECT * FROM comments ORDER BY id").fetchall(),
            "photos": conn.execute("SELECT * FROM photos ORDER BY id").fetchall(),
            "apartments": conn.execute("SELECT * FROM apartments ORDER BY project_id, id").fetchall(),
        }
