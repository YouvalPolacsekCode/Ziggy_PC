import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getInvite, acceptInvite } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../lib/i18n'
import { Check, AlertTriangle, Home, Link2 } from 'lucide-react'
import { Input } from '../components/ui/Input'

// Result-screen glyph: a 64px tinted disc with a 32px line icon. Status
// colour is allowed here because the icon is ≥ 20px.
function ResultGlyph({ icon: Icon, tone = 'ok' }) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink-mute)'
  return (
    <div aria-hidden style={{
      width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px',
      background: `color-mix(in srgb, ${color} 12%, var(--surface))`, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={32} strokeWidth={1.75} />
    </div>
  )
}

const resultTitle = { marginBottom: 8 }
const resultBody  = { color: 'var(--ink-mute)', marginBottom: 16 }

export default function AcceptInvite() {
  const { token } = useParams()
  const navigate  = useNavigate()
  const { setToken } = useAuthStore()
  const t = useT()

  const ROLE_LABEL = {
    super_admin: t('roles.owner'),
    admin:       t('roles.admin'),
    user:        t('roles.member'),
    guest:       t('roles.guest'),
  }

  // Relay invites embed ?relay=https://relay-url so AcceptInvite knows to call
  // the relay API instead of the local Ziggy API. No localStorage is touched —
  // the new user registers only in the relay, not in this home.
  const relayBase = new URLSearchParams(window.location.search).get('relay') || null

  const [invite,   setInvite]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [done,     setDone]     = useState(false)
  const [homeUrl,  setHomeUrl]  = useState(null)
  const [regResult, setRegResult] = useState(null)  // { token, home_id } from register response
  const [provStatus, setProvStatus] = useState(null)  // { type, status, tunnel_url } from status poll

  useEffect(() => {
    const fetchInvite = relayBase
      ? () => fetch(`${relayBase}/api/invites/${token}/info`)
          .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.detail || 'Not found'))))
      : () => getInvite(token)

    fetchInvite()
      .then(inv => { setInvite(inv); setEmail(inv.email || '') })
      .catch(e  => setError(e.message || t('invite.notFound')))
      .finally(() => setLoading(false))
  }, [token, relayBase])

  // Poll the home's provisioning status after a successful home-invite acceptance.
  // Stops when status is 'active' (tunnel_url ready) or starts with 'failed'.
  useEffect(() => {
    if (!done || !relayBase || !regResult?.home_id || !regResult?.token) return
    let cancelled = false
    let handle
    const poll = async () => {
      try {
        const r = await fetch(`${relayBase}/api/provision/home/${regResult.home_id}/status`, {
          headers: { Authorization: `Bearer ${regResult.token}` },
        })
        if (!r.ok || cancelled) return
        const data = await r.json()
        if (cancelled) return
        setProvStatus(data)
        if (data.status === 'active' && data.tunnel_url) {
          setHomeUrl(data.tunnel_url)
          return
        }
        if (String(data.status || '').startsWith('failed')) return
        handle = setTimeout(poll, 3000)
      } catch {
        if (!cancelled) handle = setTimeout(poll, 5000)
      }
    }
    poll()
    return () => { cancelled = true; if (handle) clearTimeout(handle) }
  }, [done, relayBase, regResult])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return setError(t('invite.emailRequired'))
    if (password.length < 6) return setError(t('invite.passwordMin'))
    if (password !== confirm) return setError(t('invite.passwordsMismatch'))
    setSaving(true)
    setError(null)
    try {
      if (relayBase) {
        // Relay invite — register in relay only, do NOT touch local Ziggy auth.
        const res = await fetch(`${relayBase}/api/auth/register`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email: email.trim().toLowerCase(), password, invite_token: token }),
        }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.detail || 'Failed'))))

        // For user invites: fetch the home's tunnel URL so we can link them directly.
        if (res.invite_type === 'user' && res.home_id && res.token) {
          try {
            const homeData = await fetch(`${relayBase}/api/homes/${res.home_id}`, {
              headers: { Authorization: `Bearer ${res.token}` },
            }).then(r => r.ok ? r.json() : null)
            if (homeData?.tunnel_url) setHomeUrl(homeData.tunnel_url)
          } catch { /* tunnel URL optional — home might still be registering */ }
        }
        // For home invites: store creds so the effect below can poll status.
        if (res.invite_type === 'home' && res.home_id && res.token) {
          setRegResult({ token: res.token, home_id: res.home_id })
        }
        setDone(true)

      } else {
        // Local invite — create account in this home and log in.
        const res = await acceptInvite(token, { email: email.trim().toLowerCase(), password })
        setToken(res.token, res.role)
        setDone(true)
        setTimeout(() => navigate('/'), 1800)
      }
    } catch (e) {
      setError(e.message || t('invite.acceptFailed'))
    } finally {
      setSaving(false)
    }
  }

  // ── Layout shell ──────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
      padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        borderRadius: 'var(--r-sheet)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Header — the accent period is the one accent on this screen */}
        <div style={{ padding: '24px 24px 0', textAlign: 'center' }}>
          <p className="z-display" style={{ marginBottom: 4 }}>
            ziggy<span style={{ color: 'var(--accent)' }}>.</span>
          </p>
          <p className="z-eyebrow" style={{ marginBottom: 24 }}>{t('invite.tagline')}</p>
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          {loading && (
            <div className="z-subhead" style={{ textAlign: 'center', padding: '32px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <span className="z-spin" aria-hidden style={{ width: 16, height: 16, border: '2px solid var(--ink-mute)', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }} />
              {t('invite.validating')}
            </div>
          )}

          {!loading && error && !invite && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <ResultGlyph icon={Link2} tone="mute" />
              <p className="z-title" style={resultTitle}>
                {t('invite.unavailable')}
              </p>
              <p className="z-subhead">{error}</p>
            </div>
          )}

          {!loading && done && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              {invite?.type === 'home' && homeUrl ? (
                <>
                  <ResultGlyph icon={Check} tone="ok" />
                  <p className="z-title" style={resultTitle}>
                    {t('invite.welcomeTo', { name: invite?.home_name || 'Ziggy' })}
                  </p>
                  <p className="z-body" style={resultBody}>
                    {t('invite.homeReady')}
                  </p>
                  <a href={homeUrl} className="z-btn-primary" style={{ textDecoration: 'none' }}>
                    {t('invite.goToHome')}
                  </a>
                </>
              ) : invite?.type === 'home' && String(provStatus?.status || '').startsWith('failed') ? (
                <>
                  <ResultGlyph icon={AlertTriangle} tone="warn" />
                  <p className="z-title" style={resultTitle}>
                    {t('invite.setupFailed')}
                  </p>
                  <p className="z-body" style={{ color: 'var(--ink-mute)' }}>
                    {t('invite.setupFailedHelp')}
                  </p>
                </>
              ) : invite?.type === 'home' ? (
                <>
                  <ResultGlyph icon={Home} tone="mute" />
                  <p className="z-title" style={resultTitle}>
                    {t('invite.accountCreated')}
                  </p>
                  <p className="z-body" style={{ color: 'var(--ink-mute)' }}>
                    {provStatus?.type === 'hub' ? (
                      <>
                        {t('invite.hubShipping1')}
                        <br />{t('invite.hubShipping2')}
                      </>
                    ) : (
                      <>
                        {t('invite.newHomeSetup1')}
                        <br />{t('invite.newHomeSetup2')}
                      </>
                    )}
                  </p>
                </>
              ) : homeUrl ? (
                <>
                  <ResultGlyph icon={Check} tone="ok" />
                  <p className="z-title" style={resultTitle}>
                    {t('invite.welcomeTo', { name: invite?.home_name || 'Ziggy' })}
                  </p>
                  <p className="z-body" style={resultBody}>
                    {t('invite.accountReady')}
                  </p>
                  <a href={homeUrl} className="z-btn-primary" style={{ textDecoration: 'none' }}>
                    {t('invite.goToHome')}
                  </a>
                </>
              ) : (
                <>
                  <ResultGlyph icon={Check} tone="ok" />
                  <p className="z-title" style={resultTitle}>
                    {relayBase ? t('invite.accountCreated') : t('invite.welcomeTo', { name: invite?.home_name || 'Ziggy' })}
                  </p>
                  <p className="z-body" style={{ color: 'var(--ink-mute)' }}>
                    {relayBase
                      ? t('invite.adminWillShare')
                      : t('invite.takingToDashboard')}
                  </p>
                </>
              )}
            </div>
          )}

          {!loading && invite && !done && (
            <form onSubmit={handleSubmit}>
              {/* Invite context */}
              <div className="z-card-soft" style={{ padding: 12, marginBottom: 20 }}>
                <p className="z-footnote" style={{ marginBottom: 4 }}>
                  {t('invite.invitedByLabel')} <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{invite.invited_by}</strong>
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="z-headline">
                    {invite.type === 'home'
                      ? t('invite.setUpHome', { name: invite.home_name || t('invite.yourNewHome') })
                      : invite.home_name}
                  </span>
                  <span className="z-chip">
                    {invite.type === 'home' ? t('invite.newHomeBadge') : (ROLE_LABEL[invite.role] || invite.role)}
                  </span>
                </div>
              </div>

              {/* Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
                <Input
                  label={t('invite.email')}
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus={!invite.email}
                />
                <Input
                  label={t('common.password')}
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('invite.passwordPlaceholder')}
                  required
                />
                <Input
                  label={t('common.confirmPassword')}
                  type="password"
                  dir="ltr"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder={t('invite.confirmPlaceholder')}
                  required
                />
              </div>

              {error && (
                <p role="alert" style={{ fontSize: 13, lineHeight: '20px', color: 'var(--err-text)', marginBottom: 16 }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="z-btn-primary z-button"
                style={{ width: '100%' }}
              >
                {saving ? t('invite.creating') : (invite.type === 'home' ? t('invite.createMyAccount') : t('invite.createAndJoin'))}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
