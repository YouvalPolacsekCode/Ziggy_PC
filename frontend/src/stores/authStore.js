import { create } from 'zustand'

const TOKEN_KEY = 'ziggy_token'
const ROLE_KEY  = 'ziggy_role'

export const useAuthStore = create((set, get) => ({
  token:         localStorage.getItem(TOKEN_KEY) || null,
  role:          localStorage.getItem(ROLE_KEY)  || null,
  authenticated: !!localStorage.getItem(TOKEN_KEY),

  setToken: (token, role = null) => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token)
      if (role) localStorage.setItem(ROLE_KEY, role)
    } else {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(ROLE_KEY)
    }
    set({ token, role: role ?? get().role, authenticated: !!token })
  },

  setRole: (role) => {
    if (role) {
      localStorage.setItem(ROLE_KEY, role)
    } else {
      localStorage.removeItem(ROLE_KEY)
    }
    set({ role })
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
    localStorage.removeItem(ROLE_KEY)
    set({ token: null, role: null, authenticated: false })
  },
}))
