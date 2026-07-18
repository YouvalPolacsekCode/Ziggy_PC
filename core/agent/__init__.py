"""Ziggy v2 assistant — a single tool-calling agent.

Replaces the v1 three-path split (quick_parse parser + terse chat classifier +
separate Pro Mode designer) with one agent that holds conversation context,
resolves device references against the HA-truth device directory, and calls the
existing tested handlers/services to act.

Gated behind the `assistant.engine` flag (see backend/routers/intent_router.py)
so v1 stays a byte-for-byte fallback until the new engine is validated on real
hardware.
"""
