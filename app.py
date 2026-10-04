"""Small site monitor. Targets come only from a trusted local file."""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from probe import observe

ROOT = Path(__file__).parent
DB_PATH = Path(os.environ.get("SITE_WATCH_DB", ROOT / "site-watch.sqlite3"))
TARGETS_PATH = Path(os.environ.get("SITE_WATCH_TARGETS", ROOT / "targets.json"))
INTERVAL = max(30, int(os.environ.get("SITE_WATCH_INTERVAL", "300")))


def targets() -> list[dict]:
    data = json.loads(TARGETS_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("targets.json must contain a list")
    for item in data:
        if not isinstance(item, dict) or not all(isinstance(item.get(key), str) and item[key].strip() for key in ("id", "name", "url")):
            raise ValueError("Each target needs id, name and url strings")
        if not item["url"].startswith("https://"):
            raise ValueError("Only HTTPS targets are supported")
    if len({item["id"] for item in data}) != len(data):
        raise ValueError("Target IDs must be unique")
    return data


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("""CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY, target_id TEXT NOT NULL, checked_at TEXT NOT NULL,
        status_code INTEGER, latency_ms INTEGER, ok INTEGER NOT NULL, error TEXT
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS checks_target_time ON checks(target_id, id DESC)")
    columns = {row[1] for row in db.execute("PRAGMA table_info(checks)")}
    for name, kind in (("final_url", "TEXT"), ("redirect_count", "INTEGER")):
        if name not in columns:
            db.execute(f"ALTER TABLE checks ADD COLUMN {name} {kind}")
    return db


async def check_target(target: dict, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    async with httpx.AsyncClient(timeout=8, follow_redirects=False, transport=transport) as client:
        result = await observe(client, target["url"])
    record = {
        "target_id": target["id"],
        "checked_at": datetime.now(timezone.utc).isoformat(),
        **result,
    }
    with connect() as db:
        db.execute("""INSERT INTO checks
            (target_id, checked_at, status_code, latency_ms, ok, error, final_url, redirect_count)
            VALUES (:target_id, :checked_at, :status_code, :latency_ms, :ok, :error, :final_url, :redirect_count)""", record)
    return record


async def check_all() -> None:
    await asyncio.gather(*(check_target(target) for target in targets()))


async def monitor_loop() -> None:
    while True:
        await check_all()
        await asyncio.sleep(INTERVAL)


@asynccontextmanager
async def lifespan(_: FastAPI):
    targets()
    with connect():
        pass
    task = asyncio.create_task(monitor_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Site Watch", lifespan=lifespan)


@app.get("/")
def home():
    html = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html.replace('name="site-watch-mode" content="snapshot"', 'name="site-watch-mode" content="api"'))


@app.get("/api/targets")
def list_targets():
    with connect() as db:
        result = []
        for target in targets():
            rows = db.execute("SELECT * FROM checks WHERE target_id=? ORDER BY id DESC LIMIT 2016", (target["id"],)).fetchall()
            result.append({**target, "history": [dict(row) for row in reversed(rows)]})
        return result


@app.post("/api/targets/{target_id}/check")
async def check_now(target_id: str):
    target = next((item for item in targets() if item["id"] == target_id), None)
    if target is None:
        raise HTTPException(404, "Unknown target")
    return await check_target(target)


@app.get("/health")
def health():
    return {"ok": True}


app.mount("/", StaticFiles(directory=ROOT / "docs", html=True), name="pages")
