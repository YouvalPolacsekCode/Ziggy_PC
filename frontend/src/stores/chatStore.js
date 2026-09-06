import { create } from 'zustand'

// Chat state. `messages` + addMessage/clearMessages keep the original ephemeral API
// (used everywhere in AIChat). The thread fields make a conversation a durable,
// resumable, background-running server object — for ALL chats, not just the fixer.
export const useChatStore = create((set) => ({
  messages: [],
  threadId: null,          // active durable thread (null → legacy ephemeral mode)
  threads: [],             // list for the switcher: [{thread_id,title,status,updated_at,preview}]
  status: 'idle',          // active thread: idle | running | error
  mode: null,              // 'diagnostic' | null — per-thread; the server owns it, we mirror it

  addMessage: (role, text, ok = true, extras = {}) =>
    set((s) => ({
      messages: [...s.messages, { id: Date.now() + Math.random(), role, text, ok, ts: new Date(), ...extras }],
    })),
  clearMessages: () => set({ messages: [] }),

  setThreadId: (threadId) => set({ threadId }),
  setThreads: (threads) => set({ threads }),
  setStatus: (status) => set({ status }),
  // Mirrors the thread's mode. Persisted per thread in localStorage so a reload
  // shows the right badge before (or without) the server round-trip; the
  // server's value wins whenever a thread is (re)loaded.
  setMode: (mode, threadId = null) => {
    const m = mode === 'diagnostic' ? 'diagnostic' : null
    if (threadId) {
      try {
        if (m) localStorage.setItem(`ziggy_chat_mode:${threadId}`, m)
        else localStorage.removeItem(`ziggy_chat_mode:${threadId}`)
      } catch { /* private window / storage blocked — store still updates */ }
    }
    set({ mode: m })
  },

  // Replace the visible message list from a server thread payload (thread.messages),
  // mapping the server shape {role, content, data, ts} → the UI shape {role, text, data}.
  // `data.card` (an embedded tool-result card) is lifted to `card` so it renders
  // exactly as it did when the reply first arrived — cards survive reload.
  loadThreadMessages: (serverMessages) =>
    set({
      messages: (serverMessages || []).map((m) => {
        const card = m.role !== 'user' && m.data?.card && typeof m.data.card === 'object' && m.data.card.kind
          ? m.data.card : null
        return {
          id: Date.now() + Math.random(),
          role: m.role,
          text: m.content,
          ok: true,
          ts: m.ts ? new Date(m.ts * 1000) : new Date(),
          ...(m.data ? { data: m.data } : {}),
          ...(card ? { card } : {}),
        }
      }),
    }),
}))
