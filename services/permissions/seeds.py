"""Seed data — capability manifests and consumer preset roles, as DATA.

Everything here is plain data the engine consumes; none of it is special-cased
in engine code. "Roles are UI, not architecture" is literally true because the
five consumer presets below are just named bundles of grant specs that expand
against whatever scope they are bound to.

Two future device classes (``ev_charger``, ``mower``) are seeded on purpose to
demonstrate that new hardware needs only a manifest — no engine change.
"""
from __future__ import annotations

from .capabilities import CapabilityDef
from .types import RiskTier

# ---------------------------------------------------------------------------
# Capability manifests — today's classes + two future ones
# ---------------------------------------------------------------------------

_LIGHT = [
    CapabilityDef("light.onoff", "light", RiskTier.LOW, frozenset({"lighting"})),
    CapabilityDef("light.brightness", "light", RiskTier.LOW, frozenset({"lighting"})),
    CapabilityDef("light.color", "light", RiskTier.LOW, frozenset({"lighting"})),
]
_MEDIA = [
    CapabilityDef("media.playback", "media", RiskTier.LOW, frozenset({"media"})),
    CapabilityDef("media.volume", "media", RiskTier.LOW, frozenset({"media"})),
    CapabilityDef("media.purchase", "media", RiskTier.HIGH, frozenset({"media", "cost"})),
]
_CLIMATE = [
    CapabilityDef("climate.setpoint", "climate", RiskTier.LOW, frozenset({"climate"})),
    CapabilityDef("climate.mode", "climate", RiskTier.LOW, frozenset({"climate"})),
]
_LOCK = [
    CapabilityDef("lock.lock", "lock", RiskTier.MEDIUM, frozenset({"security", "physical_access"})),
    CapabilityDef("lock.unlock", "lock", RiskTier.HIGH, frozenset({"security", "physical_access"}),
                  offline_default="deny"),
]
_GARAGE = [
    CapabilityDef("cover.close", "garage", RiskTier.MEDIUM, frozenset({"security", "physical_access"})),
    CapabilityDef("cover.open", "garage", RiskTier.HIGH, frozenset({"security", "physical_access"}),
                  offline_default="deny"),
]
_ALARM = [
    CapabilityDef("alarm.arm", "alarm", RiskTier.MEDIUM, frozenset({"security"})),
    CapabilityDef("alarm.disarm", "alarm", RiskTier.HIGH, frozenset({"security"}),
                  offline_default="deny"),
]
_CAMERA = [
    CapabilityDef("camera.live", "camera", RiskTier.HIGH, frozenset({"cameras", "privacy"}),
                  offline_default="deny"),
    CapabilityDef("camera.history", "camera", RiskTier.HIGH, frozenset({"cameras", "privacy"}),
                  offline_default="deny"),
]
_SENSOR = [
    CapabilityDef("sensor.read", "sensor", RiskTier.LOW, frozenset({"sensors"})),
]
# --- future classes: proof the model absorbs them with zero engine changes ---
_EV = [
    CapabilityDef("ev.start_charge", "ev_charger", RiskTier.LOW, frozenset({"energy"})),
    CapabilityDef("ev.stop_charge", "ev_charger", RiskTier.LOW, frozenset({"energy"})),
    CapabilityDef("ev.set_limit", "ev_charger", RiskTier.MEDIUM, frozenset({"energy", "cost"})),
    CapabilityDef("ev.unlock_cable", "ev_charger", RiskTier.MEDIUM,
                  frozenset({"energy", "physical_access"})),
]
_MOWER = [
    CapabilityDef("mower.start", "mower", RiskTier.MEDIUM, frozenset({"outdoor", "robotics"})),
    CapabilityDef("mower.dock", "mower", RiskTier.LOW, frozenset({"outdoor", "robotics"})),
    CapabilityDef("mower.set_zone", "mower", RiskTier.MEDIUM, frozenset({"outdoor", "robotics"})),
]

DEFAULT_CAPABILITY_MANIFESTS = [
    _LIGHT, _MEDIA, _CLIMATE, _LOCK, _GARAGE, _ALARM, _CAMERA, _SENSOR, _EV, _MOWER,
]


# ---------------------------------------------------------------------------
# Consumer preset roles — named bundles of grant specs (data, not code)
# ---------------------------------------------------------------------------
#
# A GrantSpec is a dict with the same shape as a Grant minus identity/scope:
#   {effect, resource, capability, condition?, obligations?, priority?}
# ``resource`` uses the sentinel "@scope" meaning "the scope this role is bound
# at" — expansion substitutes the real space ref. This is how one "Kid" role
# means different things in different homes with no per-home authoring.

SCOPE = "@scope"  # sentinel replaced at bind time with the bound space ref

# Everyday, non-sensitive capability set most roles get on shared devices.
_EVERYDAY = {"any_of": [
    {"scope_tag": "lighting"}, {"scope_tag": "media"}, {"scope_tag": "climate"},
    {"scope_tag": "sensors"},
]}
_SECURITY = {"any_of": [
    {"scope_tag": "security"}, {"scope_tag": "cameras"}, {"scope_tag": "physical_access"},
]}

PRESET_ROLES: dict[str, dict] = {
    "owner": {
        "label": "Owner",
        "grants": [
            {"effect": "allow", "resource": SCOPE, "capability": "*"},
        ],
    },
    "admin": {
        "label": "Admin",
        # Everything except owner-reserved capabilities (billing, ownership
        # transfer, factory reset). Those are modeled as a deny carve-out so the
        # "admin can do almost everything" story is one allow + a small deny.
        "grants": [
            {"effect": "allow", "resource": SCOPE, "capability": "*"},
            {"effect": "deny", "resource": SCOPE,
             "capability": {"any_of": [{"scope_tag": "owner_only"}]}},
        ],
    },
    "adult": {
        "label": "Adult",
        "grants": [
            {"effect": "allow", "resource": SCOPE, "capability": _EVERYDAY},
            # Security devices allowed but with step-up implied by risk tier.
            {"effect": "allow", "resource": SCOPE, "capability": _SECURITY,
             "condition": {"in": [{"var": "channel"}, ["app", "face", "nfc"]]}},
        ],
    },
    "teen": {
        "label": "Teen",
        "grants": [
            {"effect": "allow", "resource": SCOPE, "capability": _EVERYDAY,
             "condition": {"between": [{"var": "time.local"}, "06:00", "23:00"]}},
            # No security devices by default (default-deny handles the rest).
        ],
    },
    "kid": {
        "label": "Kid",
        # Default-deny for kids: they get NOTHING at the scope level. Access is
        # granted per-device by the parent's allowlist (device-level grants),
        # so the preset itself is intentionally empty of allows and carries an
        # explicit deny on anything sensitive to make intent auditable.
        "grants": [
            {"effect": "deny", "resource": SCOPE, "capability": _SECURITY},
        ],
    },
    "guest": {
        "label": "Guest",
        "grants": [
            {"effect": "allow", "resource": SCOPE, "capability": {"any_of": [
                {"scope_tag": "lighting"}, {"scope_tag": "media"},
            ]}},
            {"effect": "deny", "resource": SCOPE, "capability": _SECURITY},
        ],
    },
    "temp_guest": {
        "label": "Temporary Guest",
        # Same as guest but the *binding* carries the expiry/window; the role
        # body stays identical, proving expiry is a binding concern not a role.
        "grants": [
            {"effect": "allow", "resource": SCOPE, "capability": {"any_of": [
                {"scope_tag": "lighting"}, {"scope_tag": "media"},
            ]}},
            {"effect": "deny", "resource": SCOPE, "capability": _SECURITY},
        ],
    },
}
