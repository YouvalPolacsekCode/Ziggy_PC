import { useEffect, useState, useCallback } from 'react'
import {
  Home, Copy, Trash2, Plus, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle, Clock, XCircle, Shield, Wifi, WifiOff, Loader, Users,
  Activity, Package, Database, Smartphone, LifeBuoy, Terminal,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { useUIStore } from '../stores/uiStore'
import { useT } from '../lib/i18n'
import { computeHealth, HEALTH_COLORS } from '../lib/fleetHealth'
import {
  getUsers, updateUser, deleteUser,
  listInvites, createInvite, revokeInvite,
  getHaSettings, getHealth,
  relayListHomes, relayGetHome, relayDeprovision,
  relayCreateInvite,
  relayHomeTelemetry,
  relayOtaReleases, relayHomeOtaPin, relaySetHomeOtaPin,
  relayOtaCohorts, relaySetHomeCohort,
  relayHomeBackupStatus,
  relayHomeMobileDevices,
  relayOpenSupportSession,
  relayFounderSlotsRemaining,
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

// ── Traffic-light pill for fleet health ───────────────────────────────────────
// Drives the pill colour + tooltip text from fleetHealth.computeHealth.
// Only used for relay-managed homes; the local home keeps its haConnected
// binary pill because computeHealth's heartbeat rule doesn't fit the local
// (no-telemetry-loop) shape.
function TrafficLightPill({ home, latestPayload }) {
  const t = useT()
  const { level, reasons } = computeHealth(home, latestPayload)
  const colors = HEALTH_COLORS[level]
  const tooltip = reasons.length === 0
    ? t(`fleetHealth.${level}`)
    : reasons.map(r => t(r.key, r.args || {})).join(' · ')
  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 10, fontWeight: 600, padding: '1px 8px', borderRadius: 999,
        background: colors.bg, color: colors.fg, border: `0.5px solid ${colors.border}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.fg }} />
      {t(`fleetHealth.${level}`)}
    </span>
  )
}

// ── Helpers for tab content rendering ─────────────────────────────────────────
function timeAgoLabel(t, iso) {
  if (!iso) return t('cloudAdmin.never')
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return t('cloudAdmin.never')
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return t('cloudAdmin.minutesAgo', { n: 0 })
  if (mins < 60) return t('cloudAdmin.minutesAgo', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('cloudAdmin.hoursAgo', { n: hours })
  return t('cloudAdmin.daysAgo', { n: Math.floor(hours / 24) })
}

function StatRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px dashed var(--line)' }}>
      <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{label}</span>
      <span style={{
        fontSize: 11, color: 'var(--ink)',
        fontFamily: mono ? '"IBM Plex Mono", monospace' : 'inherit',
        wordBreak: 'break-all', textAlign: 'right',
      }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function TabSpinner() {
  return (
    <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-faint)', fontSize: 11 }}>
      <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
      <span />
    </div>
  )
}

// ── Telemetry tab ─────────────────────────────────────────────────────────────
function TelemetryTab({ homeId, onPayload }) {
  const t = useT()
  const [state, setState] = useState({ status: 'loading', rows: [], error: null })
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', rows: [], error: null })
    relayHomeTelemetry(homeId, 1)
      .then(res => {
        if (cancelled) return
        setState({ status: 'ok', rows: res.rows || [], error: null })
        // Hand the latest payload back up so the pill can compute richer health
        // reasons (disk/CPU/battery) without an extra fetch.
        if (res.rows?.[0]?.payload) onPayload?.(res.rows[0].payload)
      })
      .catch(e => {
        if (cancelled) return
        setState({ status: 'error', rows: [], error: e?.message || 'load failed' })
      })
    return () => { cancelled = true }
  }, [homeId, onPayload])

  if (state.status === 'loading') return <TabSpinner />
  if (state.status === 'error') return (
    <p style={{ padding: 14, fontSize: 11, color: 'var(--warn)' }}>{t('cloudAdmin.tabLoadError')}: {state.error}</p>
  )
  if (state.rows.length === 0) return (
    <p style={{ padding: 14, fontSize: 11, color: 'var(--ink-faint)' }}>{t('cloudAdmin.telemetryNone')}</p>
  )

  const row = state.rows[0]
  const p = row.payload || {}
  const sensors = Array.isArray(p.sensors) ? p.sensors : []
  const containers = Array.isArray(p.containers) ? p.containers : []
  const containersDown = containers.filter(c => c?.state && c.state !== 'running').length
  const uptimeHours = p.uptime_s != null ? Math.floor(p.uptime_s / 3600) : null

  // Push delivery (Prompt 10 chunk 3 — option 1 piggyback). Edge agent is
  // expected to add these counters to the telemetry payload; until it
  // ships them, render the section with a "no data yet" stub so the
  // operator can see the feature exists and is waiting on the edge.
  const apnsSuccess = p.apns_success_24h
  const apnsFailure = p.apns_failure_24h
  const fcmSuccess  = p.fcm_success_24h
  const fcmFailure  = p.fcm_failure_24h
  const hasApns = apnsSuccess != null || apnsFailure != null
  const hasFcm  = fcmSuccess  != null || fcmFailure  != null

  return (
    <div style={{ padding: '12px 20px 16px' }}>
      <StatRow label={t('cloudAdmin.telemetryLastSeen')} value={timeAgoLabel(t, row.ts)} />
      <StatRow label={t('cloudAdmin.telemetryHaVersion')} value={p.ha_version} mono />
      <StatRow label={t('cloudAdmin.telemetryZiggyVersion')} value={p.ziggy_version} mono />
      {uptimeHours != null && <StatRow label={t('cloudAdmin.telemetryUptime')} value={`${uptimeHours} h`} />}
      <StatRow label={t('cloudAdmin.telemetryDisk')} value={p.disk_pct != null ? `${Math.round(p.disk_pct)}%` : null} />
      <StatRow label={t('cloudAdmin.telemetryCpu')}  value={p.cpu_pct  != null ? `${Math.round(p.cpu_pct)}%`  : null} />
      <StatRow label={t('cloudAdmin.telemetryMem')}  value={p.mem_pct  != null ? `${Math.round(p.mem_pct)}%`  : null} />
      <StatRow label={t('cloudAdmin.telemetrySensors')} value={sensors.length || null} />
      <StatRow label={t('cloudAdmin.telemetryContainers')} value={containers.length ? `${containers.length} (${containersDown} down)` : null} />
      <StatRow label={t('cloudAdmin.telemetryLastAutomation')} value={p.last_automation_trigger ? timeAgoLabel(t, p.last_automation_trigger) : null} />
      <StatRow
        label={t('cloudAdmin.telemetryPushApns')}
        value={hasApns
          ? t('cloudAdmin.telemetryPushDelivery', { success: apnsSuccess ?? 0, failure: apnsFailure ?? 0 })
          : t('cloudAdmin.telemetryPushStub')}
      />
      <StatRow
        label={t('cloudAdmin.telemetryPushFcm')}
        value={hasFcm
          ? t('cloudAdmin.telemetryPushDelivery', { success: fcmSuccess ?? 0, failure: fcmFailure ?? 0 })
          : t('cloudAdmin.telemetryPushStub')}
      />
      <button
        onClick={() => setShowRaw(v => !v)}
        style={{ marginTop: 10, fontSize: 10, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {showRaw ? '▼' : '▶'} {t('cloudAdmin.telemetryViewRaw')}
      </button>
      {showRaw && (
        <pre style={{
          fontSize: 9.5, color: 'var(--ink-mute)', background: 'var(--bg-2)',
          padding: 10, borderRadius: 8, overflow: 'auto',
          fontFamily: '"IBM Plex Mono", monospace', marginTop: 8,
          maxHeight: 240, border: '0.5px solid var(--line)',
        }}>
          {JSON.stringify(p, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ── OTA tab — per-home pin + cohort selectors ─────────────────────────────────
function OtaTab({ home }) {
  const t = useT()
  const { addToast } = useUIStore()
  const [releases, setReleases] = useState(null)
  const [cohorts,  setCohorts]  = useState(null)
  const [pinId,    setPinId]    = useState(home.ota_pinned_release_id ?? '')
  const [cohort,   setCohort]   = useState('')
  const [savingPin,    setSavingPin]    = useState(false)
  const [savingCohort, setSavingCohort] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    Promise.all([
      relayOtaReleases().catch(e => { throw e }),
      relayOtaCohorts().catch(e => { throw e }),
      relayHomeOtaPin(home.id).catch(() => null),
    ])
      .then(([rel, coh, pin]) => {
        if (cancelled) return
        setReleases(rel.releases || [])
        setCohorts(coh.cohorts || [])
        if (pin?.release_id != null) setPinId(String(pin.release_id))
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'load failed') })
    return () => { cancelled = true }
  }, [home.id])

  if (error) return <p style={{ padding: 14, fontSize: 11, color: 'var(--warn)' }}>{t('cloudAdmin.tabLoadError')}: {error}</p>
  if (releases == null || cohorts == null) return <TabSpinner />

  const savePin = async () => {
    setSavingPin(true)
    try {
      const next = pinId === '' ? null : Number(pinId)
      await relaySetHomeOtaPin(home.id, next)
      addToast(t('cloudAdmin.otaPinSaved'), 'success')
    } catch (e) { addToast(e?.message || t('cloudAdmin.tabLoadError'), 'error') }
    finally { setSavingPin(false) }
  }
  const saveCohort = async () => {
    setSavingCohort(true)
    try {
      await relaySetHomeCohort(home.id, cohort || null)
      addToast(t('cloudAdmin.otaCohortSaved'), 'success')
    } catch (e) { addToast(e?.message || t('cloudAdmin.tabLoadError'), 'error') }
    finally { setSavingCohort(false) }
  }

  const inputStyle = { width: '100%', height: 32, padding: '0 8px', borderRadius: 8, border: '0.5px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12 }

  return (
    <div style={{ padding: '14px 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('cloudAdmin.otaPinLabel')}</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={pinId} onChange={e => setPinId(e.target.value)} style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}>
            <option value="">{t('cloudAdmin.otaPinNone')}</option>
            {releases.map(r => (
              <option key={r.id} value={String(r.id)}>
                #{r.id} · HA {r.ha_version} · Ziggy {r.ziggy_version}
              </option>
            ))}
          </select>
          <button onClick={savePin} disabled={savingPin} className="z-btn-secondary" style={{ padding: '0 12px', height: 32, borderRadius: 8, fontSize: 11 }}>
            {savingPin ? '…' : t('cloudAdmin.otaSavePin')}
          </button>
        </div>
      </div>
      <div>
        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('cloudAdmin.otaCohortLabel')}</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={cohort} onChange={e => setCohort(e.target.value)} style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}>
            <option value="">{t('cloudAdmin.otaCohortNone')}</option>
            {cohorts.map(c => (
              <option key={c.cohort_name} value={c.cohort_name}>
                {c.cohort_name} → #{c.release_id} ({c.home_count})
              </option>
            ))}
          </select>
          <button onClick={saveCohort} disabled={savingCohort} className="z-btn-secondary" style={{ padding: '0 12px', height: 32, borderRadius: 8, fontSize: 11 }}>
            {savingCohort ? '…' : t('cloudAdmin.otaSaveCohort')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Backup tab — last backup + restore events ─────────────────────────────────
function BackupTab({ homeId }) {
  const t = useT()
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', data: null, error: null })
    relayHomeBackupStatus(homeId)
      .then(d => { if (!cancelled) setState({ status: 'ok', data: d, error: null }) })
      .catch(e => { if (!cancelled) setState({ status: 'error', data: null, error: e?.message || 'load failed' }) })
    return () => { cancelled = true }
  }, [homeId])

  if (state.status === 'loading') return <TabSpinner />
  if (state.status === 'error') return <p style={{ padding: 14, fontSize: 11, color: 'var(--warn)' }}>{t('cloudAdmin.tabLoadError')}: {state.error}</p>
  const d = state.data || {}
  const restoreEvents = Array.isArray(d.restore_events) ? d.restore_events : []
  if (!d.last_backup_at && !d.last_unsealed_at && restoreEvents.length === 0) {
    return <p style={{ padding: 14, fontSize: 11, color: 'var(--ink-faint)' }}>{t('cloudAdmin.backupNoStatus')}</p>
  }

  return (
    <div style={{ padding: '12px 20px 16px' }}>
      <StatRow label={t('cloudAdmin.backupLastBackup')} value={d.last_backup_at ? timeAgoLabel(t, d.last_backup_at) : null} />
      <StatRow
        label={t('cloudAdmin.backupKeyState')}
        value={d.last_unsealed_at
          ? t('cloudAdmin.backupKeyUnsealed', { by: d.last_unsealed_by || '?', when: timeAgoLabel(t, d.last_unsealed_at) })
          : t('cloudAdmin.backupKeySealed')}
      />
      <div style={{ marginTop: 10 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          {t('cloudAdmin.backupRestoreEvents')}
        </p>
        {restoreEvents.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('cloudAdmin.backupNoRestoreEvents')}</p>
        ) : restoreEvents.map((ev, i) => (
          <div key={i} style={{ fontSize: 11, color: 'var(--ink-mute)', padding: '4px 0', borderBottom: '0.5px dashed var(--line)', fontFamily: '"IBM Plex Mono", monospace' }}>
            {ev.ts} · {ev.event} {ev.ok === false ? '(failed)' : ''}
          </div>
        ))}
      </div>
    </div>
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

// ── User row with expand-for-detail (Prompt 10 chunk 3) ──────────────────────
// Per-user view: collapsed row matches the pre-chunk-3 shape (avatar +
// username + role + delete). Click expands to show the email, the home's
// subscription state (per-home concept, surfaced under the owner row for
// context), a "Devices" count filtered out of the parent HomeCard's mobile
// list when available, and a deep link into /ops/audit pre-filtered to
// this home + the founder's support_session events.
function UserRow({
  user, isLocal, home,
  onRoleChange, onDeleteUser,
  mobileDevices,
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)

  const stopRowToggle = (e) => e.stopPropagation()
  const userId = user.id || user.email || user.username
  const devicesForUser = Array.isArray(mobileDevices)
    ? mobileDevices.filter(d => {
        const owner = d.user_id || d.user_email || d.email || d.username
        return owner && userId && String(owner).toLowerCase() === String(userId).toLowerCase()
      })
    : null
  const subState = !isLocal ? home?.subscription_state : null
  const auditDeepLink = !isLocal
    ? `/ops/audit?home_id=${encodeURIComponent(home.id)}&event=support_session_opened`
    : null

  return (
    <div style={{ borderBottom: '0.5px solid var(--line)' }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 20px', cursor: 'pointer' }}
      >
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: (ROLE_COLOR[user.role] || '#6b7280') + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: ROLE_COLOR[user.role] || '#6b7280', flexShrink: 0 }}>
          {(user.username?.[0] || user.email?.[0] || '?').toUpperCase()}
        </div>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.username || user.email || '?'}
        </span>
        {onRoleChange ? (
          <select
            value={user.role}
            onChange={e => onRoleChange(user.username, e.target.value)}
            onClick={stopRowToggle}
            style={{ fontSize: 11, padding: '2px 6px', borderRadius: 7, border: '0.5px solid var(--line)', background: 'var(--surface)', color: ROLE_COLOR[user.role] || 'var(--ink)', fontWeight: 600, cursor: 'pointer' }}
          >
            {ROLE_ORDER.map(r => <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>)}
          </select>
        ) : <RoleBadge role={user.role} />}
        {onDeleteUser && (
          <button
            onClick={e => { stopRowToggle(e); onDeleteUser(user.username) }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6 }}
          >
            <Trash2 size={12} />
          </button>
        )}
        {expanded ? <ChevronDown size={12} style={{ color: 'var(--ink-faint)' }} /> : <ChevronRight size={12} className="icon-flip-rtl" style={{ color: 'var(--ink-faint)' }} />}
      </div>
      {expanded && (
        <div style={{ padding: '10px 20px 14px', background: 'var(--bg-2)', borderTop: '0.5px solid var(--line)' }}>
          {user.email && user.email !== user.username && (
            <StatRow label={t('cloudAdmin.userEmail')} value={user.email} mono />
          )}
          {user.created_at && (
            <StatRow label={t('cloudAdmin.userCreated')} value={timeAgoLabel(t, user.created_at)} />
          )}
          {subState && (
            <StatRow label={t('cloudAdmin.userSubscription')} value={subState} />
          )}
          {devicesForUser !== null && (
            <StatRow label={t('cloudAdmin.userDevices')} value={devicesForUser.length} />
          )}
          {auditDeepLink && (
            <a
              href={auditDeepLink}
              onClick={stopRowToggle}
              style={{ display: 'inline-block', marginTop: 8, fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}
            >
              {t('cloudAdmin.userViewAudit')} →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ── Mobile devices tab — paired phones for this home ──────────────────────────
function MobileTab({ homeId, onDevicesLoaded }) {
  const t = useT()
  const [state, setState] = useState({ status: 'loading', devices: [], error: null })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', devices: [], error: null })
    relayHomeMobileDevices(homeId)
      .then(d => {
        if (cancelled) return
        const devices = d.devices || []
        setState({ status: 'ok', devices, error: null })
        // Hand list up so the per-user expansion in Members tab can show
        // owned device counts without re-fetching.
        onDevicesLoaded?.(devices)
      })
      .catch(e => { if (!cancelled) setState({ status: 'error', devices: [], error: e?.message || 'load failed' }) })
    return () => { cancelled = true }
  }, [homeId, onDevicesLoaded])

  if (state.status === 'loading') return <TabSpinner />
  if (state.status === 'error')   return <p style={{ padding: 14, fontSize: 11, color: 'var(--warn)' }}>{t('cloudAdmin.tabLoadError')}: {state.error}</p>
  if (state.devices.length === 0) return <p style={{ padding: 14, fontSize: 11, color: 'var(--ink-faint)' }}>{t('cloudAdmin.mobileNone')}</p>

  return (
    <div>
      {state.devices.map(d => {
        const platform = (d.platform || '').toLowerCase()
        const platformLabel = platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : (d.platform || t('cloudAdmin.mobileUnknownPlatform'))
        const lastSeen = d.last_seen_at || d.last_seen || d.last_active_at
        const hasToken = !!(d.push_token || d.apns_token || d.fcm_token || d.web_push_endpoint)
        return (
          <div key={d.device_id || d.id} style={{ padding: '10px 20px', borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Smartphone size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, color: 'var(--ink)' }}>
                {platformLabel}
                {d.device_name && <span style={{ color: 'var(--ink-mute)' }}> · {d.device_name}</span>}
                {d.ws_connected && (
                  <span style={{ marginLeft: 6, fontSize: 9, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ok)', background: 'color-mix(in srgb, var(--ok) 14%, var(--surface))', padding: '1px 5px', borderRadius: 4 }}>
                    {t('cloudAdmin.mobileOnline')}
                  </span>
                )}
              </p>
              <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 1, fontFamily: '"IBM Plex Mono", monospace' }}>
                {t('cloudAdmin.mobileLastSeen', { when: lastSeen ? timeAgoLabel(t, lastSeen) : t('cloudAdmin.never') })}
                {' · '}
                {hasToken ? t('cloudAdmin.mobilePushOk') : t('cloudAdmin.mobilePushMissing')}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Support session modal — Option 1: audit + SSH runbook snippet ─────────────
function SupportSessionModal({ open, onClose, homeId, homeName }) {
  const t = useT()
  const { addToast } = useUIStore()
  const [reason, setReason] = useState('')
  const [opening, setOpening] = useState(false)
  const [result, setResult] = useState(null)

  if (!open) return null

  const reset = () => { setReason(''); setResult(null) }
  const handleClose = () => { reset(); onClose() }

  const handleOpen = async () => {
    setOpening(true)
    try {
      const r = await relayOpenSupportSession(homeId, reason)
      setResult(r)
    } catch (e) {
      addToast(e?.message || t('cloudAdmin.supportOpenFailed'), 'error')
    } finally {
      setOpening(false)
    }
  }

  const copySnippet = () => {
    if (!result?.ssh_snippet) return
    navigator.clipboard.writeText(result.ssh_snippet).catch(() => {})
    addToast(t('cloudAdmin.supportSnippetCopied'), 'success')
  }

  return (
    <div onClick={e => e.target === e.currentTarget && handleClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, border: '0.5px solid var(--line)', width: '100%', maxWidth: 460, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LifeBuoy size={16} style={{ color: 'var(--accent)' }} />
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', flex: 1 }}>
            {result ? t('cloudAdmin.supportSessionOpenedTitle') : t('cloudAdmin.supportOpenTitle', { home: homeName || homeId })}
          </p>
        </div>
        {!result ? (
          <>
            <p style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{t('cloudAdmin.supportOpenBlurb')}</p>
            <div>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('cloudAdmin.supportReasonLabel')}</p>
              <textarea value={reason} onChange={e => setReason(e.target.value)}
                placeholder={t('cloudAdmin.supportReasonPh')}
                dir="auto" className="z-input"
                style={{ width: '100%', minHeight: 64, padding: 10, fontSize: 12, boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={handleClose} className="z-btn-secondary" style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12 }}>{t('common.cancel')}</button>
              <button onClick={handleOpen} disabled={opening} className="z-btn-primary" style={{ flex: 2, height: 38, borderRadius: 10, fontSize: 12 }}>
                {opening ? t('cloudAdmin.supportOpening') : t('cloudAdmin.supportOpenAction')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'color-mix(in srgb, var(--ok) 12%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--ok) 30%, transparent)' }}>
              <p style={{ fontSize: 11, color: 'var(--ok)', fontWeight: 600 }}>{t('cloudAdmin.supportAuditWritten', { id: result.audit_id ?? '?' })}</p>
              <p style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 4 }}>{t('cloudAdmin.supportNotificationStub')}</p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Terminal size={11} /> {t('cloudAdmin.supportSnippetLabel')}
              </p>
              <pre dir="ltr" style={{
                background: 'var(--bg-2)', borderRadius: 8, padding: '10px 12px',
                fontSize: 11.5, color: 'var(--ink)', fontFamily: '"IBM Plex Mono", monospace',
                border: '0.5px solid var(--line)', overflowX: 'auto', margin: 0,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>{result.ssh_snippet}</pre>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
              {t('cloudAdmin.supportRunbookHint')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={copySnippet} className="z-btn-secondary" style={{ flex: 1, height: 36, borderRadius: 9, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Copy size={12} /> {t('cloudAdmin.supportCopySnippet')}
              </button>
              <button onClick={handleClose} className="z-btn-primary" style={{ flex: 1, height: 36, borderRadius: 9, fontSize: 12 }}>
                {t('common.done')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Founder slot counter ──────────────────────────────────────────────────────
// Reads /api/billing/founder-slots/remaining (public, rate-limited). Shows the
// "N of 30 founder slots remaining" mini-widget in the homes header. Silent
// no-op when the relay isn't configured (no slot bookkeeping locally).
function FounderSlotWidget() {
  const t = useT()
  const [state, setState] = useState({ status: 'loading', remaining: null, total: null })

  useEffect(() => {
    if (!isRelayConfigured()) {
      setState({ status: 'na', remaining: null, total: null })
      return
    }
    let cancelled = false
    relayFounderSlotsRemaining()
      .then(d => { if (!cancelled) setState({ status: 'ok', remaining: d?.remaining, total: d?.total ?? 30 }) })
      .catch(()  => { if (!cancelled) setState({ status: 'error', remaining: null, total: null }) })
    return () => { cancelled = true }
  }, [])

  if (state.status === 'na' || state.status === 'error') return null
  if (state.status === 'loading') {
    return (
      <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
        {t('cloud.founderSlotsLoading')}
      </span>
    )
  }
  const { remaining, total } = state
  const claimed = (total ?? 30) - (remaining ?? 0)
  const pct = total ? Math.min(100, Math.max(0, (claimed / total) * 100)) : 0
  // Tint red as we approach the cap.
  const tone = remaining <= 3 ? 'var(--warn)' : remaining <= 10 ? 'var(--accent)' : 'var(--ok)'

  return (
    <div
      title={t('cloud.founderSlotsTooltip', { claimed, total })}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 999, border: '0.5px solid var(--line)', background: 'var(--bg-2)' }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink)' }}>
        {t('cloud.founderSlots', { remaining, total })}
      </span>
      <span style={{ width: 60, height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: tone, transition: 'width 0.3s' }} />
      </span>
    </div>
  )
}

// ── Per-home card with expandable users ───────────────────────────────────────
//
// Relay-managed homes get a 4-tab expansion (Members / Telemetry / OTA /
// Backup), with the first tab being the pre-existing users+invites surface
// unchanged. Local home stays single-pane (no telemetry pipe to Prompt 2's
// relay endpoints, no per-home OTA pin, no relay backup status — these
// only exist for cloud-provisioned homes).
function HomeCard({ home, users, invites, onRoleChange, onDeleteUser, onRevokeInvite, onInviteUser, onDeprovision, isLocal }) {
  const t = useT()
  const [expanded, setExpanded] = useState(isLocal)
  const [tab, setTab] = useState('members')
  // TelemetryTab hands the latest payload up here so the traffic-light pill
  // can compute disk/CPU/battery reasons on top of the heartbeat baseline
  // without firing a second relay request.
  const [livePayload, setLivePayload] = useState(null)
  // Only show user invites under a home — home-type invites are for provisioning
  // new homes and should never appear as pending members of an existing home.
  const pending = invites.filter(i => i.status === 'pending' && i.type !== 'home')

  const [supportModalOpen, setSupportModalOpen] = useState(false)
  // Cached mobile device list. Populated by MobileTab on first activation
  // and reused by the per-user expansion in Members tab so we don't issue
  // duplicate /mobile-devices fetches.
  const [cachedMobileDevices, setCachedMobileDevices] = useState(null)

  const tabs = [
    { id: 'members',   icon: Users,      labelKey: 'cloudAdmin.tabMembers' },
    { id: 'telemetry', icon: Activity,   labelKey: 'cloudAdmin.tabTelemetry' },
    { id: 'mobile',    icon: Smartphone, labelKey: 'cloudAdmin.tabMobile' },
    { id: 'ota',       icon: Package,    labelKey: 'cloudAdmin.tabOta' },
    { id: 'backup',    icon: Database,   labelKey: 'cloudAdmin.tabBackup' },
  ]

  const membersContent = (
    <>
      {/* Active users — each row expands to show account / sub / devices /
          deep link into /ops/audit pre-filtered to this home + this user. */}
      {users.map(u => (
        <UserRow
          key={u.username || u.email || u.id}
          user={u}
          isLocal={isLocal}
          home={home}
          onRoleChange={onRoleChange}
          onDeleteUser={onDeleteUser}
          mobileDevices={cachedMobileDevices}
        />
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
    </>
  )

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
            {isLocal ? (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
                background: home.haConnected !== false ? 'var(--ok)18' : 'var(--warn)18',
                color: home.haConnected !== false ? 'var(--ok)' : 'var(--warn)',
              }}>
                {home.haConnected ? t('cloud.haOnline') : t('cloud.haOffline')}
              </span>
            ) : (
              <TrafficLightPill home={home} latestPayload={livePayload} />
            )}
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
          {!isLocal && (
            <button
              onClick={e => { e.stopPropagation(); setSupportModalOpen(true) }}
              title={t('cloudAdmin.supportOpenTooltip')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6 }}
            >
              <LifeBuoy size={13} />
            </button>
          )}
          {!isLocal && onDeprovision && (
            <button onClick={e => { e.stopPropagation(); onDeprovision() }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6 }}>
              <Trash2 size={13} />
            </button>
          )}
          {expanded ? <ChevronDown size={14} style={{ color: 'var(--ink-faint)' }} /> : <ChevronRight size={14} className="icon-flip-rtl" style={{ color: 'var(--ink-faint)' }} />}
        </div>
      </button>

      {/* Expanded section */}
      {expanded && (
        <div style={{ borderTop: '0.5px solid var(--line)' }}>
          {/* Local home: no tabs (no relay-side data sources). */}
          {isLocal ? membersContent : (
            <>
              {/* Tab strip */}
              <div style={{ display: 'flex', borderBottom: '0.5px solid var(--line)', background: 'var(--bg-2)' }}>
                {tabs.map(({ id, icon: Icon, labelKey }) => {
                  const active = tab === id
                  return (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                        color: active ? 'var(--accent)' : 'var(--ink-faint)',
                        borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                      }}
                    >
                      <Icon size={12} />
                      {t(labelKey)}
                    </button>
                  )
                })}
              </div>

              {/* Tab content — lazy: each tab fetches on first activation. */}
              {tab === 'members'   && membersContent}
              {tab === 'telemetry' && <TelemetryTab homeId={home.id} onPayload={setLivePayload} />}
              {tab === 'mobile'    && <MobileTab homeId={home.id} onDevicesLoaded={setCachedMobileDevices} />}
              {tab === 'ota'       && <OtaTab home={home} />}
              {tab === 'backup'    && <BackupTab homeId={home.id} />}
            </>
          )}
        </div>
      )}

      {/* Support session modal — mounted at card level so it survives tab
          switches and isn't tied to any one tab's lifecycle. Only used
          for non-local homes (the relay endpoint requires a home_id). */}
      {!isLocal && (
        <SupportSessionModal
          open={supportModalOpen}
          onClose={() => setSupportModalOpen(false)}
          homeId={home.id}
          homeName={home.name}
        />
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
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-faint)', flex: 1 }}>
            {t('cloud.homesHeader', { n: 1 + relayHomes.length })}
          </p>
          <FounderSlotWidget />
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
