import asyncio

import httpx
import pytest

from probe import observe


def run(handler):
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await observe(client, "https://example.com/")
    return asyncio.run(check())


def test_redirect_checks_destination_not_just_302():
    def handler(request):
        return httpx.Response(302, headers={"location": "/broken"}) if request.url.path == "/" else httpx.Response(503)
    result = run(handler)
    assert result["ok"] is False
    assert result["status_code"] == 503
    assert result["redirect_count"] == 1
    assert result["final_url"] == "https://example.com/broken"


def test_www_redirect_then_success():
    def handler(request):
        return httpx.Response(301, headers={"location": "https://www.example.com/"}) if request.url.host == "example.com" else httpx.Response(200)
    assert run(handler)["ok"] is True


@pytest.mark.parametrize("location", [
    "https://127.0.0.1/", "https://other.example/", "http://example.com/",
    "https://example.com:8443/", "https://user:pass@example.com/",
])
def test_redirect_cannot_leave_trusted_target(location):
    calls = []
    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": location})
    result = run(handler)
    assert result["error"] == "RedirectOutsideTarget"
    assert result["ok"] is False
    assert len(calls) == 1


def test_redirect_loop_is_bounded():
    result = run(lambda request: httpx.Response(302, headers={"location": "/"}))
    assert result["error"] == "TooManyRedirects"
    assert result["ok"] is False


def test_missing_redirect_location():
    assert run(lambda request: httpx.Response(301))["error"] == "MissingRedirectLocation"


def test_connection_error_is_recorded():
    def handler(request):
        raise httpx.ConnectError("offline", request=request)
    result = run(handler)
    assert result["error"] == "ConnectError"
    assert result["status_code"] is None


def test_configured_projects_preserve_original_ids():
    import json
    from pathlib import Path
    items = json.loads((Path(__file__).parents[1] / "targets.json").read_text(encoding="utf-8"))
    assert {item["id"] for item in items} == {"portfolio", "proj", "leather", "marcos", "snekit", "nordic", "duck"}
    assert len({item["url"] for item in items}) == 7
