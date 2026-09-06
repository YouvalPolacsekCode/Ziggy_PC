"""v3 agent runner — the single brain.

run_agent(text, chat_history, channel, actor, mode) →
    {"message": str, "ok": bool, "data": {"spoken": str, ...}}

One model call with the home in context (device directory, rooms, automations,
recent changes, memory — core/agent/context.py) and Ziggy's character
(core/agent/persona.py). If the model calls tools, execute them (de-duplicated
within the turn), then either:
  - fast path (1 round-trip): every call is a successful device action with no
    narration → deterministic native confirmation, or
  - narrate: feed tool results back so the model phrases the answer.

Two output contracts: the chat reply may converse; `data.spoken` is the short
rendering the speaker reads. On the voice channel the reply IS the spoken
text. Device actions run through the existing tested services; the LLM never
free-hands hardware.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from core.logger_module import log_error, log_info
from core.debug_bus import bus, BASIC, VERBOSE
from integrations.llm_gateway import chat_completion
from integrations.openai_client import CloudLLMUnavailable, require_cloud_llm_active
from core.intent_utils import ok, err
from core.agent import directory as _dir
from core.agent import tools as _tools
from core.agent import context as _ctx
from core.agent import persona as _persona
from core.agent.output import render_device_confirmation, sanitize_reply, spoken_summary

# A real conversation can need several tool rounds (diagnose → fix → verify).
_MAX_ITERS = 6

try:  # agent-first sync (core/actions); the runner must work without it in tests
    from core.actions.registry import announce as _announce, CARD_KINDS as _CARD_KINDS
except Exception:  # pragma: no cover
    _CARD_KINDS = frozenset()

    async def _announce(*a, **k):
        return None
# Output budgets per channel. Chat may explain; voice is read aloud.
_MAX_TOKENS = {"chat": 900, "voice": 320}


def _is_hebrew(text: str) -> bool:
    return any("֐" <= c <= "׿" for c in (text or ""))


def _canonical(name: str, args: dict) -> str:
    try:
        return name + ":" + json.dumps(args, sort_keys=True, ensure_ascii=False)
    except Exception:
        return name + ":" + str(args)


def _assistant_echo(msg: Any) -> dict:
    """Rebuild the assistant message (with tool_calls) to append to history."""
    tcs = []
    for tc in msg.tool_calls or []:
        tcs.append({
            "id": tc.id,
            "type": "function",
            "function": {"name": tc.function.name, "arguments": tc.function.arguments or "{}"},
        })
    return {"role": "assistant", "content": msg.content or None, "tool_calls": tcs}


def _slim_result(result: dict) -> dict:
    """What we feed back to the model as the tool result (drop bulky bundle)."""
    out = {k: v for k, v in result.items() if k not in ("bundle",)}
    if result.get("bundle"):
        b = result["bundle"]
        arts = (b.get("artifacts") or {})
        out["bundle_summary"] = {
            "name": b.get("name"), "rationale": b.get("rationale"),
            "decline": b.get("decline"),
            "counts": {k: len(v) for k, v in arts.items() if isinstance(v, list)},
        }
    return out


def _build_system_prompt(directory: dict, lang: str, *, channel: str = "chat",
                         mode: Optional[str] = None) -> str:
    ctx = _ctx.build_context(directory, lang=lang, channel=channel, mode=mode)
    return _persona.build_system_prompt(ctx)


async def run_agent(text: str, chat_history: Optional[list[dict]] = None,
                    *, channel: str = "chat", actor: Optional[str] = None,
                    mode: Optional[str] = None) -> dict:
    """One agent turn.

    ``actor`` is the authenticated caller's principal ref ("person:<username>")
    — passed to the tools so a remediation is authorized against the human it's
    being done for, never above them. None (voice/kiosk with no identity) means
    the agent's own envelope applies. ``mode`` is "diagnostic" or None.
    """
    text = (text or "").strip()
    if not text:
        return ok("")

    try:
        require_cloud_llm_active()
    except CloudLLMUnavailable as gate_err:
        return err(str(gate_err), details="cloud_llm_gated")

    lang = "he" if _is_hebrew(text) else "en"
    channel = "voice" if channel == "voice" else "chat"

    try:
        directory = await _dir.build_directory()
    except Exception as e:
        log_error(f"[agent] directory build failed: {e}")
        directory = {"devices": [], "presence": [], "by_room": {}}

    system_prompt = _build_system_prompt(directory, lang, channel=channel, mode=mode)
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    history = chat_history or []
    messages.extend(history)
    if not history or (history[-1].get("role") != "user") or (history[-1].get("content") != text):
        messages.append({"role": "user", "content": text})

    bus.emit("intent", BASIC, "agent_turn_start", input=text, channel=channel,
             lang=lang, mode=mode, devices=len(directory.get("devices") or []))

    data: dict = {}
    reply = ""
    result_cache: dict[str, dict] = {}

    try:
        for iteration in range(_MAX_ITERS):
            resp = chat_completion(
                "chat", messages,
                tools=_tools.TOOL_SCHEMAS, tool_choice="auto",
                temperature=0.4, max_tokens=_MAX_TOKENS[channel],
            )
            msg = resp.choices[0].message

            if not msg.tool_calls:
                reply = (msg.content or "").strip()
                break

            messages.append(_assistant_echo(msg))

            iter_results: list[tuple[str, dict]] = []
            for tc in msg.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except Exception:
                    args = {}
                key = _canonical(name, args)
                if key in result_cache:
                    result = result_cache[key]
                else:
                    result = await _tools.execute_tool(name, args, directory,
                                                       lang=lang, actor=actor)
                    result_cache[key] = result
                iter_results.append((name, result))
                messages.append({
                    "role": "tool", "tool_call_id": tc.id,
                    "content": json.dumps(_slim_result(result), ensure_ascii=False),
                })

            bus.emit("intent", VERBOSE, "agent_tools_executed",
                     tools=[n for n, _ in iter_results],
                     ok=[bool(r.get("ok")) for _, r in iter_results])

            # Agent → app sync: every tool the agent ran is announced exactly
            # like an app action, so open screens react (agent-first §2).
            # A renderable tool result becomes the turn's chat card (§3).
            for tc, (n, r) in zip(msg.tool_calls, iter_results):
                try:
                    args_for_card = json.loads(tc.function.arguments or "{}")
                except Exception:
                    args_for_card = {}
                await _announce(n, args_for_card, r, actor=actor)
                rd = r.get("data") if isinstance(r.get("data"), dict) else None
                if rd and rd.get("kind") in _CARD_KINDS:
                    card = dict(rd)
                    if "entity_id" in args_for_card and "entity_id" not in card:
                        card["entity_id"] = args_for_card["entity_id"]
                    data["card"] = card

            # Pro Mode bundle preview: if a tool returned the v1 preview-card
            # envelope, surface it verbatim so the app renders BundlePreviewCard
            # (accept/edit/undo). Skip the next model turn — the card replaces
            # the text bubble anyway.
            preview_res = next(
                (r for _, r in iter_results
                 if (r.get("data") or {}).get("kind") == "automation_bundle_preview"
                 and (r.get("data") or {}).get("bundle")),
                None,
            )
            if preview_res is not None:
                data = {
                    "kind": "automation_bundle_preview",
                    "bundle": preview_res["data"]["bundle"],
                }
                reply = (preview_res.get("message") or "").strip() or (
                    "עיצבתי לך את החדר החכם — אפשר לעבור ולאשר." if lang == "he"
                    else "Here's the smart room I designed — review and accept.")
                break

            # Fast path: first turn, no narration, every call a successful device
            # action → deterministic native confirmation, skip the 2nd round-trip.
            if (iteration == 0 and not (msg.content or "").strip()
                    and iter_results
                    and all(n == "control_device" and r.get("ok") and not r.get("rehearsal")
                            for n, r in iter_results)):
                uniq: list[dict] = []
                seen: set = set()
                for _, r in iter_results:
                    eid = (r.get("device") or {}).get("entity_id")
                    if eid in seen:
                        continue
                    seen.add(eid)
                    uniq.append(r)
                conf = render_device_confirmation(uniq, lang)
                if conf:
                    reply = conf
                    break
            # otherwise loop → next model call narrates from tool results
        else:
            reply = reply or ("סיימתי." if lang == "he" else "Done.")
    except Exception as e:
        log_error(f"[agent] run failed: {e}")
        return err("משהו השתבש אצלי רגע — אפשר לנסות שוב." if lang == "he"
                   else "Something went wrong on my side — try again.", details=str(e))

    reply = sanitize_reply(reply, channel=channel)
    if not reply:
        reply = "סיימתי." if lang == "he" else "Done."

    # Voice contract: the reply is what gets spoken. Chat contract: derive the
    # short spoken rendering so the app can read it aloud without a 2nd call.
    data["spoken"] = reply if channel == "voice" else spoken_summary(reply, lang)

    bus.emit("intent", BASIC, "agent_turn_done", reply=reply,
             has_preview=bool(data.get("bundle")))

    out = ok(reply)
    out["data"] = data
    return out
