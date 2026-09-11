import { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../lib/i18n'
import { Input } from '../components/ui/Input'

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

  const disabled = loading || !username.trim() || !password

  if (mode === 'loading') {
    return (
      <div data-palette="dark" style={{ minHeight: 'var(--vh)', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="z-spin" aria-hidden style={{ width: 20, height: 20, border: '2px solid var(--ink-mute)', borderTopColor: 'transparent', borderRadius: '50%' }} />
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

        {/* Wordmark — the accent period is the one accent on this screen. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32, gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
            <span className="z-display">ziggy</span>
            <span className="z-display" style={{ color: 'var(--accent)' }}>.</span>
          </div>
          <p className="z-subhead" style={{ textAlign: 'center' }}>
            {mode === 'setup' ? t('login.createAccount') : t('login.signInToHome')}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            label={t('common.username')}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={e => { setUsername(e.target.value); setError('') }}
            placeholder={t('login.usernamePlaceholder')}
          />

          <div style={{ position: 'relative' }}>
            <Input
              label={t('common.password')}
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              dir="ltr"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="••••••••"
              style={{ paddingInlineEnd: 48 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
              style={{
                position: 'absolute', insetInlineEnd: 0, bottom: 0,
                width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 0,
              }}
            >
              {showPassword ? <EyeOff size={20} strokeWidth={1.75} /> : <Eye size={20} strokeWidth={1.75} />}
            </button>
          </div>

          {error && (
            <p role="alert" style={{ fontSize: 15, lineHeight: '20px', color: 'var(--err-text)', textAlign: 'center' }}>{error}</p>
          )}

          <button
            type="submit"
            className="z-btn-primary z-button"
            disabled={disabled}
            style={{ width: '100%', marginTop: 8 }}
          >
            {loading ? (
              <>
                <span className="z-spin" aria-hidden style={{ width: 16, height: 16, border: '2px solid var(--bg)', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }} />
                {mode === 'setup' ? t('login.creating') : t('login.signingIn')}
              </>
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
