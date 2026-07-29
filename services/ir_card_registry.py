"""
Protocol card registry — local-first store of walk-cracked cards, with
best-effort relay sync so coverage compounds across the Ziggy fleet.

Local: user_files/protocol_cards.json, merged with the built-in CARDS
(built-ins win on id collision). Cards are immutable versions — a re-walk
that produces different fields registers a _v2 rather than mutating.

Fleet sync (best-effort, never blocks a home feature):
  push: POST {relay}/api/protocol-cards        {"cards": [...]}
  pull: GET  {relay}/api/protocol-cards?fingerprint=<fp>
The relay endpoint may not exist yet — every network failure degrades to
local-only with one log line. Cards carry no home identifiers.
"""
from __future__ import annotations

import json
import os
from typing import Optional

from core.logger_module import log_error, log_info

CARDS_FILE = "user_files/protocol_cards.json"


def _load_user_cards() -> dict[str, dict]:
    if not os.path.exists(CARDS_FILE):
        return {}
    try:
        with open(CARDS_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("cards", {})
    except Exception as e:
        log_error(f"[CardRegistry] load failed: {e}")
        return {}


def _save_user_cards(cards: dict[str, dict]) -> None:
    os.makedirs(os.path.dirname(CARDS_FILE), exist_ok=True)
    with open(CARDS_FILE, "w", encoding="utf-8") as f:
        json.dump({"cards": cards}, f, indent=1, ensure_ascii=False)


def all_cards() -> dict[str, dict]:
    """Built-ins + user cards. Built-ins win on id collision."""
    from services.ir_protocol_cards import CARDS as builtin
    merged = dict(_load_user_cards())
    merged.update(builtin)
    return merged


def get_card(card_id: str) -> Optional[dict]:
    return all_cards().get(card_id)


def register_card(card: dict) -> str:
    """Store a card; immutable versions. Same id + same content -> reuse;
    same id + different content -> version-suffixed new id."""
    user = _load_user_cards()
    base_id = card["id"]
    existing = user.get(base_id)
    if existing is not None:
        stripped = {k: v for k, v in existing.items()
                    if k not in ("rx_validated", "tx_validated")}
        incoming = {k: v for k, v in card.items()
                    if k not in ("rx_validated", "tx_validated")}
        if stripped == incoming:
            return base_id
        n = 2
        while f"{base_id}_v{n}" in user:
            n += 1
        card = dict(card)
        card["id"] = card["family"] = f"{base_id}_v{n}"
    user[card["id"]] = card
    _save_user_cards(user)
    log_info(f"[CardRegistry] registered {card['id']}")
    return card["id"]


def mark_validated(card_id: str, *, rx: Optional[bool] = None,
                   tx: Optional[bool] = None) -> bool:
    """Flip validation flags. ONLY call with user-confirmed real-hardware
    evidence (the real-life validation gate is absolute)."""
    user = _load_user_cards()
    card = user.get(card_id)
    if not card:
        return False
    if rx is not None:
        card["rx_validated"] = bool(rx)
    if tx is not None:
        card["tx_validated"] = bool(tx)
    _save_user_cards(user)
    log_info(f"[CardRegistry] {card_id} validated rx={card.get('rx_validated')} "
             f"tx={card.get('tx_validated')}")
    return True


def tx_card_by_id(card_id: str, *, allow_trial: bool = False) -> Optional[dict]:
    card = get_card(card_id)
    if not card:
        return None
    if card.get("tx_validated") or allow_trial:
        return card
    return None


def find_tx_card_for_family(family: str) -> Optional[dict]:
    for card in all_cards().values():
        if card["family"] == family and card.get("tx_validated"):
            return card
    return None


# ---------------------------------------------------------------------------
# RX decode with user cards — lets the listener understand walk-cracked
# protocols that have no hand-written decoder.
# ---------------------------------------------------------------------------

def try_decode_with_user_cards(pulses: list[int]) -> Optional[tuple[dict, bytes, dict]]:
    """Try every rx_validated user card against a capture.

    Returns (card, payload, values) or None. Built-in families are handled
    by the hand decoders — only user cards are tried here.
    """
    from services.ir_protocol import _bits_to_bytes
    from services.ir_protocol_cards import decode_payload
    from services.ir_walk_analyzer import _segments

    user = _load_user_cards()
    candidates = [c for c in user.values() if c.get("rx_validated")]
    if not candidates:
        return None
    segs = [s for s in _segments(pulses) if len(s[1]) >= 16]
    if not segs:
        return None
    leader, bit_pairs = segs[0]
    if leader is None:
        return None
    for card in candidates:
        t = card["timings"]
        cl_mark, cl_space = t["leader"]
        if not (abs(leader[0] - cl_mark) < cl_mark * 0.25
                and abs(leader[1] - cl_space) < cl_space * 0.25):
            continue
        if t["encoding"] == "pulse_pair_inversion":
            bits = [1 if m > s else 0 for m, s in bit_pairs]
        else:
            thr = (t["bit0"][1] + t["bit1"][1]) / 2
            bits = [1 if s > thr else 0 for _m, s in bit_pairs]
        nbytes = t["frame_bytes"]
        if len(bits) < nbytes * 8:
            continue
        payload = _bits_to_bytes(bits[:nbytes * 8], lsb_first=t.get("lsb_first", True))
        values = decode_payload(card, payload)
        if values is not None:
            return card, payload, values
    return None


# ---------------------------------------------------------------------------
# Fleet sync — best-effort
# ---------------------------------------------------------------------------

def _relay_base() -> Optional[str]:
    try:
        from core.settings_loader import load_settings
        relay = (load_settings().get("relay") or {}).get("url")
        return relay.rstrip("/") if relay else None
    except Exception:
        return None


def push_cards_to_relay() -> bool:
    base = _relay_base()
    if not base:
        return False
    cards = [c for c in _load_user_cards().values() if c.get("rx_validated")]
    if not cards:
        return True
    try:
        import httpx
        r = httpx.post(f"{base}/api/protocol-cards",
                       json={"cards": cards}, timeout=10)
        ok = r.status_code < 300
        log_info(f"[CardRegistry] relay push: {r.status_code}")
        return ok
    except Exception as e:
        log_info(f"[CardRegistry] relay push skipped ({e.__class__.__name__})")
        return False


def fetch_cards_from_relay(fingerprint: Optional[str] = None) -> int:
    base = _relay_base()
    if not base:
        return 0
    try:
        import httpx
        params = {"fingerprint": fingerprint} if fingerprint else {}
        r = httpx.get(f"{base}/api/protocol-cards", params=params, timeout=10)
        if r.status_code >= 300:
            return 0
        added = 0
        user = _load_user_cards()
        for card in (r.json() or {}).get("cards", []):
            if card.get("id") and card["id"] not in user:
                user[card["id"]] = card
                added += 1
        if added:
            _save_user_cards(user)
            log_info(f"[CardRegistry] pulled {added} card(s) from relay")
        return added
    except Exception as e:
        log_info(f"[CardRegistry] relay pull skipped ({e.__class__.__name__})")
        return 0
