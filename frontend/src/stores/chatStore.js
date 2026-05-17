import { create } from 'zustand'

export const useChatStore = create((set) => ({
  messages: [],
  addMessage: (role, text, ok = true) =>
    set((s) => ({
      messages: [...s.messages, { id: Date.now() + Math.random(), role, text, ok, ts: new Date() }],
    })),
  clearMessages: () => set({ messages: [] }),
}))
