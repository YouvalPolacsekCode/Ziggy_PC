import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useUIStore = create(
  persist(
    (set) => ({
      theme: 'light',
      toasts: [],
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      setTheme: (theme) => set({ theme }),
      addToast: (message, type = 'info', duration, detail) => {
        const id = Date.now()
        const ms = duration ?? (type === 'error' ? 7000 : 3000)
        set((s) => ({ toasts: [...s.toasts, { id, message, type, detail }] }))
        setTimeout(() => {
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
        }, ms)
      },
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    { name: 'ziggy-ui', partialize: (s) => ({ theme: s.theme }) }
  )
)
