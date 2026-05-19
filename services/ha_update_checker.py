"""
HA Update Checker — detects available Home Assistant updates and maps
breaking changes to the user's actual Ziggy/HA setup.

Flow:
  1. GET /api/config       → current installed HA version
  2. HA entity state        → update.home_assistant_core_update
  3. GitHub releases API   → fetch release body for the target version
  4. Parse breaking changes section from release body
  5. Build user setup profile from state_cache + settings
  6. Match breaking change text against risk rules keyed to profile
  7. Score → risk level (safe / low / medium / high / unknown)
  8. Cache result 1 h; persist history to user_files/update_history.json
  9. Notify via web push (+ Telegram if configured) when risk > safe

Safety rules baked in:
  - NEVER auto-updates HA
  - NEVER modifies HA config
  - If release notes unavailable → risk = "unknown" (never "safe")
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests as _requests

from core.logger_module import log_info, log_error
from core.settings_loader import settings

# ── Storage ───────────────────────────────────────────────────────────────────
_HISTORY_FILE = Path("user_files/update_history.json")
_CACHE_TTL_S  = 3600  # 1 hour

_cache: dict | None = None
_cache_ts: float    = 0.0
_lock = threading.Lock()

# ── Risk rules ────────────────────────────────────────────────────────────────
# Each rule has:
#   id          — unique slug
#   keywords    — list of lowercase strings to search in breaking-change text
#   check_key   — key in user profile dict; "always" means always relevant; None = cannot verify
#   weight      — added to total risk score when matched (and user has the relevant setup)
#   message     — shown to user; may contain {profile_key} placeholders
#   feature     — short label for the affected Ziggy feature
#   action      — recommended action

_RISK_RULES: list[dict] = [
    # Core API — Ziggy always depends on both
    {
        "id": "websocket_api",
        "keywords": ["websocket api", "websocket", "ws api", "config/entity_registry",
                     "config/device_registry", "config/area_registry", "state_changed",
                     "state subscription", "home assistant websocket"],
        "check_key": "always",
        "weight": 3,
        "message": "This update changes the HA WebSocket API that Ziggy uses for real-time state updates and registry access.",
        "feature": "Ziggy real-time HA connection",
        "action": "Verify Ziggy's WebSocket subscriber still connects after updating.",
    },
    {
        "id": "rest_api",
        "keywords": ["/api/states", "/api/services", "rest api", "http api",
                     "rest_commands", "http integration changed", "api endpoint"],
        "check_key": "always",
        "weight": 3,
        "message": "This update changes the HA REST API that Ziggy uses for all device control.",
        "feature": "Ziggy device control API",
        "action": "Test a few device controls after updating to confirm API compatibility.",
    },
    # Zigbee / Wireless protocols
    {
        "id": "zha",
        "keywords": ["zha", "zigbee home automation", "zha device", "zha coordinator",
                     "zha.permit", "zha integration", "ieee address"],
        "check_key": "zha_device_count",
        "weight": 3,
        "message": "This update affects ZHA. You currently have {zha_device_count} ZHA devices.",
        "feature": "Zigbee device control (ZHA)",
        "action": "Back up ZHA data before updating. Verify all Zigbee devices respond after.",
    },
    {
        "id": "mqtt",
        "keywords": ["mqtt", "mqtt discovery", "mqtt broker", "mqtt integration",
                     "zigbee2mqtt", "mqtt client"],
        "check_key": "mqtt_enabled",
        "weight": 3,
        "message": "This update affects MQTT. You use MQTT / Zigbee2MQTT.",
        "feature": "MQTT / Zigbee2MQTT",
        "action": "Check MQTT broker connection and Zigbee2MQTT entity discovery after updating.",
    },
    {
        "id": "zwave",
        "keywords": ["z-wave", "zwave", "z-wave js", "zwave_js", "zwave js"],
        "check_key": "has_zwave",
        "weight": 3,
        "message": "This update affects Z-Wave. You have Z-Wave devices paired.",
        "feature": "Z-Wave device control",
        "action": "Review Z-Wave JS addon compatibility before updating.",
    },
    # Entity domains Ziggy controls
    {
        "id": "climate",
        "keywords": ["climate", "hvac", "thermostat", "set_temperature",
                     "set_hvac_mode", "climate service", "climate domain",
                     "climate entity", "climate platform"],
        "check_key": "climate_count",
        "weight": 2,
        "message": "This update affects climate services. You have {climate_count} climate entity/entities (AC control).",
        "feature": "AC / Climate control",
        "action": "Test AC control via Ziggy after updating.",
    },
    {
        "id": "light",
        "keywords": ["light.turn_on", "light service", "brightness_pct", "hs_color",
                     "rgb_color", "light domain", "light platform", "color_temp",
                     "light entity"],
        "check_key": "light_count",
        "weight": 2,
        "message": "This update affects light services. You have {light_count} light entity/entities.",
        "feature": "Light control",
        "action": "Test light on/off and brightness after updating.",
    },
    {
        "id": "media_player",
        "keywords": ["media_player", "media player", "select_source", "media_play",
                     "media_stop", "media player domain", "media player service"],
        "check_key": "media_player_count",
        "weight": 2,
        "message": "This update affects media player services. You have {media_player_count} media player entity/entities.",
        "feature": "TV / Media player control",
        "action": "Test TV/media control via Ziggy after updating.",
    },
    {
        "id": "template",
        "keywords": ["template", "template sensor", "template entity", "jinja2",
                     "template trigger", "template platform", "template changes",
                     "template integration"],
        "check_key": "always",
        "weight": 2,
        "message": "This update affects template processing. HA automations and conditions may use templates.",
        "feature": "Template-based automations / conditions",
        "action": "Review automations that use template triggers or conditions.",
    },
    {
        "id": "script",
        "keywords": ["script", "script.turn_on", "script execution", "scripts domain",
                     "script service"],
        "check_key": "script_count",
        "weight": 2,
        "message": "This update affects HA scripts. Ziggy uses {script_count} HA script(s) for routines.",
        "feature": "HA Scripts / Routines",
        "action": "Test Ziggy routines after updating.",
    },
    {
        "id": "automation",
        "keywords": ["automation", "automation trigger", "automation action",
                     "blueprint", "automation domain", "automation service"],
        "check_key": "automation_count",
        "weight": 1,
        "message": "This update affects HA automations. You have {automation_count} automation(s).",
        "feature": "HA Automations",
        "action": "Verify automations still trigger correctly after updating.",
    },
    {
        "id": "scene",
        "keywords": ["scene", "scene.turn_on", "scene activation", "scene domain",
                     "scene service"],
        "check_key": "always",
        "weight": 1,
        "message": "This update affects scene activation. Ziggy supports HA scenes.",
        "feature": "Scene activation",
        "action": "Test scene activation after updating.",
    },
    {
        "id": "person",
        "keywords": ["person", "person entity", "device_tracker", "home/away",
                     "presence detection", "person domain"],
        "check_key": "person_count",
        "weight": 1,
        "message": "This update affects person/presence tracking. Ziggy uses {person_count} person entity/entities.",
        "feature": "Presence detection",
        "action": "Check presence detection still works after updating.",
    },
    {
        "id": "todo",
        "keywords": ["todo", "shopping list", "todo list", "todo domain",
                     "todo integration"],
        "check_key": "has_todo",
        "weight": 1,
        "message": "This update affects the Todo / shopping list integration.",
        "feature": "Shopping list",
        "action": "Test shopping list add/view after updating.",
    },
    {
        "id": "fan",
        "keywords": ["fan", "fan service", "fan domain", "fan entity"],
        "check_key": "fan_count",
        "weight": 1,
        "message": "This update affects fan entities. You have {fan_count} fan device(s).",
        "feature": "Fan control",
        "action": "Test fan control after updating.",
    },
    {
        "id": "cover",
        "keywords": ["cover", "blind", "shade", "shutter", "cover domain",
                     "cover service"],
        "check_key": "cover_count",
        "weight": 1,
        "message": "This update affects cover entities (blinds/shades). You have {cover_count} cover device(s).",
        "feature": "Blinds / Cover control",
        "action": "Test cover control after updating.",
    },
    # Configuration and frontend — cannot verify, flag as unknown impact
    {
        "id": "yaml_config",
        "keywords": ["deprecated yaml", "yaml configuration", "configuration.yaml",
                     "split config", "yaml removed", "yaml deprecation",
                     "yaml format changed"],
        "check_key": None,
        "weight": 1,
        "message": "This update changes/deprecates YAML configuration syntax.",
        "feature": "HA YAML configuration",
        "action": "Review your HA YAML config files for deprecated syntax.",
    },
    {
        "id": "frontend_dashboard",
        "keywords": ["lovelace", "dashboard", "custom card", "frontend resource",
                     "mushroom", "lovelace dashboard", "ui mode"],
        "check_key": None,
        "weight": 1,
        "message": "This update may affect Lovelace/dashboard configuration or custom cards.",
        "feature": "HA Dashboard",
        "action": "Check your HA dashboard for any broken cards after updating.",
    },
]

_SCORE_TO_LEVEL: list[tuple[int, str]] = [
    (0,  "safe"),
    (2,  "low"),
    (5,  "medium"),
    (8,  "high"),
]


def _score_to_risk_level(score: int) -> str:
    level = "safe"
    for threshold, lbl in _SCORE_TO_LEVEL:
        if score >= threshold:
            level = lbl
    return level


# ── Version helpers ────────────────────────────────────────────────────────────

def _ha_url() -> str:
    return settings.get("home_assistant", {}).get("url", "").rstrip("/")


def _ha_headers() -> dict:
    token = settings.get("home_assistant", {}).get("token", "")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _get_ha_current_version() -> str | None:
    """Return the currently running HA version string, e.g. '2024.4.2'."""
    try:
        resp = _requests.get(f"{_ha_url()}/api/config", headers=_ha_headers(), timeout=10)
        if resp.status_code == 200:
            return resp.json().get("version")
    except Exception as exc:
        log_error(f"[UpdateChecker] /api/config failed: {exc}")
    return None


def _get_ha_update_entity() -> dict | None:
    """Return the state + attributes of update.home_assistant_core_update, or None."""
    try:
        resp = _requests.get(
            f"{_ha_url()}/api/states/update.home_assistant_core_update",
            headers=_ha_headers(),
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as exc:
        log_error(f"[UpdateChecker] update entity fetch failed: {exc}")
    return None


# ── GitHub release notes ───────────────────────────────────────────────────────

_GH_HEADERS = {"Accept": "application/vnd.github.v3+json", "User-Agent": "Ziggy-HA-UpdateChecker/1.0"}


def _fetch_release_notes(version: str) -> str | None:
    """Fetch the raw release body from GitHub for the given HA version tag."""
    # HA tags: "2024.4.2"
    url = f"https://api.github.com/repos/home-assistant/core/releases/tags/{version}"
    try:
        resp = _requests.get(url, headers=_GH_HEADERS, timeout=15)
        if resp.status_code == 200:
            return resp.json().get("body") or ""
        # Some patch releases may not be tagged; try the blog post format as fallback
        log_info(f"[UpdateChecker] GitHub release {version} not found (status {resp.status_code})")
    except Exception as exc:
        log_error(f"[UpdateChecker] GitHub fetch failed for {version}: {exc}")
    return None


def _parse_breaking_changes(body: str) -> list[str]:
    """Extract lines / bullets from the ## Breaking Changes section of a release body."""
    if not body:
        return []
    # Find the section
    match = re.search(
        r'##\s+Breaking\s+[Cc]hanges\b(.+?)(?=\n##|\Z)',
        body,
        re.DOTALL | re.IGNORECASE,
    )
    if not match:
        return []
    section = match.group(1).strip()
    lines = []
    for line in section.splitlines():
        line = line.strip()
        if line.startswith(("#", "---")):
            continue
        if line:
            lines.append(line)
    return lines


# ── User setup profile ─────────────────────────────────────────────────────────

def _build_user_profile() -> dict:
    """Build a snapshot of what HA features the user's Ziggy setup actually uses."""
    profile: dict[str, Any] = {}

    # Pull live state_cache (what entities exist in the user's HA)
    try:
        from services.ha_subscriber import state_cache
        all_states = dict(state_cache)
    except Exception:
        all_states = {}

    def _count_domain(domain: str) -> int:
        return sum(1 for eid in all_states if eid.startswith(f"{domain}."))

    profile["light_count"]        = _count_domain("light")
    profile["climate_count"]      = _count_domain("climate")
    profile["media_player_count"] = _count_domain("media_player")
    profile["script_count"]       = _count_domain("script")
    profile["fan_count"]          = _count_domain("fan")
    profile["cover_count"]        = _count_domain("cover")
    profile["person_count"]       = _count_domain("person")

    # Automations — check HA automation state entities
    profile["automation_count"] = _count_domain("automation")

    # ZHA — detect via entity platforms in registry
    zha_count = 0
    try:
        import asyncio
        from services.ha_areas import _ws
        loop = asyncio.get_event_loop()
        if not loop.is_running():
            res, = loop.run_until_complete(_ws({"type": "config/entity_registry/list"}))
            entities = res.get("result") or []
            zha_count = sum(1 for e in entities if e.get("platform") == "zha")
    except Exception:
        pass
    profile["zha_device_count"] = zha_count

    # MQTT — check settings
    mqtt_cfg = settings.get("mqtt", {})
    profile["mqtt_enabled"] = bool(mqtt_cfg.get("host"))

    # Z-Wave — look for zwave_js entities in state cache
    profile["has_zwave"] = any(
        (all_states.get(eid) or {}).get("attributes", {}).get("platform") == "zwave_js"
        or eid.startswith("sensor.") and "zwave" in eid.lower()
        for eid in all_states
    )

    # Todo / shopping list
    profile["has_todo"] = bool(settings.get("todo", {}).get("shopping_list"))

    return profile


# ── Risk analysis ──────────────────────────────────────────────────────────────

def _analyse_risks(breaking_lines: list[str], profile: dict) -> list[dict]:
    """Match breaking change lines against risk rules. Returns matched risks."""
    combined_text = " ".join(breaking_lines).lower()
    matched: list[dict] = []

    for rule in _RISK_RULES:
        # Check keyword match in breaking change text
        if not any(kw in combined_text for kw in rule["keywords"]):
            continue

        # Check if user's setup is affected
        check_key = rule["check_key"]
        if check_key == "always":
            relevant = True
        elif check_key is None:
            # Cannot verify — include as unknown-impact item
            relevant = True
        elif isinstance(check_key, str):
            val = profile.get(check_key)
            if isinstance(val, bool):
                relevant = val
            elif isinstance(val, int):
                relevant = val > 0
            else:
                relevant = bool(val)
        else:
            relevant = False

        if not relevant:
            continue

        # Build the message
        try:
            msg = rule["message"].format(**profile)
        except KeyError:
            msg = rule["message"]

        # Find the breaking change lines that triggered this rule
        triggered_lines = [
            ln for ln in breaking_lines
            if any(kw in ln.lower() for kw in rule["keywords"])
        ]

        matched.append({
            "rule_id":        rule["id"],
            "weight":         rule["weight"],
            "message":        msg,
            "feature":        rule["feature"],
            "action":         rule["action"],
            "triggered_by":   triggered_lines[:3],  # at most 3 example lines
            "verifiable":     check_key is not None,
        })

    return matched


# ── History persistence ────────────────────────────────────────────────────────

def _load_history() -> list[dict]:
    try:
        if _HISTORY_FILE.exists():
            return json.loads(_HISTORY_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return []


def _save_history(entries: list[dict]) -> None:
    try:
        _HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        _HISTORY_FILE.write_text(json.dumps(entries[-100:], indent=2), encoding="utf-8")
    except Exception as exc:
        log_error(f"[UpdateChecker] history save failed: {exc}")


def _record_history(report: dict) -> None:
    """Append an update detection event to history (dedup by version pair)."""
    entries = _load_history()
    key = (report.get("current_version"), report.get("latest_version"))
    # Don't duplicate same detection
    for e in entries:
        if (e.get("current_version"), e.get("latest_version")) == key:
            return
    entries.append({
        "detected_at":      datetime.now(timezone.utc).isoformat(),
        "current_version":  report.get("current_version"),
        "latest_version":   report.get("latest_version"),
        "risk_level":       report.get("risk_level"),
        "risk_count":       len(report.get("risks", [])),
        "dismissed":        False,
    })
    _save_history(entries)


def dismiss_update(version: str) -> None:
    """Mark a version as dismissed in history."""
    entries = _load_history()
    for e in entries:
        if e.get("latest_version") == version:
            e["dismissed"] = True
    _save_history(entries)


def get_history() -> list[dict]:
    return list(reversed(_load_history()))


# ── Notification ───────────────────────────────────────────────────────────────

def _notify(report: dict) -> None:
    """Send web push (and optionally Telegram) notification for a risky update."""
    risk_level = report.get("risk_level", "unknown")
    if risk_level == "safe":
        return

    latest  = report.get("latest_version", "unknown")
    current = report.get("current_version", "unknown")
    risk_count = len(report.get("risks", []))

    title = f"HA Update Available: {latest}"
    body_parts = [f"Risk level: {risk_level.upper()}"]
    if risk_count:
        body_parts.append(f"{risk_count} potential compatibility issue{'s' if risk_count > 1 else ''} detected.")
    body = " · ".join(body_parts)

    # Web push
    try:
        from services.push_notify import push_notify_sync
        push_notify_sync(title, body, "/ha-update", "ha_update")
    except Exception as exc:
        log_error(f"[UpdateChecker] push notify failed: {exc}")

    # Telegram — if bot token and allowed users are configured
    _notify_telegram(latest, current, risk_level, report.get("risks", []))


def _notify_telegram(latest: str, current: str, risk_level: str, risks: list[dict]) -> None:
    tg = settings.get("telegram", {})
    token = tg.get("token")
    allowed = tg.get("allowed_users") or []
    if not token or not allowed:
        return

    icon_map = {"safe": "✅", "low": "🟡", "medium": "🟠", "high": "🔴", "unknown": "❓"}
    icon = icon_map.get(risk_level, "❓")

    lines = [
        f"{icon} *HA Update Available*",
        f"Current: `{current}` → New: `{latest}`",
        f"Risk: *{risk_level.upper()}*",
        "",
    ]
    if risks:
        lines.append("*What may break:*")
        for r in risks[:5]:
            lines.append(f"• {r['feature']}: {r['message']}")
    lines += ["", "⚠️ Back up Home Assistant before updating.", "Open Ziggy → HA Update for full details."]

    text = "\n".join(lines)
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for chat_id in allowed:
        try:
            _requests.post(url, json={
                "chat_id":    chat_id,
                "text":       text,
                "parse_mode": "Markdown",
            }, timeout=10)
        except Exception as exc:
            log_error(f"[UpdateChecker] Telegram notify to {chat_id} failed: {exc}")


# ── Main check function ────────────────────────────────────────────────────────

def check_for_update(force: bool = False) -> dict:
    """
    Full update check. Returns a report dict with:
      update_available, current_version, latest_version,
      risk_level, risks, breaking_changes_raw,
      release_url, release_notes_available, checked_at,
      what_to_do, backup_reminder
    """
    global _cache, _cache_ts

    with _lock:
        if not force and _cache is not None and (time.time() - _cache_ts) < _CACHE_TTL_S:
            return dict(_cache)

        report = _do_check()
        _cache    = report
        _cache_ts = time.time()

    return dict(report)


def _do_check() -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── 1. Get current version ─────────────────────────────────────────────────
    current_version = _get_ha_current_version()
    if not current_version:
        return {
            "update_available":        False,
            "current_version":         None,
            "latest_version":          None,
            "risk_level":              "unknown",
            "risks":                   [],
            "breaking_changes_raw":    [],
            "release_url":             None,
            "release_notes_available": False,
            "checked_at":              now_iso,
            "error":                   "Could not reach Home Assistant to determine current version.",
            "what_to_do":              "Ensure Home Assistant is running and Ziggy's HA token is valid.",
            "backup_reminder":         False,
        }

    # ── 2. Check for available update via update entity ────────────────────────
    update_entity = _get_ha_update_entity()
    update_available = False
    latest_version: str | None = None
    release_url: str | None = None
    release_summary: str | None = None

    if update_entity:
        state = update_entity.get("state")
        attrs = update_entity.get("attributes", {}) or {}
        if state == "on":
            update_available = True
            latest_version   = attrs.get("latest_version") or attrs.get("newest_version")
            release_url      = attrs.get("release_url")
            release_summary  = attrs.get("release_summary")

    if not update_available:
        report = {
            "update_available":        False,
            "current_version":         current_version,
            "latest_version":          current_version,
            "risk_level":              "safe",
            "risks":                   [],
            "breaking_changes_raw":    [],
            "release_url":             None,
            "release_notes_available": False,
            "checked_at":              now_iso,
            "what_to_do":              "Home Assistant is up to date. No action needed.",
            "backup_reminder":         False,
        }
        return report

    log_info(f"[UpdateChecker] Update available: {current_version} → {latest_version}")

    # ── 3. Fetch release notes from GitHub ────────────────────────────────────
    notes_body = _fetch_release_notes(latest_version) if latest_version else None

    # If no notes from GitHub tag, try the release_summary from HA entity
    if not notes_body and release_summary:
        notes_body = release_summary

    release_notes_available = bool(notes_body)

    # ── 4. Parse breaking changes ─────────────────────────────────────────────
    breaking_lines = _parse_breaking_changes(notes_body or "") if notes_body else []

    # ── 5. Build user profile ─────────────────────────────────────────────────
    profile = _build_user_profile()

    # ── 6. Run risk analysis ──────────────────────────────────────────────────
    if not release_notes_available:
        # Cannot assess — mark unknown, not safe
        risk_level = "unknown"
        risks: list[dict] = []
    else:
        risks = _analyse_risks(breaking_lines, profile)
        total_score = sum(r["weight"] for r in risks)
        risk_level = _score_to_risk_level(total_score)

    # ── 7. Compose human-readable "what to do" ────────────────────────────────
    if risk_level == "safe":
        what_to_do = "No breaking changes detected that affect your Ziggy setup. Safe to update."
    elif risk_level == "low":
        what_to_do = "Minor changes detected. Review the list below, then update."
    elif risk_level == "medium":
        what_to_do = "Notable changes affect features you use. Back up, review, then update carefully."
    elif risk_level == "high":
        what_to_do = "High-impact changes detected. Back up Home Assistant, test on a spare system if possible, then update."
    else:
        what_to_do = "Release notes unavailable — risk cannot be assessed. Back up before updating."

    report = {
        "update_available":        True,
        "current_version":         current_version,
        "latest_version":          latest_version,
        "risk_level":              risk_level,
        "risks":                   risks,
        "risk_score":              sum(r["weight"] for r in risks),
        "breaking_changes_raw":    breaking_lines[:30],  # cap raw list
        "profile":                 {k: v for k, v in profile.items() if not isinstance(v, bool) or v},
        "release_url":             release_url or (
            f"https://www.home-assistant.io/blog/releases/homeassistant-{latest_version}/"
            if latest_version else None
        ),
        "release_notes_available": release_notes_available,
        "checked_at":              now_iso,
        "what_to_do":              what_to_do,
        "backup_reminder":         True,
        "backup_url":              "https://www.home-assistant.io/docs/configuration/backup/",
    }

    # ── 8. Persist to history + notify ────────────────────────────────────────
    _record_history(report)
    if risk_level not in ("safe",):
        _notify(report)

    log_info(f"[UpdateChecker] {current_version} → {latest_version} | risk={risk_level} | issues={len(risks)}")
    return report


async def background_check() -> None:
    """Async wrapper — run update check once in a background task at startup."""
    import asyncio
    try:
        # Delay 30 s after startup so HA subscriber has time to connect first
        await asyncio.sleep(30)
        check_for_update()
    except Exception as exc:
        log_error(f"[UpdateChecker] background_check failed: {exc}")
