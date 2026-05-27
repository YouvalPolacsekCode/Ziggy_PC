"""HA installer — applies a staged OTA manifest to the local Home Assistant
container, rolling back on failure (Prompt 4 chunks 1.C + 1.D).

Reads the target version from the manifest staged by services/ota_client.py,
rewrites the homeassistant service's image tag in the host compose file, runs
`docker compose up -d homeassistant`, and probes HA's REST API until the
expected version is reported. On success calls ota_client.mark_installed()
to clear the stage. On failure after the compose file has been mutated, the
installer reverts to the previously-running image tag (recorded to
user_files/ha_installer_state.json before any mutation) and re-recreates the
container — so "nothing breaks" survives a failed apply just as much as a
successful one.

This module does NOT:

  - Verify image digests. The manifest carries image_digests today but
    the installer currently trusts the registry. Pinning the digest is
    a chunk-2 hardening item once the basic apply path is proven.
  - Fire automatically. The scheduler hook that triggers apply lands in
    chunk 1.E behind ha.auto_install (default false).

Public surface:

  read_current_image(compose_file)          -> {repo, tag, raw_line}
  pin_compose_image(compose_file, repo, tag) (atomic; preserves comments)
  recreate_ha_container(compose_file)        runs docker compose; returns
                                             a result dict
  probe_ha_health(url, expected_version,
                  attempts, interval_s)      polls /api/config; returns dict
  apply_manifest(manifest, settings, *,
                 dry_run=False,
                 rollback_on_failure=True)   orchestrates the apply path,
                                             reverts on failure
  rollback(target_tag, *, settings)          explicit revert; called by
                                             apply_manifest internally and
                                             also exposed for an admin trigger

Installer state at user_files/ha_installer_state.json — written by
apply_manifest before any mutation, read by rollback():

  {
    "previous_image_tag":   "<tag>" | null,
    "last_apply_outcome":   "<reason>" | null,
    "last_apply_ts":        "<iso8601>" | null
  }

Test seams (every external dependency is injectable via kwargs):

  _run_cmd       subprocess.run wrapper — fakeable
  _http_get      requests.get wrapper   — fakeable
  _sleep         time.sleep             — fakeable for fast tests

All blocking calls catch their own failures and return result dicts.
apply_manifest never raises into the scheduler — same contract as
ota_client.poll_once and telemetry_client.post_once.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shlex
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import requests
import yaml

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Installer state file — captures "what was the image tag before we started
# applying?" so rollback knows where to revert. Kept separate from
# user_files/ota_state.json (managed by services/ota_client.py) so the OTA
# layer's state model stays untouched.
# ---------------------------------------------------------------------------

INSTALLER_STATE_PATH = Path("user_files/ha_installer_state.json")

_INSTALLER_STATE_DEFAULTS: dict = {
    "previous_image_tag": None,
    "last_apply_outcome": None,
    "last_apply_ts":      None,
}


def load_installer_state(path: Optional[Path] = None) -> dict:
    """Read installer state. Missing file → fresh defaults. Same shape as
    ota_client.load_state — extra keys in the file are preserved on read so
    a future chunk can extend without breaking existing rollback runs.

    Defaulting to None and resolving INSTALLER_STATE_PATH at call time
    lets tests monkeypatch the module-level constant without rebinding
    every function's default."""
    if path is None:
        path = INSTALLER_STATE_PATH
    try:
        raw = path.read_text()
    except FileNotFoundError:
        return dict(_INSTALLER_STATE_DEFAULTS)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        log.warning("ha_installer_state.json malformed (%s) — resetting", e)
        return dict(_INSTALLER_STATE_DEFAULTS)
    if not isinstance(data, dict):
        return dict(_INSTALLER_STATE_DEFAULTS)
    out = dict(_INSTALLER_STATE_DEFAULTS)
    out.update(data)
    return out


def save_installer_state(state: dict, path: Optional[Path] = None) -> None:
    """Atomic write — same temp+rename pattern as ota_client.save_state."""
    if path is None:
        path = INSTALLER_STATE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    os.replace(tmp, path)


def _record_outcome(reason: str, *, path: Optional[Path] = None,
                    clear_previous: bool = False) -> None:
    """Update last_apply_outcome / last_apply_ts in installer state.

    clear_previous=True nulls previous_image_tag — used after a successful
    apply once we know the new tag is healthy and the old one is no longer
    a useful rollback target."""
    if path is None:
        path = INSTALLER_STATE_PATH
    try:
        state = load_installer_state(path)
        state["last_apply_outcome"] = reason
        state["last_apply_ts"] = datetime.now(timezone.utc).isoformat()
        if clear_previous:
            state["previous_image_tag"] = None
        save_installer_state(state, path)
    except OSError as e:
        log.warning("ha_installer_state.json save failed: %s", e)


# ---------------------------------------------------------------------------
# Defaults — mirror the ha: block in config/settings.example.yaml so callers
# that pass an empty settings dict still get sensible behavior.
# ---------------------------------------------------------------------------

DEFAULT_IMAGE_REPO            = "ghcr.io/home-assistant/home-assistant"
DEFAULT_COMPOSE_FILE          = "./docker-compose.yml"
DEFAULT_HEALTH_URL            = "http://homeassistant.local:8123"
DEFAULT_APPLY_TIMEOUT_S       = 600
DEFAULT_HEALTH_ATTEMPTS       = 12
DEFAULT_HEALTH_INTERVAL_S     = 10

# Image line in the homeassistant service block. We match the home-assistant
# image repo specifically so an accidental edit to (say) mosquitto's image
# never gets rewritten. The regex captures the tag so we can return it.
#
# Matches:
#   image: ghcr.io/home-assistant/home-assistant:stable
#   image: ghcr.io/home-assistant/home-assistant:2026.5.1
#   image: "ghcr.io/home-assistant/home-assistant:stable"
#
# Anchored to start-of-line whitespace + `image:` so we don't match `# image: ...`.
_IMAGE_LINE_RE = re.compile(
    r'^(?P<lead>\s*image:\s*"?)'
    r'(?P<repo>ghcr\.io/home-assistant/home-assistant)'
    r':(?P<tag>[A-Za-z0-9._\-+]+)'
    r'(?P<trail>"?)\s*$',
    re.MULTILINE,
)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

class InstallResult(dict):
    """{ok, reason, from_version, to_version, duration_s, rolled_back,
        detail, applied_at}."""


class ProbeResult(dict):
    """{ok, reason, actual_version, attempts_made}."""


class RollbackResult(dict):
    """{ok, reason, restored_tag, detail}.

    ok=True means the compose file was reverted AND HA came back up at the
    previous tag (REST /api/config returned 200). ok=False means the
    rollback itself failed — the hub is in an indeterminate state and an
    admin must intervene. Either way, last_apply_outcome in installer
    state records the reason.
    """


# ---------------------------------------------------------------------------
# Compose-file reading & rewriting
# ---------------------------------------------------------------------------

def _resolve_compose_file(settings: Optional[dict]) -> Path:
    """Settings → env → default. Single helper so callers stay short."""
    if isinstance(settings, dict):
        cf = (settings.get("ha") or {}).get("compose_file")
        if cf:
            return Path(cf)
    env = os.getenv("ZIGGY_HOST_COMPOSE_FILE")
    if env:
        return Path(env)
    return Path(DEFAULT_COMPOSE_FILE)


def read_current_image(compose_file: Path) -> dict:
    """Return the current homeassistant image as {repo, tag, raw_line}.

    Raises FileNotFoundError if the compose file is missing — callers
    treat that as a hard configuration error, not a transient.

    Raises ValueError if the compose file exists but has zero or
    multiple home-assistant image lines (ambiguous; refusing to guess).
    """
    text = compose_file.read_text(encoding="utf-8")
    matches = list(_IMAGE_LINE_RE.finditer(text))
    if not matches:
        raise ValueError(
            f"No home-assistant image line found in {compose_file}. "
            "Expected `image: ghcr.io/home-assistant/home-assistant:<tag>`."
        )
    if len(matches) > 1:
        raise ValueError(
            f"Multiple home-assistant image lines in {compose_file} "
            f"({len(matches)}). Installer refuses to guess which to pin."
        )
    m = matches[0]
    return {
        "repo":     m.group("repo"),
        "tag":      m.group("tag"),
        "raw_line": m.group(0),
    }


def pin_compose_image(
    compose_file: Path,
    image_repo: str,
    new_tag: str,
) -> dict:
    """Atomically rewrite the homeassistant image tag.

    Returns {from_tag, to_tag, repo}. The write is temp+rename so a crash
    mid-write never leaves a half-truncated compose file.

    Validates the rewrite by re-parsing the result with PyYAML and
    confirming services.homeassistant.image now ends with the new tag.
    """
    current = read_current_image(compose_file)
    from_tag = current["tag"]
    repo_in_file = current["repo"]

    if repo_in_file != image_repo:
        # We refuse to silently swap repos — that's a different change
        # than a version bump and would surprise an admin reading diffs.
        raise ValueError(
            f"Compose file repo ({repo_in_file}) does not match configured "
            f"image_repo ({image_repo}). Refusing to swap repositories."
        )

    text = compose_file.read_text(encoding="utf-8")
    new_image = f"{image_repo}:{new_tag}"

    def _replace(match: re.Match) -> str:
        return f"{match.group('lead')}{new_image}{match.group('trail')}"

    new_text, n = _IMAGE_LINE_RE.subn(_replace, text)
    if n != 1:
        # Defense-in-depth — read_current_image already validated exactly
        # one match, so getting here means the file changed between read
        # and write.
        raise ValueError(
            f"Expected exactly 1 image-line replacement, got {n}. Aborting."
        )

    # Validate the result by round-tripping through PyYAML and inspecting
    # services.homeassistant.image. If the file isn't a valid compose
    # document afterwards, the docker compose call would fail anyway —
    # better to catch it now and bail cleanly.
    try:
        parsed = yaml.safe_load(new_text)
        ha_svc = (parsed.get("services") or {}).get("homeassistant") or {}
        actual = ha_svc.get("image", "")
        if not actual.endswith(f":{new_tag}"):
            raise ValueError(
                f"Post-rewrite compose parses but services.homeassistant.image "
                f"is {actual!r}, expected to end with :{new_tag}"
            )
    except yaml.YAMLError as e:
        raise ValueError(f"Post-rewrite compose is not valid YAML: {e}") from e

    # Atomic write — same pattern as services/ota_client.save_state.
    tmp = compose_file.with_suffix(compose_file.suffix + ".tmp")
    tmp.write_text(new_text, encoding="utf-8")
    os.replace(tmp, compose_file)

    return {"from_tag": from_tag, "to_tag": new_tag, "repo": image_repo}


# ---------------------------------------------------------------------------
# Docker compose driver
# ---------------------------------------------------------------------------

def _real_run_cmd(cmd: list[str], *, timeout: float) -> subprocess.CompletedProcess:
    """Thin wrapper around subprocess.run with sane defaults."""
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def recreate_ha_container(
    compose_file: Path,
    *,
    timeout_s: float = DEFAULT_APPLY_TIMEOUT_S,
    _run_cmd: Optional[Callable] = None,
) -> dict:
    """`docker compose -f <file> up -d homeassistant`.

    Returns {ok, reason, detail}. Never raises. A non-zero exit code,
    timeout, missing docker binary, or any other failure all surface as
    ok=False with a labelled reason so the caller can decide to roll back.
    """
    run_fn = _run_cmd or _real_run_cmd

    if not compose_file.exists():
        return {"ok": False, "reason": "compose_file_missing",
                "detail": str(compose_file)}

    cmd = ["docker", "compose", "-f", str(compose_file),
           "up", "-d", "homeassistant"]
    log.info("HA installer: running %s", shlex.join(cmd))

    try:
        result = run_fn(cmd, timeout=timeout_s)
    except FileNotFoundError:
        # `docker` binary not on PATH.
        return {"ok": False, "reason": "docker_not_found",
                "detail": "the docker binary is not available on PATH"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "docker_timeout",
                "detail": f"docker compose did not finish within {timeout_s}s"}
    except Exception as e:
        return {"ok": False, "reason": "docker_unexpected_error",
                "detail": f"{type(e).__name__}: {e}"}

    if result.returncode != 0:
        return {
            "ok": False, "reason": "docker_non_zero",
            "detail": (
                f"returncode={result.returncode} "
                f"stderr={(result.stderr or '')[:400]}"
            ),
        }
    return {"ok": True, "reason": "recreated",
            "detail": (result.stdout or "")[-400:]}


# ---------------------------------------------------------------------------
# HA health probe
# ---------------------------------------------------------------------------

def _real_http_get(url: str, *, headers: dict, timeout: float):
    return requests.get(url, headers=headers, timeout=timeout)


def probe_ha_health(
    health_url: str,
    expected_version: str,
    *,
    ha_token: str = "",
    attempts: int = DEFAULT_HEALTH_ATTEMPTS,
    interval_s: float = DEFAULT_HEALTH_INTERVAL_S,
    _http_get: Optional[Callable] = None,
    _sleep: Optional[Callable] = None,
) -> ProbeResult:
    """Poll <health_url>/api/config until 'version' equals expected_version.

    Returns ProbeResult{ok, reason, actual_version, attempts_made}.

    HA's /api/config requires a Bearer token. If ha_token is empty (e.g.
    first-boot before the user provides one) we still hit the endpoint —
    HA returns 401 fast, which we treat as "not yet healthy" and retry.
    """
    get_fn = _http_get or _real_http_get
    sleep_fn = _sleep or time.sleep
    url = health_url.rstrip("/") + "/api/config"
    headers = {"Authorization": f"Bearer {ha_token}"} if ha_token else {}

    last_reason = "no_attempts"
    last_actual: Optional[str] = None

    for i in range(1, attempts + 1):
        try:
            resp = get_fn(url, headers=headers, timeout=5.0)
        except Exception as e:
            last_reason = f"network_error: {type(e).__name__}: {e}"
            log.debug("HA health probe attempt %d/%d: %s", i, attempts, last_reason)
            if i < attempts:
                sleep_fn(interval_s)
            continue

        status = getattr(resp, "status_code", None)
        if status != 200:
            last_reason = f"http_{status}"
            log.debug("HA health probe attempt %d/%d: %s", i, attempts, last_reason)
            if i < attempts:
                sleep_fn(interval_s)
            continue

        try:
            data = resp.json()
        except Exception as e:
            last_reason = f"malformed_json: {type(e).__name__}: {e}"
            if i < attempts:
                sleep_fn(interval_s)
            continue

        actual = data.get("version") if isinstance(data, dict) else None
        last_actual = actual if isinstance(actual, str) else None
        if last_actual == expected_version:
            return ProbeResult(
                ok=True, reason="version_matches",
                actual_version=last_actual, attempts_made=i,
            )
        last_reason = (
            f"version_mismatch: expected={expected_version} "
            f"actual={last_actual}"
        )
        if i < attempts:
            sleep_fn(interval_s)

    return ProbeResult(
        ok=False, reason=last_reason,
        actual_version=last_actual, attempts_made=attempts,
    )


# ---------------------------------------------------------------------------
# Lightweight liveness probe (any 200 from /api/config)
# ---------------------------------------------------------------------------

def probe_ha_alive(
    health_url: str,
    *,
    ha_token: str = "",
    attempts: int = DEFAULT_HEALTH_ATTEMPTS,
    interval_s: float = DEFAULT_HEALTH_INTERVAL_S,
    _http_get: Optional[Callable] = None,
    _sleep: Optional[Callable] = None,
) -> ProbeResult:
    """Poll <health_url>/api/config until ANY 200 returns.

    Used by rollback() — when reverting to a previous tag we don't always
    know the exact version string HA will report (e.g. :stable resolves
    to whatever ghcr.io has today), so "alive" is the success criterion,
    not "alive with this exact version".
    """
    get_fn = _http_get or _real_http_get
    sleep_fn = _sleep or time.sleep
    url = health_url.rstrip("/") + "/api/config"
    headers = {"Authorization": f"Bearer {ha_token}"} if ha_token else {}

    last_reason = "no_attempts"
    last_actual: Optional[str] = None

    for i in range(1, attempts + 1):
        try:
            resp = get_fn(url, headers=headers, timeout=5.0)
        except Exception as e:
            last_reason = f"network_error: {type(e).__name__}: {e}"
            if i < attempts:
                sleep_fn(interval_s)
            continue
        status = getattr(resp, "status_code", None)
        if status != 200:
            last_reason = f"http_{status}"
            if i < attempts:
                sleep_fn(interval_s)
            continue
        try:
            data = resp.json()
            last_actual = data.get("version") if isinstance(data, dict) else None
        except Exception:
            last_actual = None
        return ProbeResult(
            ok=True, reason="alive",
            actual_version=last_actual if isinstance(last_actual, str) else None,
            attempts_made=i,
        )

    return ProbeResult(
        ok=False, reason=last_reason,
        actual_version=last_actual, attempts_made=attempts,
    )


# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------

def rollback(
    target_tag: str,
    *,
    settings: Optional[dict] = None,
    _run_cmd: Optional[Callable] = None,
    _http_get: Optional[Callable] = None,
    _sleep: Optional[Callable] = None,
) -> RollbackResult:
    """Revert HA's image tag to target_tag and confirm the container comes
    back alive.

    Used in two ways:
      1. Called internally by apply_manifest when an apply fails AFTER the
         compose file has been mutated (so reverting matters).
      2. Exposed for an explicit admin trigger (chunk-2 admin endpoint).

    Returns RollbackResult{ok, reason, restored_tag, detail}. Never raises.
    Records last_apply_outcome in installer state so an admin reviewing
    state files can see what happened.

    Probes for liveness (any 200 from /api/config), not for a specific
    version — because a previous tag like ":stable" resolves dynamically
    and may not equal a known version string.
    """
    cfg = _ha_settings(settings)
    compose_file = Path(cfg["compose_file"])

    try:
        current = read_current_image(compose_file)
    except FileNotFoundError:
        _record_outcome(f"rollback_failed: compose_file_missing")
        return RollbackResult(
            ok=False, reason="compose_file_missing",
            restored_tag=None, detail=str(compose_file),
        )
    except ValueError as e:
        _record_outcome(f"rollback_failed: compose_invalid")
        return RollbackResult(
            ok=False, reason="compose_invalid",
            restored_tag=None, detail=str(e),
        )

    if current["tag"] == target_tag:
        # Compose already reflects the target — no rewrite needed. But the
        # container may still be running the failed tag if it was recreated
        # since last edit, so we always re-run docker compose up -d to
        # converge state.
        log.info("Rollback: compose already at %s; reconverging container", target_tag)
    else:
        try:
            pin_compose_image(compose_file, cfg["image_repo"], target_tag)
        except ValueError as e:
            _record_outcome("rollback_failed: pin_compose_image")
            return RollbackResult(
                ok=False, reason="compose_pin_failed",
                restored_tag=None, detail=str(e),
            )

    recreate = recreate_ha_container(
        compose_file, timeout_s=cfg["apply_timeout_s"], _run_cmd=_run_cmd,
    )
    if not recreate.get("ok"):
        _record_outcome(f"rollback_failed: recreate_{recreate.get('reason')}")
        return RollbackResult(
            ok=False, reason=f"recreate_failed: {recreate.get('reason')}",
            restored_tag=target_tag, detail=recreate.get("detail") or "",
        )

    probe = probe_ha_alive(
        cfg["health_url"],
        ha_token=_ha_token_from_settings(settings),
        attempts=cfg["health_check_attempts"],
        interval_s=cfg["health_check_interval_s"],
        _http_get=_http_get,
        _sleep=_sleep,
    )
    if not probe.get("ok"):
        _record_outcome(f"rollback_failed: probe_{probe.get('reason')}")
        return RollbackResult(
            ok=False, reason=f"probe_failed: {probe.get('reason')}",
            restored_tag=target_tag,
            detail=f"actual_version={probe.get('actual_version')} attempts={probe.get('attempts_made')}",
        )

    _record_outcome(f"rolled_back_to: {target_tag}", clear_previous=True)
    log.warning(
        "HA installer: rolled back to %s (HA reports version=%s)",
        target_tag, probe.get("actual_version"),
    )
    return RollbackResult(
        ok=True, reason="restored",
        restored_tag=target_tag,
        detail=f"probed_in {probe.get('attempts_made')} attempts",
    )


# ---------------------------------------------------------------------------
# Orchestration: apply_manifest
# ---------------------------------------------------------------------------

def _ha_token_from_settings(settings: Optional[dict]) -> str:
    """Bearer token for the health probe. Empty string is acceptable."""
    if not isinstance(settings, dict):
        return ""
    ha = settings.get("home_assistant") or {}
    tok = ha.get("token")
    return tok if isinstance(tok, str) else ""


def _ha_settings(settings: Optional[dict]) -> dict:
    """Read the ha: block with defaults applied. Always returns a dict."""
    block = (settings or {}).get("ha") or {}
    return {
        "compose_file":            block.get("compose_file") or str(_resolve_compose_file(settings)),
        "image_repo":              block.get("image_repo") or DEFAULT_IMAGE_REPO,
        "health_url":              block.get("health_url") or DEFAULT_HEALTH_URL,
        "apply_timeout_s":         int(block.get("apply_timeout_s") or DEFAULT_APPLY_TIMEOUT_S),
        "health_check_attempts":   int(block.get("health_check_attempts") or DEFAULT_HEALTH_ATTEMPTS),
        "health_check_interval_s": float(block.get("health_check_interval_s") or DEFAULT_HEALTH_INTERVAL_S),
    }


def _maybe_rollback(
    *,
    settings: Optional[dict],
    previous_tag: Optional[str],
    rollback_on_failure: bool,
    failure_reason: str,
    failure_detail: str,
    from_version: Optional[str],
    to_version: Optional[str],
    started: float,
    applied_at: str,
    _run_cmd: Optional[Callable],
    _http_get: Optional[Callable],
    _sleep: Optional[Callable],
) -> InstallResult:
    """Shared post-mutation failure path. Either reverts to previous_tag and
    sets rolled_back accordingly, or returns the failure verbatim if
    rollback was disabled by the caller (used by tests + dry-run paths).

    Pulled out so each failure case in apply_manifest is a single call,
    not five copy-pasted result-construction blocks."""
    if not rollback_on_failure or not previous_tag:
        _record_outcome(f"failed_no_rollback: {failure_reason}")
        return InstallResult(
            ok=False, reason=failure_reason,
            from_version=from_version, to_version=to_version,
            duration_s=round(time.monotonic() - started, 2),
            rolled_back=False, detail=failure_detail,
            applied_at=applied_at,
        )
    rb = rollback(
        previous_tag, settings=settings,
        _run_cmd=_run_cmd, _http_get=_http_get, _sleep=_sleep,
    )
    return InstallResult(
        ok=False, reason=failure_reason,
        from_version=from_version, to_version=to_version,
        duration_s=round(time.monotonic() - started, 2),
        rolled_back=bool(rb.get("ok")),
        detail=(
            f"{failure_detail} | rollback: ok={rb.get('ok')} "
            f"reason={rb.get('reason')} detail={rb.get('detail')}"
        ),
        applied_at=applied_at,
    )


def apply_manifest(
    manifest: dict,
    *,
    settings: Optional[dict] = None,
    dry_run: bool = False,
    rollback_on_failure: bool = True,
    _run_cmd: Optional[Callable] = None,
    _http_get: Optional[Callable] = None,
    _sleep: Optional[Callable] = None,
    _mark_installed: Optional[Callable] = None,
) -> InstallResult:
    """Pin HA to manifest['ha_version'] and confirm it came up. On failure
    after the compose file is mutated, revert to the previous tag.

    Returns InstallResult{ok, reason, from_version, to_version,
    duration_s, rolled_back, detail, applied_at}. Never raises.

    Sequence:
      1. Resolve config (compose file, image repo, health url, timings)
      2. Sanity-check the manifest (release_id + ha_version present)
      3. Read current image tag from compose
      4. If already at target version → no-op success
      5. (dry_run: stop here)
      6. Persist previous_image_tag to installer state (BEFORE mutation
         so rollback survives even if Ziggy crashes mid-apply)
      7. Pin compose file to new tag
      8. docker compose up -d homeassistant
      9. Probe HA health for the new version
     10. ota_client.mark_installed(manifest) on success
     11. On any failure between 7 and 9: revert compose to previous tag,
         re-recreate, probe alive — UNLESS rollback_on_failure=False
         (tests use this to inspect the failure state before cleanup).
    """
    started = time.monotonic()
    applied_at = datetime.now(timezone.utc).isoformat()

    if not isinstance(manifest, dict):
        return InstallResult(
            ok=False, reason="invalid_manifest", from_version=None,
            to_version=None, duration_s=0, rolled_back=False,
            detail="manifest is not a dict", applied_at=applied_at,
        )

    target_version = manifest.get("ha_version")
    release_id = manifest.get("release_id")
    if not target_version or release_id is None:
        return InstallResult(
            ok=False, reason="invalid_manifest", from_version=None,
            to_version=target_version, duration_s=0, rolled_back=False,
            detail="manifest missing ha_version or release_id",
            applied_at=applied_at,
        )

    cfg = _ha_settings(settings)
    compose_file = Path(cfg["compose_file"])

    try:
        current = read_current_image(compose_file)
    except FileNotFoundError:
        # Nothing mutated yet — no rollback needed.
        _record_outcome("failed_pre_mutation: compose_file_missing")
        return InstallResult(
            ok=False, reason="compose_file_missing", from_version=None,
            to_version=target_version, duration_s=0, rolled_back=False,
            detail=str(compose_file), applied_at=applied_at,
        )
    except ValueError as e:
        _record_outcome("failed_pre_mutation: compose_invalid")
        return InstallResult(
            ok=False, reason="compose_invalid", from_version=None,
            to_version=target_version, duration_s=0, rolled_back=False,
            detail=str(e), applied_at=applied_at,
        )

    from_version = current["tag"]

    if from_version == target_version:
        _record_outcome("already_at_target")
        return InstallResult(
            ok=True, reason="already_at_target",
            from_version=from_version, to_version=target_version,
            duration_s=round(time.monotonic() - started, 2),
            rolled_back=False, detail="no-op", applied_at=applied_at,
        )

    if dry_run:
        return InstallResult(
            ok=True, reason="dry_run",
            from_version=from_version, to_version=target_version,
            duration_s=round(time.monotonic() - started, 2),
            rolled_back=False, detail="would rewrite compose + recreate",
            applied_at=applied_at,
        )

    # ── Persist previous tag BEFORE any mutation. If Ziggy dies between
    #    here and pin_compose_image, the next boot's rollback path can
    #    still recover. ────────────────────────────────────────────────
    try:
        state = load_installer_state()
        state["previous_image_tag"] = from_version
        state["last_apply_outcome"] = "in_progress"
        state["last_apply_ts"] = applied_at
        save_installer_state(state)
    except OSError as e:
        log.warning("installer state save failed pre-apply: %s", e)
        # Continue anyway — a state-file failure shouldn't block the
        # upgrade path, but rollback won't be available if apply fails.

    # ── Rewrite the compose file ──────────────────────────────────────────
    try:
        pin_compose_image(compose_file, cfg["image_repo"], target_version)
    except ValueError as e:
        # Compose write failed atomically — file is unchanged. No revert
        # needed, but rollback_on_failure=False path is still honored so
        # tests stay consistent.
        return _maybe_rollback(
            settings=settings, previous_tag=from_version,
            rollback_on_failure=False,   # nothing to revert — pin failed atomically
            failure_reason="compose_pin_failed", failure_detail=str(e),
            from_version=from_version, to_version=target_version,
            started=started, applied_at=applied_at,
            _run_cmd=_run_cmd, _http_get=_http_get, _sleep=_sleep,
        )

    # ── Recreate the HA container ─────────────────────────────────────────
    recreate = recreate_ha_container(
        compose_file,
        timeout_s=cfg["apply_timeout_s"],
        _run_cmd=_run_cmd,
    )
    if not recreate.get("ok"):
        return _maybe_rollback(
            settings=settings, previous_tag=from_version,
            rollback_on_failure=rollback_on_failure,
            failure_reason=f"recreate_failed: {recreate.get('reason')}",
            failure_detail=recreate.get("detail") or "",
            from_version=from_version, to_version=target_version,
            started=started, applied_at=applied_at,
            _run_cmd=_run_cmd, _http_get=_http_get, _sleep=_sleep,
        )

    # ── Probe HA until the new version reports ────────────────────────────
    probe = probe_ha_health(
        cfg["health_url"], target_version,
        ha_token=_ha_token_from_settings(settings),
        attempts=cfg["health_check_attempts"],
        interval_s=cfg["health_check_interval_s"],
        _http_get=_http_get,
        _sleep=_sleep,
    )
    if not probe.get("ok"):
        return _maybe_rollback(
            settings=settings, previous_tag=from_version,
            rollback_on_failure=rollback_on_failure,
            failure_reason=f"health_probe_failed: {probe.get('reason')}",
            failure_detail=(
                f"actual_version={probe.get('actual_version')} "
                f"attempts={probe.get('attempts_made')}"
            ),
            from_version=from_version, to_version=target_version,
            started=started, applied_at=applied_at,
            _run_cmd=_run_cmd, _http_get=_http_get, _sleep=_sleep,
        )

    # ── Promote staged → installed in ota_state.json ──────────────────────
    mark_fn = _mark_installed
    if mark_fn is None:
        from services.ota_client import mark_installed as _real_mark
        mark_fn = _real_mark
    try:
        mark_fn(manifest)
    except Exception as e:
        log.error("HA installer: mark_installed raised: %s", e, exc_info=True)

    # Apply succeeded — clear previous_image_tag so a future apply doesn't
    # roll back to an even-older tag.
    _record_outcome(f"installed: {target_version}", clear_previous=True)

    log.info(
        "HA installer: pinned %s → %s (release_id=%s) in %.1fs",
        from_version, target_version, release_id, time.monotonic() - started,
    )
    return InstallResult(
        ok=True, reason="installed",
        from_version=from_version, to_version=target_version,
        duration_s=round(time.monotonic() - started, 2),
        rolled_back=False,
        detail=f"release_id={release_id} probed_in {probe.get('attempts_made')} attempts",
        applied_at=applied_at,
    )
