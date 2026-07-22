"""Resource graph — a typed containment DAG, not a fixed home→room→device tree.

Nodes are ``Space``s (``org``/``property``/``building``/``floor``/``unit``/
``home``/``zone``/``room`` … — an OPEN vocabulary) and ``Device``s. Containment
is a **DAG**: a shared hallway can belong to two units; a device can live in
"Downstairs" and in "Cameras/Outdoor" at once. Grants attach to any node and
inherit down every edge.

The engine never walks this graph during a decision — it asks for a
``ResolvedResource`` once (the target plus its ordered ancestor chain) and hands
that flat object to the selectors. That keeps the hot path allocation-light and
makes "grant on the building applies to a device three levels down" fall out of
a simple id/tag/type check against the ancestor list.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class NodeView:
    """Flattened view of one node (self or an ancestor) for selector matching."""
    id: str                 # canonical ref, e.g. "space:home_42" / "device:lock_1"
    kind: str               # "space" | "device"
    type_or_class: str      # space.type or device.class
    tags: frozenset = frozenset()
    attrs: tuple = ()       # sorted (key, value) pairs; frozen for hashability

    @property
    def attr_dict(self) -> dict:
        return dict(self.attrs)


@dataclass(frozen=True)
class ResolvedResource:
    """A target node plus its ancestors, nearest-first.

    ``ancestors[0]`` is the immediate parent; deeper entries are further away.
    Selector matching prefers a hit on ``self`` (distance 0) over an ancestor
    (distance = index + 1), which is how "grant on the heater" beats "grant on
    the room" during conflict resolution.
    """
    self_node: NodeView
    ancestors: tuple = ()   # tuple[NodeView], nearest first

    def chain(self):
        """Yield ``(distance, node)`` for self (0) then each ancestor (1, 2 …)."""
        yield 0, self.self_node
        for i, anc in enumerate(self.ancestors):
            yield i + 1, anc


@dataclass
class Space:
    id: str
    type: str
    parent_ids: list = field(default_factory=list)
    tags: set = field(default_factory=set)
    attrs: dict = field(default_factory=dict)

    @property
    def ref(self) -> str:
        return f"space:{self.id}"


@dataclass
class Device:
    id: str
    device_class: str
    space_id: str | None = None
    tags: set = field(default_factory=set)
    attrs: dict = field(default_factory=dict)

    @property
    def ref(self) -> str:
        return f"device:{self.id}"


class ResourceGraph:
    """In-memory model of spaces + devices with ancestor resolution.

    Loaded/rebuilt from the event-sourced store; also constructed directly in
    tests. Cycle-safe: ancestor walks track visited ids so a malformed DAG with
    a loop degrades to a finite chain instead of hanging.
    """

    def __init__(self) -> None:
        self._spaces: dict[str, Space] = {}
        self._devices: dict[str, Device] = {}

    # -- mutation ---------------------------------------------------------
    def add_space(self, space: Space) -> None:
        self._spaces[space.id] = space

    def add_device(self, device: Device) -> None:
        self._devices[device.id] = device

    def space(self, sid: str) -> Space | None:
        return self._spaces.get(sid)

    def device(self, did: str) -> Device | None:
        return self._devices.get(did)

    # -- resolution -------------------------------------------------------
    def _space_view(self, s: Space) -> NodeView:
        return NodeView(
            id=s.ref, kind="space", type_or_class=s.type,
            tags=frozenset(s.tags), attrs=tuple(sorted(s.attrs.items())),
        )

    def _device_view(self, d: Device) -> NodeView:
        return NodeView(
            id=d.ref, kind="device", type_or_class=d.device_class,
            tags=frozenset(d.tags), attrs=tuple(sorted(d.attrs.items())),
        )

    def _ancestor_spaces(self, start_space_ids: list[str]) -> list[NodeView]:
        """BFS up the DAG from the given parent space ids, nearest-first,
        de-duplicated, cycle-safe."""
        views: list[NodeView] = []
        seen: set[str] = set()
        frontier = list(start_space_ids)
        while frontier:
            nxt: list[str] = []
            for sid in frontier:
                if sid in seen:
                    continue
                seen.add(sid)
                sp = self._spaces.get(sid)
                if not sp:
                    continue
                views.append(self._space_view(sp))
                nxt.extend(pid for pid in sp.parent_ids if pid not in seen)
            frontier = nxt
        return views

    def resolve(self, resource_ref: str) -> ResolvedResource | None:
        """Resolve a ``"device:x"`` / ``"space:y"`` ref to a flat resource view.

        Returns ``None`` for an unknown ref — the engine treats an unresolvable
        resource as default-deny (you cannot be granted access to something the
        graph has never heard of).
        """
        kind, _, rid = resource_ref.partition(":")
        if not _:
            return None
        if kind == "device":
            d = self._devices.get(rid)
            if not d:
                return None
            self_view = self._device_view(d)
            anc = self._ancestor_spaces([d.space_id] if d.space_id else [])
            return ResolvedResource(self_view, tuple(anc))
        if kind == "space":
            s = self._spaces.get(rid)
            if not s:
                return None
            self_view = self._space_view(s)
            anc = self._ancestor_spaces(list(s.parent_ids))
            return ResolvedResource(self_view, tuple(anc))
        return None

    def descendants_of(self, space_ref: str) -> list[str]:
        """All resource refs (spaces + devices) contained under a space.

        Used by delegation attenuation + the "who can do X on this?" reverse
        query, which need to enumerate the concrete resource set of a subtree.
        """
        _, _, sid = space_ref.partition(":")
        out: list[str] = []
        # Spaces whose ancestor set includes sid.
        for s in self._spaces.values():
            if s.id == sid:
                continue
            if sid in {a.id.split(":", 1)[1] for a in self._ancestor_spaces(list(s.parent_ids))}:
                out.append(s.ref)
        for d in self._devices.values():
            if not d.space_id:
                continue
            chain_ids = {d.space_id} | {
                a.id.split(":", 1)[1] for a in self._ancestor_spaces([d.space_id])
            }
            if sid in chain_ids:
                out.append(d.ref)
        return out

    def all_resource_refs(self) -> list[str]:
        return [s.ref for s in self._spaces.values()] + [d.ref for d in self._devices.values()]
