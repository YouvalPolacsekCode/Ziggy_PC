"""Wi-Fi device brands the user can pair by name.

Why this exists
---------------
Ziggy's Wi-Fi pairing screen lists what Home Assistant auto-discovered. That
covers devices which advertise themselves (a Chromecast over zeroconf, a TV
over SSDP) but it structurally cannot cover the air conditioners sold in
Israel, because none of their integrations advertise anything:

  * Tadiran units speak the Gree protocol. The `gree` manifest declares no
    zeroconf/dhcp/ssdp discovery, and its config flow is HA's
    `register_discovery_flow` helper — the UDP broadcast scan runs inside the
    *user* step. Nobody starts that step, nothing is ever found.
  * Electra is cloud-polling and needs a phone number plus an SMS code.

So a brand the user recognises is the only workable entry point: they tell us
what they own, we start the matching user-sourced flow on their behalf.

This table is an ALLOWLIST, not a hint. The start route refuses anything not
listed, so the endpoint can never be used to kick off an arbitrary HA flow.

Keep `label` in customer vocabulary. The HA handler is an implementation
detail and must never reach the UI — see tests/test_wifi_brand_pairing.py.
"""
from __future__ import annotations

# brand key → {handler, label, kind}
# `kind` lets the UI group the picker without knowing anything about HA.
_BRANDS: dict[str, dict[str, str]] = {
    "tadiran": {"handler": "gree",         "label": "Tadiran", "kind": "ac"},
    "electra": {"handler": "electrasmart", "label": "Electra", "kind": "ac"},
}

# Deliberately absent: Tornado. Those are Midea units, served by the
# `midea-ac-py` HACS integration, which is not installed on any hub — listing
# it would offer the user a button that cannot work. Adding Tornado means
# shipping that integration in the image first.


def handler_for(brand: str) -> str | None:
    """HA config-flow handler for a brand key, or None if not allowlisted."""
    entry = _BRANDS.get((brand or "").strip().lower())
    return entry["handler"] if entry else None


def label_for(brand: str) -> str:
    """Customer-facing brand name; falls back to the raw key for log safety."""
    entry = _BRANDS.get((brand or "").strip().lower())
    return entry["label"] if entry else (brand or "this device")


def listed() -> list[dict[str, str]]:
    """Brands for the picker. Carries no HA vocabulary by construction."""
    return [
        {"brand": key, "label": entry["label"], "kind": entry["kind"]}
        for key, entry in _BRANDS.items()
    ]


# Abort reasons worth explaining. Anything else falls through to HA's reason
# string, which is better than inventing a cause we did not observe.
def abort_guidance(reason: str, brand: str) -> str | None:
    """Human guidance for a flow that aborted, or None to let the reason stand."""
    label = label_for(brand)
    if reason == "no_devices_found":
        return (
            f"Ziggy couldn't find a {label} air conditioner on your Wi-Fi. "
            f"Check that the unit is powered on, that its Wi-Fi is switched on, "
            f"and that it's joined to the same network as Ziggy — then try again."
        )
    if reason in ("single_instance_allowed", "already_configured"):
        return f"Your {label} air conditioner is already set up in Ziggy."
    if reason == "cannot_connect":
        return (
            f"Ziggy found a {label} unit but couldn't talk to it. If you've "
            f"paired it with the manufacturer's phone app, that app can hold "
            f"the connection — close it and try again."
        )
    return None
