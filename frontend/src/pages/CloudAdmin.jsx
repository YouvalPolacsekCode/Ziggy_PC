import { useEffect, useState, useCallback } from 'react'
import {
  Home, Copy, Trash2, Plus, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle, Clock, XCircle, Shield, Wifi, WifiOff, Loader, Users,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { useUIStore } from '../stores/uiStore'
import { useT } from '../lib/i18n'
import {
  getUsers, updateUser, deleteUser,
  listInvites, createInvite, revokeInvite,
  getHaSettings, getHealth,
  relayListHomes, relayGetHome, relayProvision, relayDeprovision,
  relayCreateInvite,
  isRelayConfigured, getRelayUrl, setRelayUrl, setRelayToken, relayLogin,
} from '../lib/api'

const ROLE_ORDER = ['super_admin', 'admin', 'user', 'guest']
const ROLE_LABEL_KEY = { super_admin: 'roles.owner', admin: 'roles.admin', user: 'roles.member', guest: 'roles.guest' }
const ROLE_COLOR = { super_admin: '#7c3aed', admin: '#2563eb', user: '#16a34a', guest: '#6b7280' }

function RoleBadge({ role }) {
  const t = useT()
  const labelKey = ROLE_LABEL_KEY[role]
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
      background: (ROLE_COLOR[role] || '#6b7280') + '18',
      color: ROLE_COLOR[role] || '#6b7280',
      border: `0.5px solid ${(ROLE_COLOR[role] || '#6b7280')}40`,
    }}>
      {labelKey ? t(labelKey) : role}
    </span>
  )
}

// ── Invite modal — context-aware (user invite OR new home) ───────────────────
function InviteModal({ open, onClose, onCreated, homeId, homeName, mode }) {
  // mode: 'user' | 'home'
  const t = useT()
  const { addToast } = useUIStore()
  const [email,  setEmail]  = useState('')
  const [role,   setRole]   = useState(mode === 'home' ? 'super_admin' : 'user')
  const [note,   setNote]   = useState('')
  const [link,   setLink]   = useState(null)
  const [saving, setSaving] = useState(false)
  const [emailSent,  setEmailSent]  = useState(false)
  const [emailError, setEmailError] = useState(null)

  const reset = () => {
    setEmail(''); setRole(mode === 'home' ? 'super_admin' : 'user')
    setNote(''); setLink(null); setEmailSent(false); setEmailError(null)
  }
  const handleClose = () => { reset(); onClose() }

  const handleCreate = async () => {
    if (!email.trim() && mode === 'user') { addToast(t('cloud.emailRequired'), 'error'); return }
    setSaving(true)
    try {
      let url
      if (mode === 'home' && isRelayConfigured()) {
        // New home provisioning — always through relay
        const res = await relayCreateInvite({
          type: 'home', email: email.trim() || undefined,
          role, home_name: note.trim() || undefined,
          public_url: window.location.origin,
        })
        url = res.invite_url
        setEmailSent(!!email.trim()); setEmailError(null)
      } else if (mode === 'user' && homeId && homeId !== 'local' && isRelayConfigured()) {
        // Inviting a user to a relay-managed home — must go through relay
        // so the account is created in the relay's user registry, not locally
        const res = await relayCreateInvite({
          type: 'user', email: email.trim() || undefined,
          role, home_id: homeId,
          public_url: window.location.origin,
        })
        url = res.invite_url
        setEmailSent(!!email.trim()); setEmailError(null)
      } else {
        // Inviting a user to THIS (local) home
        const res = await createInvite({
          type: 'user', email: email.trim() || undefined,
          role, public_url: window.location.origin,
        })
        url = `${window.location.origin}${res.invite_url}`
        setEmailSent(res.email_sent ?? false); setEmailError(res.email_error ?? null)
      }
      setLink(url); onCreated()
    } catch (e) { addToast(e.message || t('cloud.failed'), 'error') }
    finally { setSaving(false) }
  }

  const copyLink = () => { navigator.clipboard.writeText(link).catch(() => {}); addToast(t('cloud.linkCopied'), 'success') }

  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => e.target === e.currentTarget && handleClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 20, border: '0.5px solid var(--line)', width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '0.5px solid var(--line)' }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
            {link
              ? (mode === 'home' ? t('cloud.modalNewHomeInvite') : t('cloud.modalUserInvited'))
              : (mode === 'home' ? t('cloud.modalSetUpHome') : t('cloud.modalInviteUserTo', { home: homeName || t('cloud.modalFallbackHome') }))}
          </p>
        </div>

        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {link ? (
            <>
              {emailSent && (
                <div style={{ display: 'flex', gap: 10, background: 'var(--ok)10', border: '0.5px solid var(--ok)30', borderRadius: 10, padding: '12px 14px' }}>
                  <CheckCircle size={15} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                  <p style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 600 }}>
                    {mode === 'home' ? t('cloud.setupEmailSent') : t('cloud.inviteEmailSent')} {t('cloud.emailToStrong')} <strong>{email}</strong>
                  </p>
                </div>
              )}
              {emailError && (
                <div style={{ display: 'flex', gap: 10, background: 'var(--warn)10', border: '0.5px solid var(--warn)30', borderRadius: 10, padding: '12px 14px' }}>
                  <XCircle size={15} style={{ color: 'var(--warn)', flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--warn)', fontWeight: 600, marginBottom: 2 }}>{t('cloud.emailNotSent')}</p>
                    <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{emailError}</p>
                  </div>
                </div>
              )}
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>{t('cloud.linkExpires')}</p>
              <div style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '10px 12px', fontFamily: '"IBM Plex Mono", monospace', fontSize: 10.5, color: 'var(--ink)', wordBreak: 'break-all', lineHeight: 1.5 }}>
                {link}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={copyLink} className="z-btn-secondary" style={{ flex: 1, height: 36, borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Copy size={12} /> {t('cloud.copyLink')}
                </button>
                <button onClick={handleClose} className="z-btn-primary" style={{ height: 36, borderRadius: 10, fontSize: 12, padding: '0 16px' }}>{t('cloud.doneBtn')}</button>
              </div>
            </>
          ) : (
            <>
              <div>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>
                  {t('cloud.emailLabel')} {mode === 'home' ? <span style={{ fontWeight: 400 }}>{t('cloud.emailOptional')}</span> : ''}
                </p>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder={mode === 'home' ? t('cloud.emailPhHome') : t('cloud.emailPhUser')}
                  autoFocus dir="auto" className="z-input"
                  style={{ width: '100%', height: 38, padding: '0 12px', fontSize: 13, boxSizing: 'border-box' }} />
                <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 4 }}>
                  {mode === 'home' ? t('cloud.helpHome') : t('cloud.helpUser')}
                </p>
              </div>

              <div>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('cloud.role')}</p>
                <select value={role} onChange={e => setRole(e.target.value)} disabled={mode === 'home'}
                  style={{ width: '100%', height: 38, padding: '0 12px', borderRadius: 10, border: '0.5px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13, cursor: 'pointer' }}>
                  {(mode === 'home' ? ['super_admin', 'admin'] : ROLE_ORDER).map(r => (
                    <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>
                  ))}
                </select>
              </div>

              {mode === 'home' && (
                <div>
                  <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('cloud.homeName')} <span style={{ fontWeight: 400 }}>{t('cloud.optional')}</span></p>
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder={t('cloud.homeNamePh')}
                    dir="auto" className="z-input" style={{ width: '100%', height: 38, padding: '0 12px', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={handleClose} className="z-btn-secondary" style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12 }}>{t('common.cancel')}</button>
                <button onClick={handleCreate} disabled={saving} className="z-btn-primary" style={{ flex: 2, height: 38, borderRadius: 10, fontSize: 12 }}>
                  {saving ? t('cloud.sending') : email.trim()
                    ? mode === 'home' ? t('cloud.sendSetupEmail') : t('cloud.sendInviteEmail')
                    : t('cloud.createInviteLink')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Per-home card with expandable users ───────────────────────────────────────
function HomeCard({ home, users, invites, onRoleChange, onDeleteUser, onRevokeInvite, onInviteUser, onDeprovision, isLocal }) {
  const t = useT()
  const [expanded, setExpanded] = useState(isLocal)
  // Only show user invites under a home — home-type invites are for provisioning
  // new homes and should never appear as pending members of an existing home.
  const pending = invites.filter(i => i.status === 'pending' && i.type !== 'home')

  return (
    <Card style={{ marginBottom: 12 }}>
      {/* Home header */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent)15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Home size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{home.name}</p>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
              background: home.haConnected !== false ? 'var(--ok)18' : 'var(--warn)18',
              color: home.haConnected !== false ? 'var(--ok)' : 'var(--warn)',
            }}>
              {isLocal ? (home.haConnected ? t('cloud.haOnline') : t('cloud.haOffline')) : (home.status || t('cloud.unknown'))}
            </span>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)', background: 'var(--bg-2)', padding: '1px 7px', borderRadius: 999 }}>
              {home.type || t('cloud.hub')}
            </span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {users.length} {users.length !== 1 ? t('cloud.usersWordPlural') : t('cloud.usersWord')}{pending.length > 0 ? ` · ${pending.length} ${pending.length !== 1 ? t('cloud.pendingInviteWordPlural') : t('cloud.pendingInviteWord')}` : ''}
            {home.haUrl ? ` · ${home.haUrl}` : home.tunnel_url ? ` · ${home.tunnel_url}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {!isLocal && onDeprovision && (
            <button onClick={e => { e.stopPropagation(); onDeprovision() }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6 }}>
              <Trash2 size={13} />
            </button>
          )}
          {expanded ? <ChevronDown size={14} style={{ color: 'var(--ink-faint)' }} /> : <ChevronRight size={14} style={{ color: 'var(--ink-faint)' }} />}
        </div>
      </button>

      {/* Expanded: users + pending invites + invite button */}
      {expanded && (
        <div style={{ borderTop: '0.5px solid var(--line)' }}>
          {/* Active users */}
          {users.map(u => (
            <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 20px', borderBottom: '0.5px solid var(--line)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: (ROLE_COLOR[u.role] || '#6b7280') + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: ROLE_COLOR[u.role] || '#6b7280', flexShrink: 0 }}>
                {(u.username[0] || '?').toUpperCase()}
              </div>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
              {onRoleChange ? (
                <select value={u.role} onChange={e => onRoleChange(u.username, e.target.value)}
                  style={{ fontSize: 11, padding: '2px 6px', borderRadius: 7, border: '0.5px solid var(--line)', background: 'var(--surface)', color: ROLE_COLOR[u.role] || 'var(--ink)', fontWeight: 600, cursor: 'pointer' }}>
                  {ROLE_ORDER.map(r => <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>)}
                </select>
              ) : <RoleBadge role={u.role} />}
              {onDeleteUser && (
                <button onClick={() => onDeleteUser(u.username)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6 }}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}

          {/* Pending invites */}
          {pending.map(inv => (
            <div key={inv.token} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px', borderBottom: '0.5px solid var(--line)', opacity: 0.7 }}>
              <Clock size={13} style={{ color: 'var(--warn)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {inv.email || t('cloud.openInviteShort')} · {ROLE_LABEL_KEY[inv.role] ? t(ROLE_LABEL_KEY[inv.role]) : inv.role}
              </span>
              <span style={{ fontSize: 10, color: 'var(--warn)', fontWeight: 600, background: 'var(--warn)15', padding: '1px 6px', borderRadius: 6, flexShrink: 0 }}>{t('cloud.tagPending')}</span>
              {onRevokeInvite && (
                <button onClick={() => onRevokeInvite(inv.token)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6 }}>
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}

          {/* Invite button */}
          <div style={{ padding: '12px 20px' }}>
            <button onClick={onInviteUser} className="z-btn-secondary" style={{ width: '100%', height: 34, borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Plus size={13} /> {t('cloud.inviteUser')}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function CloudAdmin() {
  const t = useT()
  const { addToast } = useUIStore()
  const [users,       setUsers]       = useState([])
  const [invites,     setInvites]     = useState([])
  const [home,        setHome]        = useState(null)
  const [relayHomes,  setRelayHomes]  = useState([])
  const [relayOnline, setRelayOnline] = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [relayInput,  setRelayInput]  = useState({ url: getRelayUrl(), email: '', password: '' })
  const [relayConnecting, setRelayConnecting] = useState(false)

  // Modal state
  const [modal, setModal] = useState(null) // null | { mode: 'user'|'home', homeId, homeName }

  const load = useCallback(async () => {
    try {
      const [u, i, ha, health] = await Promise.all([
        getUsers(), listInvites(), getHaSettings(), getHealth(),
      ])
      setUsers(u)
      setInvites(i)
      setHome({
        name: t('cloud.thisHome'), type: 'hub',
        haUrl: ha.url || t('cloud.notConfiguredHa'),
        haConnected: health.ha_connected ?? false,
        offlineCount: health.offline_count ?? 0,
      })
    } catch { }

    if (isRelayConfigured()) {
      try { setRelayHomes(await relayListHomes()); setRelayOnline(true) }
      catch { setRelayOnline(false) }
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const connectRelay = async () => {
    setRelayConnecting(true)
    try {
      setRelayUrl(relayInput.url.trim().replace(/\/$/, ''))
      const res = await relayLogin({ email: relayInput.email, password: relayInput.password })
      if (!res.token) throw new Error('No token returned')
      setRelayToken(res.token); setRelayOnline(true)
      await load(); addToast(t('cloud.connected'), 'success')
    } catch (e) { addToast(e.message || t('cloud.failedConnect'), 'error') }
    finally { setRelayConnecting(false) }
  }

  // Local home handlers
  const handleRoleChange = async (username, tok) => {
    try { await updateUser(username, { role: tok }); setUsers(prev => prev.map(u => u.username === username ? { ...u, role: tok } : u)); addToast(t('cloud.roleUpdated'), 'success') }
    catch (e) { addToast(e.message || t('cloud.failed'), 'error') }
  }
  const handleDeleteUser = async (username) => {
    if (!window.confirm(t('cloud.removeUserConfirm', { name: username }))) return
    try { await deleteUser(username); setUsers(prev => prev.filter(u => u.username !== username)); addToast(t('cloud.userRemoved'), 'success') }
    catch (e) { addToast(e.message || t('cloud.failed'), 'error') }
  }
  const handleRevoke = async (tok) => {
    try { await revokeInvite(tok); setInvites(prev => prev.filter(i => i.token !== tok)); addToast(t('cloud.inviteRevoked'), 'success') }
    catch (e) { addToast(e.message || t('cloud.failed'), 'error') }
  }
  const handleDeprovision = async (homeId, name) => {
    if (!window.confirm(t('cloud.deprovisionConfirm', { name }))) return
    try { await relayDeprovision(homeId); await load(); addToast(t('cloud.deprovisioned', { name }), 'success') }
    catch (e) { addToast(e.message || t('cloud.failed'), 'error') }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 60px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Shield size={16} style={{ color: 'var(--accent)' }} />
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>{t('cloud.title')}</h1>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{t('cloud.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: 7, cursor: 'pointer' }}>
            <RefreshCw size={13} />
          </button>
          <button onClick={() => setModal({ mode: 'home', homeId: null, homeName: null })} className="z-btn-primary"
            style={{ height: 34, padding: '0 14px', borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> {t('cloud.newHome')}
          </button>
        </div>
      </div>

      {/* Relay status bar */}
      {isRelayConfigured() && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, padding: '8px 14px', background: 'var(--bg-2)', borderRadius: 10, border: '0.5px solid var(--line)' }}>
          {relayOnline
            ? <><CheckCircle size={12} style={{ color: 'var(--ok)' }} /><span style={{ fontSize: 11, color: 'var(--ok)', fontWeight: 600 }}>{t('cloud.relayOnline')}</span></>
            : <><WifiOff size={12} style={{ color: 'var(--warn)' }} /><span style={{ fontSize: 11, color: 'var(--warn)', fontWeight: 600 }}>{t('cloud.relayOffline')}</span></>}
          <span style={{ fontSize: 11, color: 'var(--ink-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getRelayUrl()}</span>
          <button onClick={() => { localStorage.removeItem('ziggy_relay_url'); localStorage.removeItem('ziggy_relay_token'); window.location.reload() }}
            style={{ fontSize: 10, color: 'var(--ink-faint)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            {t('cloud.disconnectBtn')}
          </button>
        </div>
      )}

      {/* Connect relay panel — shown above homes when not yet connected */}
      {!isRelayConfigured() && (
        <div style={{ marginBottom: 20, padding: '16px 20px', background: 'var(--bg-2)', border: '0.5px solid var(--line)', borderRadius: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{t('cloud.connectRelay')}</p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 12, lineHeight: 1.5 }}>
            {t('cloud.connectIntro')} {t('cloud.deployHint')} <code>relay/fly.toml</code>.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={relayInput.url} onChange={e => setRelayInput(s => ({ ...s, url: e.target.value }))} placeholder={t('cloud.relayUrlPh')} dir="auto" className="z-input" style={{ height: 34, padding: '0 10px', fontSize: 12, width: '100%', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={relayInput.email} onChange={e => setRelayInput(s => ({ ...s, email: e.target.value }))} placeholder={t('cloud.adminEmail')} type="email" dir="auto" className="z-input" style={{ flex: 1, height: 34, padding: '0 10px', fontSize: 12 }} />
              <input value={relayInput.password} onChange={e => setRelayInput(s => ({ ...s, password: e.target.value }))} placeholder={t('cloud.password')} type="password" dir="auto" className="z-input" style={{ flex: 1, height: 34, padding: '0 10px', fontSize: 12 }} />
              <button onClick={connectRelay} disabled={relayConnecting || !relayInput.url || !relayInput.email} className="z-btn-primary"
                style={{ height: 34, padding: '0 14px', borderRadius: 9, fontSize: 12, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                {relayConnecting ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Wifi size={12} />}
                {relayConnecting ? t('cloud.connecting') : t('cloud.connect')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Homes */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Home size={13} style={{ color: 'var(--ink-faint)' }} />
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
            {t('cloud.homesHeader', { n: 1 + relayHomes.length })}
          </p>
        </div>

        {/* This home */}
        {home && (
          <HomeCard
            home={home}
            users={users}
            invites={invites.filter(i => i.type !== 'home')}
            onRoleChange={handleRoleChange}
            onDeleteUser={handleDeleteUser}
            onRevokeInvite={handleRevoke}
            onInviteUser={() => setModal({ mode: 'user', homeId: 'local', homeName: home.name })}
            isLocal
          />
        )}

        {/* Relay homes */}
        {relayHomes.map(h => (
          <HomeCard
            key={h.id}
            home={{ ...h, haConnected: h.status === 'active' }}
            users={h.users || []}
            invites={[]}
            onInviteUser={() => setModal({ mode: 'user', homeId: h.id, homeName: h.name })}
            onDeprovision={() => handleDeprovision(h.id, h.name)}
            isLocal={false}
          />
        ))}
      </div>

      {/* Invite modal */}
      {modal && (
        <InviteModal
          open
          mode={modal.mode}
          homeId={modal.homeId}
          homeName={modal.homeName}
          onClose={() => setModal(null)}
          onCreated={load}
        />
      )}
    </div>
  )
}
