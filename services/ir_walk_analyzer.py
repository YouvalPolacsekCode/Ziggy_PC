"""
Walk analyzer — ordered, labeled captures -> protocol card.

Automates the reverse-engineering method that cracked the user's Tadiran
on 2026-07-27 (see tests/test_ir_protocol_tadiran_walk.py for the story):

  structure    leader/bit timings, pulse encoding class, bit order, halves
  checksum     found FIRST and its byte excluded from field search — the
               checksum shadows every field (it moves whenever they do)
  temp         monotonic fit over the ladder presses (tolerates RX misses)
  mode/fan     value<->observed-label bijection over the cycle presses
  swing        whole-byte flag aligned with observed on/off
  power        alternating marker never seen in settings frames
               (toggle_marker — the Tadiran discovery: direction is NOT
               encoded; the AC toggles and distinguishes power presses
               from settings presses by settings-equality)

Output card is executable by services/ir_protocol_cards.py in both
directions. rx_validated/tx_validated start False — ONLY the wizard's
user-confirmed hardware validation pass may flip them (the user's rule:
nothing works until the real device obeys).

Input steps: [{"label": str, "raw_b64": str, "observed": dict}]
  labels:   baseline | temp_down | temp_up | mode | fan | swing | power
  observed: baseline {"mode","temp","fan","swing"}; mode {"mode"}; fan
            {"fan"}; swing {"swing": bool}; power {"result"}; ladder ends
            {"temp": N}
"""
from __future__ import annotations

import base64
import hashlib
import statistics
from typing import Any, Optional

from services.ir_protocol import _bits_to_bytes, parse_broadlink_raw

_EXPECTED_FIELDS = ("temp", "mode", "fan", "swing", "power")
_GAP_US = 3000  # same bit/leader boundary the production decoders use


# ---------------------------------------------------------------------------
# Stage 1 — structure
# ---------------------------------------------------------------------------

def _segments(pulses: list[int]) -> list[tuple[Optional[tuple], list[tuple]]]:
    """Split a capture into (leader, bit_pairs) transmission segments."""
    segs, i, n = [], 0, len(pulses)
    while i + 1 < n:
        leader = None
        if pulses[i] > _GAP_US:
            leader = (pulses[i], pulses[i + 1])
            i += 2
        bits = []
        while i + 1 < n:
            m, s = pulses[i], pulses[i + 1]
            if m > _GAP_US:
                break
            i += 2
            if s > _GAP_US:
                break  # trailer pair — the mark is not a data bit
            bits.append((m, s))
        if leader or bits:
            segs.append((leader, bits))
        else:
            i += 2
    return [(l, b) for l, b in segs if l is not None or len(b) >= 16]


def _analyze_structure(raws: list[bytes]) -> Optional[dict]:
    per_capture = []
    for raw in raws:
        segs = [s for s in _segments(parse_broadlink_raw(raw)) if len(s[1]) >= 16]
        if not segs:
            return None
        per_capture.append(segs)

    halves = max(set(len(s) for s in per_capture),
                 key=[len(s) for s in per_capture].count)
    first_segs = [s[0] for s in per_capture]
    all_pairs = [p for _l, bits in first_segs for p in bits]
    marks = [m for m, _s in all_pairs]
    spaces = [s for _m, s in all_pairs]
    mark_cv = statistics.pstdev(marks) / max(1, statistics.mean(marks))
    encoding = "pulse_pair_inversion" if mark_cv > 0.25 else "pulse_distance"

    if encoding == "pulse_pair_inversion":
        def to_bit(m, s):
            return 1 if m > s else 0
    else:
        thr = (min(spaces) + max(spaces)) / 2
        def to_bit(m, s):
            return 1 if s > thr else 0

    bitstreams = [[to_bit(m, s) for m, s in bits] for _l, bits in first_segs]
    nbits = max(set(len(b) for b in bitstreams),
                key=[len(b) for b in bitstreams].count)
    frame_bytes = nbits // 8
    keep = [i for i, b in enumerate(bitstreams) if len(b) == nbits]

    payload_sets = {}
    for lsb in (True, False):
        payloads = [_bits_to_bytes(bitstreams[i][:frame_bytes * 8], lsb_first=lsb)
                    for i in keep]
        const = sum(1 for pos in range(frame_bytes)
                    if len({p[pos] for p in payloads}) == 1)
        payload_sets[lsb] = (const, payloads)
    lsb_first = True if payload_sets[True][0] >= payload_sets[False][0] else False
    payloads = payload_sets[lsb_first][1]

    ones = [(m, s) for (m, s) in all_pairs if to_bit(m, s)]
    zeros = [(m, s) for (m, s) in all_pairs if not to_bit(m, s)]
    med = lambda xs: int(statistics.median(xs)) if xs else 0
    leaders = [l for l, _b in first_segs if l]
    timings = {
        "encoding": encoding,
        "leader": [med([l[0] for l in leaders]), med([l[1] for l in leaders])],
        "bit1": [med([m for m, _ in ones]), med([s for _, s in ones])],
        "bit0": [med([m for m, _ in zeros]), med([s for _, s in zeros])],
        "frame_bytes": frame_bytes,
        "halves": halves,
        "lsb_first": lsb_first,
        "inter_frame": [1700, 33000],
        "trailer": [1700, 100000],
        "repeat_leader": all(len(c) < 2 or c[1][0] is not None for c in per_capture),
    }
    return {"timings": timings, "payloads": payloads, "kept": keep}


# ---------------------------------------------------------------------------
# Stage 2 — checksum (before fields: it shadows every field)
# ---------------------------------------------------------------------------

def _find_checksum(payloads: list[bytes], frame_bytes: int) -> dict:
    def nibble_sum(d): return sum((b >> 4) + (b & 15) for b in d) & 0xFF
    def byte_sum(d): return sum(d) & 0xFF
    def xor(d):
        out = 0
        for b in d:
            out ^= b
        return out
    for target in range(frame_bytes - 1, -1, -1):
        for name, fn in (("nibble_sum", nibble_sum), ("byte_sum", byte_sum),
                         ("xor", xor)):
            if all(fn(p[:target]) == p[target] for p in payloads):
                return {"type": name, "byte": target}
    return {"type": "none"}


# ---------------------------------------------------------------------------
# Field candidates: whole byte + both nibbles of every non-excluded byte
# ---------------------------------------------------------------------------

def _candidates(frame_bytes: int, exclude: set[int], *, narrow_first: bool = False):
    """(byte, mask, shift) candidates. Enum fields want the NARROWEST mask
    that satisfies the bijection (two enums can share a byte — Tadiran packs
    fan|mode in byte 1, and a whole-byte fit would break the moment the
    other nibble moves). Numeric fields want the widest stable fit."""
    shapes = ([(0x0F, 0), (0xF0, 4), (0xFF, 0)] if narrow_first
              else [(0xFF, 0), (0x0F, 0), (0xF0, 4)])
    for byte in range(frame_bytes):
        if byte in exclude:
            continue
        for mask, shift in shapes:
            yield {"byte": byte, "mask": mask, "shift": shift}


def _raw(payload: bytes, c: dict) -> int:
    return (payload[c["byte"]] & c["mask"]) >> c["shift"]


def _fit_temp(steps, payloads_by_idx, frame_bytes, exclude) -> Optional[dict]:
    ladder = [(i, s) for i, s in enumerate(steps)
              if s["label"] in ("temp_down", "temp_up")]
    if len(ladder) < 4:
        return None
    pairs = []  # (prev_idx, cur_idx, direction)
    for i, s in ladder:
        if i - 1 in payloads_by_idx and i in payloads_by_idx:
            pairs.append((i - 1, i, -1 if s["label"] == "temp_down" else 1))
    anchors = [(i, s["observed"]["temp"]) for i, s in enumerate(steps)
               if "temp" in (s.get("observed") or {}) and i in payloads_by_idx]
    if len(pairs) < 4 or not anchors:
        return None

    best = None
    for c in _candidates(frame_bytes, exclude):
        deltas = []
        ok = True
        for a, b, sign in pairs:
            d = _raw(payloads_by_idx[b], c) - _raw(payloads_by_idx[a], c)
            if d == 0 or (d > 0) != (sign > 0):
                ok = False
                break
            deltas.append(abs(d))
        if not ok or not deltas:
            continue
        mul = min(deltas)  # a missed press doubles the delta; min is one press
        if mul == 0 or any(d % mul for d in deltas):
            continue
        offsets = set()
        for idx, temp in anchors:
            raw = _raw(payloads_by_idx[idx], c)
            if raw % mul:
                offsets.add(None)
            else:
                offsets.add(raw // mul - temp)
        if len(offsets) != 1 or None in offsets:
            continue
        offset = offsets.pop()
        temps = [_raw(p, c) // mul - offset for p in payloads_by_idx.values()
                 if _raw(p, c) % mul == 0]
        spec = {"byte": c["byte"], "mask": c["mask"], "shift": c["shift"],
                "codec": {"type": "scale", "mul": mul, "offset": offset},
                "min": min(temps), "max": max(temps)}
        if best is None or c["mask"] == 0xFF:  # prefer the widest stable fit
            best = spec
    return best


def _fit_enum(steps, payloads_by_idx, frame_bytes, exclude, label, obs_key,
              include_baseline=True) -> Optional[dict]:
    obs = []
    for i, s in enumerate(steps):
        if i not in payloads_by_idx:
            continue
        if s["label"] == label and obs_key in (s.get("observed") or {}):
            obs.append((i, s["observed"][obs_key]))
        elif include_baseline and s["label"] == "baseline" \
                and obs_key in (s.get("observed") or {}):
            obs.append((i, s["observed"][obs_key]))
    if len(obs) < 2:
        return None
    for c in _candidates(frame_bytes, exclude, narrow_first=True):
        value_by_label: dict[str, int] = {}
        ok = True
        for idx, lab in obs:
            v = _raw(payloads_by_idx[idx], c)
            if value_by_label.setdefault(lab, v) != v:
                ok = False
                break
        if not ok:
            continue
        vals = list(value_by_label.values())
        if len(set(vals)) != len(vals):
            continue  # not injective — different labels share a value
        return {"byte": c["byte"], "mask": c["mask"], "shift": c["shift"],
                "map": {str(v): lab for lab, v in value_by_label.items()}}
    return None


def _fit_swing(steps, payloads_by_idx, frame_bytes, exclude) -> Optional[dict]:
    on_idx = [i for i, s in enumerate(steps)
              if s["label"] == "swing" and (s.get("observed") or {}).get("swing") is True
              and i in payloads_by_idx]
    off_idx = [i for i, s in enumerate(steps)
               if i in payloads_by_idx and (
                   (s["label"] == "swing" and (s.get("observed") or {}).get("swing") is False)
                   or (s["label"] == "baseline"
                       and (s.get("observed") or {}).get("swing") is False))]
    if not on_idx or not off_idx:
        return None
    for byte in range(frame_bytes):
        if byte in exclude:
            continue
        on_vals = {payloads_by_idx[i][byte] for i in on_idx}
        off_vals = {payloads_by_idx[i][byte] for i in off_idx}
        if len(on_vals) == 1 and len(off_vals) == 1 and on_vals != off_vals:
            return {"byte": byte, "kind": "value_flag",
                    "on": on_vals.pop(), "off": off_vals.pop()}
    return None


def _fit_power(steps, payloads_by_idx, frame_bytes, exclude) -> Optional[dict]:
    power_idx = [i for i, s in enumerate(steps)
                 if s["label"] == "power" and i in payloads_by_idx]
    settings_idx = [i for i, s in enumerate(steps)
                    if s["label"] != "power" and i in payloads_by_idx]
    if len(power_idx) < 2 or not settings_idx:
        return None
    for byte in range(frame_bytes):
        if byte in exclude:
            continue
        rest_vals = {payloads_by_idx[i][byte] for i in settings_idx}
        if len(rest_vals) != 1:
            continue
        rest = rest_vals.pop()
        power_vals = [payloads_by_idx[i][byte] for i in power_idx]
        specials = {v for v in power_vals if v != rest}
        # An alternating marker: exactly one special value, seen on some
        # power presses, absent from every settings frame.
        if len(specials) == 1 and any(v == rest for v in power_vals):
            return {"byte": byte, "kind": "toggle_marker",
                    "marker": specials.pop(), "rest": rest}
        if len(specials) == 1 and all(v != rest for v in power_vals):
            # Every power press carries the special value — closer to a
            # command bit; still emit toggle_marker semantics (safe: the
            # state engine treats marker frames as toggles).
            return {"byte": byte, "kind": "toggle_marker",
                    "marker": specials.pop(), "rest": rest}
    return None


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def analyze_walk_session(steps: list[dict]) -> dict:
    """Ordered labeled captures -> {"card", "report", "unresolved", "confidence"}."""
    report: list[str] = []
    raws = []
    for s in steps:
        try:
            raws.append(base64.b64decode(s["raw_b64"]))
        except Exception:
            raws.append(b"")
    structure = _analyze_structure([r for r in raws if r])
    if structure is None:
        return {"card": None, "report": ["No decodable structure."],
                "unresolved": list(_EXPECTED_FIELDS), "confidence": 0.0}

    timings = structure["timings"]
    frame_bytes = timings["frame_bytes"]
    payloads_by_idx = {structure["kept"][j]: p
                       for j, p in enumerate(structure["payloads"])}
    payloads = list(payloads_by_idx.values())
    report.append(f"structure: {timings['encoding']}, {frame_bytes} bytes, "
                  f"{timings['halves']} halves, "
                  f"{'LSB' if timings['lsb_first'] else 'MSB'}-first")

    checksum = _find_checksum(payloads, frame_bytes)
    exclude: set[int] = set()
    if checksum["type"] != "none":
        exclude.add(checksum["byte"])
        report.append(f"checksum: {checksum['type']} at byte {checksum['byte']}")

    fields: dict[str, Any] = {}
    temp = _fit_temp(steps, payloads_by_idx, frame_bytes, exclude)
    if temp:
        fields["temp"] = temp
    mode = _fit_enum(steps, payloads_by_idx, frame_bytes, exclude, "mode", "mode")
    if mode:
        fields["mode"] = mode
    fan = _fit_enum(steps, payloads_by_idx, frame_bytes, exclude, "fan", "fan")
    if fan:
        fields["fan"] = fan
    swing = _fit_swing(steps, payloads_by_idx, frame_bytes, exclude)
    if swing:
        fields["swing"] = swing
    field_bytes = {f["byte"] for f in fields.values()}
    power = _fit_power(steps, payloads_by_idx, frame_bytes,
                       exclude | field_bytes)
    if power:
        fields["power"] = power

    used = exclude | {f["byte"] for f in fields.values()}
    const_bytes = {str(i): payloads[0][i] for i in range(frame_bytes)
                   if i not in used and payloads[0][i] != 0
                   and len({p[i] for p in payloads}) == 1}

    unresolved = [f for f in _EXPECTED_FIELDS if f not in fields]
    for f in unresolved:
        report.append(f"unresolved: {f}")

    fingerprint = hashlib.sha1(
        f"{timings['encoding']}:{frame_bytes}:{timings['leader']}".encode()
    ).hexdigest()[:8]
    card = {
        "id": f"walk_{fingerprint}",
        "family": f"walk_{fingerprint}",
        "brand": "",
        "rx_validated": False,
        "tx_validated": False,
        "timings": timings,
        "checksum": checksum,
        "const_bytes": const_bytes,
        "fields": fields,
    }
    confidence = 1.0 - len(unresolved) / len(_EXPECTED_FIELDS)
    return {"card": card, "report": report, "unresolved": unresolved,
            "confidence": confidence}
