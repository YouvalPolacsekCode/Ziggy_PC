import { create } from 'zustand'

// In-context navigation: tapping an object inside a chat card opens that
// object's real page while the conversation stays at hand. On wide screens
// the chat re-renders as a side dock beside the page (AppShell); on phones
// it collapses to a floating bubble that reopens as a bottom sheet
// (components/chat/ChatBubble + ChatSheet). One breakpoint decides both —
// 1024px, deliberately wider than the Sidebar's `md` (768px): sidebar (196px)
// + dock (400px) leave nothing usable for the page at 768.
export const CHAT_DOCK_MIN_WIDTH = 1024
export const CHAT_DOCK_QUERY = `(min-width: ${CHAT_DOCK_MIN_WIDTH}px)`

export function isWideForChatDock() {
  try {
    if (typeof window === 'undefined') return false
    if (window.matchMedia) return window.matchMedia(CHAT_DOCK_QUERY).matches
    return window.innerWidth >= CHAT_DOCK_MIN_WIDTH
  } catch { return false }
}

// Chat state. `messages` + addMessage/clearMessages keep the original ephemeral API
// (used everywhere in AIChat). The thread fields make a conversation a durable,
// resumable, background-running server object — for ALL chats, not just the fixer.
export const useChatStore = create((set) => ({
  messages: [],
  threadId: null,          // active durable thread (null → legacy ephemeral mode)
  threads: [],             // list for the switcher: [{thread_id,title,status,updated_at,preview}]
  status: 'idle',          // active thread: idle | running | error
  mode: null,              // 'diagnostic' | null — per-thread; the server owns it, we mirror it
  chatDock: false,         // wide screens: keep the chat open as a side column beside the page
  setChatDock: (chatDock) => set({ chatDock: !!chatDock }),
  // Phones: the chat as a bottom sheet over the current page. Opening it is
  // reading it, so the unread count resets in the same write.
  chatSheet: false,
  setChatSheet: (chatSheet) => set(chatSheet ? { chatSheet: true, chatUnread: 0 } : { chatSheet: false }),
  // Replies (ziggy_response pushes) that landed while no chat surface was
  // showing — shown as the bubble's badge. Counted by ChatBubble.
  chatUnread: 0,
  bumpChatUnread: (n = 1) => set((s) => ({ chatUnread: s.chatUnread + Math.max(0, n | 0) })),
  clearChatUnread: () => set({ chatUnread: 0 }),

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
