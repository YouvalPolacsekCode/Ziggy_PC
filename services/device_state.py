"""
Universal device-state engine — templates for any IR-controllable device.

The legacy code had AC-specific scaffolding (`ac_memory`, `apply_decoded_ac_state`,
mode/temp/fan reasoning hard-coded across the manager). This module generalizes
that pattern so adding a TV, streamer, soundbar, set-top box, or anything else
the user points at the room is a matter of editing a template, not writing
device-class-specific code paths.

Concepts
--------

**Template**
  Describes one device class. Defines:
    - state schema (which fields exist, what types, what ranges)
    - default state (the "optimistic guess" at cold start)
    - button → state mutations (vol_up adds 2 to volume, mute toggles muted)
    - standard buttons (the canonical names the wizard offers to learn)

**State**
  A plain dict that lives on the device record under `device["state"]`.
  Updated by:
    - User-initiated commands  → mutations applied per button
    - Decoded physical presses → mutations applied per button (same path)
    - Decoded full-state packets (stateful AC) → state-replace

**Confidence**
  Every state has a confidence band: "live" (RX-confirmed in last 30s),
  "estimated" (last Ziggy command or decoded press older than the window),
  "stale" (no observation for hours). The UI surfaces this distinction so
  the user knows when Ziggy is sure vs guessing.

Compatibility
-------------

The engine is additive. Existing AC code paths continue to work — they read
`device["ac_memory"]` and `device["assumed_state"]`. The new pipeline writes
both the new `state` field AND the legacy fields, so nothing breaks until
the legacy fields are deprecated.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Optional


# Confidence window thresholds (seconds). Tunable; chosen to match the
# user-facing "the AC card updated right when I pressed the remote" demo
# moment — 30s feels live, 6h feels stale, in between is estimated.
LIVE_WINDOW_S = 30
STALE_WINDOW_S = 6 * 3600


# ---------------------------------------------------------------------------
# Schema primitives
# ---------------------------------------------------------------------------

@dataclass
class StateField:
    """One field in a device's state schema.

    `kind` choices: "bool", "int", "enum", "str".
    `values` is required for "enum", optional for "str" (allowed set).
    `min`/`max` apply to "int".
    """
    name: str
    kind: str
    default: Any
    values: Optional[list] = None
    min: Optional[int] = None
    max: Optional[int] = None

    def clamp(self, value: Any) -> Any:
        """Clamp / coerce a value to the field's domain."""
        if value is None:
            return self.default
        if self.kind == "int":
            try:
                v = int(value)
            except (TypeError, ValueError):
                return self.default
            if self.min is not None:
                v = max(self.min, v)
            if self.max is not None:
                v = min(self.max, v)
            return v
        if self.kind == "bool":
            return bool(value)
        if self.kind == "enum":
            if self.values and value in self.values:
                return value
            return self.default
        if self.kind == "str":
            s = str(value)
            if self.values and s not in self.values:
                return self.default
            return s
        return value


@dataclass
class Mutation:
    """A single field mutation triggered by a button press.

    Mutations compose — one button can carry multiple (e.g. mode_cool sets
    mode=cool AND power=on for AC remotes that turn the unit on as a side
    effect of selecting a mode).

    `op` choices:
      "set":    field <- value
      "toggle": field <- !field   (bool only)
      "incr":   field <- field + step (clamped)
      "decr":   field <- field - step (clamped)
      "cycle":  field <- next in values list

    Mutations on missing fields are no-ops; this keeps templates loose
    enough to share button vocabulary across device classes that have
    slightly different schemas.
    """
    field: str
    op: str
    value: Any = None
    step: int = 1


@dataclass
class DeviceTemplate:
    """Schema + behavior for one class of IR-controllable device."""
    id: str                                       # "ac" | "tv" | "streamer" | ...
    label: str                                    # human-readable
    schema: dict[str, StateField]                 # state fields keyed by name
    default_state: dict[str, Any]                 # cold-start guess
    button_mutations: dict[str, list[Mutation]]   # logical_command -> mutations
    standard_buttons: list[str] = field(default_factory=list)  # wizard suggestion

    def make_initial_state(self) -> dict[str, Any]:
        """Fresh state dict for a newly-created device of this class."""
        state: dict[str, Any] = {}
        for fname, fdef in self.schema.items():
            state[fname] = self.default_state.get(fname, fdef.default)
        return state


# ---------------------------------------------------------------------------
# Built-in templates
# ---------------------------------------------------------------------------

def _ac_template() -> DeviceTemplate:
    schema = {
        "power": StateField("power", "bool", False),
        "mode":  StateField("mode", "enum", "cool",
                            values=["cool", "heat", "fan", "auto", "dry"]),
        "temp":  StateField("temp", "int", 24, min=16, max=30),
        "fan":   StateField("fan", "enum", "auto",
                            values=["low", "medium", "high", "auto"]),
        "swing": StateField("swing", "bool", False),
    }
    default_state = {
        "power": False,
        "mode": "cool",          # Israel-first: cool is the dominant mode
        "temp": 24,              # Israeli AC industry standard default
        "fan": "auto",
        "swing": False,
    }
    button_mutations = {
        "power_on":   [Mutation("power", "set", value=True)],
        "power_off":  [Mutation("power", "set", value=False)],
        "power":      [Mutation("power", "toggle")],
        "temp_up":    [Mutation("temp", "incr", step=1)],
        "temp_down":  [Mutation("temp", "decr", step=1)],
        "mode_cool":  [Mutation("mode", "set", value="cool"),
                       Mutation("power", "set", value=True)],
        "mode_heat":  [Mutation("mode", "set", value="heat"),
                       Mutation("power", "set", value=True)],
        "mode_fan":   [Mutation("mode", "set", value="fan"),
                       Mutation("power", "set", value=True)],
        "mode_auto":  [Mutation("mode", "set", value="auto"),
                       Mutation("power", "set", value=True)],
        "mode_dry":   [Mutation("mode", "set", value="dry"),
                       Mutation("power", "set", value=True)],
        "fan_low":    [Mutation("fan", "set", value="low")],
        "fan_medium": [Mutation("fan", "set", value="medium")],
        "fan_high":   [Mutation("fan", "set", value="high")],
        "fan_auto":   [Mutation("fan", "set", value="auto")],
        # Single-button fan cycle on many remotes: advances through the
        # values list (low → medium → high → auto → low). Mirrors the
        # legacy fan_cycle = ["auto","low","medium","high"] sequence, since
        # cycling from "auto" wraps to "low" (first in the schema's values).
        "fan_cycle":  [Mutation("fan", "cycle")],
        "swing":      [Mutation("swing", "toggle")],
    }
    # Discrete temperature buttons — Tadiran-style remotes can have these.
    for t in range(16, 31):
        button_mutations[f"temp_{t}"] = [Mutation("temp", "set", value=t)]
    standard_buttons = ["power_on", "power_off", "mode_cool",
                        "fan_auto", "temp_up", "temp_down"]
    return DeviceTemplate(
        id="ac", label="Air Conditioner",
        schema=schema, default_state=default_state,
        button_mutations=button_mutations, standard_buttons=standard_buttons,
    )


def _tv_template() -> DeviceTemplate:
    schema = {
        "power":   StateField("power", "bool", False),
        "input":   StateField("input", "str", "hdmi1"),
        "volume":  StateField("volume", "int", 30, min=0, max=100),
        "muted":   StateField("muted", "bool", False),
        "channel": StateField("channel", "int", 1, min=1, max=999),
    }
    default_state = {
        "power": False,
        "input": "hdmi1",
        "volume": 30,
        "muted": False,
        "channel": 1,
    }
    button_mutations = {
        "power":     [Mutation("power", "toggle")],
        "power_on":  [Mutation("power", "set", value=True)],
        "power_off": [Mutation("power", "set", value=False)],
        # Volume changes implicitly unmute on real TVs — mirror that.
        "vol_up":    [Mutation("volume", "incr", step=2),
                      Mutation("muted", "set", value=False)],
        "vol_down":  [Mutation("volume", "decr", step=2),
                      Mutation("muted", "set", value=False)],
        "mute":      [Mutation("muted", "toggle")],
        "ch_up":     [Mutation("channel", "incr", step=1)],
        "ch_down":   [Mutation("channel", "decr", step=1)],
    }
    standard_buttons = ["power", "vol_up", "vol_down", "mute",
                        "ch_up", "ch_down", "input", "ok", "back", "home"]
    return DeviceTemplate(
        id="tv", label="TV",
        schema=schema, default_state=default_state,
        button_mutations=button_mutations, standard_buttons=standard_buttons,
    )


def _streamer_template() -> DeviceTemplate:
    """Apple TV / Roku / generic streamer."""
    schema = {
        "power":   StateField("power", "bool", False),
        "playing": StateField("playing", "bool", False),
        "app":     StateField("app", "str", "home"),
    }
    default_state = {"power": False, "playing": False, "app": "home"}
    button_mutations = {
        "power":      [Mutation("power", "toggle")],
        "power_on":   [Mutation("power", "set", value=True)],
        "power_off":  [Mutation("power", "set", value=False)],
        "play_pause": [Mutation("playing", "toggle")],
        "play":       [Mutation("playing", "set", value=True)],
        "pause":      [Mutation("playing", "set", value=False)],
        "home":       [Mutation("app", "set", value="home"),
                       Mutation("playing", "set", value=False)],
    }
    standard_buttons = ["power", "home", "play_pause", "back", "ok",
                        "up", "down", "left", "right", "menu"]
    return DeviceTemplate(
        id="streamer", label="Streamer",
        schema=schema, default_state=default_state,
        button_mutations=button_mutations, standard_buttons=standard_buttons,
    )


def _soundbar_template() -> DeviceTemplate:
    schema = {
        "power":  StateField("power", "bool", False),
        "volume": StateField("volume", "int", 30, min=0, max=100),
        "muted":  StateField("muted", "bool", False),
        "input":  StateField("input", "str", "hdmi"),
    }
    default_state = {"power": False, "volume": 30, "muted": False, "input": "hdmi"}
    button_mutations = {
        "power":     [Mutation("power", "toggle")],
        "power_on":  [Mutation("power", "set", value=True)],
        "power_off": [Mutation("power", "set", value=False)],
        "vol_up":    [Mutation("volume", "incr", step=2),
                      Mutation("muted", "set", value=False)],
        "vol_down":  [Mutation("volume", "decr", step=2),
                      Mutation("muted", "set", value=False)],
        "mute":      [Mutation("muted", "toggle")],
    }
    standard_buttons = ["power", "vol_up", "vol_down", "mute", "input"]
    return DeviceTemplate(
        id="soundbar", label="Soundbar",
        schema=schema, default_state=default_state,
        button_mutations=button_mutations, standard_buttons=standard_buttons,
    )


def _stb_template() -> DeviceTemplate:
    """Israeli set-top boxes: Yes (DBS), HOT, Cellcom TV."""
    schema = {
        "power":   StateField("power", "bool", False),
        "channel": StateField("channel", "int", 1, min=1, max=999),
    }
    default_state = {"power": False, "channel": 1}
    button_mutations = {
        "power":     [Mutation("power", "toggle")],
        "power_on":  [Mutation("power", "set", value=True)],
        "power_off": [Mutation("power", "set", value=False)],
        "ch_up":     [Mutation("channel", "incr", step=1)],
        "ch_down":   [Mutation("channel", "decr", step=1)],
    }
    standard_buttons = ["power", "ch_up", "ch_down",
                        "num_0", "num_1", "num_2", "num_3", "num_4",
                        "num_5", "num_6", "num_7", "num_8", "num_9",
                        "ok", "guide", "info", "back"]
    return DeviceTemplate(
        id="stb", label="Set-top Box",
        schema=schema, default_state=default_state,
        button_mutations=button_mutations, standard_buttons=standard_buttons,
    )


def _fan_template() -> DeviceTemplate:
    """Standalone IR fan — also covers heaters / dehumidifiers with a speed knob."""
    schema = {
        "power": StateField("power", "bool", False),
        "speed": StateField("speed", "enum", "low",
                            values=["low", "medium", "high", "auto"]),
        "swing": StateField("swing", "bool", False),
    }
    default_state = {"power": False, "speed": "low", "swing": False}
    button_mutations = {
        "power":     [Mutation("power", "toggle")],
        "power_on":  [Mutation("power", "set", value=True)],
        "power_off": [Mutation("power", "set", value=False)],
        "speed_low":    [Mutation("speed", "set", value="low")],
        "speed_medium": [Mutation("speed", "set", value="medium")],
        "speed_high":   [Mutation("speed", "set", value="high")],
        "speed_auto":   [Mutation("speed", "set", value="auto")],
        "swing":     [Mutation("swing", "toggle")],
    }
    standard_buttons = ["power", "speed_low", "speed_medium", "speed_high", "swing"]
    return DeviceTemplate(
        id="fan", label="Fan / Heater",
        schema=schema, default_state=default_state,
        button_mutations=button_mutations, standard_buttons=standard_buttons,
    )


def _custom_template() -> DeviceTemplate:
    """Catch-all for 'point at the room and learn' — no fixed schema beyond power."""
    schema = {"power": StateField("power", "bool", False)}
    default_state = {"power": False}
    button_mutations = {
        "power":     [Mutation("power", "toggle")],
        "power_on":  [Mutation("power", "set", value=True)],
        "power_off": [Mutation("power", "set", value=False)],
    }
    return DeviceTemplate(
        id="custom", label="Custom IR Device",
        schema=schema, default_state=default_state,
        button_mutations=button_mutations, standard_buttons=["power"],
    )


_BUILTIN_TEMPLATES: dict[str, DeviceTemplate] = {
    t.id: t for t in [
        _ac_template(),
        _tv_template(),
        _streamer_template(),
        _soundbar_template(),
        _stb_template(),
        _fan_template(),
        _custom_template(),
    ]
}


def get_template(template_id: str) -> Optional[DeviceTemplate]:
    """Look up a template by id. Returns None for unknown ids."""
    if not template_id:
        return None
    return _BUILTIN_TEMPLATES.get(template_id.lower())


def list_templates() -> list[dict]:
    """UI-friendly list of all known templates."""
    return [
        {"id": t.id, "label": t.label,
         "standard_buttons": list(t.standard_buttons),
         "fields": [f.name for f in t.schema.values()]}
        for t in _BUILTIN_TEMPLATES.values()
    ]


# ---------------------------------------------------------------------------
# Mutation engine
# ---------------------------------------------------------------------------

def _apply_one(state: dict, schema: dict[str, StateField], mut: Mutation) -> None:
    """In-place state mutation. No-op on unknown fields (forgiving)."""
    fdef = schema.get(mut.field)
    if fdef is None:
        return
    cur = state.get(mut.field, fdef.default)

    if mut.op == "set":
        state[mut.field] = fdef.clamp(mut.value)

    elif mut.op == "toggle":
        if fdef.kind == "bool":
            state[mut.field] = not bool(cur)

    elif mut.op == "incr":
        if fdef.kind == "int":
            try:
                state[mut.field] = fdef.clamp(int(cur) + int(mut.step))
            except (TypeError, ValueError):
                state[mut.field] = fdef.clamp(fdef.default)

    elif mut.op == "decr":
        if fdef.kind == "int":
            try:
                state[mut.field] = fdef.clamp(int(cur) - int(mut.step))
            except (TypeError, ValueError):
                state[mut.field] = fdef.clamp(fdef.default)

    elif mut.op == "cycle":
        if fdef.kind == "enum" and fdef.values:
            try:
                idx = fdef.values.index(cur)
            except ValueError:
                idx = -1
            state[mut.field] = fdef.values[(idx + 1) % len(fdef.values)]


def apply_button_press(state: dict, template: DeviceTemplate, command: str) -> dict:
    """Apply a learned-button press to a state dict. Returns mutated copy.

    The same logical command maps to the same mutations whether the press was
    initiated by Ziggy (sent a command) or detected via the listener
    (physical-remote press matched against a learned code). One pipeline.
    """
    new_state = dict(state)
    muts = template.button_mutations.get(command, [])
    for m in muts:
        _apply_one(new_state, template.schema, m)
    return new_state


def apply_decoded_full_state(state: dict, template: DeviceTemplate,
                              decoded: dict) -> dict:
    """Apply a fully-decoded payload (e.g. AC stateful protocol) — replace.

    Only fields present in the template's schema are accepted; unknown fields
    in `decoded` are ignored. Missing fields fall back to existing state value.
    """
    new_state = dict(state)
    for fname, fdef in template.schema.items():
        if fname in decoded:
            new_state[fname] = fdef.clamp(decoded[fname])
    return new_state


# ---------------------------------------------------------------------------
# Confidence model — the "live vs estimated vs stale" axis
# ---------------------------------------------------------------------------

def confidence_band(observed_at: Optional[float], *, now: Optional[float] = None) -> str:
    """Bucket a last-observed timestamp into a confidence band.

    Returns one of: "live" | "estimated" | "stale" | "unknown".

    Usage: pass the state's `live_at` (last RX-confirmed observation) for
    "live"; pass `estimated_at` (last Ziggy command) for "estimated" upper
    bound. Caller picks the strongest band.
    """
    if observed_at is None:
        return "unknown"
    t = time.time() if now is None else now
    age = t - float(observed_at)
    if age < 0:
        return "unknown"
    if age <= LIVE_WINDOW_S:
        return "live"
    if age <= STALE_WINDOW_S:
        return "estimated"
    return "stale"


def merged_confidence(live_at: Optional[float], estimated_at: Optional[float],
                       *, now: Optional[float] = None) -> tuple[str, Optional[float]]:
    """Pick the strongest confidence band given both timestamps.

    Returns (band, age_seconds_or_None). `age` is for the timestamp that
    produced the chosen band — used by the UI to render "3 minutes ago".
    """
    t = time.time() if now is None else now
    live_band = confidence_band(live_at, now=t)
    if live_band == "live":
        return "live", t - float(live_at)  # type: ignore[arg-type]
    est_band = confidence_band(estimated_at, now=t)
    if est_band in ("live", "estimated"):
        # Estimated never "promotes" to live — RX is the only path to live.
        return "estimated", t - float(estimated_at)  # type: ignore[arg-type]
    if live_band == "estimated":
        return "estimated", t - float(live_at)  # type: ignore[arg-type]
    if live_band == "stale":
        return "stale", t - float(live_at)  # type: ignore[arg-type]
    if est_band == "stale":
        return "stale", t - float(estimated_at)  # type: ignore[arg-type]
    return "unknown", None


# ---------------------------------------------------------------------------
# State record helpers — what lives on the device record under device["state"]
# ---------------------------------------------------------------------------

def make_state_record(template: DeviceTemplate) -> dict:
    """Build the full state record stored on a device.

    Shape:
      {
        "template": "ac" | "tv" | ...,
        "values":   {field: value, ...},
        "live_at":       float | None,   # last RX-confirmed observation
        "estimated_at":  float | None,   # last Ziggy-initiated command
      }
    """
    return {
        "template": template.id,
        "values": template.make_initial_state(),
        "live_at": None,
        "estimated_at": None,
    }


def update_state_from_button(state_record: dict, template: DeviceTemplate,
                              command: str, *, source: str = "estimated") -> dict:
    """Mutate a state record from a button press.

    `source`:
      "live"      — RX-confirmed (physical-remote press matched a learned code)
      "estimated" — Ziggy-initiated (we sent the command ourselves)

    Returns the updated record. Caller is responsible for persisting.
    """
    new_values = apply_button_press(state_record.get("values", {}), template, command)
    out = dict(state_record)
    out["values"] = new_values
    out["template"] = template.id
    now = time.time()
    if source == "live":
        out["live_at"] = now
    else:
        out["estimated_at"] = now
    return out


def update_state_from_decoded(state_record: dict, template: DeviceTemplate,
                                decoded: dict) -> dict:
    """Mutate a state record from a fully-decoded payload (always live).

    Stateful AC payloads carry the whole state — every decode is RX-confirmed
    by definition.
    """
    new_values = apply_decoded_full_state(
        state_record.get("values", {}), template, decoded
    )
    out = dict(state_record)
    out["values"] = new_values
    out["template"] = template.id
    out["live_at"] = time.time()
    return out


def state_with_confidence(state_record: dict) -> dict:
    """UI-shape snapshot: values + confidence band + age."""
    band, age = merged_confidence(
        state_record.get("live_at"),
        state_record.get("estimated_at"),
    )
    return {
        "template": state_record.get("template"),
        "values": dict(state_record.get("values") or {}),
        "confidence": band,
        "age_seconds": age,
    }
