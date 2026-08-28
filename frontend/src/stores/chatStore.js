import { create } from 'zustand'

// Chat state. `messages` + addMessage/clearMessages keep the original ephemeral API
// (used everywhere in AIChat). The thread fields make a conversation a durable,
// resumable, background-running server object — for ALL chats, not just the fixer.
export const useChatStore = create((set) => ({
  messages: [],
  threadId: null,          // active durable thread (null → legacy ephemeral mode)
  threads: [],             // list for the switcher: [{thread_id,title,status,updated_at,preview}]
  status: 'idle',          // active thread: idle | running | error

  addMessage: (role, text, ok = true, extras = {}) =>
    set((s) => ({
      messages: [...s.messages, { id: Date.now() + Math.random(), role, text, ok, ts: new Date(), ...extras }],
    })),
  clearMessages: () => set({ messages: [] }),

  setThreadId: (threadId) => set({ threadId }),
  setThreads: (threads) => set({ threads }),
  setStatus: (status) => set({ status }),

  // Replace the visible message list from a server thread payload (thread.messages),
  // mapping the server shape {role, content, data, ts} → the UI shape {role, text, data}.
  loadThreadMessages: (serverMessages) =>
    set({
      messages: (serverMessages || []).map((m) => ({
        id: Date.now() + Math.random(),
        role: m.role,
        text: m.content,
        ok: true,
        ts: m.ts ? new Date(m.ts * 1000) : new Date(),
        ...(m.data ? { data: m.data } : {}),
      })),
    }),
}))
