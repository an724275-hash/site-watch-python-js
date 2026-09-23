from datetime import datetime, timedelta, timezone

from build_pages import merge_history


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
