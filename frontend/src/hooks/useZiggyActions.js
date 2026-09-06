import { useEffect, useRef } from 'react'
import { useWsMessages } from './useWebSocket'

/**
 * Agent → app sync. After ANY action runs on the hub (chat agent, voice, the
 * app itself, an external assistant over /mcp) the hub broadcasts
 *   { type: 'ziggy_action', name, args, ok, kind, actor, source, ts }
 * This hook hands each new one to `onAction(evt)` exactly once.
 *
 * Same seq-cursor pattern as useChatThreads: a burst is handled in full and
 * nothing is replayed across renders. Messages without `_seq` are treated as
 * new (dev/mocked sockets) — the cursor never blocks them.
 *
 * `names` (optional) narrows to a set of action names.
 */
export function useZiggyActions(onAction, names = null) {
  const wsMessages = useWsMessages()
  const lastSeq = useRef(0)
  const cb = useRef(onAction)
  cb.current = onAction
  const wanted = names ? new Set(names) : null

  useEffect(() => {
    for (const m of wsMessages || []) {
      if (m?._seq != null && m._seq <= lastSeq.current) continue
      if (m?._seq != null) lastSeq.current = Math.max(lastSeq.current, m._seq)
      if (m?.type !== 'ziggy_action' || !m.name) continue
      if (wanted && !wanted.has(m.name)) continue
      try { cb.current?.(m) } catch { /* a bad handler must not break the socket loop */ }
    }
    // `wanted` is derived from `names` each render; keying on wsMessages is
    // what matters — a new names array does not need to re-scan old messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsMessages])
}

// Actions that change the automations list. Pages that show it refetch on these.
export const AUTOMATION_ACTIONS = [
  'toggle_automation', 'delete_automation', 'create_automation',
  'design_smart_room', 'design_automation',
]
