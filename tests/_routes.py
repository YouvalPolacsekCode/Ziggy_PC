"""Walk a FastAPI app's routes, across FastAPI versions.

Up to ~0.115, `app.include_router()` copied every route onto `app.routes`
with its prefix applied, so `{r.path for r in app.routes}` listed them all.
Newer FastAPI keeps each included router as one lazy `_IncludedRouter` entry
with no `.path`, so that scan silently finds only the app's own few routes and
every "is X mounted?" test fails even though the route serves fine.

`iter_routes` descends into included routers (duck-typed on
`original_router`, so it works on both shapes) and yields each concrete route
with its full, prefixed path.
"""

from __future__ import annotations


def iter_routes(app):
    """Yield `(full_path, route)` for every concrete route in `app`."""
    def walk(routes, prefix):
        for r in routes:
            inner = getattr(r, "original_router", None)
            if inner is not None:
                ctx = getattr(r, "include_context", None)
                yield from walk(inner.routes, prefix + (getattr(ctx, "prefix", "") or ""))
                continue
            path = getattr(r, "path", None)
            if path is not None:
                yield prefix + path, r
    yield from walk(app.routes, "")


def route_paths(app) -> set[str]:
    return {path for path, _ in iter_routes(app)}
