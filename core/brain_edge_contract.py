"""Brain ↔ Edge contract — the line the cloud phase will later cut along.

Today both sides run in the same process; the contract is the explicit
boundary. Swapping the in-process implementations for a remote pair
(brain in the cloud, edge on the hub) is a config change, not a refactor.

Roles
=====
EDGE (must always run locally on the hub):
  - Live home state (ha_subscriber, state_cache)
  - Device execution (HA REST/WS, Broadlink IR, command_router)
  - Automation execution, scheduler, anomaly engine
  - Voice capture, OTA, backup
  - Persistent state in user_files/

BRAIN (can run on the same machine OR remotely):
  - Intent parsing (LLM-driven)
  - Conversational chat
  - Dispatch decisions that need understanding
  - Conversation context / session memory
  - The LLM gateway itself

The brain emits Ziggy-native intents (and Ziggy-native device ids /
selectors when targeting devices); it never sees HA entity_ids or HA
service names. Translation happens on the edge side via
services.device_translator.

Common-path guarantee
=====================
Simple direct commands — anything that matched a fast path in
core.intent_parser.quick_parse OR was already shaped as a known intent
— execute on the edge WITHOUT a brain round-trip. Only genuine
understanding (LLM-needed parses, free-form chat, "what should I do
about this anomaly?") goes through the brain.

In particular, core.action_parser.handle_intent is the edge's
single execution entry; calling edge.execute_intent(...) below
delegates to it directly with no LLM call in between. The brain
performs no work for fast-path intents.

Fallback guarantee
==================
The edge can act WITHOUT the brain. BrainHook.ask() accepts a
`fallback` callable so any edge-side trigger (scheduler tick,
anomaly engine, suggestion engine) can degrade gracefully when
the brain is unreachable. When the brain runs remote, "brain
unreachable" is just a network failure on this call.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Iterable, Protocol


# ── EDGE contract ───────────────────────────────────────────────────────────

class EdgeContract(Protocol):
    """Interface the brain uses to reach the edge. Every brain → edge
    interaction goes through this protocol — never via direct imports of
    services.* / core.handlers.* from brain-side code."""

    async def execute_intent(
        self,
        intent: str,
        params: dict,
        *,
        source: str = "brain",
    ) -> dict:
        """Edge expands + executes a Ziggy-native intent locally.

        Returns the standard handler result shape:
            {"ok": bool, "message": str, "data": ...}
        Expansion ("all lights", room selectors, etc.) is the edge's job —
        the brain should never enumerate devices to build a fan-out.
        """
        ...

    def query_state(self, selector: str | dict) -> dict | list[dict]:
        """Resolve a Ziggy-native selector and return live state.

        Returns a single state dict for a degenerate selector (single id)
        or a list of state dicts for a multi-device selector.
        """
        ...

    def list_devices(self, filter: dict | None = None) -> list[dict]:
        """Enumerate devices from the live registry (edge-only knowledge).

        Each dict is the brain-facing ZiggyDevice shape — no HA entity_ids,
        no IR codeset ids. `filter` accepts {device_type: ..., room: ...}.
        """
        ...


# ── BRAIN contract ──────────────────────────────────────────────────────────

class BrainContract(Protocol):
    """Interface edge-side autonomous components use to reach the brain.

    Used by services.ziggy_scheduler, services.anomaly_engine,
    services.suggestion_engine when they need a model decision. Always
    accept a `fallback` so the edge keeps working when the brain is
    unavailable.
    """

    async def ask(
        self,
        prompt: str,
        context: dict | None = None,
        *,
        purpose: str = "chat",
        fallback: Callable[[str, dict], str] | None = None,
    ) -> dict:
        """Send a question to the brain. Returns {"ok": bool, ...}.

        On success: {"ok": True, "answer": str, "from_fallback": False}
        On brain failure with a fallback: {"ok": True, "answer": str,
                                            "from_fallback": True}
        On total failure: {"ok": False, "error": str}.
        """
        ...


# ── In-process implementations ──────────────────────────────────────────────

class InProcessEdge:
    """Default edge: directly invokes the existing edge modules.

    Swap this for a network-RPC client when the brain runs remote — the
    public method signatures stay the same.
    """

    async def execute_intent(
        self,
        intent: str,
        params: dict,
        *,
        source: str = "brain",
    ) -> dict:
        # action_parser is the single dispatch entry on the edge today.
        # It already knows how to fan out __multi__ envelopes and how to
        # route per-intent to the right handler.
        from core.action_parser import handle_intent
        return await handle_intent(
            {"intent": intent, "params": params, "source": source}
        )

    def query_state(self, selector: str | dict):
        from services import device_translator
        devs = device_translator.expand_selector(selector)
        if not devs:
            return {"ok": False, "message": f"No devices match selector: {selector!r}"}
        if len(devs) == 1:
            out = device_translator.query_state(devs[0].id)
            out["device"] = devs[0].for_brain()
            return out
        results = []
        for d in devs:
            entry = device_translator.query_state(d.id)
            entry["device"] = d.for_brain()
            results.append(entry)
        return results

    def list_devices(self, filter: dict | None = None) -> list[dict]:
        from services import device_translator
        f = filter or {}
        devs = device_translator.list_devices(
            device_type=f.get("device_type") or f.get("type"),
            room=f.get("room"),
        )
        return [d.for_brain() for d in devs]


class InProcessBrain:
    """Default brain: routes ask() through the existing LLM gateway.

    Swap this for a network-RPC client when the brain runs remote — the
    public method signatures stay the same.
    """

    async def ask(
        self,
        prompt: str,
        context: dict | None = None,
        *,
        purpose: str = "chat",
        fallback: Callable[[str, dict], str] | None = None,
    ) -> dict:
        ctx = context or {}
        try:
            from integrations.llm_gateway import chat_completion
            messages = [{"role": "user", "content": prompt}]
            resp = chat_completion(purpose, messages)
            answer = (resp.choices[0].message.content or "").strip()
            return {"ok": True, "answer": answer, "from_fallback": False}
        except Exception as e:
            # Brain unreachable / gated. Fall back if the caller provided one.
            if fallback is not None:
                try:
                    fb_answer = fallback(prompt, ctx)
                    return {"ok": True, "answer": fb_answer, "from_fallback": True}
                except Exception as fb_err:
                    return {"ok": False, "error": f"brain={e!s}; fallback={fb_err!s}"}
            return {"ok": False, "error": str(e)}


# ── Process-wide singletons ─────────────────────────────────────────────────
#
# Brain-side code that needs to reach the edge does:
#     from core.brain_edge_contract import edge
#     await edge.execute_intent(intent, params)
#
# Edge-side code that needs to ask the brain does:
#     from core.brain_edge_contract import brain
#     await brain.ask(prompt, context, fallback=...)
#
# In a future cloud-deploy step, these singletons are reassigned to remote
# RPC clients before any consumer imports them. The consumers don't change.

edge: EdgeContract = InProcessEdge()
brain: BrainContract = InProcessBrain()


# ── Helpers / introspection ─────────────────────────────────────────────────

def install_edge(impl: EdgeContract) -> None:
    """Replace the process-wide edge implementation. Used by tests and,
    eventually, by the cloud-mode bootstrap that wires in a remote client."""
    global edge
    edge = impl


def install_brain(impl: BrainContract) -> None:
    """Replace the process-wide brain implementation. Same uses as above."""
    global brain
    brain = impl
