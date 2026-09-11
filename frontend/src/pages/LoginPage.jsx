import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../lib/i18n'

export default function LoginPage() {
  const t = useT()
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
      if (!res.ok) { setError(data.detail || t('common.somethingWentWrong')); setLoading(false); return }
      setToken(data.token, data.role)
    } catch { setError(t('login.cannotReach')); setLoading(false) }
  }

  const fieldStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface-2)',
    border: '0.5px solid var(--line)',
    borderRadius: 12, padding: '12px 14px',
    color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14,
    outline: 'none', transition: 'border-color 0.12s',
  }

  if (mode === 'loading') {
    return (
      <div data-palette="dark" style={{ minHeight: 'var(--vh)', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 20, height: 20, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div
      data-palette="dark"
      style={{
        minHeight: 'var(--vh)',
        background: 'var(--bg)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        // Honor iOS safe-area-insets so inputs don't graze the bezel edges
        // when the keyboard appears and the viewport reflows.
        padding: '24px max(20px, env(safe-area-inset-left)) 24px max(20px, env(safe-area-inset-right))',
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100vw',
        overflow: 'hidden',
        fontFamily: "'Heebo', system-ui, sans-serif",
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>

        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 48, gap: 6 }}>
          <div style={{
            width: 56, height: 56,
            background: 'var(--accent)',
            borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            boxShadow: 'var(--shadow-lg)',
          }}>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
              <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="var(--bg)" />
            </svg>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 28, letterSpacing: '-0.025em', color: 'var(--ink)' }}>ziggy</span>
            <span style={{ color: 'var(--accent)', fontSize: 28, fontWeight: 700 }}>.</span>
          </div>
          <p className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>
            {mode === 'setup' ? t('login.createAccount') : t('login.signInToHome')}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="z-eyebrow" style={{ display: 'block', marginBottom: 6 }}>{t('common.username')}</label>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              dir="auto"
              value={username}
              onChange={e => { setUsername(e.target.value); setError('') }}
              placeholder={t('login.usernamePlaceholder')}
              style={fieldStyle}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={e  => e.currentTarget.style.borderColor = 'var(--line)'}
            />
          </div>

          <div>
            <label className="z-eyebrow" style={{ display: 'block', marginBottom: 6 }}>{t('common.password')}</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••"
                style={{ ...fieldStyle, paddingRight: 42 }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e  => e.currentTarget.style.borderColor = 'var(--line)'}
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4,
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
            <p style={{ fontSize: 12, color: 'var(--err)', textAlign: 'center' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            style={{
              width: '100%', padding: '13px 16px', marginTop: 6,
              background: 'var(--accent)', color: 'var(--bg)',
              border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
              cursor: loading || !username.trim() || !password ? 'not-allowed' : 'pointer',
              opacity: loading || !username.trim() || !password ? 0.5 : 1,
              fontFamily: 'inherit', transition: 'opacity 0.12s',
            }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ width: 14, height: 14, border: '2px solid var(--bg)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                {mode === 'setup' ? t('login.creating') : t('login.signingIn')}
              </span>
            ) : mode === 'setup' ? t('login.createAccountButton') : t('login.signIn')}
          </button>
        </form>

        <p className="z-eyebrow" style={{ textAlign: 'center', marginTop: 32 }}>
          {t('login.tagline')}
        </p>
      </div>
    </div>
  )
}
