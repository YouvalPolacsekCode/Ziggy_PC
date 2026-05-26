import { create } from 'zustand'
import { getFeaturesSettings, patchFeaturesSettings } from '../lib/api'

// Defaults must mirror backend admin_router._FEATURE_DEFAULTS so the FE
// renders the same gates before the first fetch completes. The fetch runs
// right after auth, but pages can mount in the gap (cold PWA boot, route
// preloads), so a missing flag should resolve to the same default the
// server would have returned.
const DEFAULTS = {
  buddy_mode:      true,
  file_management: true,
  home_map:        false,
  ifttt:           true,
  local_storage:   true,
  smart_home:      true,
  task_tracking:   false,
  voice:           true,
  zigbee_support:  true,
}

export const useFeaturesStore = create((set, get) => ({
  features: DEFAULTS,
  loaded: false,

  fetch: async () => {
    try {
      const data = await getFeaturesSettings()
      set({ features: { ...DEFAULTS, ...data }, loaded: true })
    } catch {
      // 403 (role too low) or transport failure — keep defaults so the UI
      // still gates predictably. Loaded stays false so a later retry runs.
    }
  },

  // Optimistic toggle:
  //   1. Update the store immediately so every useFeature subscriber
  //      (nav, route gate, dashboard) re-renders before the network hop.
  //   2. Send the PATCH. The backend returns the authoritative feature dict
  //      ({ok, features}) — we use THAT directly to avoid a stale-refetch
  //      race where another save_settings call (auth/presence/device) writes
  //      old in-memory state right before our follow-up GET reads it.
  //   3. On error, revert the optimistic value and rethrow so the caller can
  //      toast. We don't refetch on failure — the optimistic revert is the
  //      truth at that point.
  setFeature: async (key, value) => {
    const prev = get().features[key]
    set((s) => ({ features: { ...s.features, [key]: value } }))
    try {
      const res = await patchFeaturesSettings({ [key]: value })
      if (res && res.features) {
        set({ features: { ...DEFAULTS, ...res.features }, loaded: true })
      }
    } catch (e) {
      set((s) => ({ features: { ...s.features, [key]: prev } }))
      throw e
    }
  },
}))

// Selector hook — components subscribe to a single flag without re-rendering
// on unrelated flag changes. Returns the backend value if loaded, else the
// safe default. Never undefined.
export const useFeature = (key) =>
  useFeaturesStore((s) => s.features[key] ?? DEFAULTS[key] ?? false)
