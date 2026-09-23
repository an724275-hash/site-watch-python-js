"""Produce the public, read-only status snapshot for GitHub Pages."""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).parent


async def probe(client: httpx.AsyncClient, target: dict) -> dict:
    try:
        response = await client.get(target["url"])
        return {"id": target["id"], "name": target["name"], "url": target["url"], "ok": 200 <= response.status_code < 400, "status_code": response.status_code}
    except httpx.HTTPError as exc:
        return {"id": target["id"], "name": target["name"], "url": target["url"], "ok": False, "error": type(exc).__name__}


async def main() -> None:
    targets = json.loads((ROOT / "targets.json").read_text(encoding="utf-8"))
    async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
        results = await asyncio.gather(*(probe(client, item) for item in targets))
    output = {"checked_at": datetime.now(timezone.utc).isoformat(), "targets": results}
    (ROOT / "docs" / "status.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())

