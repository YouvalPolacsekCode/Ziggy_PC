"""Consent capture, persistence, and gating for privacy-sensitive features.

Implements the runtime side of docs/IN_APP_LEGAL_SURFACES.md (which was
design-only). Three consent surfaces are enforced here:

  - ``voice_transcript``      §4  keep the TEXT of voice commands on the hub
  - ``support_tunnel``        §5  founder support SSH tunnel into the hub
  - ``background_location``    §6  mobile background location for presence

Design contracts honored:

- **Default-deny.** A feature with no recorded consent is treated as NOT
  granted. A fresh hub grants nothing until the owner explicitly opts in.
- **Persisted.** State lives in ``user_files/consent.json`` (git-ignored,
  same directory as the rest of the hub's runtime state). Atomic writes.
- **Auditable.** Every change stamps ``updated_at`` (ISO-8601 UTC) and the
  ``source`` (app|web|email|system) plus the acting ``actor``. The last
  change and a bounded history tail are retained so the data-export flow
  (§2) and the consent-history right-of-access (§7) can read them.
- **Enforcement primitive.** ``require(feature)`` raises ``ConsentRequired``
  when a feature is used without consent. Callers (the support-tunnel
  approval path, the voice-transcript store) gate on it. Because the gate
  is one function, there is exactly one place that decides "allowed?".

This module speaks to nothing on the network. The relay audit-log POST
described in the design doc is layered on top by the router / caller; here
we only keep the authoritative local record.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import threading
from pathlib import Path
from typing import Optional

from core.logger_module import log_error, log_info

# ---------------------------------------------------------------------------
# Feature registry
# ---------------------------------------------------------------------------

# The canonical set of consent-gated features. Keys are stable wire
# identifiers used by the router path, the persisted file, and the audit
# events — do NOT rename without a migration.
VOICE_TRANSCRIPT = "voice_transcript"
SUPPORT_TUNNEL = "support_tunnel"
BACKGROUND_LOCATION = "background_location"

FEATURES: tuple[str, ...] = (
    VOICE_TRANSCRIPT,
    SUPPORT_TUNNEL,
    BACKGROUND_LOCATION,
)

# Human-facing metadata mirrored from the design doc so a client can render
# the consent surfaces without hardcoding copy in two places.
FEATURE_META: dict[str, dict] = {
    VOICE_TRANSCRIPT: {
        "title_en": "Keep a history of your voice commands?",
        "title_he": "לשמור היסטוריה של פקודות הקול?",
        "default": False,
        "doc": "IN_APP_LEGAL_SURFACES.md#4",
    },
    SUPPORT_TUNNEL: {
        "title_en": "Allow support to connect?",
        "title_he": "לאשר חיבור תמיכה?",
        "default": False,
        "doc": "IN_APP_LEGAL_SURFACES.md#5",
    },
    BACKGROUND_LOCATION: {
        "title_en": "Use your phone for home/away detection?",
        "title_he": "להשתמש בטלפון לזיהוי בית/חוץ?",
        "default": False,
        "doc": "IN_APP_LEGAL_SURFACES.md#6",
    },
}

# How many historical change records to retain per feature. Bounded so a
# noisy toggler can't grow the file without limit; the export flow reads
# this tail, the full history is reconstructable from the relay audit log.
_HISTORY_TAIL = 50


class ConsentRequired(PermissionError):
    """Raised by :func:`require` when a feature is used without consent.

    Subclasses ``PermissionError`` so callers that already catch permission
    errors degrade safely, while dedicated handlers can map it to HTTP 403.
    """

    def __init__(self, feature: str, message: Optional[str] = None):
        self.feature = feature
        super().__init__(
            message or f"consent required for '{feature}' (default-deny; not granted)"
        )


class UnknownFeature(KeyError):
    """Raised when a feature id is not in :data:`FEATURES`."""


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_STORE = _REPO_ROOT / "user_files" / "consent.json"

# Overridable for tests via set_store_path(). A module-level lock guards the
# read-modify-write so two concurrent grants can't clobber each other.
_store_path: Path = _DEFAULT_STORE
_lock = threading.RLock()


def set_store_path(path: str | os.PathLike) -> None:
    """Point persistence at a different file (tests use a tmp path)."""
    global _store_path
    with _lock:
        _store_path = Path(path)


def get_store_path() -> Path:
    return _store_path


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def _normalize(feature: str) -> str:
    f = (feature or "").strip().lower().replace("-", "_")
    if f not in FEATURES:
        raise UnknownFeature(feature)
    return f


def _load_all() -> dict:
    p = _store_path
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as e:  # corrupt file must not break the hub
        log_error(f"[consent] store unreadable at {p}: {e}")
        return {}


def _save_all(data: dict) -> None:
    p = _store_path
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        # Consent state is privacy-relevant; keep it owner-readable only.
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        tmp.replace(p)
    except Exception as e:
        log_error(f"[consent] store write failed at {p}: {e}")
        raise


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get(feature: str) -> bool:
    """Return True iff `feature` is currently granted. Default-deny."""
    f = _normalize(feature)
    with _lock:
        rec = _load_all().get(f)
    if not isinstance(rec, dict):
        return False
    return bool(rec.get("granted", False))


def get_record(feature: str) -> dict:
    """Return the full stored record for `feature` (granted, updated_at,
    source, actor, history). Synthesizes a default-deny record if absent."""
    f = _normalize(feature)
    with _lock:
        rec = _load_all().get(f)
    if not isinstance(rec, dict):
        return {
            "feature": f,
            "granted": False,
            "updated_at": None,
            "source": None,
            "actor": None,
            "history": [],
            "default": FEATURE_META[f]["default"],
        }
    rec = dict(rec)
    rec.setdefault("feature", f)
    rec.setdefault("history", [])
    rec["default"] = FEATURE_META[f]["default"]
    return rec


def get_all() -> dict[str, dict]:
    """Return the record for every known feature (default-deny for unset)."""
    return {f: get_record(f) for f in FEATURES}


def set(
    feature: str,
    granted: bool,
    *,
    source: str = "system",
    actor: Optional[str] = None,
    note: Optional[str] = None,
) -> dict:
    """Record a consent decision. Returns the new record.

    `source` is one of app|web|email|system per the audit shape in the
    design doc §7. `actor` is the acting account (email/username) when known.
    A history entry is appended (bounded to the last ``_HISTORY_TAIL``).
    """
    f = _normalize(feature)
    granted = bool(granted)
    ts = _now_iso()
    with _lock:
        data = _load_all()
        prev = data.get(f) if isinstance(data.get(f), dict) else {}
        previous_value = bool(prev.get("granted", False))
        history = list(prev.get("history", []))
        history.append(
            {
                "granted": granted,
                "previous": previous_value,
                "source": source,
                "actor": actor,
                "note": note,
                "ts": ts,
            }
        )
        history = history[-_HISTORY_TAIL:]
        rec = {
            "feature": f,
            "granted": granted,
            "previous_value": previous_value,
            "updated_at": ts,
            "source": source,
            "actor": actor,
            "note": note,
            "history": history,
        }
        data[f] = rec
        _save_all(data)
    log_info(
        f"[consent] {f} set granted={granted} (was {previous_value}) "
        f"source={source} actor={actor or '-'}"
    )
    out = dict(rec)
    out["default"] = FEATURE_META[f]["default"]
    return out


def require(feature: str) -> None:
    """Raise :class:`ConsentRequired` unless `feature` is granted.

    The single enforcement point. Callers that must not run without consent
    (support-tunnel enable, voice-transcript persistence) call this first.
    """
    if not get(feature):
        raise ConsentRequired(feature)


def is_allowed(feature: str) -> bool:
    """Non-raising variant of :func:`require` — True iff granted."""
    return get(feature)


# Convenience wrappers so call sites read intently and can't typo a feature id.

def is_voice_transcript_storage_allowed() -> bool:
    return get(VOICE_TRANSCRIPT)


def is_support_tunnel_allowed() -> bool:
    return get(SUPPORT_TUNNEL)


def is_background_location_allowed() -> bool:
    return get(BACKGROUND_LOCATION)
