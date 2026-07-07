# Device Pairing Foundation + Vacuums Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer pair a robot vacuum they own from inside Ziggy's existing pair-device wizard, driving Home Assistant's config-flow behind the scenes, with zero HA terminology ever surfaced.

**Architecture:** A new backend `ha_config_flow` service wraps HA's REST `config_entries/flow` API. A `pairing_catalog` module maps customer-facing brands to hidden HA integration domains and translates all HA strings to Ziggy copy. New generic flow endpoints in `pairing_router.py` drive a per-session state machine. The frontend generalizes the existing `SwitcherPairingFlow` into a schema-driven `SmartDevicePairingFlow` reached from a new "smart device" entry in `PairingWizard`. Everything is additive; existing pairing paths are untouched.

**Tech Stack:** Python 3.11 / FastAPI / httpx (backend); React + Framer Motion (frontend); Home Assistant REST config-flow API; pytest / pytest-asyncio.

## Global Constraints

- **Zero HA exposure (C1):** No `entity_id`, integration domain name (`roborock`, `dreame_vacuum`, …), or HA vocabulary ("config flow", "integration", "config entry", "area") in ANY surfaced string — UI, voice, or error. The `pairing_catalog` is the sole translation layer. Verbatim denylist for the no-leak test: `["config flow", "config entry", "integration", "entity_id", "home assistant", "homeassistant", "hass", "config_entries", "handler", "domain"]` (case-insensitive).
- **Additive only (C2):** Do not modify existing functions `switcherPairingStep`, `matterCommission`, `zigbeePermit`, or the Switcher/IR flows. New code sits beside them.
- **Existing precedent to follow:** the occupancy-sensor onboarding already drives HA's REST `config_entries` flow — locate it (grep `config_entries/flow`) and mirror its httpx/auth pattern rather than inventing one. HA auth token + base URL come from the same place `services/home_automation.py` reads them.
- **Vendored HA components are pinned** — record the exact git SHA/tag in the vendored folder's `MANIFEST` note.

---

### Task 1: `ha_config_flow` service — start a flow

**Files:**
- Create: `services/ha_config_flow.py`
- Test: `tests/test_ha_config_flow.py`

**Interfaces:**
- Consumes: HA base URL + token from the same accessor `services/home_automation.py` uses (locate it, e.g. `_ha_base_url()` / `_ha_headers()`; reuse, do not duplicate).
- Produces: `async def start_flow(handler: str, *, show_advanced: bool = False) -> dict` — POSTs `/api/config/config_entries/flow`, returns the raw HA step dict (`{"flow_id","type","step_id","data_schema","errors"}` or `type` in `{"create_entry","abort","external_step"}`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ha_config_flow.py
import pytest
from unittest.mock import AsyncMock, patch
from services import ha_config_flow

@pytest.mark.asyncio
async def test_start_flow_returns_first_step():
    fake = {"flow_id": "abc", "type": "form", "step_id": "user",
            "data_schema": [{"name": "username", "required": True, "type": "string"}],
            "errors": {}}
    with patch.object(ha_config_flow, "_post", new=AsyncMock(return_value=fake)) as post:
        step = await ha_config_flow.start_flow("roborock")
    assert step["flow_id"] == "abc"
    assert step["type"] == "form"
    post.assert_awaited_once()
    args, kwargs = post.call_args
    assert args[0].endswith("/api/config/config_entries/flow")
    assert kwargs["json"]["handler"] == "roborock"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ha_config_flow.py::test_start_flow_returns_first_step -v`
Expected: FAIL with `ModuleNotFoundError` or `AttributeError: module 'services.ha_config_flow' has no attribute 'start_flow'`.

- [ ] **Step 3: Write minimal implementation**

```python
# services/ha_config_flow.py
"""Thin async wrapper over Home Assistant's REST config_entries/flow API.

This is the ONLY module that speaks HA config-flow vocabulary. Everything it
returns is raw HA data; translation to Ziggy-facing copy happens in
services/pairing_catalog.py. Do not surface anything from here directly.
"""
import httpx
from services.home_automation import _ha_base_url, _ha_headers  # reuse existing accessors

_FLOW_PATH = "/api/config/config_entries/flow"


async def _post(url: str, *, json: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, json=json, headers=_ha_headers())
        resp.raise_for_status()
        return resp.json()


async def start_flow(handler: str, *, show_advanced: bool = False) -> dict:
    url = _ha_base_url() + _FLOW_PATH
    return await _post(url, json={"handler": handler, "show_advanced_options": show_advanced})
```

> If `_ha_base_url`/`_ha_headers` are named differently in `home_automation.py`, adapt the import to the real names — grep first: `grep -n "def _ha" services/home_automation.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_ha_config_flow.py::test_start_flow_returns_first_step -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ha_config_flow.py tests/test_ha_config_flow.py
git commit -m "feat(pairing): ha_config_flow.start_flow over HA REST config-flow API"
```

---

### Task 2: `ha_config_flow` — submit a step and fetch current step

**Files:**
- Modify: `services/ha_config_flow.py`
- Test: `tests/test_ha_config_flow.py`

**Interfaces:**
- Produces:
  - `async def submit_step(flow_id: str, user_input: dict) -> dict` — POST `/api/config/config_entries/flow/{flow_id}`.
  - `async def get_step(flow_id: str) -> dict` — GET same path.
  - `async def abort_flow(flow_id: str) -> None` — DELETE same path.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_submit_step_posts_user_input():
    result = {"flow_id": "abc", "type": "create_entry", "title": "Roborock", "result": "entry123"}
    with patch.object(ha_config_flow, "_post", new=AsyncMock(return_value=result)) as post:
        step = await ha_config_flow.submit_step("abc", {"username": "u", "password": "p"})
    assert step["type"] == "create_entry"
    args, kwargs = post.call_args
    assert args[0].endswith("/api/config/config_entries/flow/abc")
    assert kwargs["json"] == {"username": "u", "password": "p"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ha_config_flow.py::test_submit_step_posts_user_input -v`
Expected: FAIL `AttributeError: ... has no attribute 'submit_step'`.

- [ ] **Step 3: Write minimal implementation**

```python
# append to services/ha_config_flow.py

async def _get(url: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=_ha_headers())
        resp.raise_for_status()
        return resp.json()


async def _delete(url: str) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(url, headers=_ha_headers())
        resp.raise_for_status()


def _flow_url(flow_id: str) -> str:
    return _ha_base_url() + _FLOW_PATH + "/" + flow_id


async def submit_step(flow_id: str, user_input: dict) -> dict:
    return await _post(_flow_url(flow_id), json=user_input)


async def get_step(flow_id: str) -> dict:
    return await _get(_flow_url(flow_id))


async def abort_flow(flow_id: str) -> None:
    await _delete(_flow_url(flow_id))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_ha_config_flow.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add services/ha_config_flow.py tests/test_ha_config_flow.py
git commit -m "feat(pairing): ha_config_flow submit/get/abort step"
```

---

### Task 3: `pairing_catalog` — brand→domain + presentation + HA-string translation

**Files:**
- Create: `services/pairing_catalog.py`
- Test: `tests/test_pairing_catalog.py`

**Interfaces:**
- Produces:
  - `CATALOG: dict[str, CatalogEntry]` keyed by Ziggy `brand_id` (e.g. `"roborock"`, `"dreame"`).
  - `CatalogEntry` dataclass: `brand_id: str`, `display_name: str`, `ha_handler: str`, `category: str` (`"vacuum"`/`"ac"`), `icon: str`, `needs_hint: str`, `field_labels: dict[str, str]`.
  - `def resolve_handler(brand_id: str) -> str` — returns hidden HA handler for a brand.
  - `def translate_step(step: dict, entry: CatalogEntry) -> dict` — converts a raw HA step dict into a Ziggy-facing descriptor: friendly field labels, translated `errors`/`abort` reasons, NO HA vocabulary. Returns `{"kind","fields","message","error"}`.
  - `def translate_error(code: str) -> str` — maps HA error/abort codes to Ziggy copy.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pairing_catalog.py
from services import pairing_catalog as pc

DENY = ["config flow", "config entry", "integration", "entity_id",
        "home assistant", "homeassistant", "hass", "config_entries", "handler", "domain"]

def test_resolve_handler_maps_brand_to_hidden_domain():
    assert pc.resolve_handler("roborock") == "roborock"
    assert pc.resolve_handler("dreame") == "dreame_vacuum"

def test_translate_step_uses_friendly_labels_and_no_ha_terms():
    raw = {"type": "form", "step_id": "user", "flow_id": "x",
           "data_schema": [{"name": "username", "required": True, "type": "string"},
                           {"name": "password", "required": True, "type": "string"}],
           "errors": {"base": "invalid_auth"}}
    entry = pc.CATALOG["roborock"]
    out = pc.translate_step(raw, entry)
    assert out["kind"] == "form"
    labels = " ".join(f["label"].lower() for f in out["fields"])
    assert "email" in labels or "username" in labels
    blob = (out["error"] + " " + " ".join(f["label"] for f in out["fields"])).lower()
    for term in DENY:
        assert term not in blob

def test_translate_error_is_human():
    assert pc.translate_error("invalid_auth").lower().startswith("that ")
    assert "config" not in pc.translate_error("cannot_connect").lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_pairing_catalog.py -v`
Expected: FAIL `ModuleNotFoundError: services.pairing_catalog`.

- [ ] **Step 3: Write minimal implementation**

```python
# services/pairing_catalog.py
"""Customer-facing brand catalog and the HA->Ziggy translation layer.

RULE: nothing HA-shaped may leave this module. All field labels, errors, and
abort reasons are rewritten to Ziggy copy here.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class CatalogEntry:
    brand_id: str
    display_name: str
    ha_handler: str          # hidden — never surfaced
    category: str            # "vacuum" | "ac"
    icon: str
    needs_hint: str          # "what you'll need" copy
    field_labels: dict = field(default_factory=dict)


CATALOG: dict[str, CatalogEntry] = {
    "roborock": CatalogEntry(
        "roborock", "Roborock", "roborock", "vacuum", "robot",
        "You'll need your Roborock app email and password.",
        {"username": "Roborock email", "password": "Roborock password"},
    ),
    "ecovacs": CatalogEntry(
        "ecovacs", "Ecovacs", "ecovacs", "vacuum", "robot",
        "You'll need your Ecovacs app login.",
        {"username": "Ecovacs email", "password": "Ecovacs password"},
    ),
    "dreame": CatalogEntry(
        "dreame", "Dreame", "dreame_vacuum", "vacuum", "robot",
        "You'll need your Dreame app login.",
        {"username": "Dreame email", "password": "Dreame password"},
    ),
    "mova": CatalogEntry(
        "mova", "Mova", "dreame_vacuum", "vacuum", "robot",
        "You'll need your Mova app login.",
        {"username": "Mova email", "password": "Mova password"},
    ),
    "xiaomi_vacuum": CatalogEntry(
        "xiaomi_vacuum", "Xiaomi", "xiaomi_miio", "vacuum", "robot",
        "You'll need your Xiaomi Home token.",
        {"token": "Xiaomi token", "host": "Vacuum IP address"},
    ),
}

_ERROR_COPY = {
    "invalid_auth": "That login didn't work — double-check the email and password.",
    "cannot_connect": "Ziggy couldn't reach the device. Make sure it's powered on and online.",
    "already_configured": "That device is already connected to Ziggy.",
    "unknown": "Something went wrong. Give it another try in a moment.",
}


def resolve_handler(brand_id: str) -> str:
    return CATALOG[brand_id].ha_handler


def translate_error(code: str) -> str:
    return _ERROR_COPY.get(code, _ERROR_COPY["unknown"])


def _label_for(name: str, entry: CatalogEntry) -> str:
    if name in entry.field_labels:
        return entry.field_labels[name]
    # generic fallback — humanize, never leak raw HA names verbatim as HA terms
    pretty = name.replace("_", " ").strip().capitalize()
    return "Email" if pretty.lower() == "username" else pretty


def translate_step(step: dict, entry: CatalogEntry) -> dict:
    kind = step.get("type", "form")
    if kind == "form":
        fields = []
        for f in step.get("data_schema", []):
            fields.append({
                "name": f["name"],
                "label": _label_for(f["name"], entry),
                "required": bool(f.get("required")),
                "secret": f["name"] in ("password", "token", "api_key"),
                "type": f.get("type", "string"),
            })
        errors = step.get("errors") or {}
        err = translate_error(next(iter(errors.values()))) if errors else ""
        return {"kind": "form", "fields": fields, "message": entry.needs_hint, "error": err}
    if kind == "create_entry":
        return {"kind": "done", "fields": [], "message": f"{entry.display_name} connected!", "error": ""}
    if kind == "abort":
        return {"kind": "error", "fields": [], "message": "", "error": translate_error(step.get("reason", "unknown"))}
    if kind == "external_step":
        return {"kind": "oauth", "fields": [], "message": entry.needs_hint, "error": "", "url": step.get("url", "")}
    return {"kind": "form", "fields": [], "message": entry.needs_hint, "error": ""}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_pairing_catalog.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/pairing_catalog.py tests/test_pairing_catalog.py
git commit -m "feat(pairing): brand catalog + HA->Ziggy translation layer"
```

---

### Task 4: Pairing orchestrator — session state machine

**Files:**
- Create: `services/pairing_orchestrator.py`
- Test: `tests/test_pairing_orchestrator.py`

**Interfaces:**
- Consumes: `ha_config_flow.start_flow/submit_step/abort_flow`, `pairing_catalog.CATALOG/resolve_handler/translate_step`.
- Produces (all `async`):
  - `async def start(brand_id: str) -> dict` → `{"session_id","step"}` where `step` is a translated descriptor.
  - `async def submit(session_id: str, user_input: dict) -> dict` → `{"session_id","step"}`.
  - `async def cancel(session_id: str) -> None`.
  - Sessions held in an in-memory dict `{session_id: {"flow_id","brand_id"}}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pairing_orchestrator.py
import pytest
from unittest.mock import AsyncMock, patch
from services import pairing_orchestrator as po

@pytest.mark.asyncio
async def test_start_creates_session_and_returns_translated_step():
    raw = {"flow_id": "F1", "type": "form", "step_id": "user",
           "data_schema": [{"name": "username", "required": True, "type": "string"}],
           "errors": {}}
    with patch("services.pairing_orchestrator.ha_config_flow.start_flow",
               new=AsyncMock(return_value=raw)):
        out = await po.start("roborock")
    assert out["session_id"]
    assert out["step"]["kind"] == "form"
    assert out["step"]["fields"][0]["label"] == "Roborock email"

@pytest.mark.asyncio
async def test_submit_advances_flow():
    raw_done = {"flow_id": "F1", "type": "create_entry", "title": "Roborock", "result": "e1"}
    with patch("services.pairing_orchestrator.ha_config_flow.start_flow",
               new=AsyncMock(return_value={"flow_id": "F1", "type": "form",
                   "data_schema": [{"name": "username"}], "errors": {}})):
        started = await po.start("roborock")
    with patch("services.pairing_orchestrator.ha_config_flow.submit_step",
               new=AsyncMock(return_value=raw_done)):
        out = await po.submit(started["session_id"], {"username": "u"})
    assert out["step"]["kind"] == "done"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_pairing_orchestrator.py -v`
Expected: FAIL `ModuleNotFoundError: services.pairing_orchestrator`.

- [ ] **Step 3: Write minimal implementation**

```python
# services/pairing_orchestrator.py
"""Per-session pairing state machine. Bridges a brand choice to HA's flow,
returning only Ziggy-translated step descriptors (never raw HA data)."""
import uuid
from services import ha_config_flow
from services import pairing_catalog as catalog

_SESSIONS: dict[str, dict] = {}


async def start(brand_id: str) -> dict:
    entry = catalog.CATALOG[brand_id]
    raw = await ha_config_flow.start_flow(catalog.resolve_handler(brand_id))
    session_id = uuid.uuid4().hex
    _SESSIONS[session_id] = {"flow_id": raw.get("flow_id"), "brand_id": brand_id}
    return {"session_id": session_id, "step": catalog.translate_step(raw, entry)}


async def submit(session_id: str, user_input: dict) -> dict:
    sess = _SESSIONS[session_id]
    entry = catalog.CATALOG[sess["brand_id"]]
    raw = await ha_config_flow.submit_step(sess["flow_id"], user_input)
    if raw.get("flow_id"):
        sess["flow_id"] = raw["flow_id"]
    step = catalog.translate_step(raw, entry)
    if step["kind"] in ("done", "error"):
        _SESSIONS.pop(session_id, None)
    return {"session_id": session_id, "step": step}


async def cancel(session_id: str) -> None:
    sess = _SESSIONS.pop(session_id, None)
    if sess and sess.get("flow_id"):
        await ha_config_flow.abort_flow(sess["flow_id"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_pairing_orchestrator.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/pairing_orchestrator.py tests/test_pairing_orchestrator.py
git commit -m "feat(pairing): session orchestrator over ha_config_flow + catalog"
```

---

### Task 5: Backend endpoints — start / step / cancel + brand list

**Files:**
- Modify: `backend/routers/pairing_router.py` (append new routes; do NOT touch existing Switcher/matter/zigbee routes)
- Test: `tests/test_pairing_router_smart_device.py`

**Interfaces:**
- Consumes: `pairing_orchestrator.start/submit/cancel`, `pairing_catalog.CATALOG`.
- Produces HTTP:
  - `GET /api/pairing/smart/brands?category=vacuum` → `[{"brand_id","display_name","icon","needs_hint"}]` (no `ha_handler`).
  - `POST /api/pairing/smart/start` `{brand_id}` → `{session_id, step}`.
  - `POST /api/pairing/smart/{session_id}/step` `{user_input}` → `{session_id, step}`.
  - `POST /api/pairing/smart/{session_id}/cancel` → `{ok: true}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pairing_router_smart_device.py
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from backend.server import app  # adapt if app is created elsewhere

client = TestClient(app)

def test_brands_endpoint_hides_ha_handler():
    r = client.get("/api/pairing/smart/brands?category=vacuum")
    assert r.status_code == 200
    body = r.json()
    assert any(b["brand_id"] == "roborock" for b in body)
    assert all("ha_handler" not in b for b in body)

def test_start_endpoint_returns_session():
    step = {"session_id": "S1", "step": {"kind": "form", "fields": [], "message": "", "error": ""}}
    with patch("backend.routers.pairing_router.pairing_orchestrator.start",
               new=AsyncMock(return_value=step)):
        r = client.post("/api/pairing/smart/start", json={"brand_id": "roborock"})
    assert r.status_code == 200
    assert r.json()["session_id"] == "S1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_pairing_router_smart_device.py -v`
Expected: FAIL 404 (routes not registered).

- [ ] **Step 3: Write minimal implementation**

First read the file to match its style and router object name: `grep -n "APIRouter\|@router" backend/routers/pairing_router.py | head`. Then append:

```python
# backend/routers/pairing_router.py  (append near the bottom, before any __main__)
from pydantic import BaseModel
from services import pairing_orchestrator
from services import pairing_catalog


class _SmartStartBody(BaseModel):
    brand_id: str


class _SmartStepBody(BaseModel):
    user_input: dict


@router.get("/api/pairing/smart/brands")
async def smart_brands(category: str | None = None):
    out = []
    for e in pairing_catalog.CATALOG.values():
        if category and e.category != category:
            continue
        out.append({"brand_id": e.brand_id, "display_name": e.display_name,
                    "icon": e.icon, "needs_hint": e.needs_hint})
    return out


@router.post("/api/pairing/smart/start")
async def smart_start(body: _SmartStartBody):
    return await pairing_orchestrator.start(body.brand_id)


@router.post("/api/pairing/smart/{session_id}/step")
async def smart_step(session_id: str, body: _SmartStepBody):
    return await pairing_orchestrator.submit(session_id, body.user_input)


@router.post("/api/pairing/smart/{session_id}/cancel")
async def smart_cancel(session_id: str):
    await pairing_orchestrator.cancel(session_id)
    return {"ok": True}
```

> If `router` uses a prefix, drop the `/api` prefix from the decorators to avoid doubling. Confirm with the grep above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_pairing_router_smart_device.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/pairing_router.py tests/test_pairing_router_smart_device.py
git commit -m "feat(pairing): smart-device brand list + flow endpoints"
```

---

### Task 6: No-HA-leak guard test (C1 enforcement)

**Files:**
- Test: `tests/test_no_ha_leak.py`

**Interfaces:**
- Consumes: `pairing_catalog.translate_step`, `translate_error`, `CATALOG`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_no_ha_leak.py
from services import pairing_catalog as pc

DENY = ["config flow", "config entry", "integration", "entity_id", "home assistant",
        "homeassistant", "hass", "config_entries", "handler", "domain"]

def _assert_clean(text: str):
    low = text.lower()
    for term in DENY:
        assert term not in low, f"HA term leaked: {term!r} in {text!r}"

def test_all_error_copy_is_clean():
    for code in ["invalid_auth", "cannot_connect", "already_configured", "unknown", "not_real"]:
        _assert_clean(pc.translate_error(code))

def test_translated_steps_are_clean_for_every_brand():
    raw = {"type": "form", "data_schema": [{"name": "username"}, {"name": "password"}],
           "errors": {"base": "invalid_auth"}}
    for entry in pc.CATALOG.values():
        out = pc.translate_step(raw, entry)
        _assert_clean(out["message"]); _assert_clean(out["error"])
        for f in out["fields"]:
            _assert_clean(f["label"])
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `pytest tests/test_no_ha_leak.py -v`
Expected: PASS (Task 3 already satisfies this). If it FAILS, fix the offending copy in `pairing_catalog.py` — do not weaken the denylist.

- [ ] **Step 3: Commit**

```bash
git add tests/test_no_ha_leak.py
git commit -m "test(pairing): assert no HA terminology leaks to surfaced strings"
```

---

### Task 7: Frontend API client functions

**Files:**
- Modify: `frontend/src/lib/api.js` (add near the existing IR/pairing calls ~line 514)
- Test: manual (frontend has no unit harness for api.js per investigation)

**Interfaces:**
- Produces: `smartBrands(category)`, `smartPairStart(brandId)`, `smartPairStep(sessionId, userInput)`, `smartPairCancel(sessionId)`.

- [ ] **Step 1: Add the functions**

```javascript
// frontend/src/lib/api.js  (add alongside getConfigFlows ~line 514)
export const smartBrands = (category) =>
  get(`/pairing/smart/brands${category ? `?category=${category}` : ""}`)
export const smartPairStart = (brandId) =>
  post(`/pairing/smart/start`, { brand_id: brandId })
export const smartPairStep = (sessionId, userInput) =>
  post(`/pairing/smart/${sessionId}/step`, { user_input: userInput })
export const smartPairCancel = (sessionId) =>
  post(`/pairing/smart/${sessionId}/cancel`, {})
```

> Match the existing helper names in api.js — grep `grep -n "const get\|const post\|export const zigbeePermit" frontend/src/lib/api.js` and mirror the real `get`/`post` wrappers and base path handling.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: builds without error.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "feat(pairing): frontend api client for smart-device pairing"
```

---

### Task 8: `SmartDevicePairingFlow` component (generalize the Switcher pattern)

**Files:**
- Create: `frontend/src/components/SmartDevicePairingFlow.jsx`
- Reference (read, do not modify): `frontend/src/components/SwitcherPairingFlow.jsx`

**Interfaces:**
- Props: `brandId`, `onDone(entryTitle)`, `onCancel()`.
- Behavior: on mount calls `smartPairStart(brandId)`; renders `step.fields` (secret fields as password inputs) with `step.message` and `step.error`; on submit calls `smartPairStep`; on `step.kind === "oauth"` opens `step.url` via the existing external-link/webview pattern and polls `smartPairStep(sessionId, {})` until resolved; on `kind === "done"` calls `onDone`.

- [ ] **Step 1: Write the component**

```jsx
// frontend/src/components/SmartDevicePairingFlow.jsx
import { useState, useEffect } from "react"
import { smartPairStart, smartPairStep, smartPairCancel } from "../lib/api"
import { Input } from "./ui/Input"
import { Button } from "./ui/Button"

export default function SmartDevicePairingFlow({ brandId, onDone, onCancel }) {
  const [sessionId, setSessionId] = useState(null)
  const [step, setStep] = useState(null)
  const [values, setValues] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    smartPairStart(brandId).then((r) => {
      if (!alive) return
      setSessionId(r.session_id); setStep(r.step)
    })
    return () => { alive = false }
  }, [brandId])

  async function submit() {
    setBusy(true)
    try {
      const r = await smartPairStep(sessionId, values)
      setStep(r.step); setValues({})
      if (r.step.kind === "done") onDone?.(r.step.message)
      if (r.step.kind === "oauth" && r.step.url) window.open(r.step.url, "_blank")
    } finally { setBusy(false) }
  }

  if (!step) return <div className="p-4 text-sm opacity-70">Getting ready…</div>
  if (step.kind === "error") return (
    <div className="p-4">
      <p className="text-red-500 text-sm">{step.error}</p>
      <Button onClick={onCancel}>Back</Button>
    </div>
  )
  return (
    <div className="p-4 space-y-3">
      {step.message && <p className="text-sm opacity-80">{step.message}</p>}
      {step.error && <p className="text-sm text-red-500">{step.error}</p>}
      {step.fields.map((f) => (
        <Input key={f.name} label={f.label} type={f.secret ? "password" : "text"}
          value={values[f.name] || ""}
          onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
      ))}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy}>{busy ? "Connecting…" : "Connect"}</Button>
        <Button variant="secondary" onClick={() => { smartPairCancel(sessionId); onCancel?.() }}>Cancel</Button>
      </div>
    </div>
  )
}
```

> Confirm `Input`/`Button` import paths and prop APIs against the real components (`frontend/src/components/ui/Input.jsx`, `Button.jsx`) — adapt props (`label`, `variant`) to their actual signatures.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: builds without error.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SmartDevicePairingFlow.jsx
git commit -m "feat(pairing): SmartDevicePairingFlow schema-driven sub-flow"
```

---

### Task 9: Wire "Smart device" entry + brand picker into PairingWizard

**Files:**
- Modify: `frontend/src/components/PairingWizard.jsx` (add a protocol entry + a brand-pick sub-step + render `SmartDevicePairingFlow`; do NOT change existing protocol cases)

**Interfaces:**
- Consumes: `smartBrands(category)`, `SmartDevicePairingFlow`.

- [ ] **Step 1: Add the protocol + brand picker**

Read the file first: `grep -n "PROTOCOLS\|const \[step\|switcher_flow\|AnimatePresence" frontend/src/components/PairingWizard.jsx`. Then:

1. Add to the `PROTOCOLS` array (near line 30):
```javascript
{ id: 'smart_device', Icon: Wifi, immediate: false },
```
2. Import at top: `import SmartDevicePairingFlow from './SmartDevicePairingFlow'` and `import { smartBrands } from '../lib/api'`.
3. Add state near the other `useState`s:
```javascript
const [smartCategory, setSmartCategory] = useState('vacuum')
const [smartBrandList, setSmartBrandList] = useState([])
const [chosenBrand, setChosenBrand] = useState(null)
```
4. In `handleStart()` where protocols branch, add a case: when `protocol === 'smart_device'`, `setStep('smart_pick')` and `smartBrands(smartCategory).then(setSmartBrandList)`.
5. Add two render blocks in the `AnimatePresence` (after the existing `switcher_flow` block near line 864):
```jsx
{step === 'smart_pick' && (
  <div className="p-4 space-y-2">
    <p className="text-sm opacity-80">Which device are you adding?</p>
    <div className="grid grid-cols-2 gap-2">
      {smartBrandList.map((b) => (
        <button key={b.brand_id} onClick={() => { setChosenBrand(b); setStep('smart_flow') }}
          className="rounded-xl border p-3 text-left">{b.display_name}</button>
      ))}
    </div>
  </div>
)}
{step === 'smart_flow' && chosenBrand && (
  <SmartDevicePairingFlow brandId={chosenBrand.brand_id}
    onDone={() => setStep('found')} onCancel={() => setStep('smart_pick')} />
)}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: builds without error.

- [ ] **Step 3: Manual smoke (with backend + HA running)**

Open the Devices page → Pair → "Smart device" → pick Roborock → verify a form renders with "Roborock email/password" labels and NO HA words anywhere.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PairingWizard.jsx
git commit -m "feat(pairing): smart-device brand picker wired into pair wizard"
```

---

### Task 10: Chat handoff — "add my Roborock" opens the wizard at the brand

**Files:**
- Modify: `core/handlers/device_handler.py` or the intent path that already recognizes "add device" (grep `grep -rn "add.*device\|pair" core/handlers core/intent_parser.py`)
- Test: `tests/test_pairing_intent.py`

**Interfaces:**
- Produces: an intent result `{"status":"ok","action":"open_pairing","brand_id":<id or null>,"category":<"vacuum"|"ac"|null>}` that the frontend interprets to open the wizard. Reuse the existing WS/broadcast or intent-return convention — grep how other UI-opening intents return.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pairing_intent.py
from core.handlers import pairing_intent  # create this small helper module

def test_detects_brand_from_phrase():
    r = pairing_intent.parse("add my roborock")
    assert r["action"] == "open_pairing"
    assert r["brand_id"] == "roborock"

def test_generic_add_vacuum():
    r = pairing_intent.parse("connect a robot vacuum")
    assert r["action"] == "open_pairing"
    assert r["category"] == "vacuum"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_pairing_intent.py -v`
Expected: FAIL `ModuleNotFoundError: core.handlers.pairing_intent`.

- [ ] **Step 3: Write minimal implementation**

```python
# core/handlers/pairing_intent.py
from services import pairing_catalog

_VACUUM_WORDS = ("vacuum", "roomba", "robovac", "robot vacuum", "שואב")


def parse(text: str) -> dict:
    low = text.lower()
    for brand_id, entry in pairing_catalog.CATALOG.items():
        if entry.display_name.lower() in low or brand_id.replace("_", " ") in low:
            return {"status": "ok", "action": "open_pairing",
                    "brand_id": brand_id, "category": entry.category}
    if any(w in low for w in _VACUUM_WORDS):
        return {"status": "ok", "action": "open_pairing", "brand_id": None, "category": "vacuum"}
    return {"status": "no_match", "action": None, "brand_id": None, "category": None}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_pairing_intent.py -v`
Expected: PASS.

- [ ] **Step 5: Wire into the action router + frontend open-handler**

In the existing intent routing (grep result from Files), call `pairing_intent.parse` for add/connect phrasing and, on `action == "open_pairing"`, broadcast a WS message `{"type":"open_pairing","brand_id":...,"category":...}`. In the frontend WS handler, on that message set the wizard open with `smartCategory`/`chosenBrand` prefilled. Follow the exact broadcast + WS-consume pattern already used (grep `manager.broadcast` and the frontend `ws.onmessage`).

- [ ] **Step 6: Commit**

```bash
git add core/handlers/pairing_intent.py tests/test_pairing_intent.py core/handlers/device_handler.py
git commit -m "feat(pairing): chat intent opens pair wizard at the named brand"
```

---

### Task 11: Vendor the Dreame/Mova component into base HA (present-but-unconfigured)

**Files:**
- Create: `docker/ha-config/custom_components/dreame_vacuum/` (vendored, pinned) + `docker/ha-config/custom_components/dreame_vacuum/ZIGGY_VENDOR_NOTE.md`
- Modify: `relay/app/provisioner.py` (extend SFTP seeding ~lines 302-312 to also push the vendored folder)
- Test: `tests/test_vendored_components.py`

**Interfaces:**
- Produces: on a freshly provisioned home, `custom_components/dreame_vacuum/manifest.json` exists in the HA config dir.

- [ ] **Step 1: Vendor the component**

```bash
mkdir -p docker/ha-config/custom_components
git clone --depth 1 https://github.com/Tasshack/dreame-vacuum /tmp/dreame-vacuum
cp -R /tmp/dreame-vacuum/custom_components/dreame_vacuum docker/ha-config/custom_components/
( cd /tmp/dreame-vacuum && git rev-parse HEAD ) > docker/ha-config/custom_components/dreame_vacuum/ZIGGY_VENDOR_NOTE.md
```
Prepend to `ZIGGY_VENDOR_NOTE.md`: source repo URL, pinned SHA (the line above), license (check the repo's LICENSE), and "vendored, do not edit; update deliberately."

- [ ] **Step 2: Write the failing test**

```python
# tests/test_vendored_components.py
import os
def test_dreame_component_vendored():
    base = "docker/ha-config/custom_components/dreame_vacuum"
    assert os.path.isfile(os.path.join(base, "manifest.json"))
    assert os.path.isfile(os.path.join(base, "ZIGGY_VENDOR_NOTE.md"))
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pytest tests/test_vendored_components.py -v`
Expected: PASS (files were copied in Step 1).

- [ ] **Step 4: Extend the cloud provisioner**

Read `relay/app/provisioner.py` around lines 300-315. After the existing `mkdir -p {home_dir}/ha-config` and config writes, add a directory create + recursive SFTP push of the local `docker/ha-config/custom_components/dreame_vacuum` tree into `{home_dir}/ha-config/custom_components/dreame_vacuum`. Follow the existing `_sftp_write()` helper; add a small `_sftp_write_tree(local_dir, remote_dir)` loop beside it. Keep the change additive.

- [ ] **Step 5: Commit**

```bash
git add docker/ha-config/custom_components/dreame_vacuum relay/app/provisioner.py tests/test_vendored_components.py
git commit -m "feat(pairing): vendor pinned dreame_vacuum component into base HA"
```

---

### Task 12: End-to-end pairing test against HA (integration)

**Files:**
- Test: `tests/integration/test_pairing_e2e.py` (marked `@pytest.mark.integration`, skipped unless `ZIGGY_HA_TEST_URL` env set)

- [ ] **Step 1: Write the integration test**

```python
# tests/integration/test_pairing_e2e.py
import os, pytest
pytestmark = pytest.mark.skipif(not os.getenv("ZIGGY_HA_TEST_URL"),
                                reason="requires a live HA test instance")

@pytest.mark.asyncio
async def test_start_flow_against_real_ha_returns_form():
    # Uses a simple always-available handler (e.g. a demo/local integration) to
    # prove start_flow reaches HA and returns a real step.
    from services import ha_config_flow
    step = await ha_config_flow.start_flow(os.getenv("ZIGGY_HA_TEST_HANDLER", "roborock"))
    assert "type" in step
```

- [ ] **Step 2: Run (only when HA test env available)**

Run: `ZIGGY_HA_TEST_URL=... pytest tests/integration/test_pairing_e2e.py -v`
Expected: PASS against a live HA, or SKIP otherwise.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/test_pairing_e2e.py
git commit -m "test(pairing): e2e config-flow test gated on live HA env"
```

---

## Self-Review

**Spec coverage (§ from the design doc):**
- §3 Foundation (ha_config_flow, catalog, orchestrator, endpoints, generalized sub-flow, wizard wiring, chat handoff) → Tasks 1–10. ✓
- §2 C1 zero-HA-exposure (translation layer + denylist test) → Tasks 3, 6. ✓
- §2 C2 additive-only (append-only routes/components; existing flows untouched) → called out in every modify-task. ✓
- §3.3 OAuth in scope → Task 8 handles `external_step`/`oauth`. ✓ Matter deferred → not in this plan. ✓
- §4 Vacuums (catalog entries + vendored dreame + pin) → Tasks 3, 11. ✓
- §9 testing (unit vs recorded responses, no-leak test, e2e vs live HA) → Tasks 1–6, 12. ✓

**Deferred to later plans (correct, not gaps):** SP2 Smart ACs (Plan #2), SP3 IR enrichment (Plan #3).

**Placeholder scan:** No "TBD/handle edge cases/similar to Task N" — modify-tasks that can't show a blind diff instead give the exact grep anchor + exact code to insert. Acceptable under "follow established patterns" since the code to add is fully specified.

**Type consistency:** `translate_step` returns `{"kind","fields","message","error"[,"url"]}` — consumed identically in Tasks 4, 6, 8. `start/submit` return `{"session_id","step"}` — consumed identically in Tasks 5, 8. `resolve_handler`/`CATALOG`/`CatalogEntry` names consistent across Tasks 3, 4, 5, 10. ✓

**One open adaptation flagged for the implementer:** exact accessor names in `home_automation.py` (`_ha_base_url`/`_ha_headers`) and `api.js` `get`/`post` helpers must be confirmed by grep before use — noted inline in Tasks 1 and 7.
