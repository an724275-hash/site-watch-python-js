"""Produce a real, bounded history of scheduled checks for GitHub Pages."""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
from probe import observe

ROOT = Path(__file__).parent


def read_history(path: Path) -> dict | None:
    """Missing history is normal on the first run; unreadable history is not."""
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    if not isinstance(existing, dict) or not isinstance(existing.get("checks"), list):
        raise ValueError("History must contain a checks list; refusing to reset it")
    return existing


async def probe(client: httpx.AsyncClient, target: dict) -> dict:
    return {**target, **await observe(client, target["url"])}


def merge_history(existing: dict | None, latest: dict) -> dict:
    """Keep up to seven days and 400 real snapshots, oldest first."""
    now = datetime.fromisoformat(latest["checked_at"])
    if now.tzinfo is None:
        raise ValueError("The latest check must include a timezone")
    if existing is not None and (
        not isinstance(existing, dict) or not isinstance(existing.get("checks"), list)
    ):
        raise ValueError("History must contain a checks list; refusing to reset it")
    earlier = existing["checks"] if existing is not None else []
    valid = {}
    for check in earlier:
        try:
            at = datetime.fromisoformat(check["checked_at"])
            if 0 <= (now - at).total_seconds() <= 7 * 86400 and isinstance(check["targets"], list):
                valid[at] = check
        except (KeyError, ValueError, TypeError):
            continue
    valid[now] = latest
    return {
        "updated_at": latest["checked_at"],
        "checks": [valid[at] for at in sorted(valid)[-400:]],
    }


async def main() -> None:
    history_path = ROOT / "docs" / "history.json"
    existing = read_history(history_path)
    targets = json.loads((ROOT / "targets.json").read_text(encoding="utf-8"))
    async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
        results = await asyncio.gather(*(probe(client, item) for item in targets))
    output = {"checked_at": datetime.now(timezone.utc).isoformat(), "targets": results}
    merged = merge_history(existing, output)
    (ROOT / "docs" / "status.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    history_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
