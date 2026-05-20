import { create } from 'zustand'
import { getVoiceRuntimeStatus, patchVoiceSettings } from '../lib/api'

// Runtime state for Ziggy's backend wake-word/listening daemon. Distinct from
// the browser hold-to-talk mic on the chat page — this controls the always-on
// OS-level mic that runs in the backend voice loop.
export const useVoiceStore = create((set, get) => ({
  micEnabled:        null,   // null until first fetch — avoids flickering UI
  wakewordEnabled:   false,
  wakewordModel:     null,
  wakeInitFailed:    false,
  voiceThreadRunning:false,
  loading:           false,
  error:             null,

  fetchStatus: async () => {
    try {
      set({ loading: true, error: null })
      const data = await getVoiceRuntimeStatus()
      set({
        micEnabled:         !!data?.mic_enabled,
        wakewordEnabled:    !!data?.wakeword_enabled,
        wakewordModel:      data?.wakeword_model ?? null,
        wakeInitFailed:     !!data?.wake_init_failed,
        voiceThreadRunning: !!data?.voice_thread_running,
        loading:            false,
      })
    } catch (e) {
      set({ loading: false, error: e?.message || 'Failed to load voice status' })
    }
  },

  setMicEnabled: async (enabled) => {
    const prev = get().micEnabled
    set({ micEnabled: enabled })   // optimistic
    try {
      await patchVoiceSettings({ mic_enabled: !!enabled })
    } catch (e) {
      set({ micEnabled: prev, error: e?.message || 'Failed to toggle mic' })
      throw e
    }
  },
}))
