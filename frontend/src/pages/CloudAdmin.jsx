import { useEffect, useState, useCallback } from 'react'
import {
  Home, Copy, Trash2, Plus, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle, Clock, XCircle, Shield, Wifi, WifiOff, Loader, Users,
  Activity, Package, Database,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { useUIStore } from '../stores/uiStore'
import { useT } from '../lib/i18n'
import { computeHealth, HEALTH_COLORS } from '../lib/fleetHealth'
import {
  getUsers, updateUser, deleteUser,
  listInvites, createInvite, revokeInvite,
  getHaSettings, getHealth,
  relayListHomes, relayGetHome, relayProvision, relayDeprovision,
  relayCreateInvite,
  relayHomeTelemetry,
  relayOtaReleases, relayHomeOtaPin, relaySetHomeOtaPin,
  relayOtaCohorts, relaySetHomeCohort,
  relayHomeBackupStatus,
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

  // Push delivery (Prompt 10 chunk 3 design — option 1 piggyback). Edge agent
  // is expected to add these counters to its telemetry payload. Until then,
  // they read as undefined and the rows simply don't render.
  const apnsSuccess = p.apns_success_24h
  const apnsFailure = p.apns_failure_24h
  const fcmSuccess  = p.fcm_success_24h
  const fcmFailure  = p.fcm_failure_24h
  const showPush = [apnsSuccess, apnsFailure, fcmSuccess, fcmFailure].some(v => v != null)

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
      {showPush && (
        <>
          <StatRow
            label={t('cloudAdmin.telemetryPushApns')}
            value={apnsSuccess != null || apnsFailure != null
              ? t('cloudAdmin.telemetryPushDelivery', { success: apnsSuccess ?? 0, failure: apnsFailure ?? 0 })
              : null}
          />
          <StatRow
            label={t('cloudAdmin.telemetryPushFcm')}
            value={fcmSuccess != null || fcmFailure != null
              ? t('cloudAdmin.telemetryPushDelivery', { success: fcmSuccess ?? 0, failure: fcmFailure ?? 0 })
              : null}
          />
        </>
      )}
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

  const tabs = [
    { id: 'members',   icon: Users,    labelKey: 'cloudAdmin.tabMembers' },
    { id: 'telemetry', icon: Activity, labelKey: 'cloudAdmin.tabTelemetry' },
    { id: 'ota',       icon: Package,  labelKey: 'cloudAdmin.tabOta' },
    { id: 'backup',    icon: Database, labelKey: 'cloudAdmin.tabBackup' },
  ]

  const membersContent = (
    <>
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
          {!isLocal && onDeprovision && (
            <button onClick={e => { e.stopPropagation(); onDeprovision() }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6 }}>
              <Trash2 size={13} />
            </button>
          )}
          {expanded ? <ChevronDown size={14} style={{ color: 'var(--ink-faint)' }} /> : <ChevronRight size={14} style={{ color: 'var(--ink-faint)' }} />}
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
              {tab === 'ota'       && <OtaTab home={home} />}
              {tab === 'backup'    && <BackupTab homeId={home.id} />}
            </>
          )}
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
