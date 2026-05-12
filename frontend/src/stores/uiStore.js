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
      addToast: (message, type = 'info', duration = 3500) => {
        const id = Date.now()
        set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
        setTimeout(() => {
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
        }, duration)
      },
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    { name: 'ziggy-ui', partialize: (s) => ({ theme: s.theme }) }
  )
)
