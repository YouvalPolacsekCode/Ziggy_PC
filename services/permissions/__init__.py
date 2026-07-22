"""Ziggy permission platform.

A general policy engine (Policy Decision Point) that answers exactly one
question everywhere in the product::

    decide(Principal, Action, Resource, Context) -> Allow | Deny + Obligations

Roles, groups, kids, buildings, cars, kiosks, voice and AI are all *data* fed
to that one function. The consumer UI exposes ~5% of the grammar (five preset
roles + one kid screen); the same engine scales to apartment buildings, rentals
and enterprise installs without a redesign.

Public surface is intentionally small — import the engine + core value types:

    from services.permissions import Engine, Principal, Effect, Decision
"""
from __future__ import annotations

from .types import (
    ActorKind,
    Channel,
    Decision,
    Effect,
    Obligation,
    ObligationKind,
    Principal,
    PrincipalType,
    RiskTier,
)
from .context import Context, ContextBuilder
from .grants import Grant
from .engine import Engine

__all__ = [
    "Engine",
    "Grant",
    "Principal",
    "PrincipalType",
    "Effect",
    "Decision",
    "Obligation",
    "ObligationKind",
    "RiskTier",
    "Channel",
    "ActorKind",
    "Context",
    "ContextBuilder",
]
