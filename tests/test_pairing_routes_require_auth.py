"""Auth pinning for the brand-pairing routes.

Caught by a security review before these shipped: three new routes went out
without a role dependency. The hub serves over plain HTTP on the home LAN and
there is NO global auth middleware (relay_auth only trusts a user the relay
injects, it does not enforce one), so an unauthenticated route is reachable by
anything on the network.

The worst of the three was the smart-AC probe, which is not a read at all: it
starts a Home Assistant config flow and triggers a UDP broadcast scan on every
call. The other two expose home topology — device ids, entity ids, names and
rooms.

This test exists so the dependency can't be dropped again in a refactor.
"""
from __future__ import annotations

from backend.routers import pairing_router as pr

# Routes added for brand-initiated AC pairing. Every one of them either drives
# hardware or describes the home, so every one needs a role.
GUARDED = {
    "/api/pairing/wifi-brands",
    "/api/pairing/config-flow/start",
    "/api/pairing/smart-ac-probe",
    "/api/pairing/climate-units",
    "/api/pairing/identify",
    "/api/pairing/brand-request",
}


def _routes_by_path():
    out = {}
    for r in pr.router.routes:
        out.setdefault(getattr(r, "path", None), []).append(r)
    return out


def test_every_brand_pairing_route_has_an_auth_dependency():
    by_path = _routes_by_path()
    missing = []
    for path in sorted(GUARDED):
        routes = by_path.get(path)
        assert routes, f"route disappeared: {path}"
        for r in routes:
            deps = getattr(getattr(r, "dependant", None), "dependencies", [])
            if not deps:
                missing.append(path)
    assert not missing, f"unauthenticated pairing routes: {missing}"


def test_the_probe_is_guarded_because_it_has_side_effects():
    """Singled out: this one opens a config flow and scans the LAN. An
    unauthenticated caller could do that in a loop."""
    routes = _routes_by_path()["/api/pairing/smart-ac-probe"]
    assert all(getattr(r.dependant, "dependencies", []) for r in routes)
