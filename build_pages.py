"""Produce a real, bounded history of scheduled checks for GitHub Pages."""
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).parent


async def probe(client: httpx.AsyncClient, target: dict) -> dict:
    started = time.perf_counter()
    try:
        response = await client.get(target["url"])
        return {"id": target["id"], "name": target["name"], "url": target["url"], "ok": 200 <= response.status_code < 400, "status_code": response.status_code, "latency_ms": round((time.perf_counter() - started) * 1000)}
    except httpx.HTTPError as exc:
        return {"id": target["id"], "name": target["name"], "url": target["url"], "ok": False, "error": type(exc).__name__, "latency_ms": round((time.perf_counter() - started) * 1000)}


def merge_history(existing: dict | None, latest: dict) -> dict:
    """Keep up to seven days and 400 real snapshots, oldest first."""
    now = datetime.fromisoformat(latest["checked_at"])
    earlier = existing.get("checks", []) if isinstance(existing, dict) else []
    valid = []
    for check in earlier:
        try:
            at = datetime.fromisoformat(check["checked_at"])
            if 0 <= (now - at).total_seconds() <= 7 * 86400 and isinstance(check["targets"], list):
                valid.append(check)
        except (KeyError, ValueError, TypeError):
            continue
    valid.append(latest)
    return {"updated_at": latest["checked_at"], "checks": valid[-400:]}


async def main() -> None:
    targets = json.loads((ROOT / "targets.json").read_text(encoding="utf-8"))
    async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
        results = await asyncio.gather(*(probe(client, item) for item in targets))
    output = {"checked_at": datetime.now(timezone.utc).isoformat(), "targets": results}
    (ROOT / "docs" / "status.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    history_path = ROOT / "docs" / "history.json"
    try:
        existing = json.loads(history_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        existing = None
    history_path.write_text(json.dumps(merge_history(existing, output), ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
