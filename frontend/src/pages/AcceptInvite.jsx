import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getInvite, acceptInvite } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../lib/i18n'

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
        width: '100%', maxWidth: 400,
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Header */}
        <div style={{ padding: '28px 28px 0', textAlign: 'center' }}>
          <p style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-0.025em', color: 'var(--ink)', marginBottom: 4 }}>
            ziggy<span style={{ color: 'var(--accent)' }}>.</span>
          </p>
          <p className="z-eyebrow" style={{ marginBottom: 24 }}>{t('invite.tagline')}</p>
        </div>

        <div style={{ padding: '0 28px 28px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-faint)', fontSize: 13 }}>
              {t('invite.validating')}
            </div>
          )}

          {!loading && error && !invite && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ fontSize: 28, marginBottom: 12 }}>🔗</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
                {t('invite.unavailable')}
              </p>
              <p style={{ fontSize: 12, color: 'var(--ink-faint)', lineHeight: 1.5 }}>{error}</p>
            </div>
          )}

          {!loading && done && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              {invite?.type === 'home' && homeUrl ? (
                <>
                  <p style={{ fontSize: 28, marginBottom: 12 }}>✅</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
                    {t('invite.welcomeTo', { name: invite?.home_name || 'Ziggy' })}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 16 }}>
                    {t('invite.homeReady')}
                  </p>
                  <a
                    href={homeUrl}
                    style={{
                      display: 'inline-block',
                      background: 'var(--accent)', color: '#fff',
                      padding: '10px 20px', borderRadius: 10,
                      fontSize: 13, fontWeight: 600, textDecoration: 'none',
                    }}
                  >
                    {t('invite.goToHome')}
                  </a>
                </>
              ) : invite?.type === 'home' && String(provStatus?.status || '').startsWith('failed') ? (
                <>
                  <p style={{ fontSize: 28, marginBottom: 12 }}>⚠️</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
                    {t('invite.setupFailed')}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
                    {t('invite.setupFailedHelp')}
                  </p>
                </>
              ) : invite?.type === 'home' ? (
                <>
                  <p style={{ fontSize: 28, marginBottom: 12 }}>🏠</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
                    {t('invite.accountCreated')}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
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
                  <p style={{ fontSize: 28, marginBottom: 12 }}>✅</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
                    {t('invite.welcomeTo', { name: invite?.home_name || 'Ziggy' })}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 16 }}>
                    {t('invite.accountReady')}
                  </p>
                  <a
                    href={homeUrl}
                    style={{
                      display: 'inline-block',
                      background: 'var(--accent)', color: '#fff',
                      padding: '10px 20px', borderRadius: 10,
                      fontSize: 13, fontWeight: 600, textDecoration: 'none',
                    }}
                  >
                    {t('invite.goToHome')}
                  </a>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 28, marginBottom: 12 }}>✅</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
                    {relayBase ? t('invite.accountCreated') : t('invite.welcomeTo', { name: invite?.home_name || 'Ziggy' })}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
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
              <div style={{
                background: 'var(--bg-2)', borderRadius: 12,
                padding: '14px 16px', marginBottom: 20,
              }}>
                <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 4 }}>
                  {t('invite.invitedByLabel')} <strong style={{ color: 'var(--ink)' }}>{invite.invited_by}</strong>
                </p>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {invite.type === 'home'
                    ? t('invite.setUpHome', { name: invite.home_name || t('invite.yourNewHome') })
                    : invite.home_name}
                  <span style={{
                    marginLeft: 8, fontSize: 10, fontWeight: 600,
                    background: 'var(--accent)', color: '#fff',
                    padding: '2px 8px', borderRadius: 999,
                  }}>
                    {invite.type === 'home' ? t('invite.newHomeBadge') : (ROLE_LABEL[invite.role] || invite.role)}
                  </span>
                </p>
              </div>

              {/* Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('invite.email')}</p>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus={!invite.email}
                    className="z-input"
                    style={{ width: '100%', height: 40, padding: '0 12px', fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('common.password')}</p>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t('invite.passwordPlaceholder')}
                    required
                    className="z-input"
                    style={{ width: '100%', height: 40, padding: '0 12px', fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('common.confirmPassword')}</p>
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder={t('invite.confirmPlaceholder')}
                    required
                    className="z-input"
                    style={{ width: '100%', height: 40, padding: '0 12px', fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {error && (
                <p style={{ fontSize: 12, color: 'var(--err)', marginBottom: 14, lineHeight: 1.4 }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                style={{
                  width: '100%', height: 42,
                  background: 'var(--accent)', color: '#fff',
                  border: 'none', borderRadius: 11,
                  fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
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
