"""Groups + relationships + principal expansion.

Grants can target a *group* as well as an individual, and groups come in two
flavours:

* **static** — an explicit member list (``Family``, ``Everyone``).
* **dynamic** — a predicate (condition AST) re-evaluated at decision time
  (``Adults = subject.age >= 18``; ``Guardians = "guardian_of" in
  subject.relationship_types``; ``Present = presence.subject_present``).

Relationships are a typed edge graph between principals (``guardian_of``,
``caregiver_of``, ``manager_of``, ``owner_of``). "Child", "guardian", "property
manager", "caregiver" are all just edges + attributes — none of them are
hardcoded schema, which is what keeps the model from baking in "family".

``PrincipalResolver.expand`` turns a subject person into the full set of
principals a decision should consider: the person plus every group they belong
to (static + dynamic + nested), which is exactly what ``Engine.decide`` wants as
``subject_principals``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .conditions import evaluate as eval_condition
from .context import Context
from .types import Principal


@dataclass
class Group:
    id: str
    kind: str                     # "static" | "dynamic"
    label: str = ""
    members: list = field(default_factory=list)   # list[str] principal refs (static)
    predicate: Optional[dict] = None              # condition AST (dynamic)

    @property
    def principal(self) -> Principal:
        return Principal.group(self.id)


class RelationshipGraph:
    """Directed, typed edges between principal refs."""

    def __init__(self) -> None:
        self._edges: set[tuple[str, str, str]] = set()  # (from_ref, type, to_ref)

    def add(self, from_ref: str, rel_type: str, to_ref: str) -> None:
        self._edges.add((from_ref, rel_type, to_ref))

    def remove(self, from_ref: str, rel_type: str, to_ref: str) -> None:
        self._edges.discard((from_ref, rel_type, to_ref))

    def has(self, from_ref: str, rel_type: str, to_ref: str) -> bool:
        return (from_ref, rel_type, to_ref) in self._edges

    def targets(self, from_ref: str, rel_type: str) -> set[str]:
        return {t for (f, r, t) in self._edges if f == from_ref and r == rel_type}

    def types_from(self, from_ref: str) -> set[str]:
        return {r for (f, r, t) in self._edges if f == from_ref}

    def sources(self, rel_type: str, to_ref: str) -> set[str]:
        return {f for (f, r, t) in self._edges if r == rel_type and t == to_ref}

    def all_edges(self) -> list[tuple[str, str, str]]:
        return sorted(self._edges)


class PrincipalResolver:
    def __init__(self, groups: list[Group], relationships: RelationshipGraph) -> None:
        self._groups = list(groups)
        self._rel = relationships

    def expand(self, subject: Principal, context: Context) -> set[Principal]:
        """Return {subject} ∪ all groups the subject belongs to.

        Dynamic-group predicates are evaluated against ``context`` augmented
        with ``subject.relationship_types`` and ``subject.ref`` so a predicate
        can gate on relationships as well as plain attributes.
        """
        ctx2 = self._augment(subject, context)
        out: set[Principal] = {subject}

        # First pass: direct membership (static list + dynamic predicate).
        for g in self._groups:
            if self._is_member(g, subject, ctx2, out):
                out.add(g.principal)

        # Fixpoint for nested static groups (a group listing another group ref).
        changed = True
        while changed:
            changed = False
            member_refs = {p.ref for p in out}
            for g in self._groups:
                if g.principal in out:
                    continue
                if g.kind == "static" and any(m in member_refs for m in g.members):
                    out.add(g.principal)
                    changed = True
        return out

    def _is_member(self, g: Group, subject: Principal, ctx: Context,
                   already: set[Principal]) -> bool:
        if g.kind == "static":
            return subject.ref in g.members
        if g.kind == "dynamic":
            return bool(eval_condition(g.predicate, ctx))
        return False

    def _augment(self, subject: Principal, context: Context) -> Context:
        data = dict(context.data)
        subj = dict(data.get("subject") or {})
        subj.setdefault("ref", subject.ref)
        subj["relationship_types"] = sorted(self._rel.types_from(subject.ref))
        data["subject"] = subj
        return Context(data)


# ---------------------------------------------------------------------------
# Built-in dynamic groups every home gets — data, not code.
# ---------------------------------------------------------------------------

def default_groups() -> list[Group]:
    return [
        Group("everyone", "dynamic", "Everyone", predicate=None),  # None ⇒ always
        Group("adults", "dynamic", "Adults",
              predicate={">=": [{"var": "subject.age"}, 18]}),
        Group("kids", "dynamic", "Kids",
              predicate={"<": [{"var": "subject.age"}, 13]}),
        Group("teens", "dynamic", "Teens",
              predicate={"all": [
                  {">=": [{"var": "subject.age"}, 13]},
                  {"<": [{"var": "subject.age"}, 18]},
              ]}),
        Group("guardians", "dynamic", "Guardians",
              predicate={"in": ["guardian_of", {"var": "subject.relationship_types"}]}),
        Group("present", "dynamic", "Present at home",
              predicate={"==": [{"var": "subject.present"}, True]}),
    ]
