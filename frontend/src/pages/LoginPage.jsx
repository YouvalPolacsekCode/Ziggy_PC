import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'

export default function LoginPage() {
  const [mode,         setMode]         = useState('loading')
  const [username,     setUsername]     = useState('')
  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const { setToken } = useAuthStore()

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(d => { if (d.configured) { setUsername(d.username || ''); setMode('login') } else setMode('setup') })
      .catch(() => setMode('login'))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setError(''); setLoading(true)
    try {
      const endpoint = mode === 'setup' ? '/api/auth/setup' : '/api/auth/login'
      const res  = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password }) })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || 'Something went wrong.'); setLoading(false); return }
      setToken(data.token, data.role)
    } catch { setError('Cannot reach Ziggy. Is it running?'); setLoading(false) }
  }

  if (mode === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: 'oklch(0.16 0.010 250)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 20, height: 20, border: '2px solid oklch(0.72 0.16 32)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'oklch(0.16 0.010 250)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px',
      fontFamily: "'Heebo', system-ui, sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>

        {/* Wordmark */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 48, gap: 6 }}>
          {/* Bolt icon */}
          <div style={{
            width: 56, height: 56,
            background: 'oklch(0.72 0.16 32)',
            borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            boxShadow: '0 8px 24px -6px oklch(0.72 0.16 32 / 0.5)',
          }}>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
              <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="oklch(0.16 0.010 250)" />
            </svg>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
            <span style={{ fontFamily: "'Heebo', sans-serif", fontWeight: 600, fontSize: 28, letterSpacing: '-0.02em', color: 'oklch(0.96 0.006 75)' }}>ziggy</span>
            <span style={{ color: 'oklch(0.72 0.16 32)', fontSize: 28, fontWeight: 600 }}>.</span>
          </div>
          <p style={{ fontSize: 13, color: 'oklch(0.50 0.010 75)', marginTop: 2 }}>
            {mode === 'setup' ? 'Create your account' : 'Sign in to your home'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'oklch(0.50 0.010 75)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'IBM Plex Mono', monospace" }}>
              Username
            </label>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={e => { setUsername(e.target.value); setError('') }}
              placeholder="your name"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'oklch(0.21 0.012 250)',
                border: '0.5px solid oklch(0.30 0.012 250)',
                borderRadius: 11, padding: '12px 14px',
                color: 'oklch(0.96 0.006 75)', fontFamily: 'inherit', fontSize: 14,
                outline: 'none', transition: 'border-color 0.12s',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'oklch(0.72 0.16 32)'}
              onBlur={e  => e.currentTarget.style.borderColor = 'oklch(0.30 0.012 250)'}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'oklch(0.50 0.010 75)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'IBM Plex Mono', monospace" }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'oklch(0.21 0.012 250)',
                  border: '0.5px solid oklch(0.30 0.012 250)',
                  borderRadius: 11, padding: '12px 42px 12px 14px',
                  color: 'oklch(0.96 0.006 75)', fontFamily: 'inherit', fontSize: 14,
                  outline: 'none', transition: 'border-color 0.12s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'oklch(0.72 0.16 32)'}
                onBlur={e  => e.currentTarget.style.borderColor = 'oklch(0.30 0.012 250)'}
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: 'oklch(0.50 0.010 75)', padding: 4,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {showPassword
                    ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M10.73 10.73A3 3 0 0013.27 13.27M3 3l18 18"/></>
                    : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                  }
                </svg>
              </button>
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: 'oklch(0.72 0.16 32)', textAlign: 'center' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            style={{
              width: '100%', padding: '13px 16px', marginTop: 6,
              background: 'oklch(0.72 0.16 32)', color: 'oklch(0.16 0.010 250)',
              border: 'none', borderRadius: 11, fontSize: 15, fontWeight: 700,
              cursor: loading || !username.trim() || !password ? 'not-allowed' : 'pointer',
              opacity: loading || !username.trim() || !password ? 0.5 : 1,
              fontFamily: 'inherit', transition: 'opacity 0.12s',
            }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ width: 14, height: 14, border: '2px solid oklch(0.16 0.010 250)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                Signing in…
              </span>
            ) : mode === 'setup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'oklch(0.38 0.010 75)', marginTop: 32, fontFamily: "'IBM Plex Mono', monospace" }}>
          ZIGGY · LOCAL · YOUR DATA
        </p>
      </div>
    </div>
  )
}
