"""Shared, bounded HTTP observation for the API and scheduled Pages build."""
import asyncio
import time

import httpx


async def observe(client: httpx.AsyncClient, url: str) -> dict:
    started = time.perf_counter()
    current = httpx.URL(url)
    host = current.host.removeprefix("www.")
    allowed_hosts = {host, f"www.{host}"}
    code, error, redirects = None, None, 0
    try:
        # A redirect is evidence of a response, not of a working destination.
        # Do not follow it onto an unrelated host or a non-HTTPS endpoint.
        async with asyncio.timeout(20):
            for hop in range(6):
                async with client.stream("GET", current, follow_redirects=False) as response:
                    code = response.status_code
                    if code not in {301, 302, 303, 307, 308}:
                        break
                    location = response.headers.get("location")
                    if not location:
                        error = "MissingRedirectLocation"
                        break
                    destination = current.join(location)
                    if (destination.scheme != "https" or destination.host not in allowed_hosts
                            or destination.port not in {None, 443} or destination.userinfo):
                        error = "RedirectOutsideTarget"
                        break
                    if hop == 5:
                        error = "TooManyRedirects"
                        break
                    current = destination
                    redirects += 1
    except (httpx.HTTPError, httpx.InvalidURL, TimeoutError, ValueError) as exc:
        error = type(exc).__name__
    return {
        "ok": error is None and code is not None and 200 <= code < 300,
        "status_code": code,
        "error": error,
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "final_url": str(current),
        "redirect_count": redirects,
    }
