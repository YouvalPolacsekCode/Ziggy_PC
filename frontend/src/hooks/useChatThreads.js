import { useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useWsMessages } from './useWebSocket'
import {
  createThread, listThreads, getThread, sendChat as apiSendChat,
} from '../lib/api'

const LS_KEY = 'ziggy_active_thread'

/**
 * Durable, resumable, background-running chat threads for the whole app.
 *
 * Encapsulates the thread lifecycle so a page (AIChat) adopts it with one call:
 *  - on mount: restore (or create) the active thread and load its messages + the list;
 *  - send(text): append the user turn locally, POST with thread_id — the reply runs
 *    server-side in the BACKGROUND and arrives over WS (thread_message), so leaving the
 *    page or switching threads never loses it;
 *  - consumes WS thread_message / thread_status for the active thread to render the reply
 *    and reflect running/idle status;
 *  - newThread() / switchThread(id) to start or return to a conversation.
 */
export function useChatThreads() {
  const {
    threadId, setThreadId, setThreads, setStatus, loadThreadMessages, addMessage,
  } = useChatStore()
  const wsMessages = useWsMessages()
  const lastSeq = useRef(0)

  const refreshList = async () => {
    try { setThreads((await listThreads()).threads || []) } catch { /* best-effort */ }
  }

  // Restore or create the active thread on mount.
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
      } catch { /* offline — legacy ephemeral still works */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Consume WS thread events for the ACTIVE thread → render reply + status.
  useEffect(() => {
    const fresh = (wsMessages || []).filter((m) => (m?._seq ?? 0) > lastSeq.current)
    if (fresh.length) lastSeq.current = fresh[fresh.length - 1]._seq ?? lastSeq.current
    for (const m of fresh) {
      if (m?.thread_id !== threadId) continue
      if (m.type === 'thread_status') setStatus(m.status)
      if (m.type === 'thread_message') {
        setStatus(m.status || 'idle')
        const msg = m.message || {}
        if (msg.role === 'assistant') {
          addMessage('assistant', msg.content || '…', true, msg.data ? { data: msg.data } : {})
          refreshList()
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsMessages, threadId])

  const send = async (text) => {
    if (!threadId || !text?.trim()) return
    addMessage('user', text)
    setStatus('running')
    try { await apiSendChat(text, [], 'web', threadId) }
    catch { setStatus('error') }
  }

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

  return { threadId, send, newThread, switchThread }
}
