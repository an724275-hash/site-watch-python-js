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

