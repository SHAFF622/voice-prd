"""Single source of truth: in-memory cache mirrored to SQLite on every write.
This ~30-line file IS the entire 'durable / resume after crash' story for Wayco.
Kill the server mid-call, restart, reload the page -> state resumes from prd.db."""
import sqlite3
from schema import PRD

_db = sqlite3.connect("prd.db", check_same_thread=False)
_db.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, prd TEXT)")
_db.commit()

_cache: dict[str, PRD] = {}


def get(session_id: str) -> PRD:
    if session_id in _cache:
        return _cache[session_id]
    row = _db.execute("SELECT prd FROM sessions WHERE id=?", (session_id,)).fetchone()
    prd = PRD.model_validate_json(row[0]) if row else PRD()
    _cache[session_id] = prd
    return prd


def save(session_id: str, prd: PRD) -> None:
    _cache[session_id] = prd
    _db.execute(
        "INSERT INTO sessions (id, prd) VALUES (?, ?) "
        "ON CONFLICT(id) DO UPDATE SET prd=excluded.prd",
        (session_id, prd.model_dump_json()),
    )
    _db.commit()


def reset(session_id: str) -> PRD:
    """Wipe a session back to an empty PRD (handy between demo takes)."""
    prd = PRD()
    save(session_id, prd)
    return prd
