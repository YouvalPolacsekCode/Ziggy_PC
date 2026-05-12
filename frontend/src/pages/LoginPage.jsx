import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'

export default function LoginPage() {
  const [mode, setMode] = useState('loading') // loading | login | setup
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setToken } = useAuthStore()

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => {
        if (d.configured) {
          setUsername(d.username || '')
          setMode('login')
        } else {
          setMode('setup')
        }
      })
      .catch(() => setMode('login'))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setError('')
    setLoading(true)
    try {
      const endpoint = mode === 'setup' ? '/api/auth/setup' : '/api/auth/login'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'Something went wrong.')
        setLoading(false)
        return
      }
      setToken(data.token)
    } catch {
      setError('Cannot reach Ziggy. Is it running?')
      setLoading(false)
    }
  }

  if (mode === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 bg-yellow-400 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-yellow-400/20">
            <svg viewBox="0 0 32 32" className="w-8 h-8" fill="none">
              <path d="M20 4H10L7 14h7L10 28L26 12h-8z" fill="#18181b" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Ziggy</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {mode === 'setup' ? 'Create your account' : 'Sign in to your home'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
              Username
            </label>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError('') }}
              placeholder="your name"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3
                         text-white placeholder-zinc-600 text-sm
                         focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400/30
                         transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 pr-11
                           text-white placeholder-zinc-600 text-sm
                           focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400/30
                           transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full bg-yellow-400 text-zinc-900 font-semibold rounded-xl py-3 text-sm
                       hover:bg-yellow-300 active:scale-98 transition-all duration-150
                       disabled:opacity-40 disabled:cursor-not-allowed mt-2"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
                Signing in…
              </span>
            ) : mode === 'setup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-600 mt-8">
          Ziggy · Your home, your data
        </p>
      </div>
    </div>
  )
}
