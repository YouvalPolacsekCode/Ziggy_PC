"""Event-sourced persistence for the permission platform.

The database stores exactly ONE thing: an append-only ``policy_events`` log.
The current permission state (spaces, devices, principals, identities, groups,
relationships, role bindings, grants) is a *read model* rebuilt by replaying the
log through :class:`PolicyState`. There are no projection tables to drift out of
sync — apply-event is the single write path, which is the whole reason to go
event-sourced here.

Falls out for free:
* **point-in-time** — replay up to any ``seq`` to answer "who could unlock the
  door on March 3?"
* **provenance** — every grant traces to the event (and actor) that issued it.
* **revoke cascade** — revoking a delegation root removes its whole subtree.

Storage conventions mirror ``services.auth_db``: SQLite, sync API (policy writes
are not perf-sensitive), a git-ignored file under ``user_files/``. The store is a
class (not module globals) so tests inject a temp path directly.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Optional

from .grants import Grant
from .groups import Group, RelationshipGraph
from .resources import Device, ResourceGraph, Space
from .roles import expand_role

_DEFAULT_DB = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "user_files",
    "permissions.db",
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS policy_events (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts             TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    payload        TEXT NOT NULL,
    actor          TEXT,
    correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_policy_events_type ON policy_events(event_type);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# The event log
# ---------------------------------------------------------------------------

class PolicyStore:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or _DEFAULT_DB
        self._lock = threading.Lock()
        self._init()

    def _connect(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init(self) -> None:
        with self._connect() as db:
            db.executescript(_SCHEMA)
            db.commit()

    def append(self, event_type: str, payload: dict, *,
               actor: str | None = None, correlation_id: str | None = None) -> int:
        with self._lock, self._connect() as db:
            cur = db.execute(
                "INSERT INTO policy_events (ts, event_type, payload, actor, correlation_id)"
                " VALUES (?, ?, ?, ?, ?)",
                (_now(), event_type, json.dumps(payload), actor, correlation_id),
            )
            db.commit()
            return cur.lastrowid

    def events(self, up_to_seq: Optional[int] = None) -> list[dict]:
        with self._connect() as db:
            if up_to_seq is None:
                rows = db.execute(
                    "SELECT * FROM policy_events ORDER BY seq").fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM policy_events WHERE seq <= ? ORDER BY seq",
                    (up_to_seq,)).fetchall()
            out = []
            for r in rows:
                d = dict(r)
                d["payload"] = json.loads(d["payload"])
                out.append(d)
            return out

    def latest_seq(self) -> int:
        with self._connect() as db:
            row = db.execute("SELECT MAX(seq) AS m FROM policy_events").fetchone()
            return row["m"] or 0


# ---------------------------------------------------------------------------
# The read model — rebuilt by replaying events
# ---------------------------------------------------------------------------

class PolicyState:
    """In-memory materialization of the policy world at a point in the log."""

    def __init__(self) -> None:
        self.spaces: dict[str, Space] = {}
        self.devices: dict[str, Device] = {}
        self.principals: dict[str, dict] = {}   # ref -> {type, attrs, status}
        self.identities: dict[str, dict] = {}   # id -> {...}
        self.groups: dict[str, Group] = {}
        self.relationships = RelationshipGraph()
        self.bindings: dict[str, dict] = {}     # binding_id -> meta
        self.grants: dict[str, Grant] = {}      # grant_id -> Grant

    # -- replay ----------------------------------------------------------
    def apply(self, event: dict) -> None:
        handler = getattr(self, f"_on_{event['event_type']}", None)
        if handler is None:
            # Unknown event types are ignored on replay so a newer log can be
            # read by older code without crashing (forward-compat).
            return
        handler(event["payload"])

    # spaces / devices
    def _on_space_added(self, p):
        self.spaces[p["id"]] = Space(
            p["id"], p["type"], list(p.get("parent_ids", [])),
            set(p.get("tags", [])), dict(p.get("attrs", {})))

    def _on_space_removed(self, p):
        self.spaces.pop(p["id"], None)

    def _on_device_added(self, p):
        self.devices[p["id"]] = Device(
            p["id"], p["device_class"], p.get("space_id"),
            set(p.get("tags", [])), dict(p.get("attrs", {})))

    def _on_device_removed(self, p):
        self.devices.pop(p["id"], None)

    # principals / identities
    def _on_principal_added(self, p):
        self.principals[p["ref"]] = {
            "type": p["ref"].split(":", 1)[0],
            "attrs": dict(p.get("attrs", {})),
            "status": p.get("status", "active"),
        }

    def _on_principal_removed(self, p):
        ref = p["ref"]
        self.principals.pop(ref, None)
        # Cascade: drop that principal's grants + identities + relationships.
        for gid in [g for g, gr in self.grants.items() if gr.principal.ref == ref]:
            self.grants.pop(gid, None)
        for iid in [i for i, iv in self.identities.items() if iv.get("person_ref") == ref]:
            self.identities.pop(iid, None)

    def _on_identity_added(self, p):
        self.identities[p["id"]] = {
            "person_ref": p["person_ref"], "kind": p["kind"],
            "trust_level": p.get("trust_level", 1), "status": "active",
        }

    def _on_identity_revoked(self, p):
        iv = self.identities.get(p["id"])
        if iv:
            iv["status"] = "revoked"

    # groups / relationships
    def _on_group_upserted(self, p):
        self.groups[p["id"]] = Group(
            p["id"], p["kind"], p.get("label", ""),
            list(p.get("members", [])), p.get("predicate"))

    def _on_group_removed(self, p):
        self.groups.pop(p["id"], None)

    def _on_relationship_added(self, p):
        self.relationships.add(p["from_ref"], p["type"], p["to_ref"])

    def _on_relationship_removed(self, p):
        self.relationships.remove(p["from_ref"], p["type"], p["to_ref"])

    # role bindings — expand to grants at apply time
    def _on_role_bound(self, p):
        from .types import Principal
        binding_id = p["binding_id"]
        self.bindings[binding_id] = p
        grants = expand_role(
            p["role"], principal=Principal.parse(p["principal"]),
            scope_ref=p["scope"], binding_id=binding_id,
            condition=p.get("condition"), expires_at=p.get("expires_at"))
        for g in grants:
            self.grants[g.id] = g

    def _on_role_unbound(self, p):
        binding_id = p["binding_id"]
        self.bindings.pop(binding_id, None)
        for gid in [g for g in self.grants if g.startswith(f"{binding_id}#")]:
            self.grants.pop(gid, None)

    # grants
    def _on_grant_issued(self, p):
        g = Grant.from_json(p)
        self.grants[g.id] = g

    def _on_grant_revoked(self, p):
        gid = p.get("id")
        root = p.get("revoke_root")
        if gid:
            self.grants.pop(gid, None)
        if root:
            # Cascade: remove the root and every grant delegated beneath it.
            for g in [g for g, gr in self.grants.items()
                      if gr.revoke_root == root or g == root]:
                self.grants.pop(g, None)

    # -- read helpers ----------------------------------------------------
    def to_resource_graph(self) -> ResourceGraph:
        rg = ResourceGraph()
        for s in self.spaces.values():
            rg.add_space(s)
        for d in self.devices.values():
            rg.add_device(d)
        return rg

    def groups_list(self) -> list[Group]:
        return list(self.groups.values())

    def all_grants(self) -> list[Grant]:
        return list(self.grants.values())

    def grants_for(self, principal_refs: set[str]) -> list[Grant]:
        return [g for g in self.grants.values() if g.principal.ref in principal_refs]

    def principal_attrs(self, ref: str) -> dict:
        p = self.principals.get(ref)
        return dict(p["attrs"]) if p else {}


def build_state(store: PolicyStore, up_to_seq: Optional[int] = None) -> PolicyState:
    state = PolicyState()
    for ev in store.events(up_to_seq=up_to_seq):
        state.apply(ev)
    return state
