import { create } from 'zustand'

const TOKEN_KEY = 'ziggy_token'

export const useAuthStore = create((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY) || null,
  authenticated: !!localStorage.getItem(TOKEN_KEY),

  setToken: (token) => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
    set({ token, authenticated: !!token })
  },

  logout: () => {
    const { token } = get()
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {})
    }
    localStorage.removeItem(TOKEN_KEY)
    set({ token: null, authenticated: false })
  },
}))
