"""Small site monitor. Targets come only from a trusted local file."""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
DB_PATH = Path(os.environ.get("SITE_WATCH_DB", ROOT / "site-watch.sqlite3"))
TARGETS_PATH = Path(os.environ.get("SITE_WATCH_TARGETS", ROOT / "targets.json"))
INTERVAL = max(30, int(os.environ.get("SITE_WATCH_INTERVAL", "300")))


def targets() -> list[dict]:
    data = json.loads(TARGETS_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("targets.json must contain a list")
    for item in data:
        if not all(isinstance(item.get(key), str) for key in ("id", "name", "url")):
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
    return db


async def check_target(target: dict, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    started = time.perf_counter()
    code = None
    error = None
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False, transport=transport) as client:
            response = await client.get(target["url"])
            code = response.status_code
            ok = 200 <= code < 400
    except httpx.HTTPError as exc:
        ok = False
        error = type(exc).__name__
    record = {
        "target_id": target["id"],
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "status_code": code,
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "ok": ok,
        "error": error,
    }
    with connect() as db:
        db.execute("""INSERT INTO checks
            (target_id, checked_at, status_code, latency_ms, ok, error)
            VALUES (:target_id, :checked_at, :status_code, :latency_ms, :ok, :error)""", record)
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
    return FileResponse(ROOT / "docs" / "index.html")


@app.get("/api/targets")
def list_targets():
    with connect() as db:
        result = []
        for target in targets():
            rows = db.execute("SELECT * FROM checks WHERE target_id=? ORDER BY id DESC LIMIT 24", (target["id"],)).fetchall()
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
