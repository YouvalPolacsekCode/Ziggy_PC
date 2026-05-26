import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { describeError } from '../lib/errors'

// Fire-and-forget server sync. The theme is also stored in /api/ui/prefs so
// it survives PWA "clear site data" and service-worker cache evictions (same
// reason we did this for Dashboard pinned shortcuts and room photos).
// Lazy-import api.js to avoid circular module deps at app boot.
function _syncTheme(theme) {
  import('../lib/api.js').then(({ putUiPrefs }) => {
    putUiPrefs({ theme }).catch(() => {})
  }).catch(() => {})
}

// Dedupe window — repeated identical toasts inside this window are skipped.
// 4s is long enough to absorb a burst of WS-driven failures (e.g. ten
// command_failed events firing as a Z-Wave network reorganizes) without
// burying earlier toasts the user needs to read.
const TOAST_DEDUPE_MS = 4_000
// Maximum identical toasts before we throttle hard (drop until cooldown).
// Without this, a runaway store update loop could mint a toast per render
// frame and fill the queue.
const _recentToasts = new Map()  // `${type}:${message}` → last ts

export const useUIStore = create(
  persist(
    (set) => ({
      theme: 'light',
      toasts: [],
      toggleTheme: () =>
        set((s) => {
          const next = s.theme === 'light' ? 'dark' : 'light'
          _syncTheme(next)
          return { theme: next }
        }),
      setTheme: (theme) => { _syncTheme(theme); set({ theme }) },
      addToast: (message, type = 'info', duration, detail) => {
        // Dedupe: collapse the same toast text+type fired within the window.
        // Errors get the strongest filter because they're the loudest UX
        // failure (toast spam on a flapping WS used to dominate the screen).
        const key = `${type}:${message}`
        const now = Date.now()
        const last = _recentToasts.get(key) || 0
        if (now - last < TOAST_DEDUPE_MS) return
        _recentToasts.set(key, now)
        // Periodically prune the dedupe map so it doesn't grow unbounded
        // across long sessions. Cheap — runs every ~50 toasts.
        if (_recentToasts.size > 50) {
          for (const [k, ts] of _recentToasts.entries()) {
            if (now - ts > TOAST_DEDUPE_MS * 3) _recentToasts.delete(k)
          }
        }

        const id = `${now}-${Math.random().toString(36).slice(2, 7)}`
        const ms = duration ?? (type === 'error' ? 7000 : 3000)
        set((s) => ({ toasts: [...s.toasts, { id, message, type, detail }] }))
        setTimeout(() => {
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
        }, ms)
      },
      // Centralized error-toast helper. Runs the error through describeError
      // so the user sees a localized, sanitized string instead of raw
      // err.message. Use this from any catch block that should show feedback
      // — it's the only addToast variant that knows how to handle a
      // ZiggyApiError (or any other thrown value) correctly.
      //
      // Usage:
      //   try { await thing() }
      //   catch (e) { useUIStore.getState().toastError(e) }
      toastError: (err, { fallback, duration } = {}) => {
        const desc = describeError(err)
        const message = desc.message || fallback || ''
        if (!message) return
        // Reuse addToast so the dedupe window applies — multiple failing
        // requests in a row collapse to a single visible toast.
        const detail = desc.requestId ? `Ref: ${desc.requestId}` : undefined
        // eslint-disable-next-line no-use-before-define
        useUIStore.getState().addToast(message, 'error', duration, detail)
      },
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    { name: 'ziggy-ui', partialize: (s) => ({ theme: s.theme }) }
  )
)
