import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import app


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "DB_PATH", tmp_path / "test.sqlite3")
    config = tmp_path / "targets.json"
    config.write_text(json.dumps([{"id": "demo", "name": "Demo", "url": "https://example.com"}]))
    monkeypatch.setattr(app, "TARGETS_PATH", config)
    # TestClient starts the lifespan task; unit tests must not probe the internet.
    async def no_background_checks():
        pass

    monkeypatch.setattr(app, "check_all", no_background_checks)


def test_check_and_history():
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text="ok"))
    record = asyncio.run(app.check_target(app.targets()[0], transport))
    assert record["ok"] is True
    with TestClient(app.app) as client:
        data = client.get("/api/targets").json()
        assert data[0]["history"][-1]["status_code"] == 200
        assert client.get("/health").json() == {"ok": True}


def test_unknown_target_cannot_be_checked():
    with TestClient(app.app) as client:
        assert client.post("/api/targets/localhost/check").status_code == 404


def test_only_https_targets(tmp_path):
    app.TARGETS_PATH.write_text('[{"id":"bad","name":"Bad","url":"http://localhost"}]')
    with pytest.raises(ValueError):
        app.targets()


def test_local_page_explicitly_enables_api_mode():
    with TestClient(app.app) as client:
        assert 'name="site-watch-mode" content="api"' in client.get("/").text
        assert 'name="site-watch-mode" content="snapshot"' in client.get("/index.html").text


def test_existing_database_migrates_without_losing_checks():
    import sqlite3
    db = sqlite3.connect(app.DB_PATH)
    db.execute("""CREATE TABLE checks (
        id INTEGER PRIMARY KEY, target_id TEXT, checked_at TEXT,
        status_code INTEGER, latency_ms INTEGER, ok INTEGER, error TEXT
    )""")
    db.execute("INSERT INTO checks VALUES (1, 'demo', '2026-10-04T10:00:00Z', 200, 100, 1, NULL)")
    db.commit()
    db.close()
    with app.connect() as migrated:
        assert migrated.execute("SELECT COUNT(*) FROM checks").fetchone()[0] == 1
        assert "final_url" in {row[1] for row in migrated.execute("PRAGMA table_info(checks)")}
