"""Turn raw hub telemetry into a fleet-operator verdict.

The relay used to store telemetry verbatim and refuse to interpret it
("The relay never interprets the payload" — telemetry.py). That boundary is
why a customer home could sit degraded for 19 h with the cloud showing nothing
but `status: active`, which is a *provisioning lifecycle* column, not health.

This module is that missing interpretation, and it is deliberately PURE:
`evaluate(home, payload, ts, now)` → verdict. No I/O, no DB, no clock of its
own. That makes every rule unit-testable against a synthetic payload, which
matters because these rules are the thing that decides whether a human gets
woken up.

Design notes
------------
* **Silence is the most important signal.** A dead mini PC, a cut power line, a
  crashed container, a severed tunnel — none of them post telemetry saying so.
  You cannot detect absence by inspecting payloads; you detect it by noticing
  that nothing arrived. So `last_seen` is evaluated FIRST and outranks
  everything a payload could claim.
* **Rules are ordered by severity**, and the worst determines `level` while all
  matches are reported in `issues` — an operator needs the headline AND the
  full picture.
* **Unknown ≠ healthy.** A home that has never reported gets `unknown`, not
  `ok`. Optimistic defaults are how outages hide.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

# ── Levels, worst first ────────────────────────────────────────────────────
LEVEL_DOWN     = "down"       # not reachable / not reporting — go look now
LEVEL_DEGRADED = "degraded"   # working but impaired, or drifted off-channel
LEVEL_OK       = "ok"
LEVEL_UNKNOWN  = "unknown"    # never reported; can't claim either way

_LEVEL_RANK = {LEVEL_DOWN: 3, LEVEL_DEGRADED: 2, LEVEL_UNKNOWN: 1, LEVEL_OK: 0}

# ── Thresholds ─────────────────────────────────────────────────────────────
# Hubs post every 5 min. Two missed posts is noise (a slow HA call, a blip);
# three is a pattern. 20 min keeps false pages near zero while still catching a
# real outage within a coffee break.
SILENCE_DEGRADED_S = 20 * 60
# An hour of silence is not a hiccup. Power cut, dead disk, crashed container,
# tunnel down — all look identical from here, and all need a human.
SILENCE_DOWN_S     = 60 * 60

DISK_DEGRADED_PCT  = 85.0
DISK_DOWN_PCT      = 95.0   # SQLite + Z2M corrupt when the disk fills
MEM_DEGRADED_PCT   = 92.0

# Share of devices offline before it reads as an infrastructure fault rather
# than "one bulb is unplugged". Mirrors the hub-side ha_health thresholds.
DEVICES_OFFLINE_MANY_SHARE = 0.5
DEVICES_OFFLINE_MIN        = 1

# A registry where (nearly) everything is "lost" is the 2026-08-09 signature:
# not 23 dead devices, but one bad reconcile telling the user their home was
# dismantled. Treated as its own issue because the remedy is different — you
# reconcile, you don't go hunting for dead radios.
REGISTRY_MASS_LOST_SHARE = 0.9
REGISTRY_MASS_LOST_MIN   = 3


def hub_base_url(home: dict) -> str:
    """Where to reach a hub over HTTP. One resolver, used everywhere.

    `public_hostname` wins over `tunnel_url` because many homes only ever
    registered a raw `*.cfargotunnel.com` address, which is routable from inside
    Cloudflare but NOT from Fly — every call to those times out after 30 s.
    Three separate call sites each rebuilt this URL by hand and only one of them
    was fixed, so the fleet console could reach a hub while the paired-phones
    lookup on the very same page could not.
    """
    base = (home.get("public_hostname") or "").strip() or (home.get("tunnel_url") or "").strip()
    if not base:
        return ""
    if not base.startswith(("http://", "https://")):
        base = f"https://{base.lstrip('/')}"
    return base.rstrip("/")


def _iso_to_epoch(ts: Optional[str]) -> Optional[float]:
    if not ts:
        return None
    try:
        s = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return None


# Issues that are worth showing but are not a fault to fix — context an operator
# reads, not a task. Naming them keeps the UI from offering a repair for
# "the host rebooted", or implying a human must act on "this hub is too old to
# report health".
_CONTEXT_ONLY = frozenset({
    "recently_rebooted", "no_health_telemetry", "never_reported",
})


def _issue(code: str, level: str, message: str, **detail: Any) -> dict:
    out = {"code": code, "level": level, "message": message}
    # Each issue carries its own remedy so every surface — console, CLI,
    # remediator — agrees on what can be fixed automatically. Deriving it
    # separately in a UI is how three surfaces start disagreeing.
    remedy = _REMEDY.get(code)
    out["remedy"] = remedy
    out["kind"] = "repair" if remedy else ("context" if code in _CONTEXT_ONLY else "human")
    if detail:
        out["detail"] = detail
    return out


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def evaluate(
    home: dict,
    payload: Optional[dict],
    last_seen_iso: Optional[str],
    *,
    now: float,
) -> dict:
    """Verdict for one home.

    Returns::

        {
          "home_id", "name",
          "level":        ok|degraded|down|unknown,
          "headline":     str,        # the single worst thing, for a list row
          "issues":       [ {code, level, message, detail?}, ... ],
          "last_seen":    iso|None,
          "silent_for_s": float|None,
          "actionable":   [ "reconcile", ... ],   # safe verbs that may help
        }
    """
    issues: list[dict] = []
    payload = payload if isinstance(payload, dict) else None

    # ── 0. Suspended homes are not "unhealthy", they're switched off ───────
    status = (home.get("status") or "").lower()
    if status in ("suspended", "deprovisioning", "deprovisioned"):
        return {
            "home_id": home.get("id"),
            "name": home.get("name"),
            "level": LEVEL_UNKNOWN,
            "headline": f"Home is {status} — health not evaluated.",
            "issues": [],
            "last_seen": last_seen_iso,
            "silent_for_s": None,
            "actionable": [],
            "suspended": True,
        }

    # ── 1. Silence — outranks anything a payload could say ─────────────────
    last_seen_epoch = _iso_to_epoch(last_seen_iso)
    silent_for = (now - last_seen_epoch) if last_seen_epoch else None

    if last_seen_epoch is None:
        issues.append(_issue(
            "never_reported", LEVEL_UNKNOWN,
            "This home has never sent telemetry.",
        ))
    elif silent_for is not None and silent_for >= SILENCE_DOWN_S:
        issues.append(_issue(
            "hub_silent", LEVEL_DOWN,
            f"No telemetry for {_human(silent_for)} — hub may be powered off, "
            f"offline, or its container is down.",
            silent_for_s=round(silent_for),
        ))
    elif silent_for is not None and silent_for >= SILENCE_DEGRADED_S:
        issues.append(_issue(
            "hub_reporting_late", LEVEL_DEGRADED,
            f"No telemetry for {_human(silent_for)} (expected every 5 min).",
            silent_for_s=round(silent_for),
        ))

    if payload:
        issues.extend(_evaluate_payload(payload))

    level = _worst_level(issues)
    if not issues:
        level = LEVEL_OK

    return {
        "home_id": home.get("id"),
        "name": home.get("name"),
        "level": level,
        "headline": _headline(issues, level),
        "issues": issues,
        "last_seen": last_seen_iso,
        "silent_for_s": round(silent_for) if silent_for is not None else None,
        "actionable": _actionable(issues),
        "suspended": False,
    }


def _evaluate_payload(p: dict) -> list[dict]:
    issues: list[dict] = []
    health = p.get("health") if isinstance(p.get("health"), dict) else {}
    registry = health.get("registry") if isinstance(health.get("registry"), dict) else {}
    devices = health.get("devices") if isinstance(health.get("devices"), dict) else {}
    deploy = p.get("deploy") if isinstance(p.get("deploy"), dict) else {}

    # ── Home Assistant itself ──────────────────────────────────────────────
    if health.get("ha_reachable") is False:
        issues.append(_issue(
            "ha_unreachable", LEVEL_DOWN,
            "Ziggy cannot reach Home Assistant — nothing in the home responds.",
        ))

    coord = health.get("coordinator_state")
    if coord in ("setup_retry", "setup_error", "failed", "not_loaded", "migration_error"):
        issues.append(_issue(
            "zigbee_coordinator_down", LEVEL_DOWN,
            f"Zigbee coordinator is '{coord}' — every Zigbee device is unreachable.",
            coordinator_state=coord,
        ))

    # ── The false-lost signature ───────────────────────────────────────────
    r_total, r_lost = registry.get("total"), registry.get("lost")
    if isinstance(r_total, int) and isinstance(r_lost, int) and r_total >= REGISTRY_MASS_LOST_MIN:
        if r_lost >= REGISTRY_MASS_LOST_SHARE * r_total:
            issues.append(_issue(
                "devices_mass_lost", LEVEL_DEGRADED,
                f"{r_lost} of {r_total} devices are marked 'lost' — the app is "
                f"telling this customer their devices were removed from the hub. "
                f"Almost always a bad reconcile, not real device loss.",
                lost=r_lost, total=r_total,
            ))
        elif r_lost > 0:
            issues.append(_issue(
                "devices_lost", LEVEL_DEGRADED,
                f"{r_lost} of {r_total} devices show as removed from the hub.",
                lost=r_lost, total=r_total,
            ))

    # ── Devices offline per HA ─────────────────────────────────────────────
    d_total, d_off = devices.get("total"), devices.get("offline")
    if isinstance(d_total, int) and isinstance(d_off, int) and d_off >= DEVICES_OFFLINE_MIN:
        share = (d_off / d_total) if d_total else 0.0
        if d_total and share >= DEVICES_OFFLINE_MANY_SHARE:
            issues.append(_issue(
                "devices_offline_many", LEVEL_DEGRADED,
                f"{d_off} of {d_total} devices are offline ({share:.0%}) — "
                f"looks like a radio or network fault, not individual devices.",
                offline=d_off, total=d_total,
            ))
        else:
            issues.append(_issue(
                "devices_offline", LEVEL_DEGRADED,
                f"{d_off} of {d_total} devices offline.",
                offline=d_off, total=d_total,
            ))

    # ── Containers ─────────────────────────────────────────────────────────
    for c in (p.get("container_health") or []):
        if not isinstance(c, dict):
            continue
        name, state = c.get("name"), (c.get("status") or "").lower()
        if state and not any(k in state for k in ("up", "running", "healthy")):
            issues.append(_issue(
                "container_unhealthy", LEVEL_DOWN,
                f"Container '{name}' is {state}.",
                container=name, state=state,
            ))

    # ── Resources ──────────────────────────────────────────────────────────
    disk = _num(p.get("disk_pct_used"))
    if disk is not None:
        if disk >= DISK_DOWN_PCT:
            issues.append(_issue(
                "disk_critical", LEVEL_DOWN,
                f"Disk {disk:.0f}% full — Zigbee and HA databases corrupt when it fills.",
                disk_pct=disk,
            ))
        elif disk >= DISK_DEGRADED_PCT:
            issues.append(_issue(
                "disk_low", LEVEL_DEGRADED, f"Disk {disk:.0f}% full.", disk_pct=disk,
            ))

    mem = _num(p.get("mem_pct"))
    if mem is not None and mem >= MEM_DEGRADED_PCT:
        issues.append(_issue("memory_pressure", LEVEL_DEGRADED, f"Memory {mem:.0f}% used.", mem_pct=mem))

    # ── Recent restart — context, not an alert on its own ──────────────────
    up = _num(p.get("system_uptime_s"))
    if up is not None and up < 900:
        issues.append(_issue(
            "recently_rebooted", LEVEL_DEGRADED,
            f"Host rebooted {_human(up)} ago — watch for devices that don't come back.",
            uptime_s=round(up),
        ))

    # ── Release drift ──────────────────────────────────────────────────────
    if deploy.get("drifted"):
        issues.append(_issue(
            "release_drift", LEVEL_DEGRADED,
            f"Not on the release channel: {deploy.get('drift_reason') or 'unknown reason'}.",
            git_sha=deploy.get("git_sha"), release_tag=deploy.get("release_tag"),
            cohort=deploy.get("cohort"), dirty=deploy.get("dirty"),
        ))

    # ── Old hub that doesn't report health at all ──────────────────────────
    if not health:
        issues.append(_issue(
            "no_health_telemetry", LEVEL_UNKNOWN,
            "Hub is reporting, but on an old build that sends no health data — "
            "its true state is unknown until it updates.",
        ))

    return issues


def vitals(payload: Optional[dict]) -> dict:
    """The numbers an operator glances at, pulled from one telemetry payload.

    Kept separate from `evaluate` on purpose: evaluate decides whether to worry,
    this just reports. A console that only ever showed alerts would leave you
    unable to see a disk climbing toward full BEFORE it became an incident.
    """
    p = payload if isinstance(payload, dict) else {}
    health = p.get("health") if isinstance(p.get("health"), dict) else {}
    devices = health.get("devices") if isinstance(health.get("devices"), dict) else {}
    registry = health.get("registry") if isinstance(health.get("registry"), dict) else {}
    deploy = p.get("deploy") if isinstance(p.get("deploy"), dict) else {}

    return {
        "devices_total":   devices.get("total"),
        "devices_offline": devices.get("offline"),
        "devices_lost":    registry.get("lost"),
        "disk_pct":        _num(p.get("disk_pct_used")),
        "mem_pct":         _num(p.get("mem_pct")),
        "cpu_pct":         _num(p.get("cpu_pct")),
        "uptime_s":        _num(p.get("system_uptime_s")),
        "ha_version":      p.get("ha_version"),
        "ziggy_version":   p.get("ziggy_version"),
        "release_tag":     deploy.get("release_tag") or deploy.get("git_describe"),
        "cohort":          deploy.get("cohort"),
        "drifted":         bool(deploy.get("drifted")),
    }


import re

# `git describe` on a commit past a tag returns "<tag>-<n>-g<sha>". The canary
# cohort follows origin/main BY DESIGN, so it sits a commit or two past the
# newest tag almost all the time.
_DESCRIBE_SUFFIX = re.compile(r"-(\d+)-g[0-9a-f]{7,}$")


def base_release(tag: Optional[str]) -> tuple[Optional[str], int]:
    """('release-2026.08.11-5', 1) from 'release-2026.08.11-5-1-gc97d6cd'."""
    if not tag:
        return None, 0
    m = _DESCRIBE_SUFFIX.search(tag)
    if not m:
        return tag, 0
    return tag[:m.start()], int(m.group(1))


def version_rollup(verdicts: list[dict]) -> dict:
    """Is the fleet all on one release?

    Release drift is the failure that hides: a home silently left behind gets no
    fixes and nothing complains. Convergence deserves to be visible on the front
    page rather than inferred by reading a column.

    Compared on the BASE tag, not the raw `git describe` string. The canary hub
    tracks origin/main and is therefore a commit or two ahead of the newest tag
    nearly always — comparing raw strings reported the fleet as "split across 2
    versions" permanently, in warning colour, for a hub doing exactly what its
    cohort tells it to. An alert that is always on is one nobody reads.
    """
    counts: dict[str, int] = {}
    ahead: dict[str, int] = {}
    for v in verdicts:
        if v.get("suspended"):
            continue
        raw = (v.get("vitals") or {}).get("release_tag")
        base, n = base_release(raw)
        key = base or "unknown"
        counts[key] = counts.get(key, 0) + 1
        if n:
            ahead[v.get("name") or v.get("home_id") or "?"] = n

    known = {k: c for k, c in counts.items() if k != "unknown"}
    return {
        "counts": counts,
        "distinct": len(known),
        # One release across every reporting home, and nothing unaccounted for.
        "converged": len(known) <= 1 and "unknown" not in counts and bool(known),
        "majority": max(known, key=known.get) if known else None,
        # Homes deliberately running past the tag (canary), so the UI can show
        # the lead as information rather than as a fault.
        "ahead": ahead,
    }


def _worst_level(issues: list[dict]) -> str:
    if not issues:
        return LEVEL_OK
    return max((i["level"] for i in issues), key=lambda l: _LEVEL_RANK.get(l, 0))


def _headline(issues: list[dict], level: str) -> str:
    if not issues:
        return "All good."
    worst = [i for i in issues if i["level"] == level]
    head = (worst or issues)[0]["message"]
    extra = len(issues) - 1
    return f"{head}" + (f" (+{extra} more)" if extra > 0 else "")


# Which safe, idempotent hub verbs might actually help this issue. Consumed by
# the autonomous remediator so it never guesses — an unmapped issue means
# "a human decides", which is the correct default.
_REMEDY = {
    "devices_mass_lost": "reconcile",
    "devices_lost":      "reconcile",
    "devices_offline_many": "recover-ha",
    "zigbee_coordinator_down": "recover-ha",
}


def _actionable(issues: list[dict]) -> list[str]:
    out: list[str] = []
    for i in issues:
        verb = _REMEDY.get(i["code"])
        if verb and verb not in out:
            out.append(verb)
    return out


def _human(seconds: float) -> str:
    s = int(seconds)
    if s < 90:
        return f"{s}s"
    if s < 5400:
        return f"{s // 60}m"
    if s < 172800:
        return f"{s // 3600}h"
    return f"{s // 86400}d"


def summarize(verdicts: list[dict]) -> dict:
    """Fleet-level rollup for a dashboard header / alert subject line."""
    counts = {LEVEL_OK: 0, LEVEL_DEGRADED: 0, LEVEL_DOWN: 0, LEVEL_UNKNOWN: 0}
    for v in verdicts:
        counts[v.get("level", LEVEL_UNKNOWN)] = counts.get(v.get("level", LEVEL_UNKNOWN), 0) + 1
    if counts[LEVEL_DOWN]:
        level = LEVEL_DOWN
    elif counts[LEVEL_DEGRADED]:
        level = LEVEL_DEGRADED
    elif counts[LEVEL_OK]:
        level = LEVEL_OK
    else:
        level = LEVEL_UNKNOWN
    return {
        "level": level,
        "total": len(verdicts),
        "counts": counts,
        "needs_attention": [
            v["home_id"] for v in verdicts if v.get("level") in (LEVEL_DOWN, LEVEL_DEGRADED)
        ],
    }
