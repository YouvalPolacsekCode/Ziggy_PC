import { create } from 'zustand'

export const useChatStore = create((set) => ({
  messages: [],
  addMessage: (role, text) =>
    set((s) => ({
      messages: [...s.messages, { id: Date.now() + Math.random(), role, text, ts: new Date() }],
    })),
  clearMessages: () => set({ messages: [] }),
}))
