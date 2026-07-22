"""Evaluation context — the runtime facts a condition is judged against.

A ``Context`` is an immutable snapshot of everything the engine might need to
decide a single request: the time, the subject's attributes (age, role,
relationships), presence/location, the home mode, the target device's live
state, the channel/trust the request arrived on, and grant metadata.

It is deliberately a thin wrapper over a nested dict with dotted-path lookup
(``ctx.resolve("subject.age")``) so the condition language stays data-only and
new context providers (Policy Information Points) can add keys without any code
change to the evaluator. Unknown paths resolve to ``None`` — the condition
layer treats that as fail-safe (comparisons against None are False).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .types import ActorKind, Channel

_MISSING = object()


@dataclass(frozen=True)
class Context:
    data: dict = field(default_factory=dict)

    def resolve(self, path: str) -> Any:
        """Resolve a dotted path against the nested data dict.

        Returns ``None`` for any missing segment (fail-safe). Supports dict
        traversal only — lists are returned whole for use with ``in``.
        """
        cur: Any = self.data
        for seg in path.split("."):
            if isinstance(cur, dict):
                cur = cur.get(seg, _MISSING)
                if cur is _MISSING:
                    return None
            else:
                return None
        return cur

    def with_overrides(self, **top_level: Any) -> "Context":
        merged = dict(self.data)
        merged.update(top_level)
        return Context(merged)


class ContextBuilder:
    """Ergonomic builder for the common request context shape.

    Keeps the well-known keys consistent across the codebase so conditions
    written against ``subject.age`` / ``home.mode`` / ``resource.state`` keep
    working regardless of who assembled the context.
    """

    def __init__(self) -> None:
        self._d: dict = {
            "time": {},
            "subject": {},
            "presence": {},
            "home": {},
            "resource": {"state": {}, "attrs": {}},
            "session": {},
            "context": {"actor_kind": ActorKind.HUMAN.value},
            "grant": {},
            "emergency": False,
        }

    def time(self, *, local_hhmm: str | None = None, dow: int | None = None,
             is_holiday: bool | None = None) -> "ContextBuilder":
        if local_hhmm is not None:
            self._d["time"]["local"] = local_hhmm
        if dow is not None:
            self._d["time"]["dow"] = dow  # 0=Mon .. 6=Sun
        if is_holiday is not None:
            self._d["time"]["is_holiday"] = is_holiday
        return self

    def subject(self, **attrs: Any) -> "ContextBuilder":
        self._d["subject"].update(attrs)
        return self

    def presence(self, *, home: bool | None = None, who: list | None = None,
                 subject_present: bool | None = None) -> "ContextBuilder":
        if home is not None:
            self._d["presence"]["home"] = home
        if who is not None:
            self._d["presence"]["who"] = who
        if subject_present is not None:
            self._d["subject"]["present"] = subject_present
        return self

    def home(self, *, mode: str | None = None, **attrs: Any) -> "ContextBuilder":
        if mode is not None:
            self._d["home"]["mode"] = mode
            # Emergency is common enough to surface as a top-level shortcut too.
            self._d["emergency"] = (mode == "emergency")
        self._d["home"].update(attrs)
        return self

    def emergency(self, on: bool = True) -> "ContextBuilder":
        self._d["emergency"] = bool(on)
        if on:
            self._d["home"]["mode"] = "emergency"
        return self

    def resource_state(self, **state: Any) -> "ContextBuilder":
        self._d["resource"]["state"].update(state)
        return self

    def session(self, *, channel: Channel | str | None = None,
                trust_level: int | None = None,
                actor_kind: ActorKind | str | None = None) -> "ContextBuilder":
        if channel is not None:
            ch = channel.value if isinstance(channel, Channel) else str(channel)
            self._d["session"]["channel"] = ch
            self._d["channel"] = ch  # convenience top-level alias
        if trust_level is not None:
            self._d["session"]["trust_level"] = int(trust_level)
        if actor_kind is not None:
            ak = actor_kind.value if isinstance(actor_kind, ActorKind) else str(actor_kind)
            self._d["context"]["actor_kind"] = ak
        return self

    def grant_meta(self, **meta: Any) -> "ContextBuilder":
        self._d["grant"].update(meta)
        return self

    def raw(self, **top_level: Any) -> "ContextBuilder":
        self._d.update(top_level)
        return self

    def build(self) -> Context:
        return Context(self._d)
