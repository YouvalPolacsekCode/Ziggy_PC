"""Condition language — a safe, serializable boolean expression evaluator.

Conditions are stored as plain JSON (a nested dict/list AST) and evaluated
against a :class:`~services.permissions.context.Context`. There is NO ``eval``
and no code execution — only a fixed set of operators — so a condition authored
via the API can never be a code-injection vector.

Grammar (JSONLogic-flavoured, intentionally tiny)::

    condition := null                         # always true
               | {"all": [condition, ...]}    # AND  (empty ⇒ true)
               | {"any": [condition, ...]}    # OR   (empty ⇒ false)
               | {"not": condition}
               | {"==":  [operand, operand]}  # also !=, >, >=, <, <=
               | {"in":  [operand, operand]}  # needle in haystack(list/str)
               | {"between": [operand, lo, hi]}   # inclusive; time-aware
               | {"matches": [operand, "glob*"]}  # fnmatch glob
    operand   := {"var": "dotted.path"} | literal(str|num|bool|null|list)

Fail-safe semantics
-------------------
An unknown ``var`` resolves to ``None``. Ordered comparisons (``>``/``<`` …)
against ``None`` are **False**, never a crash — a missing presence signal can
never *accidentally satisfy* a restrictive condition. ``==``/``!=``/``in`` treat
``None`` as an ordinary value.

Time-aware ``between``
---------------------
When both bounds look like ``"HH:MM"``, the operand is coerced to minutes-of-day
and **wrap-around windows are supported** (``22:00``–``07:00`` spans midnight) —
this is what makes "quiet hours" and "allowed hours" a one-liner.
"""
from __future__ import annotations

import fnmatch
from typing import Any

from .context import Context

_ORDER_OPS = {">", ">=", "<", "<="}
_LOGIC = {"all", "any", "not"}
_ALL_OPS = _LOGIC | {"==", "!=", "in", "between", "matches"} | _ORDER_OPS


class ConditionError(ValueError):
    """Raised by :func:`validate` for a malformed condition AST."""


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate(cond: Any, ctx: Context) -> bool:
    """Evaluate a condition AST to a bool. ``None`` ⇒ always true."""
    if cond is None:
        return True
    if not isinstance(cond, dict):
        raise ConditionError(f"condition must be an object or null, got {type(cond).__name__}")
    if len(cond) != 1:
        raise ConditionError(f"condition object must have exactly one operator key, got {list(cond)}")
    (op, args), = cond.items()

    if op == "all":
        return all(evaluate(c, ctx) for c in _as_list(args, op))
    if op == "any":
        return any(evaluate(c, ctx) for c in _as_list(args, op))
    if op == "not":
        return not evaluate(args, ctx)

    if op == "==":
        a, b = _binops(args, ctx, op)
        return a == b
    if op == "!=":
        a, b = _binops(args, ctx, op)
        return a != b
    if op in _ORDER_OPS:
        a, b = _binops(args, ctx, op)
        return _ordered(op, a, b)
    if op == "in":
        a, b = _binops(args, ctx, op)
        try:
            return a in b  # b is a list or string
        except TypeError:
            return False
    if op == "matches":
        a, b = _binops(args, ctx, op)
        if a is None or b is None:
            return False
        return fnmatch.fnmatchcase(str(a), str(b))
    if op == "between":
        return _between(args, ctx)

    raise ConditionError(f"unknown operator {op!r}")


def _as_list(args: Any, op: str) -> list:
    if not isinstance(args, list):
        raise ConditionError(f"{op!r} expects a list argument")
    return args


def _operand(x: Any, ctx: Context) -> Any:
    """Resolve an operand: a ``{"var": path}`` lookup or a literal."""
    if isinstance(x, dict) and set(x) == {"var"}:
        return ctx.resolve(x["var"])
    return x


def _binops(args: Any, ctx: Context, op: str) -> tuple[Any, Any]:
    if not isinstance(args, list) or len(args) != 2:
        raise ConditionError(f"{op!r} expects exactly 2 operands")
    return _operand(args[0], ctx), _operand(args[1], ctx)


def _ordered(op: str, a: Any, b: Any) -> bool:
    # Fail-safe: any ordered comparison touching None is False.
    if a is None or b is None:
        return False
    try:
        if op == ">":
            return a > b
        if op == ">=":
            return a >= b
        if op == "<":
            return a < b
        return a <= b
    except TypeError:
        # Mismatched types (e.g. str vs int) — treat as unsatisfiable, not error.
        return False


def _between(args: Any, ctx: Context) -> bool:
    if not isinstance(args, list) or len(args) != 3:
        raise ConditionError("'between' expects [value, lo, hi]")
    val = _operand(args[0], ctx)
    lo = _operand(args[1], ctx)
    hi = _operand(args[2], ctx)
    if val is None or lo is None or hi is None:
        return False
    # Time-of-day window if bounds are HH:MM. Supports midnight wrap-around.
    if _is_hhmm(lo) and _is_hhmm(hi):
        v = _to_minutes(val)
        if v is None:
            return False
        lom, him = _to_minutes(lo), _to_minutes(hi)
        if lom <= him:
            return lom <= v <= him
        # Wrap-around window, e.g. 22:00..07:00
        return v >= lom or v <= him
    try:
        return lo <= val <= hi
    except TypeError:
        return False


def _is_hhmm(x: Any) -> bool:
    return isinstance(x, str) and len(x) == 5 and x[2] == ":" and x[:2].isdigit() and x[3:].isdigit()


def _to_minutes(x: Any) -> int | None:
    if _is_hhmm(x):
        h, m = int(x[:2]), int(x[3:])
        return h * 60 + m
    if isinstance(x, (int, float)):
        return int(x)
    return None


# ---------------------------------------------------------------------------
# Validation — reject malformed ASTs at author time (API / store write path)
# ---------------------------------------------------------------------------

def validate(cond: Any) -> None:
    """Raise :class:`ConditionError` if ``cond`` is not a well-formed AST.

    Called on the write path so a bad condition is rejected when a grant is
    created, not silently mis-evaluated at decision time.
    """
    if cond is None:
        return
    if not isinstance(cond, dict) or len(cond) != 1:
        raise ConditionError("condition must be null or a single-operator object")
    (op, args), = cond.items()
    if op not in _ALL_OPS:
        raise ConditionError(f"unknown operator {op!r}")
    if op in ("all", "any"):
        for c in _as_list(args, op):
            validate(c)
    elif op == "not":
        validate(args)
    elif op == "between":
        if not isinstance(args, list) or len(args) != 3:
            raise ConditionError("'between' expects [value, lo, hi]")
        for a in args:
            _validate_operand(a)
    else:  # binary ops
        if not isinstance(args, list) or len(args) != 2:
            raise ConditionError(f"{op!r} expects exactly 2 operands")
        for a in args:
            _validate_operand(a)


def _validate_operand(x: Any) -> None:
    if isinstance(x, dict):
        if set(x) != {"var"} or not isinstance(x["var"], str) or not x["var"]:
            raise ConditionError(f"invalid operand object: {x!r}")
    elif not isinstance(x, (str, int, float, bool, list)) and x is not None:
        raise ConditionError(f"invalid literal operand: {x!r}")


def referenced_vars(cond: Any) -> set[str]:
    """Return the set of ``var`` paths a condition reads.

    Used by the cache layer to know which volatile context keys (presence,
    time, device state) a materialized decision depends on, so it can be
    invalidated precisely instead of flushed wholesale.
    """
    out: set[str] = set()
    _collect_vars(cond, out)
    return out


def _collect_vars(node: Any, out: set[str]) -> None:
    if isinstance(node, dict):
        if set(node) == {"var"}:
            out.add(node["var"])
            return
        for v in node.values():
            _collect_vars(v, out)
    elif isinstance(node, list):
        for v in node:
            _collect_vars(v, out)
