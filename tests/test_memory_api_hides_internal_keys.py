"""GET /api/memory must not surface hub plumbing as user facts.

Long-term memory stores `home_assistant: {url: ...}` next to "my dog is Mika".
Settings → Memory rendered that as a "Home → assistant" card with the bridge
URL as its value — an HA term and an internal address on a customer screen.
"""
from __future__ import annotations

import pytest

from backend.routers import status_router


@pytest.mark.asyncio
async def test_home_assistant_record_is_hidden(monkeypatch):
    monkeypatch.setattr(
        status_router,
        "list_memory",
        lambda: {
            "home_assistant": {"url": "http://homeassistant.local:8123/"},
            "_scratch": "x",
            "my dog": "Mika",
            "home_city": "Binyamina",
        },
    )
    res = await status_router.get_memory()
    keys = [e["key"] for e in res["memory"]]
    assert keys == ["my dog", "home_city"]


@pytest.mark.asyncio
async def test_list_form_is_filtered_too(monkeypatch):
    monkeypatch.setattr(
        status_router,
        "list_memory",
        lambda: [{"key": "home_assistant", "value": {}}, {"key": "wife", "value": "Adi"}],
    )
    res = await status_router.get_memory()
    assert [e["key"] for e in res["memory"]] == ["wife"]
