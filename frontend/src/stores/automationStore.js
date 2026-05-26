import { create } from 'zustand'
import logger from '../lib/logger'
import {
  getAutomations, getAutomation, createAutomation, toggleAutomation,
  triggerAutomation, deleteAutomation,
  getRoutines, getRoutine, createRoutine, runRoutine, deleteRoutine,
} from '../lib/api'

// Lazy-imported to avoid circular dependency with deviceStore (which itself
// lazy-imports uiStore). Used to GC pinned shortcuts when a routine is
// deleted so the user doesn't hit the 8-pin cap with stale entries.
const _pruneShortcut = async (type, id) => {
  try {
    const { useDeviceStore } = await import('./deviceStore.js')
    const current = useDeviceStore.getState().pinnedShortcuts || []
    const next = current.filter(s => !(s.type === type && s.id === id))
    if (next.length !== current.length) {
      useDeviceStore.getState().setPinnedShortcuts(next)
    }
  } catch {}
}

export const useAutomationStore = create((set, get) => ({
  automations: [],
  routines: [],
  loading: false,
  error: null,
  // Last successful fetch timestamps + in-flight promises. Used by the
  // staleness/dedupe guards below so back-navigation between Automations,
  // Routines, and the Dashboard doesn't re-fan-out to HA on every mount.
  // (Behind the scenes, /api/automations and /api/routines each pull the
  //  full HA state set — same shape of cost as deviceStore.fetchAll.)
  _autosUpdatedAt: 0,
  _autosInflight:  null,
  _routinesUpdatedAt: 0,
  _routinesInflight:  null,

  // fetchAutomations(options?)
  //   maxAge:  reuse cached list if it was fetched in the last N ms.
  //   force:   bypass cache + in-flight dedupe (post-mutation refreshes).
  fetchAutomations: async ({ maxAge = 0, force = false } = {}) => {
    const s = get()
    if (!force) {
      if (maxAge > 0 && s._autosUpdatedAt &&
          s.automations.length > 0 &&
          (Date.now() - s._autosUpdatedAt) < maxAge) {
        return
      }
      if (s._autosInflight) return s._autosInflight
    }
    const promise = (async () => {
      set({ loading: true, error: null })
      try {
        const res = await getAutomations()
        set({
          automations: res.automations || [],
          loading: false,
          _autosUpdatedAt: Date.now(),
        })
      } catch (e) {
        // Preserve the full error so describeError/DataState can render the
        // proper localized message + retry affordance.
        set({ loading: false, error: e })
      } finally {
        set({ _autosInflight: null })
      }
    })()
    set({ _autosInflight: promise })
    return promise
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
    logger.action('automation_toggle_click', {
      automation_id: id, name: current.name, to: newEnabled ? 'enabled' : 'disabled',
    })
    await toggleAutomation(id, newEnabled)
    set((s) => ({
      automations: s.automations.map((a) => (a.id === id ? { ...a, enabled: newEnabled } : a)),
    }))
  },

  triggerAutomation: async (id) => {
    const current = get().automations.find((a) => a.id === id)
    logger.action('automation_trigger_click', {
      automation_id: id, name: current?.name,
    })
    await triggerAutomation(id)
  },

  // Load full config for editing
  loadAutomationConfig: async (id) => {
    return await getAutomation(id)
  },

  fetchRoutines: async ({ maxAge = 0, force = false } = {}) => {
    const s = get()
    if (!force) {
      if (maxAge > 0 && s._routinesUpdatedAt &&
          s.routines.length > 0 &&
          (Date.now() - s._routinesUpdatedAt) < maxAge) {
        return
      }
      if (s._routinesInflight) return s._routinesInflight
    }
    const promise = (async () => {
      set({ loading: true, error: null })
      try {
        const res = await getRoutines()
        set({
          routines: res.routines || [],
          loading: false,
          _routinesUpdatedAt: Date.now(),
        })
      } catch (e) {
        // Preserve the full error so describeError/DataState can render the
        // proper localized message + retry affordance.
        set({ loading: false, error: e })
      } finally {
        set({ _routinesInflight: null })
      }
    })()
    set({ _routinesInflight: promise })
    return promise
  },

  // Unified save: create (no id) or update-in-place (id present). The backend
  // accepts `id` on POST /api/routines and uses it as the HA script_id, so
  // editing a routine no longer slugifies-on-name (which would orphan the
  // original script on rename and append a duplicate card here).
  saveRoutine: async (data) => {
    const res = await createRoutine(data)
    const routine = res.routine
    set((s) => {
      const idx = s.routines.findIndex((r) => r.id === routine.id)
      if (idx >= 0) {
        const updated = [...s.routines]
        updated[idx] = routine
        return { routines: updated, _routinesUpdatedAt: Date.now() }
      }
      // Also handle the case where the id changed (edit + rename → new slug).
      // The original record would otherwise linger; refetch reconciles.
      return { routines: [...s.routines, routine], _routinesUpdatedAt: Date.now() }
    })
    // Force-refresh in the background so any rename/slug-change cleans up the
    // stale row. Fire-and-forget — UI is already coherent without it.
    get().fetchRoutines({ force: true }).catch(() => {})
    return routine
  },

  // Backwards-compat alias — older callers may still expect `addRoutine`.
  addRoutine: async (data) => get().saveRoutine(data),

  removeRoutine: async (id) => {
    await deleteRoutine(id)
    set((s) => ({ routines: s.routines.filter((r) => r.id !== id) }))
    // Clean up any pinned-shortcut entry that referenced this routine —
    // otherwise it counts toward the 8-pin cap forever, invisibly.
    _pruneShortcut('routine', id)
  },

  runRoutine: async (id) => {
    await runRoutine(id)
  },

  // Load full config for editing
  loadRoutineConfig: async (id) => {
    return await getRoutine(id)
  },
}))
