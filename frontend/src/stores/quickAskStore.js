import { create } from 'zustand'
import { getQuickAsks, createQuickAsk, updateQuickAsk, deleteQuickAsk } from '../lib/api'

export const useQuickAskStore = create((set, get) => ({
  items: [],
  loading: false,

  fetch: async () => {
    set({ loading: true })
    try {
      const items = await getQuickAsks()
      set({ items: Array.isArray(items) ? items : [], loading: false })
    } catch {
      set({ loading: false })
    }
  },

  create: async (data) => {
    const item = await createQuickAsk(data)
    set((s) => ({ items: [...s.items, item] }))
    return item
  },

  update: async (id, data) => {
    const updated = await updateQuickAsk(id, data)
    set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)) }))
    return updated
  },

  remove: async (id) => {
    await deleteQuickAsk(id)
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
  },
}))
