"""v2 agent runner — the single brain.

run_agent(text, chat_history, channel) →
    {"reply": str, "ok": bool, "data": dict, "meta": {...}}

One model call with the HA-truth directory in context. If the model calls
tools, execute them (de-duplicated), then either:
  - fast path (1 round-trip): all calls are successful device actions with no
    model narration → deterministic terse confirmation, or
  - narrate (2nd round-trip): feed tool results back so the model phrases the
    answer (queries, web search, automation preview, ambiguity, errors).

Device actions run through the existing tested services; the LLM never
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
from core.agent.output import render_device_confirmation, sanitize_reply

_MAX_ITERS = 3


def _is_hebrew(text: str) -> bool:
    return any("֐" <= c <= "׿" for c in (text or ""))


def _persons_and_mode() -> tuple[list[dict], str]:
    persons: list[dict] = []
    mode = "home"
    try:
        from services.presence_engine import list_persons
        for p in list_persons():
            persons.append({"name": p.get("name") or p.get("username") or p.get("id"),
                            "state": p.get("effective_state") or "unknown"})
    except Exception:
        pass
    try:
        from services.mode_service import _load as _mode_load, DEFAULT_MODE
        mode = str((_mode_load() or {}).get("mode") or DEFAULT_MODE)
    except Exception:
        pass
    return persons, mode


def _build_system_prompt(directory: dict, lang: str) -> str:
    persons, mode = _persons_and_mode()
    who = ", ".join(f"{p['name']}={p['state']}" for p in persons) or "unknown"
    dir_text = _dir.format_directory_for_prompt(directory)

    lang_rule = (
        "ALWAYS reply in Hebrew. Speak like a real Israeli — warm, short, dugri, "
        "בגובה העיניים. Never literary/translated Hebrew. "
        "Refer to a device by its natural Hebrew noun + room, NOT its English "
        "name and NEVER its id: say 'המנורה בסלון', 'המזגן בחדר שינה' — never "
        "'Living Room Lamp', never 'living room', never an id. "
        "Ziggy speaks about himself in masculine 1st person (כיביתי, בדקתי, עדיין "
        "לא יודע). Address the user GENDER-FREE by construction — never guess a "
        "gender: say 'אפשר לנסח שוב?' not 'תוכל/תוכלי', 'רוצה שאמשיך?' not "
        "'אתה/את רוצה'. 24h clock, °C, ₪."
        if lang == "he" else
        "Reply in English. Refer to devices by their real name; never show an id."
    )

    return (
        "You are Ziggy, the smart-home assistant. You are ONE agent that handles "
        "everything the user says: commands, questions, presence/state, and "
        "automations.\n\n"
        f"{lang_rule}\n\n"
        "OUTPUT SHAPE: one short sentence for actions and simple answers "
        "(voice reads your reply aloud). Plain prose only — no markdown, bullets, "
        "symbols, emoji, or lists. Answer and STOP — NEVER append a filler tail "
        "like 'anything else?', 'happy to help', 'משהו נוסף?', 'יש עוד משהו "
        "לעזור?', 'אשמח לעזור', 'אני כאן'.\n\n"
        "HOW YOU ACT:\n"
        "- To control a device, call control_device with the EXACT id from the "
        "directory below. Resolve the user's words ('the lamp in the living "
        "room', 'המנורה בסלון') to the right device yourself by matching its name "
        "and room.\n"
        "- If two or more devices genuinely match and you can't tell which, DO "
        "NOT guess — ask ONE short question naming the options. When the user "
        "then clarifies (including 'no, the X' corrections), re-resolve using the "
        "conversation and act.\n"
        "- 'is anyone in <room>' → room_occupancy. 'what's on' / 'is X on' → "
        "query_devices. Temperature → get_temperature.\n"
        "- An OUTCOME ('make the bedroom smart', 'תעשה אוטומציה לסלון') → "
        "design_automation. An explicit single trigger+action ('turn off the "
        "bedroom light at 23:00') → create_automation.\n"
        "- A device tagged [IR] in the directory has no id you can pass to "
        "control_device — use the ir_* tools instead (ir_send_command for TV/AC "
        "power/mode, ir_set_ac_temperature for AC temperature, ir_send_channel "
        "for TV channels), giving device_type + room.\n"
        "- A live-data question (weather/news/prices/scores) → web_search.\n"
        "- Gibberish / a lone symbol / impossible request → one short reply "
        "asking to rephrase or declining. NEVER invent a question, NEVER greet "
        "unless greeted, NEVER list your capabilities, NEVER echo a user-style "
        "question back.\n"
        "- Never mention Home Assistant, entities, integrations, or any id.\n\n"
        f"HOUSE: mode={mode}; people: {who}.\n\n"
        "DEVICE DIRECTORY (real names + rooms + current state; ids are for your "
        "tool calls only, never shown to the user):\n"
        f"{dir_text}\n"
    )


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


async def run_agent(text: str, chat_history: Optional[list[dict]] = None,
                    *, channel: str = "chat") -> dict:
    text = (text or "").strip()
    if not text:
        return ok("")

    try:
        require_cloud_llm_active()
    except CloudLLMUnavailable as gate_err:
        return err(str(gate_err), details="cloud_llm_gated")

    lang = "he" if _is_hebrew(text) else "en"

    try:
        directory = await _dir.build_directory()
    except Exception as e:
        log_error(f"[agent] directory build failed: {e}")
        directory = {"devices": [], "presence": [], "by_room": {}}

    system_prompt = _build_system_prompt(directory, lang)
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    history = chat_history or []
    messages.extend(history)
    if not history or (history[-1].get("role") != "user") or (history[-1].get("content") != text):
        messages.append({"role": "user", "content": text})

    bus.emit("intent", BASIC, "agent_turn_start", input=text, channel=channel,
             lang=lang, devices=len(directory.get("devices") or []))

    data: dict = {}
    reply = ""
    result_cache: dict[str, dict] = {}

    try:
        for iteration in range(_MAX_ITERS):
            resp = chat_completion(
                "chat", messages,
                tools=_tools.TOOL_SCHEMAS, tool_choice="auto",
                temperature=0.3, max_tokens=500,
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
                    result = await _tools.execute_tool(name, args, directory)
                    result_cache[key] = result
                iter_results.append((name, result))
                messages.append({
                    "role": "tool", "tool_call_id": tc.id,
                    "content": json.dumps(_slim_result(result), ensure_ascii=False),
                })

            bus.emit("intent", VERBOSE, "agent_tools_executed",
                     tools=[n for n, _ in iter_results],
                     ok=[bool(r.get("ok")) for _, r in iter_results])

            # Pro Mode bundle preview: if a tool returned the v1 preview-card
            # envelope, surface it verbatim so the app renders BundlePreviewCard
            # (accept/edit/undo). Skip the 2nd model turn — the card replaces the
            # text bubble anyway. This is what makes "build me a smart room" work
            # in chat.
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
                    "עיצבתי לך את החדר החכם — סקור ואשר." if lang == "he"
                    else "Here's the smart room I designed — review and accept.")
                break

            # Fast path: first turn, no narration, every call a successful device
            # action → deterministic terse confirmation, skip 2nd round-trip.
            if (iteration == 0 and not (msg.content or "").strip()
                    and iter_results
                    and all(n == "control_device" and r.get("ok") for n, r in iter_results)):
                # de-dup the results for phrasing (unique devices)
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
            # ran out of iterations without a plain-content answer
            reply = reply or ("סיימתי." if lang == "he" else "Done.")
    except Exception as e:
        log_error(f"[agent] run failed: {e}")
        return err("GPT error while chatting.", details=str(e))

    reply = sanitize_reply(reply, channel=channel)
    if not reply:
        reply = "סיימתי." if lang == "he" else "Done."

    bus.emit("intent", BASIC, "agent_turn_done", reply=reply,
             has_preview=bool(data.get("preview")))

    out = ok(reply)
    if data:
        out["data"] = data
    return out
