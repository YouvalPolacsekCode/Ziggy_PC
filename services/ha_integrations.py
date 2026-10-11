"""Remove an integration, and prove it went.

Ziggy could add an integration but never remove one. The only route out was
deleting its devices one at a time through `delete_ha_entity`, whose safety
guard — rightly — refuses to delete a config entry that still backs devices
you are not removing. On a Gree entry owning four air conditioners that guard
fired on every single delete: four devices lost their entities, the entry
survived, and the customer's next pairing attempt was refused with "already
set up". A zombie entry nobody could clear.

So removal is one operation on the entry itself, not N operations on its
children.

The second half matters as much as the first. The earlier failure was reported
as a success because only one layer was checked: an entity count came back
zero and that was taken as proof, while the devices and the entry were both
still there. An HTTP 2xx is not evidence, and neither is an empty count of
whichever layer you happened to look at. `verify_removed` reads the config
entry, the device registry and the entity registry back from Home Assistant
and will only say `removed` when all three are clear.
"""
from __future__ import annotations

from services.ha_areas import _ws
from core.logger_module import log_error, log_info

# Entries that must never be removed through this path. Deleting the MQTT
# entry takes Zigbee2MQTT — and therefore every Zigbee device in the house —
# down with it; the others are the hub's own plumbing.
PROTECTED_DOMAINS = frozenset({
    "mqtt", "zha", "zigbee2mqtt", "matter", "thread", "otbr",
    "hassio", "homeassistant", "met", "sun", "radio_browser", "mobile_app",
})


async def _entries() -> list[dict]:
    res, = await _ws({"type": "config_entries/get"})
    if not isinstance(res, dict) or not res.get("success"):
        return []
    return [e for e in (res.get("result") or []) if isinstance(e, dict)]


async def _devices() -> list[dict]:
    res, = await _ws({"type": "config/device_registry/list"})
    return res.get("result") or []


async def _entities() -> list[dict]:
    res, = await _ws({"type": "config/entity_registry/list"})
    return res.get("result") or []


def _delete_entry(entry_id: str, timeout: float = 15.0) -> bool:
    """HA's REST config-entry delete. Removes the entry AND everything it
    owns, and works when the devices are offline. The WebSocket equivalent
    answers `unknown_command` on this build, which is why this is REST."""
    from services import ha_client
    import requests
    try:
        url = f"{ha_client.url().rstrip('/')}/api/config/config_entries/entry/{entry_id}"
        resp = requests.delete(url, headers=ha_client.headers(), timeout=timeout)
        ok = 200 <= resp.status_code < 300
        if not ok:
            log_error(f"[Integrations] delete {entry_id} -> HTTP {resp.status_code}")
        return ok
    except Exception as e:
        log_error(f"[Integrations] delete {entry_id} failed: {e}")
        return False


async def list_integrations() -> dict:
    """Every config entry with how much of the home it owns."""
    try:
        entries, devices = await _entries(), await _devices()
        out = []
        for e in entries:
            eid = e.get("entry_id")
            n = sum(1 for d in devices if eid in (d.get("config_entries") or []))
            out.append({
                "entry_id": eid,
                "domain": e.get("domain"),
                "title": e.get("title"),
                "state": e.get("state"),
                "device_count": n,
                "protected": e.get("domain") in PROTECTED_DOMAINS,
            })
        return {"ok": True, "integrations": out}
    except Exception as e:
        log_error(f"[Integrations] list: {e}")
        return {"ok": False, "error": str(e), "integrations": []}


async def verify_removed(entry_id: str) -> dict:
    """Read every layer back from HA. `removed` is true only when the config
    entry, its devices and its entities are ALL gone.

    This exists because the previous attempt checked one layer, found it
    empty, and declared success while two others were still populated.
    """
    try:
        entries, devices, entities = await _entries(), await _devices(), await _entities()
        entry_alive = any(e.get("entry_id") == entry_id for e in entries)
        dev_ids = {d.get("id") for d in devices
                   if entry_id in (d.get("config_entries") or [])}
        # Count an entity if it belongs to one of the entry's devices OR if
        # it names the entry itself. Without the second clause an entity whose
        # device had already been removed would go uncounted and the whole
        # thing would read as clean — the precise shape of the bug that
        # started this.
        ent_count = sum(
            1 for e in entities
            if e.get("device_id") in dev_ids or e.get("config_entry_id") == entry_id
        )
        return {
            "ok": True,
            "entry": entry_alive,
            "devices": len(dev_ids),
            "entities": ent_count,
            "removed": (not entry_alive) and not dev_ids and not ent_count,
        }
    except Exception as e:
        # Cannot read it back ⇒ cannot claim it is gone.
        log_error(f"[Integrations] verify {entry_id}: {e}")
        return {"ok": False, "error": str(e), "removed": False}


async def remove_integration(entry_id: str, verify: bool = True) -> dict:
    """Remove one config entry and everything it owns.

    Returns ok=False unless the read-back confirms it. The delete's own
    success is never the answer.
    """
    entries = await _entries()
    entry = next((e for e in entries if e.get("entry_id") == entry_id), None)
    if not entry:
        return {"ok": False, "error": f"No such integration: {entry_id}"}

    domain = entry.get("domain")
    if domain in PROTECTED_DOMAINS:
        return {"ok": False,
                "error": f"'{domain}' is protected — removing it would take "
                         f"other devices in the home down with it."}

    log_info(f"[Integrations] removing {domain} ({entry_id})")
    deleted = _delete_entry(entry_id)

    if not verify:
        return {"ok": bool(deleted), "entry_id": entry_id, "domain": domain}

    checked = await verify_removed(entry_id)
    return {
        "ok": bool(checked.get("removed")),
        "entry_id": entry_id,
        "domain": domain,
        "delete_reported": bool(deleted),
        "verified": checked,
    }


async def _reload_entry(entry_id: str) -> bool:
    """Ask HA to reload one config entry. For a discovery-based integration
    this re-runs its setup, which re-runs its scan."""
    import asyncio
    from services.home_automation import call_service
    try:
        await asyncio.to_thread(
            call_service, "homeassistant", "reload_config_entry",
            {"entry_id": entry_id})
        return True
    except Exception as e:
        log_error(f"[Integrations] reload {entry_id}: {e}")
        return False


async def rescan_domain(domain: str, settle_s: float = 12.0) -> dict:
    """Look for more devices belonging to an integration already set up.

    Gree — and every other single-instance integration — refuses to start its
    config flow a second time, so once the entry exists the pairing screen has
    nothing left to offer. A customer with six air conditioners paired the
    three that happened to answer the first broadcast and was then stuck:
    tapping the brand again just said "already set up".

    Reloading the entry re-runs the integration's own discovery, which is the
    supported way to pick up units that were asleep, resetting, or simply
    missed the first scan.
    """
    import asyncio
    entries = await _entries()
    entry = next((e for e in entries if e.get("domain") == domain), None)
    if not entry:
        return {"ok": False, "error": f"'{domain}' is not set up on this hub"}

    entry_id = entry.get("entry_id")
    devices = await _devices()
    before = sum(1 for d in devices if entry_id in (d.get("config_entries") or []))

    log_info(f"[Integrations] rescanning {domain} ({entry_id}), {before} device(s) now")
    ok = await _reload_entry(entry_id)
    if settle_s:
        # Discovery is a UDP broadcast with its own timeout; give it room
        # before counting, or we report the pre-reload number back.
        await asyncio.sleep(settle_s)

    devices_after = await _devices()
    after = sum(1 for d in devices_after if entry_id in (d.get("config_entries") or []))
    return {
        "ok": bool(ok),
        "domain": domain,
        "entry_id": entry_id,
        "devices_before": before,
        "devices_after": after,
        "found_new": max(0, after - before),
    }
