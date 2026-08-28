import { useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { createThread, listThreads, getThread } from '../lib/api'
import { useWsMessages } from './useWebSocket'
import { applyThreadTitle } from '../lib/threadTitles'

const LS_KEY = 'ziggy_active_thread'

/**
 * Durable, resumable chat threads for the whole app.
 *
 * A conversation is a server-side object now, so it survives page reload / navigation
 * and can be returned to. This hook owns the thread lifecycle; the page keeps its own
 * rich send/render path and just passes threadId to sendChat (the reply is persisted
 * server-side + returned synchronously, so rendering is unchanged).
 *
 *  - on mount: restore (or create) the active thread and load its messages + the list;
 *  - newThread(): start a fresh conversation;
 *  - switchThread(id): return to any conversation (loads its messages).
 *
 * A turn that was still running when you left completes server-side (shielded task) and
 * is on the thread when you come back — so re-opening the thread shows the reply.
 */
export function useChatThreads() {
  const {
    threadId, threads, setThreadId, setThreads, setStatus, loadThreadMessages,
  } = useChatStore()

  const refreshList = async () => {
    try { setThreads((await listThreads()).threads || []) } catch { /* best-effort */ }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let tid = localStorage.getItem(LS_KEY)
        if (!tid) {
          tid = (await createThread()).thread_id
          localStorage.setItem(LS_KEY, tid)
        }
        if (cancelled) return
        setThreadId(tid)
        try {
          const th = await getThread(tid)
          loadThreadMessages(th.messages)
          setStatus(th.status)
        } catch { /* new/empty thread */ }
        refreshList()
      } catch { /* offline — legacy ephemeral chat still works */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The hub names a thread from its first exchange, a second or two after the
  // reply lands. Rename the row in place when that push arrives — otherwise the
  // drawer shows "New chat" until it's closed and reopened.
  // Same seq-cursor pattern as the wall's live-reload: a burst is handled in
  // full, and nothing is replayed across renders.
  const wsMessages = useWsMessages()
  const lastSeq = useRef(0)
  useEffect(() => {
    const titled = []
    for (const m of wsMessages || []) {
      if (m?._seq != null && m._seq <= lastSeq.current) continue
      if (m?._seq != null) lastSeq.current = Math.max(lastSeq.current, m._seq)
      if (m?.type === 'thread_titled' && m.thread_id && m.title) titled.push(m)
    }
    if (!titled.length) return
    useChatStore.setState((s) => ({
      threads: titled.reduce(
        (acc, m) => applyThreadTitle(acc, m.thread_id, m.title), s.threads),
    }))
  }, [wsMessages])

  const newThread = async () => {
    const tid = (await createThread()).thread_id
    localStorage.setItem(LS_KEY, tid)
    setThreadId(tid)
    loadThreadMessages([])
    setStatus('idle')
    refreshList()
  }

  const switchThread = async (tid) => {
    localStorage.setItem(LS_KEY, tid)
    setThreadId(tid)
    try {
      const th = await getThread(tid)
      loadThreadMessages(th.messages)
      setStatus(th.status)
    } catch { loadThreadMessages([]) }
  }

  return { threadId, threads, newThread, switchThread, refreshList }
}
