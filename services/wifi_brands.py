"""The catalogue of Wi-Fi devices a customer can add by naming them.

Why this exists
---------------
Ziggy's Wi-Fi pairing screen lists what Home Assistant auto-discovered. Of the
852 integrations with a config flow, only 295 announce themselves over
zeroconf / DHCP / SSDP / Bluetooth. The other 557 — 266 of them actual
devices — can never appear there, no matter how often the customer rescans.

That gap is not evenly spread, and it falls hardest on exactly our market.
Big international brands implement mDNS; small local ones do not. Every
Israeli-made device in Home Assistant is in the invisible set:

    Risco (alarms) · SwitchBee (wall switches) · CoolAutomation (AC bridges)
    Tami4 (water bars) · Read Your Meter Pro (water meters) · Ituran

…alongside Tadiran and Electra, whose absence is what started this. So
"pick your device" is not a fallback for an edge case. For an Israeli home it
is the main road, and the discovery list is the shortcut.

Curated, not generated
----------------------
We could emit all 266 from Home Assistant's own data. We don't: the result
would carry HA's naming and be mostly devices nobody here owns. Each entry
below is chosen, named in the customer's words, and verified to exist as a
config-flow integration in HA core. A brand button that cannot work is worse
than no button — that is why Tornado is absent (its Midea integration is
HACS-only and ships on no hub) and why Switcher is absent (it keeps its own
dedicated flow in switcher_pairing.py).

The catalogue is an ALLOWLIST and a security boundary: the start route
refuses any brand not named here, so it can never be used to kick off an
arbitrary Home Assistant flow.

Adding an entry
---------------
1. Confirm the domain is a config-flow integration in HA core (not HACS).
2. Confirm the hub's HA version actually ships it.
3. Use the brand the customer bought, not the integration's name. Someone who
   owns a Tadiran has never heard of "Gree".
"""
from __future__ import annotations

# Categories map onto the device vocabulary the rest of Ziggy already uses
# (frontend/src/lib/domainRegistry.js). Pairing must not invent a third
# taxonomy — a device added under "climate" here is the same "climate" the
# room page groups by.
CATEGORIES: list[dict[str, str]] = [
    {"id": "climate",      "icon": "snowflake"},
    {"id": "cover",        "icon": "blinds"},
    {"id": "alarm",        "icon": "shield"},
    {"id": "camera",       "icon": "camera"},
    {"id": "vacuum",       "icon": "vacuum"},
    {"id": "lock",         "icon": "lock"},
    {"id": "water_heater", "icon": "flame"},
    {"id": "irrigation",   "icon": "droplet"},
    {"id": "light",        "icon": "bulb"},
    {"id": "switch",       "icon": "toggle"},
    {"id": "other",        "icon": "plus"},
]

# brand key → {handler, label, category}
#
# `label` is the brand on the box. `handler` is the HA integration behind it
# and must never reach the UI. One brand can appear twice under different
# categories (an LG television and an LG air conditioner are different
# integrations), which is why the key is brand+category, not brand.
#
# Ordering within a category is deliberate: what an Israeli home is most
# likely to own comes first.
_BRANDS: dict[str, dict[str, str]] = {
    # ── Air conditioning ────────────────────────────────────────────────
    "tadiran":        {"handler": "gree",              "label": "Tadiran",       "category": "climate"},
    "electra":        {"handler": "electrasmart",      "label": "Electra",       "category": "climate"},
    "coolmaster":     {"handler": "coolmaster",        "label": "CoolAutomation","category": "climate"},
    "sensibo":        {"handler": "sensibo",           "label": "Sensibo",       "category": "climate"},
    "mitsubishi":     {"handler": "melcloud",          "label": "Mitsubishi",    "category": "climate"},
    "hisense_ac":     {"handler": "hisense_aehw4a1",   "label": "Hisense",       "category": "climate"},
    "cielo":          {"handler": "cielo_home",        "label": "Cielo",         "category": "climate"},

    # ── Shutters and blinds ─────────────────────────────────────────────
    "soma":           {"handler": "soma",              "label": "Soma",          "category": "cover"},
    "nice":           {"handler": "nice_go",           "label": "Nice",          "category": "cover"},
    "motionblinds":   {"handler": "motion_blinds",     "label": "Motionblinds",  "category": "cover"},
    "chacon":         {"handler": "chacon_dio",        "label": "Chacon DiO",    "category": "cover"},
    "brunt":          {"handler": "brunt",             "label": "Brunt",         "category": "cover"},

    # ── Alarm ───────────────────────────────────────────────────────────
    "risco":          {"handler": "risco",             "label": "Risco",         "category": "alarm"},
    "satel":          {"handler": "satel_integra",     "label": "Satel",         "category": "alarm"},

    # ── Cameras ─────────────────────────────────────────────────────────
    "ezviz":          {"handler": "ezviz",             "label": "EZVIZ",         "category": "camera"},
    "foscam":         {"handler": "foscam",            "label": "Foscam",        "category": "camera"},
    "motioneye":      {"handler": "motioneye",         "label": "motionEye",     "category": "camera"},
    "ipcamera":       {"handler": "mjpeg",             "label": "Other IP camera","category": "camera"},

    # ── Vacuums ─────────────────────────────────────────────────────────
    "ecovacs":        {"handler": "ecovacs",           "label": "Ecovacs",       "category": "vacuum"},
    "shark":          {"handler": "sharkiq",           "label": "Shark",         "category": "vacuum"},
    "neato":          {"handler": "neato",             "label": "Neato",         "category": "vacuum"},

    # ── Locks ───────────────────────────────────────────────────────────
    "schlage":        {"handler": "schlage",           "label": "Schlage",       "category": "lock"},
    "tedee":          {"handler": "tedee",             "label": "Tedee",         "category": "lock"},
    "igloohome":      {"handler": "igloohome",         "label": "igloohome",     "category": "lock"},

    # ── Water heating ───────────────────────────────────────────────────
    # Switcher is deliberately absent: it has its own dedicated flow.
    "rheem":          {"handler": "econet",            "label": "Rheem",         "category": "water_heater"},
    "oso":            {"handler": "osoenergy",         "label": "OSO",           "category": "water_heater"},
    "aosmith":        {"handler": "aosmith",           "label": "A. O. Smith",   "category": "water_heater"},

    # ── Irrigation ──────────────────────────────────────────────────────
    "hunter":         {"handler": "hydrawise",         "label": "Hunter",        "category": "irrigation"},
    "rainbird":       {"handler": "rainbird",          "label": "Rain Bird",     "category": "irrigation"},
    "opengarage":     {"handler": "opengarage",        "label": "OpenGarage",    "category": "irrigation"},
    "yardian":        {"handler": "yardian",           "label": "Yardian",       "category": "irrigation"},

    # ── Lighting ────────────────────────────────────────────────────────
    "govee":          {"handler": "govee_light_local", "label": "Govee",         "category": "light"},
    "cync":           {"handler": "cync",              "label": "Cync",          "category": "light"},

    # ── Switches and sockets ────────────────────────────────────────────
    "switchbee":      {"handler": "switchbee",         "label": "SwitchBee",     "category": "switch"},
    "refoss":         {"handler": "refoss",            "label": "Refoss",        "category": "switch"},
    "iotty":          {"handler": "iotty",             "label": "iotty",         "category": "switch"},

    # ── Everything else worth having here ───────────────────────────────
    "tami4":          {"handler": "tami4",             "label": "Tami4",         "category": "other"},
    "rympro":         {"handler": "rympro",            "label": "Read Your Meter","category": "other"},
}


def handler_for(brand: str) -> str | None:
    """HA config-flow handler for a brand key, or None if not allowlisted."""
    entry = _BRANDS.get((brand or "").strip().lower())
    return entry["handler"] if entry else None


def label_for(brand: str) -> str:
    """Customer-facing brand name; falls back to the raw key for log safety."""
    entry = _BRANDS.get((brand or "").strip().lower())
    return entry["label"] if entry else (brand or "this device")


def category_for(brand: str) -> str | None:
    entry = _BRANDS.get((brand or "").strip().lower())
    return entry["category"] if entry else None


def listed(category: str | None = None) -> list[dict[str, str]]:
    """Brands for the picker, optionally one category. Carries no HA
    vocabulary by construction — `handler` is never included."""
    out = []
    for key, e in _BRANDS.items():
        if category and e["category"] != category:
            continue
        out.append({"brand": key, "label": e["label"], "category": e["category"]})
    return out


def categories() -> list[dict]:
    """Categories that actually have brands, with how many."""
    counts: dict[str, int] = {}
    for e in _BRANDS.values():
        counts[e["category"]] = counts.get(e["category"], 0) + 1
    return [
        {"id": c["id"], "icon": c["icon"], "count": counts.get(c["id"], 0)}
        for c in CATEGORIES if counts.get(c["id"])
    ]


def abort_guidance(reason: str, brand: str) -> str | None:
    """Human guidance for a flow that aborted, or None to let HA's reason
    stand rather than inventing a cause we did not observe."""
    label = label_for(brand)
    if reason == "no_devices_found":
        return (
            f"Ziggy couldn't find a {label} device on your Wi-Fi. "
            f"Check that it's powered on, that its Wi-Fi is switched on, and "
            f"that it's joined to the same network as Ziggy — then try again."
        )
    if reason in ("single_instance_allowed", "already_configured"):
        return f"Your {label} is already set up in Ziggy."
    if reason == "cannot_connect":
        return (
            f"Ziggy found your {label} but couldn't talk to it. If you've "
            f"paired it with the manufacturer's phone app, that app can hold "
            f"the connection — close it and try again."
        )
    return None
