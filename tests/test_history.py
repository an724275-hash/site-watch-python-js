from datetime import datetime, timedelta, timezone

import asyncio
import json

import httpx
import pytest

import build_pages
from build_pages import merge_history, read_history


def test_history_keeps_recent_snapshots():
    now = datetime.now(timezone.utc)
    old = {"checked_at": (now - timedelta(days=9)).isoformat(), "targets": []}
    current = {"checked_at": now.isoformat(), "targets": [{"id": "x", "ok": True}]}
    merged = merge_history({"checks": [old]}, current)
    assert merged["checks"] == [current]


def test_history_caps_snapshot_count():
    now = datetime.now(timezone.utc)
    checks = [{"checked_at": (now - timedelta(minutes=i)).isoformat(), "targets": []} for i in range(500, 0, -1)]
    latest = {"checked_at": now.isoformat(), "targets": []}
    assert len(merge_history({"checks": checks}, latest)["checks"]) == 400


def test_history_sorts_and_deduplicates_equivalent_timestamps():
    earlier = {"checked_at": "2026-01-08T11:00:00+00:00", "targets": []}
    latest = {"checked_at": "2026-01-08T12:00:00+00:00", "targets": [{"id": "x", "ok": True}]}
    duplicate = {"checked_at": "2026-01-08T13:00:00+01:00", "targets": []}
    merged = merge_history({"checks": [duplicate, earlier, earlier]}, latest)
    assert merged["checks"] == [earlier, latest]
    assert merged["updated_at"] == latest["checked_at"]


def test_history_ignores_bad_future_and_expired_snapshots():
    latest = {"checked_at": "2026-01-08T12:00:00+00:00", "targets": []}
    boundary = {"checked_at": "2026-01-01T12:00:00+00:00", "targets": []}
    invalid = [
        None, 4, {}, {"checked_at": "bad", "targets": []},
        {"checked_at": "2026-01-08T11:00:00", "targets": []},
        {"checked_at": "2026-01-08T13:00:00+00:00", "targets": []},
        {"checked_at": "2026-01-01T11:59:59+00:00", "targets": []},
        {"checked_at": "2026-01-08T11:00:00+00:00", "targets": {}},
    ]
    assert merge_history({"checks": [boundary, *invalid]}, latest)["checks"] == [boundary, latest]


def test_history_missing_on_first_run(tmp_path):
    assert read_history(tmp_path / "missing.json") is None


@pytest.mark.parametrize("contents", ["{broken", "null", "[]", "{}", '{"checks": null}'])
def test_bad_history_is_not_silently_reset(tmp_path, contents):
    path = tmp_path / "history.json"
    path.write_text(contents, encoding="utf-8")
    with pytest.raises(ValueError):
        read_history(path)
    assert path.read_text(encoding="utf-8") == contents


def test_builder_preserves_history_and_records_real_results(tmp_path, monkeypatch):
    monkeypatch.setattr(build_pages, "ROOT", tmp_path)
    (tmp_path / "docs").mkdir()
    (tmp_path / "targets.json").write_text(json.dumps([
        {"id": "up", "name": "Up", "url": "https://up.example"},
        {"id": "down", "name": "Down", "url": "https://down.example"},
    ]))
    earlier = {"checked_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(), "targets": []}
    path = tmp_path / "docs" / "history.json"
    path.write_text(json.dumps({"checks": [earlier]}))

    def respond(request):
        if request.url.host == "down.example":
            raise httpx.ConnectError("offline", request=request)
        return httpx.Response(200)

    client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(build_pages.httpx, "AsyncClient", lambda **kwargs: client)
    asyncio.run(build_pages.main())
    history = json.loads(path.read_text())
    status = json.loads((tmp_path / "docs" / "status.json").read_text())
    assert history["checks"] == [earlier, status]
    assert status["targets"][0]["ok"] is True
    assert status["targets"][1]["ok"] is False
    assert status["targets"][1]["error"] == "ConnectError"


def test_builder_stops_before_checks_if_history_is_corrupt(tmp_path, monkeypatch):
    monkeypatch.setattr(build_pages, "ROOT", tmp_path)
    (tmp_path / "docs").mkdir()
    path = tmp_path / "docs" / "history.json"
    path.write_text("not json")
    with pytest.raises(ValueError):
        asyncio.run(build_pages.main())
    assert path.read_text() == "not json"
    assert not (tmp_path / "docs" / "status.json").exists()
