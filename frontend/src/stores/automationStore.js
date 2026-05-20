import { create } from 'zustand'
import {
  getAutomations, getAutomation, createAutomation, toggleAutomation,
  triggerAutomation, deleteAutomation,
  getRoutines, getRoutine, createRoutine, runRoutine, deleteRoutine,
} from '../lib/api'

export const useAutomationStore = create((set, get) => ({
  automations: [],
  routines: [],
  loading: false,
  error: null,

  fetchAutomations: async () => {
    set({ loading: true, error: null })
    try {
      const res = await getAutomations()
      set({ automations: res.automations || [], loading: false })
    } catch (e) {
      set({ loading: false, error: e.message })
    }
  },

  addAutomation: async (data) => {
    const res = await createAutomation({
      ...data,
      rooms: data.rooms || [],
    })
    const automation = res.automation
    set((s) => {
      const idx = s.automations.findIndex((a) => a.id === automation.id)
      if (idx >= 0) {
        const updated = [...s.automations]
        updated[idx] = automation
        return { automations: updated }
      }
      return { automations: [...s.automations, automation] }
    })
    return automation
  },

  // No dedicated update endpoint — saving with the original id re-creates in
  // place (the backend slugifies-on-create, so reusing the same id keeps the
  // record identifiable instead of producing a duplicate with a fresh slug).
  updateAutomation: async (id, data) => {
    const res = await createAutomation({ ...data, id })
    const automation = res.automation
    set((s) => ({
      automations: s.automations.map((a) => (a.id === id ? automation : a)),
    }))
    return automation
  },

  removeAutomation: async (id) => {
    await deleteAutomation(id)
    set((s) => ({ automations: s.automations.filter((a) => a.id !== id) }))
  },

  toggleAutomation: async (id) => {
    const current = get().automations.find((a) => a.id === id)
    if (!current) return
    const newEnabled = !current.enabled
    await toggleAutomation(id, newEnabled)
    set((s) => ({
      automations: s.automations.map((a) => (a.id === id ? { ...a, enabled: newEnabled } : a)),
    }))
  },

  triggerAutomation: async (id) => {
    await triggerAutomation(id)
  },

  // Load full config for editing
  loadAutomationConfig: async (id) => {
    return await getAutomation(id)
  },

  fetchRoutines: async () => {
    set({ loading: true, error: null })
    try {
      const res = await getRoutines()
      set({ routines: res.routines || [], loading: false })
    } catch (e) {
      set({ loading: false, error: e.message })
    }
  },

  addRoutine: async (data) => {
    const res = await createRoutine(data)
    const routine = res.routine
    set((s) => ({ routines: [...s.routines, routine] }))
    return routine
  },

  toggleRoutine: (id) => {
    set((s) => ({
      routines: s.routines.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r),
    }))
  },

  removeRoutine: async (id) => {
    await deleteRoutine(id)
    set((s) => ({ routines: s.routines.filter((r) => r.id !== id) }))
  },

  runRoutine: async (id) => {
    await runRoutine(id)
  },

  // Load full config for editing
  loadRoutineConfig: async (id) => {
    return await getRoutine(id)
  },
}))
