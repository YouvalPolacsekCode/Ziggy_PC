import { create } from 'zustand'
import {
  getSuggestions, acceptSuggestion, rejectSuggestion,
  snoozeSuggestion, runPatternAnalysis,
} from '../lib/api'

export const useSuggestionStore = create((set, get) => ({
  suggestions: [],
  loading: false,
  analyzing: false,

  fetch: async () => {
    set({ loading: true })
    try {
      const data = await getSuggestions()
      set({ suggestions: data.suggestions || [], loading: false })
    } catch {
      set({ loading: false })
    }
  },

  // Populate the habit-suggestion slice from a unified-feed response.
  // The unified feed returns the original habit suggestion under each
  // item's `raw` field, so we restore the persisted shape verbatim.
  // Callers should pass the full items array; non-habit items are ignored.
  setFromFeed: (items) => {
    const habits = (items || [])
      .filter((it) => it && it.source === 'habit')
      .map((it) => it.raw || it)
    set({ suggestions: habits })
  },

  accept: async (id) => {
    await acceptSuggestion(id)
    await get().fetch()
  },

  reject: async (id) => {
    await rejectSuggestion(id)
    await get().fetch()
  },

  snooze: async (id, days = 3) => {
    await snoozeSuggestion(id, days)
    await get().fetch()
  },

  runAnalysis: async () => {
    set({ analyzing: true })
    try {
      const result = await runPatternAnalysis()
      await get().fetch()
      return result
    } finally {
      set({ analyzing: false })
    }
  },

  // Derived helpers
  pending: () => get().suggestions.filter((s) => s.status === 'pending'),
  accepted: () => get().suggestions.filter((s) => s.status === 'accepted'),
  rejected: () => get().suggestions.filter((s) => s.status === 'rejected'),
  snoozed: () => get().suggestions.filter((s) => s.status === 'snoozed'),
  pendingCount: () => get().suggestions.filter((s) => s.status === 'pending').length,
}))
