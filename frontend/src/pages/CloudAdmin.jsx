import { useEffect, useState, useCallback } from 'react'
import {
  Home, Copy, Trash2, Plus, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle, Clock, XCircle, Shield, Wifi, WifiOff, Loader, Users,
  Activity, Package, Database, Smartphone, LifeBuoy, Terminal,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import FleetOps from '../components/admin/ops/FleetOps'
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
// Role colour rides on an 8px dot next to the word; the word itself stays
// ink so the 13px chip passes contrast in both palettes.
const ROLE_DOT = { super_admin: 'var(--info)', admin: 'var(--info)', user: 'var(--ok)', guest: 'var(--ink-faint)' }

function Dot({ color }) {
  return <span className="z-dot" style={{ background: color }} />
}

function RoleBadge({ role }) {
  const t = useT()
  const labelKey = ROLE_LABEL_KEY[role]
  return (
    <span className="z-chip" style={{ gap: 6 }}>
      <Dot color={ROLE_DOT[role] || 'var(--ink-faint)'} />
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
      className="z-chip"
      style={{ gap: 6, background: colors.bg, color: colors.fg, borderColor: colors.border }}
    >
      <Dot color={colors.dot} />
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
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', padding: '8px 0', borderBottom: '0.5px dashed var(--line)' }}>
      <span className="z-footnote" style={{ flexShrink: 0 }}>{label}</span>
      <span className={mono ? 'z-code' : undefined} style={{
        fontSize: mono ? 13 : 15, color: 'var(--ink)',
        wordBreak: 'break-all', textAlign: 'end',
      }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function TabSpinner() {
  return (
    <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-mute)' }}>
      <Loader size={18} strokeWidth={1.75} className="z-spin" />
      <span />
    </div>
  )
}

function TabError({ children }) {
  return <p style={{ padding: 16, fontSize: 15, color: 'var(--warn-text)' }}>{children}</p>
}
function TabEmpty({ children }) {
  return <p className="z-body" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-mute)' }}>{children}</p>
}
function FieldLabel({ children }) {
  return <p className="z-footnote" style={{ marginBottom: 4 }}>{children}</p>
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
    <TabError>{t('cloudAdmin.tabLoadError')}: {state.error}</TabError>
  )
  if (state.rows.length === 0) return (
    <TabEmpty>{t('cloudAdmin.telemetryNone')}</TabEmpty>
  )

  const row = state.rows[0]
  const p = row.payload || {}
  const sensors = Array.isArray(p.sensors) ? p.sensors : []
  const containers = Array.isArray(p.containers) ? p.containers : []
  const containersDown = containers.filter(c => c?.state && c.state !== 'running').length
  const uptimeHours = p.uptime_s != null ? Math.floor(p.uptime_s / 3600) : null

  // Push delivery over the last 24 h, from services/push_stats.py. Push is how
  // a home reports a door opening or a problem, so a broken delivery path is
  // otherwise indistinguishable from a quiet house. A hub older than the
  // counters reports nothing here, which is a different statement from zero.
  const apnsSuccess = p.apns_success_24h
  const apnsFailure = p.apns_failure_24h
  const fcmSuccess  = p.fcm_success_24h
  const fcmFailure  = p.fcm_failure_24h
  const webSuccess  = p.web_success_24h
  const webFailure  = p.web_failure_24h
  const hasApns = apnsSuccess != null || apnsFailure != null
  const hasFcm  = fcmSuccess  != null || fcmFailure  != null
  const hasWeb  = webSuccess  != null || webFailure  != null

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
      <StatRow
        label={t('cloudAdmin.telemetryPushWeb')}
        value={hasWeb
          ? t('cloudAdmin.telemetryPushDelivery', { success: webSuccess ?? 0, failure: webFailure ?? 0 })
          : t('cloudAdmin.telemetryPushStub')}
      />
      <Button variant="ghost" size="sm" onClick={() => setShowRaw(v => !v)} style={{ marginTop: 12, paddingInline: 8 }}>
        {showRaw
          ? <ChevronDown size={18} strokeWidth={1.75} />
          : <ChevronRight size={18} strokeWidth={1.75} className="icon-flip-rtl" />}
        {t('cloudAdmin.telemetryViewRaw')}
      </Button>
      {showRaw && (
        <pre className="z-code" style={{
          fontSize: 13, lineHeight: '18px', color: 'var(--ink-mute)', background: 'var(--surface-2)',
          padding: 12, borderRadius: 'var(--r-ctl)', overflow: 'auto', marginTop: 8,
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

  if (error) return <TabError>{t('cloudAdmin.tabLoadError')}: {error}</TabError>
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

  return (
    <div style={{ padding: '16px 20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <FieldLabel>{t('cloudAdmin.otaPinLabel')}</FieldLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={pinId} onChange={e => setPinId(e.target.value)} className="z-input" style={{ flex: 1, cursor: 'pointer' }}>
            <option value="">{t('cloudAdmin.otaPinNone')}</option>
            {releases.map(r => (
              <option key={r.id} value={String(r.id)}>
                #{r.id} · HA {r.ha_version} · Ziggy {r.ziggy_version}
              </option>
            ))}
          </select>
          <button onClick={savePin} disabled={savingPin} className="z-btn-secondary">
            {savingPin ? '…' : t('cloudAdmin.otaSavePin')}
          </button>
        </div>
      </div>
      <div>
        <FieldLabel>{t('cloudAdmin.otaCohortLabel')}</FieldLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={cohort} onChange={e => setCohort(e.target.value)} className="z-input" style={{ flex: 1, cursor: 'pointer' }}>
            <option value="">{t('cloudAdmin.otaCohortNone')}</option>
            {cohorts.map(c => (
              <option key={c.cohort_name} value={c.cohort_name}>
                {c.cohort_name} → #{c.release_id} ({c.home_count})
              </option>
            ))}
          </select>
          <button onClick={saveCohort} disabled={savingCohort} className="z-btn-secondary">
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
  if (state.status === 'error') return <TabError>{t('cloudAdmin.tabLoadError')}: {state.error}</TabError>
  const d = state.data || {}
  const restoreEvents = Array.isArray(d.restore_events) ? d.restore_events : []
  // The relay reports a backup RUN: {ts, outcome, stage, files, uploaded_bytes,
  // error_reason, dry_run}. This tab was reading last_backup_at /
  // last_unsealed_at — field names the endpoint has never returned — so a home
  // backing itself up nightly to B2 rendered as "No backup status reported".
  // `ts` is the authoritative timestamp; the old names are kept as fallbacks in
  // case an older relay is ever on the other end.
  const lastBackupAt = d.ts || d.last_backup_at || null
  const outcome = d.outcome || (d.error_reason ? 'failed' : null)
  const failed = outcome && outcome !== 'success'
  const sizeMb = typeof d.uploaded_bytes === 'number'
    ? (d.uploaded_bytes / 1_048_576).toFixed(1) + ' MB'
    : null
  const fileCount = Array.isArray(d.files) ? d.files.length : null

  if (!lastBackupAt && !d.last_unsealed_at && restoreEvents.length === 0) {
    return <TabEmpty>{t('cloudAdmin.backupNoStatus')}</TabEmpty>
  }

  return (
    <div style={{ padding: '12px 20px 16px' }}>
      <StatRow label={t('cloudAdmin.backupLastBackup')} value={lastBackupAt ? timeAgoLabel(t, lastBackupAt) : null} />
      {outcome && (
        <StatRow
          label="Outcome"
          value={
            <span style={{ color: failed ? 'var(--err-text)' : 'var(--ok-text)', fontWeight: 600 }}>
              {failed ? `${outcome}${d.error_reason ? ` — ${d.error_reason}` : ''}` : 'success'}
              {d.dry_run ? ' (dry run)' : ''}
            </span>
          }
        />
      )}
      {fileCount != null && (
        <StatRow label="Archives" value={`${fileCount} file${fileCount === 1 ? '' : 's'}${sizeMb ? ` · ${sizeMb}` : ''}`} />
      )}
      <StatRow
        label={t('cloudAdmin.backupKeyState')}
        value={d.last_unsealed_at
          ? t('cloudAdmin.backupKeyUnsealed', { by: d.last_unsealed_by || '?', when: timeAgoLabel(t, d.last_unsealed_at) })
          : t('cloudAdmin.backupKeySealed')}
      />
      <div style={{ marginTop: 16 }}>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>
          {t('cloudAdmin.backupRestoreEvents')}
        </p>
        {restoreEvents.length === 0 ? (
          <p className="z-subhead">{t('cloudAdmin.backupNoRestoreEvents')}</p>
        ) : restoreEvents.map((ev, i) => (
          <div key={i} className="z-mono" style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '8px 0', borderBottom: '0.5px dashed var(--line)' }}>
            {ev.ts} · {ev.event} {ev.ok === false ? '(failed)' : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared modal shell ────────────────────────────────────────────────────────
function ModalShell({ onClose, maxWidth, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-sheet)', border: '0.5px solid var(--line)', width: '100%', maxWidth, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        {children}
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
    <ModalShell onClose={handleClose} maxWidth={420}>
      <div style={{ padding: '24px 24px 16px', borderBottom: '0.5px solid var(--line)' }}>
        <p className="z-title3">
          {link
            ? (mode === 'home' ? t('cloud.modalNewHomeInvite') : t('cloud.modalUserInvited'))
            : (mode === 'home' ? t('cloud.modalSetUpHome') : t('cloud.modalInviteUserTo', { home: homeName || t('cloud.modalFallbackHome') }))}
        </p>
      </div>

      <div style={{ padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {link ? (
          <>
            {emailSent && (
              <div className="bg-ok-soft" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', padding: '12px 16px' }}>
                <CheckCircle size={20} strokeWidth={1.75} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ok-text)', fontWeight: 600 }}>
                  {mode === 'home' ? t('cloud.setupEmailSent') : t('cloud.inviteEmailSent')} {t('cloud.emailToStrong')} <strong>{email}</strong>
                </p>
              </div>
            )}
            {emailError && (
              <div className="bg-warn-soft" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', padding: '12px 16px' }}>
                <XCircle size={20} strokeWidth={1.75} style={{ color: 'var(--warn)', flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--warn-text)', fontWeight: 600, marginBottom: 2 }}>{t('cloud.emailNotSent')}</p>
                  <p className="z-footnote">{emailError}</p>
                </div>
              </div>
            )}
            <p className="z-footnote">{t('cloud.linkExpires')}</p>
            <div className="z-code" style={{ background: 'var(--surface-2)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', padding: 12, fontSize: 13, lineHeight: '18px', color: 'var(--ink)', wordBreak: 'break-all' }}>
              {link}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={copyLink} className="z-btn-secondary" style={{ flex: 1 }}>
                <Copy size={18} strokeWidth={1.75} /> {t('cloud.copyLink')}
              </button>
              <button onClick={handleClose} className="z-btn-primary">{t('cloud.doneBtn')}</button>
            </div>
          </>
        ) : (
          <>
            <div>
              <FieldLabel>
                {t('cloud.emailLabel')} {mode === 'home' ? <span>{t('cloud.emailOptional')}</span> : ''}
              </FieldLabel>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder={mode === 'home' ? t('cloud.emailPhHome') : t('cloud.emailPhUser')}
                autoFocus dir="auto" className="z-input"
                style={{ boxSizing: 'border-box' }} />
              <p className="z-footnote" style={{ marginTop: 4 }}>
                {mode === 'home' ? t('cloud.helpHome') : t('cloud.helpUser')}
              </p>
            </div>

            <div>
              <FieldLabel>{t('cloud.role')}</FieldLabel>
              <select value={role} onChange={e => setRole(e.target.value)} disabled={mode === 'home'}
                className="z-input" style={{ cursor: 'pointer' }}>
                {(mode === 'home' ? ['super_admin', 'admin'] : ROLE_ORDER).map(r => (
                  <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>
                ))}
              </select>
            </div>

            {mode === 'home' && (
              <div>
                <FieldLabel>{t('cloud.homeName')} <span>{t('cloud.optional')}</span></FieldLabel>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder={t('cloud.homeNamePh')}
                  dir="auto" className="z-input" style={{ boxSizing: 'border-box' }} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={handleClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
              <button onClick={handleCreate} disabled={saving} className="z-btn-primary" style={{ flex: 2 }}>
                {saving ? t('cloud.sending') : email.trim()
                  ? mode === 'home' ? t('cloud.sendSetupEmail') : t('cloud.sendInviteEmail')
                  : t('cloud.createInviteLink')}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
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
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', minHeight: 56, cursor: 'pointer' }}
      >
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ink)', flexShrink: 0 }}>
          {(user.username?.[0] || user.email?.[0] || '?').toUpperCase()}
        </div>
        <span className="z-headline" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.username || user.email || '?'}
        </span>
        {onRoleChange ? (
          <select
            value={user.role}
            onChange={e => onRoleChange(user.username, e.target.value)}
            onClick={stopRowToggle}
            className="z-input"
            style={{ width: 'auto', fontSize: 15, padding: '8px 12px', cursor: 'pointer' }}
          >
            {ROLE_ORDER.map(r => <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>)}
          </select>
        ) : <RoleBadge role={user.role} />}
        {onDeleteUser && (
          <button
            onClick={e => { stopRowToggle(e); onDeleteUser(user.username) }}
            className="z-icon-btn"
            aria-label={t('common.remove')}
            title={t('common.remove')}
            style={{ color: 'var(--err)' }}
          >
            <Trash2 size={20} strokeWidth={1.75} />
          </button>
        )}
        {expanded
          ? <ChevronDown size={20} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
          : <ChevronRight size={20} strokeWidth={1.75} className="icon-flip-rtl" style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />}
      </div>
      {expanded && (
        <div style={{ padding: '12px 20px 16px', background: 'var(--bg-2)', borderTop: '0.5px solid var(--line)' }}>
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, marginTop: 4, fontSize: 15, fontWeight: 500, color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              {t('cloudAdmin.userViewAudit')}
              <ChevronRight size={18} strokeWidth={1.75} className="icon-flip-rtl" />
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
  if (state.status === 'error')   return <TabError>{t('cloudAdmin.tabLoadError')}: {state.error}</TabError>
  if (state.devices.length === 0) return <TabEmpty>{t('cloudAdmin.mobileNone')}</TabEmpty>

  return (
    <div>
      {state.devices.map(d => {
        const platform = (d.platform || '').toLowerCase()
        const platformLabel = platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : (d.platform || t('cloudAdmin.mobileUnknownPlatform'))
        const lastSeen = d.last_seen_at || d.last_seen || d.last_active_at
        const hasToken = !!(d.push_token || d.apns_token || d.fcm_token || d.web_push_endpoint)
        return (
          <div key={d.device_id || d.id} style={{ padding: '12px 20px', minHeight: 56, borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Smartphone size={20} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  {platformLabel}
                  {d.device_name && <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}> · {d.device_name}</span>}
                </span>
                {d.ws_connected && (
                  <span className="z-chip bg-ok-soft" style={{ color: 'var(--ok-text)', gap: 6 }}>
                    <Dot color="var(--ok)" />
                    {t('cloudAdmin.mobileOnline')}
                  </span>
                )}
              </p>
              <p className="z-footnote" style={{ marginTop: 2 }}>
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
    <ModalShell onClose={handleClose} maxWidth={460}>
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LifeBuoy size={20} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
          <p className="z-title3" style={{ flex: 1 }}>
            {result ? t('cloudAdmin.supportSessionOpenedTitle') : t('cloudAdmin.supportOpenTitle', { home: homeName || homeId })}
          </p>
        </div>
        {!result ? (
          <>
            <p className="z-subhead">{t('cloudAdmin.supportOpenBlurb')}</p>
            <div>
              <FieldLabel>{t('cloudAdmin.supportReasonLabel')}</FieldLabel>
              <textarea value={reason} onChange={e => setReason(e.target.value)}
                placeholder={t('cloudAdmin.supportReasonPh')}
                dir="auto" className="z-input"
                style={{ minHeight: 88, padding: 12, boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={handleClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
              <button onClick={handleOpen} disabled={opening} className="z-btn-primary" style={{ flex: 2 }}>
                {opening ? t('cloudAdmin.supportOpening') : t('cloudAdmin.supportOpenAction')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-ok-soft" style={{ padding: '12px 16px', borderRadius: 'var(--r-ctl)', border: '0.5px solid var(--line)' }}>
              <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ok-text)', fontWeight: 600 }}>{t('cloudAdmin.supportAuditWritten', { id: result.audit_id ?? '?' })}</p>
              <p className="z-footnote" style={{ marginTop: 4 }}>{t('cloudAdmin.supportNotificationStub')}</p>
            </div>
            <div>
              <p className="z-footnote" style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Terminal size={16} strokeWidth={1.75} /> {t('cloudAdmin.supportSnippetLabel')}
              </p>
              <pre dir="ltr" className="z-code" style={{
                background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)', padding: 12,
                fontSize: 13, lineHeight: '18px', color: 'var(--ink)', border: '0.5px solid var(--line)', overflowX: 'auto', margin: 0,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>{result.ssh_snippet}</pre>
            </div>
            <p className="z-footnote">
              {t('cloudAdmin.supportRunbookHint')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={copySnippet} className="z-btn-secondary" style={{ flex: 1 }}>
                <Copy size={18} strokeWidth={1.75} /> {t('cloudAdmin.supportCopySnippet')}
              </button>
              <button onClick={handleClose} className="z-btn-primary" style={{ flex: 1 }}>
                {t('common.done')}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
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
      <span className="z-footnote z-mono">
        {t('cloud.founderSlotsLoading')}
      </span>
    )
  }
  const { remaining, total } = state
  const claimed = (total ?? 30) - (remaining ?? 0)
  const pct = total ? Math.min(100, Math.max(0, (claimed / total) * 100)) : 0
  // The bar tints as the cap approaches: quiet while there is room, warn
  // in the last ten, err in the last three. Status colours only — the brand
  // accent is not a severity.
  const tone = remaining <= 3 ? 'var(--err)' : remaining <= 10 ? 'var(--warn)' : 'var(--ok)'

  return (
    <div
      title={t('cloud.founderSlotsTooltip', { claimed, total })}
      className="z-chip"
      style={{ gap: 8, minHeight: 32 }}
    >
      <span className="z-mono" style={{ fontWeight: 600, color: 'var(--ink)' }}>
        {t('cloud.founderSlots', { remaining, total })}
      </span>
      <span style={{ width: 60, height: 4, background: 'var(--line)', borderRadius: 999, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: tone, transition: 'width var(--dur-state) var(--ease-standard)' }} />
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
        <div key={inv.token} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', minHeight: 56, borderBottom: '0.5px solid var(--line)' }}>
          <Clock size={20} strokeWidth={1.75} style={{ color: 'var(--warn)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 15, color: 'var(--ink-mute)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inv.email || t('cloud.openInviteShort')} · {ROLE_LABEL_KEY[inv.role] ? t(ROLE_LABEL_KEY[inv.role]) : inv.role}
          </span>
          <span className="z-chip bg-warn-soft" style={{ color: 'var(--warn-text)', flexShrink: 0 }}>{t('cloud.tagPending')}</span>
          {onRevokeInvite && (
            <button onClick={() => onRevokeInvite(inv.token)} className="z-icon-btn" aria-label={t('common.remove')} title={t('common.remove')} style={{ color: 'var(--err)' }}>
              <Trash2 size={20} strokeWidth={1.75} />
            </button>
          )}
        </div>
      ))}

      {/* Invite button */}
      <div style={{ padding: '12px 20px' }}>
        <button onClick={onInviteUser} className="z-btn-secondary" style={{ width: '100%' }}>
          <Plus size={18} strokeWidth={1.75} /> {t('cloud.inviteUser')}
        </button>
      </div>
    </>
  )

  const haOk = home.haConnected !== false

  return (
    <Card style={{ marginBottom: 12 }}>
      {/* Home header. A div with the button role rather than a <button>: the
          support and deprovision controls live inside it, and a button cannot
          legally contain buttons. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v) } }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', minHeight: 68, cursor: 'pointer', textAlign: 'start', boxSizing: 'border-box' }}
      >
        <div style={{ width: 40, height: 40, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Home size={20} strokeWidth={1.75} style={{ color: 'var(--ink-mute)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
            <p className="z-headline">{home.name}</p>
            {isLocal ? (
              <span className={`z-chip ${haOk ? 'bg-ok-soft' : 'bg-warn-soft'}`} style={{ gap: 6, color: haOk ? 'var(--ok-text)' : 'var(--warn-text)' }}>
                <Dot color={haOk ? 'var(--ok)' : 'var(--warn)'} />
                {home.haConnected ? t('cloud.haOnline') : t('cloud.haOffline')}
              </span>
            ) : (
              <TrafficLightPill home={home} latestPayload={livePayload} />
            )}
            <span className="z-chip">
              {home.type || t('cloud.hub')}
            </span>
          </div>
          <p className="z-footnote" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {users.length} {users.length !== 1 ? t('cloud.usersWordPlural') : t('cloud.usersWord')}{pending.length > 0 ? ` · ${pending.length} ${pending.length !== 1 ? t('cloud.pendingInviteWordPlural') : t('cloud.pendingInviteWord')}` : ''}
            {home.haUrl ? ` · ${home.haUrl}` : home.tunnel_url ? ` · ${home.tunnel_url}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {!isLocal && (
            <button
              onClick={e => { e.stopPropagation(); setSupportModalOpen(true) }}
              title={t('cloudAdmin.supportOpenTooltip')}
              aria-label={t('cloudAdmin.supportOpenTooltip')}
              className="z-icon-btn"
            >
              <LifeBuoy size={20} strokeWidth={1.75} />
            </button>
          )}
          {!isLocal && onDeprovision && (
            <button onClick={e => { e.stopPropagation(); onDeprovision() }}
              className="z-icon-btn" aria-label={t('common.remove')} title={t('common.remove')} style={{ color: 'var(--err)' }}>
              <Trash2 size={20} strokeWidth={1.75} />
            </button>
          )}
          {expanded
            ? <ChevronDown size={20} strokeWidth={1.75} style={{ color: 'var(--ink-mute)' }} />
            : <ChevronRight size={20} strokeWidth={1.75} className="icon-flip-rtl" style={{ color: 'var(--ink-mute)' }} />}
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div style={{ borderTop: '0.5px solid var(--line)' }}>
          {/* Local home: no tabs (no relay-side data sources). */}
          {isLocal ? membersContent : (
            <>
              {/* Tab strip — the active tab is ink with an ink underline; the
                  brand accent is not a selection colour. */}
              <div style={{ display: 'flex', borderBottom: '0.5px solid var(--line)', background: 'var(--bg-2)', overflowX: 'auto' }}>
                {tabs.map(({ id, icon: Icon, labelKey }) => {
                  const active = tab === id
                  return (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        padding: '0 12px', minHeight: 44, background: 'transparent', border: 'none', cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap',
                        color: active ? 'var(--ink)' : 'var(--ink-mute)',
                        borderBottom: `2px solid ${active ? 'var(--ink)' : 'transparent'}`,
                        transition: 'color var(--dur-press) var(--ease-standard), border-color var(--dur-press) var(--ease-standard)',
                      }}
                    >
                      <Icon size={18} strokeWidth={1.75} />
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
  const [relayNeedsAuth, setRelayNeedsAuth] = useState(false)
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
      try {
        setRelayHomes(await relayListHomes())
        setRelayOnline(true); setRelayNeedsAuth(false)
      } catch (e) {
        // "I got a 401" and "the relay is down" are different facts and need
        // different actions. Reporting both as "Relay offline" sent the
        // operator hunting a dead server when all that was missing was a
        // sign-in — the relay was up and answering the whole time.
        const unauthorized = e?.status === 401 || e?.status === 403
          || e?.code === 'NOT_AUTHENTICATED' || e?.code === 'INSUFFICIENT_PERMISSIONS'
        setRelayOnline(false)
        setRelayNeedsAuth(unauthorized)
      }
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
      <Loader size={24} strokeWidth={1.75} className="z-spin" style={{ color: 'var(--ink-mute)' }} />
    </div>
  )

  // One inverted button per screen. Until a relay is connected, connecting is
  // the action that matters; afterwards it is creating a home.
  const relayConfigured = isRelayConfigured()

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>
      {/* Header */}
      <div className="z-page-head" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h1 className="z-display" style={{ margin: 0 }}>{t('cloud.title')}</h1>
          <p className="z-footnote">{t('cloud.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} className="z-icon-btn" aria-label={t('common.refresh')} title={t('common.refresh')}>
            <RefreshCw size={18} strokeWidth={1.75} />
          </button>
          <button onClick={() => setModal({ mode: 'home', homeId: null, homeName: null })}
            className={relayConfigured ? 'z-btn-primary' : 'z-btn-secondary'}>
            <Plus size={18} strokeWidth={1.75} /> {t('cloud.newHome')}
          </button>
        </div>
      </div>

      {/* Relay status bar */}
      {relayConfigured && (
        <div className="z-card-soft" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, padding: '8px 16px', minHeight: 56, borderRadius: 'var(--r-ctl)' }}>
          {relayOnline
            ? <><CheckCircle size={18} strokeWidth={1.75} style={{ color: 'var(--ok)', flexShrink: 0 }} /><span style={{ fontSize: 15, color: 'var(--ok-text)', fontWeight: 600 }}>{t('cloud.relayOnline')}</span></>
            : relayNeedsAuth
              ? <><Shield size={18} strokeWidth={1.75} style={{ color: 'var(--warn)', flexShrink: 0 }} /><span style={{ fontSize: 15, color: 'var(--warn-text)', fontWeight: 600 }}>Not signed in to the relay</span></>
              : <><WifiOff size={18} strokeWidth={1.75} style={{ color: 'var(--warn)', flexShrink: 0 }} /><span style={{ fontSize: 15, color: 'var(--warn-text)', fontWeight: 600 }}>{t('cloud.relayOffline')}</span></>}
          <span className="z-code" style={{ fontSize: 13, color: 'var(--ink-mute)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getRelayUrl()}</span>
          <Button variant="ghost" size="sm" onClick={() => { localStorage.removeItem('ziggy_relay_url'); localStorage.removeItem('ziggy_relay_token'); window.location.reload() }}>
            {t('cloud.disconnectBtn')}
          </Button>
        </div>
      )}

      {/* Fleet health — the operator's first question ("is anything broken?")
          answered before the home list, from the relay's rule engine rather
          than a second opinion computed in the browser. */}
      {/* Rendered unconditionally on purpose: the console discovers the relay
          URL from the hub and offers sign-in itself. Gating it on
          isRelayConfigured() would reproduce the bug it exists to fix — a
          working fleet rendering as a blank page because nobody had typed a URL
          into this browser. */}
      <div style={{ marginBottom: 32 }}>
        <FleetOps />
      </div>

      {/* Connect relay panel — shown above homes when not yet connected */}
      {!relayConfigured && (
        <div className="z-card-soft" style={{ marginBottom: 24, padding: '16px 20px' }}>
          <p className="z-headline" style={{ marginBottom: 4 }}>{t('cloud.connectRelay')}</p>
          <p className="z-subhead" style={{ marginBottom: 12 }}>
            {t('cloud.connectIntro')} {t('cloud.deployHint')} <code className="z-code">relay/fly.toml</code>.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={relayInput.url} onChange={e => setRelayInput(s => ({ ...s, url: e.target.value }))} placeholder={t('cloud.relayUrlPh')} dir="auto" className="z-input" style={{ boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={relayInput.email} onChange={e => setRelayInput(s => ({ ...s, email: e.target.value }))} placeholder={t('cloud.adminEmail')} type="email" dir="auto" className="z-input" style={{ flex: '1 1 200px', width: 'auto' }} />
              <input value={relayInput.password} onChange={e => setRelayInput(s => ({ ...s, password: e.target.value }))} placeholder={t('cloud.password')} type="password" dir="auto" className="z-input" style={{ flex: '1 1 160px', width: 'auto' }} />
              <button onClick={connectRelay} disabled={relayConnecting || !relayInput.url || !relayInput.email} className="z-btn-primary"
                style={{ whiteSpace: 'nowrap' }}>
                {relayConnecting ? <Loader size={18} strokeWidth={1.75} className="z-spin" /> : <Wifi size={18} strokeWidth={1.75} />}
                {relayConnecting ? t('cloud.connecting') : t('cloud.connect')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Homes */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <p className="z-eyebrow" style={{ flex: 1 }}>
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
