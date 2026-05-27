"""HA installer — applies a staged OTA manifest to the local Home Assistant
container (Prompt 4 chunk 1.C).

Reads the target version from the manifest staged by services/ota_client.py,
rewrites the homeassistant service's image tag in the host compose file, runs
`docker compose up -d homeassistant`, and probes HA's REST API until the
expected version is reported. On success calls ota_client.mark_installed()
to clear the stage.

This module does NOT:

  - Roll back on failure. apply_manifest returns a result dict with
    rolled_back=False; the rollback orchestrator (chunk 1.D) wraps this
    module's apply path with the revert sequence.
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
                 dry_run=False)              orchestrates the four above

Test seams (every external dependency is injectable via kwargs):

  _run_cmd       subprocess.run wrapper — fakeable
  _http_get      requests.get wrapper   — fakeable
  _sleep         time.sleep             — fakeable for fast tests

All blocking calls catch their own failures and return result dicts.
apply_manifest never raises into the scheduler — same contract as
ota_client.poll_once and telemetry_client.post_once.
"""

from __future__ import annotations

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


def apply_manifest(
    manifest: dict,
    *,
    settings: Optional[dict] = None,
    dry_run: bool = False,
    _run_cmd: Optional[Callable] = None,
    _http_get: Optional[Callable] = None,
    _sleep: Optional[Callable] = None,
    _mark_installed: Optional[Callable] = None,
) -> InstallResult:
    """Pin HA to manifest['ha_version'] and confirm it came up.

    Returns InstallResult{ok, reason, from_version, to_version,
    duration_s, rolled_back, detail, applied_at}. Never raises.

    Sequence:
      1. Resolve config (compose file, image repo, health url, timings)
      2. Sanity-check the manifest (release_id + ha_version present)
      3. Read current image tag from compose
      4. If already at target version → no-op success
      5. (dry_run: stop here)
      6. Pin compose file to new tag
      7. docker compose up -d homeassistant
      8. Probe HA health for the new version
      9. ota_client.mark_installed(manifest) on success

    Rollback is NOT performed here. See chunk 1.D for the rollback
    orchestrator that wraps this with a revert path on health-probe
    failure. rolled_back is always False from this module.
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
        return InstallResult(
            ok=False, reason="compose_file_missing", from_version=None,
            to_version=target_version, duration_s=0, rolled_back=False,
            detail=str(compose_file), applied_at=applied_at,
        )
    except ValueError as e:
        return InstallResult(
            ok=False, reason="compose_invalid", from_version=None,
            to_version=target_version, duration_s=0, rolled_back=False,
            detail=str(e), applied_at=applied_at,
        )

    from_version = current["tag"]

    if from_version == target_version:
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

    # ── Rewrite the compose file ──────────────────────────────────────────
    try:
        pin_compose_image(compose_file, cfg["image_repo"], target_version)
    except ValueError as e:
        return InstallResult(
            ok=False, reason="compose_pin_failed",
            from_version=from_version, to_version=target_version,
            duration_s=round(time.monotonic() - started, 2),
            rolled_back=False, detail=str(e), applied_at=applied_at,
        )

    # ── Recreate the HA container ─────────────────────────────────────────
    recreate = recreate_ha_container(
        compose_file,
        timeout_s=cfg["apply_timeout_s"],
        _run_cmd=_run_cmd,
    )
    if not recreate.get("ok"):
        return InstallResult(
            ok=False, reason=f"recreate_failed: {recreate.get('reason')}",
            from_version=from_version, to_version=target_version,
            duration_s=round(time.monotonic() - started, 2),
            rolled_back=False, detail=recreate.get("detail") or "",
            applied_at=applied_at,
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
        return InstallResult(
            ok=False, reason=f"health_probe_failed: {probe.get('reason')}",
            from_version=from_version, to_version=target_version,
            duration_s=round(time.monotonic() - started, 2),
            rolled_back=False,
            detail=f"actual_version={probe.get('actual_version')} attempts={probe.get('attempts_made')}",
            applied_at=applied_at,
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
