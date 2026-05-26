import { useEffect, useState } from 'react'
import { getUpdateStatus, forceUpdateCheck, dismissUpdate } from '../lib/api'
import { useT } from '../lib/i18n'

// ── Icons ─────────────────────────────────────────────────────────────────────
function Icon({ name, size = 16 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'refresh':   return <svg {...p}><path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.7-8.5L23 10"/></svg>
    case 'shield':    return <svg {...p}><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/></svg>
    case 'check':     return <svg {...p}><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
    case 'warn':      return <svg {...p}><path d="M10.3 3.3L1.6 18a2 2 0 0 0 1.7 3h17.4a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    case 'alert':     return <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    case 'info':      return <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    case 'chev':      return <svg {...p}><path d="M9 18l6-6-6-6"/></svg>
    case 'external':  return <svg {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    case 'backup':    return <svg {...p}><polyline points="20 7 20 20 4 20 4 7"/><polyline points="1 7 23 7 23 5 1 5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
    case 'dismiss':   return <svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    case 'history':   return <svg {...p}><polyline points="12 8 12 12 14 14"/><path d="M3.1 9a9 9 0 1 0 .4-2.5"/><polyline points="3 3 3 9 9 9"/></svg>
    case 'zigbee':    return <svg {...p}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    case 'code':      return <svg {...p}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
    default:          return <svg {...p}><circle cx="12" cy="12" r="10"/></svg>
  }
}

// ── Risk level config ─────────────────────────────────────────────────────────
const RISK_CONFIG = {
  safe:    { color: '#22c55e', bg: 'color-mix(in srgb, #22c55e 10%, var(--surface))', border: 'color-mix(in srgb, #22c55e 30%, transparent)', labelKey: 'haUpdate.riskSafe',    icon: 'check'  },
  low:     { color: '#f59e0b', bg: 'color-mix(in srgb, #f59e0b 10%, var(--surface))', border: 'color-mix(in srgb, #f59e0b 30%, transparent)', labelKey: 'haUpdate.riskLow',     icon: 'info'   },
  medium:  { color: '#f97316', bg: 'color-mix(in srgb, #f97316 10%, var(--surface))', border: 'color-mix(in srgb, #f97316 30%, transparent)', labelKey: 'haUpdate.riskMedium',  icon: 'warn'   },
  high:    { color: '#ef4444', bg: 'color-mix(in srgb, #ef4444 10%, var(--surface))', border: 'color-mix(in srgb, #ef4444 30%, transparent)', labelKey: 'haUpdate.riskHigh',    icon: 'alert'  },
  unknown: { color: '#6b7280', bg: 'color-mix(in srgb, #6b7280 10%, var(--surface))', border: 'color-mix(in srgb, #6b7280 30%, transparent)', labelKey: 'haUpdate.riskUnknown', icon: 'info' },
}

function RiskBadge({ level, size = 'md' }) {
  const t = useT()
  const cfg = RISK_CONFIG[level] || RISK_CONFIG.unknown
  const pad = size === 'sm' ? '3px 9px' : '6px 14px'
  const fs  = size === 'sm' ? 11 : 13
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: pad, borderRadius: 999, fontSize: fs, fontWeight: 600,
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      <Icon name={cfg.icon} size={size === 'sm' ? 12 : 14} />
      {t(cfg.labelKey)}
    </span>
  )
}

// ── Risk item card ────────────────────────────────────────────────────────────
function RiskCard({ risk }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const weightColor = risk.weight >= 3 ? '#ef4444' : risk.weight >= 2 ? '#f97316' : '#f59e0b'

  return (
    <div style={{ borderRadius: 10, background: 'var(--bg)', border: '0.5px solid var(--line)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: weightColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 1 }}>{risk.feature}</p>
          <p style={{ fontSize: 11, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: open ? 'normal' : 'nowrap' }}>{risk.message}</p>
        </div>
        {!risk.verifiable && (
          <span style={{ fontSize: 10, color: 'var(--ink-faint)', border: '0.5px solid var(--line)', borderRadius: 6, padding: '2px 6px', flexShrink: 0 }}>{t('haUpdate.unverified')}</span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </button>

      {open && (
        <div style={{ padding: '0 14px 12px', borderTop: '0.5px solid var(--line)' }}>
          <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {risk.triggered_by?.length > 0 && (
              <div>
                <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{t('haUpdate.fromNotes')}</p>
                {risk.triggered_by.map((line, i) => (
                  <p key={i} style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace', padding: '4px 8px', background: 'var(--bg-2)', borderRadius: 6, marginBottom: 4 }}>
                    {line.replace(/^[-*•]+\s*/, '')}
                  </p>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, #3b82f6 8%, var(--bg-2))', border: '0.5px solid color-mix(in srgb, #3b82f6 20%, transparent)' }}>
              <Icon name="info" size={13} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 11, color: 'var(--ink)', lineHeight: 1.5, margin: 0 }}>{risk.action}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── History item ──────────────────────────────────────────────────────────────
function HistoryItem({ entry }) {
  const t = useT()
  const cfg = RISK_CONFIG[entry.risk_level] || RISK_CONFIG.unknown
  const date = new Date(entry.detected_at)
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid var(--line)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 12, color: 'var(--ink)' }}>
          <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{entry.current_version}</span>
          <span style={{ color: 'var(--ink-faint)', margin: '0 6px' }}>→</span>
          <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{entry.latest_version}</span>
        </p>
        <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>{dateStr}</p>
      </div>
      <RiskBadge level={entry.risk_level} size="sm" />
      {entry.dismissed && <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t('haUpdate.dismissedTag')}</span>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function HAUpdate() {
  const t = useT()
  const [status,   setStatus]   = useState(null)
  const [history,  setHistory]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [checking, setChecking] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [s, h] = await Promise.all([getUpdateStatus(), import('../lib/api').then(m => m.getUpdateHistory())])
      setStatus(s)
      setHistory(h.history || [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCheck = async () => {
    setChecking(true)
    try {
      const s = await forceUpdateCheck()
      setStatus(s)
    } catch {}
    setChecking(false)
  }

  const handleDismiss = async () => {
    if (!status?.latest_version) return
    try {
      await dismissUpdate(status.latest_version)
      setDismissed(true)
    } catch {}
  }

  const cfg         = status ? (RISK_CONFIG[status.risk_level] || RISK_CONFIG.unknown) : null
  const checkedStr  = status?.checked_at
    ? new Date(status.checked_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const card = { padding: '14px 16px', borderRadius: 13, background: 'var(--surface)', border: '0.5px solid var(--line)' }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(16px, 3vw, 36px)', paddingTop: 24, paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 14, borderBottom: '0.5px solid var(--line)' }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 3 }}>{t('haUpdate.eyebrow')}</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', lineHeight: 1.1 }}>{t('haUpdate.title')}</h1>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowHistory(v => !v)}
          title={t('haUpdate.viewHistoryTitle')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, background: 'none', border: '0.5px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--ink-mute)' }}
        >
          <Icon name="history" size={13} />
          {t('haUpdate.history')}
        </button>
        <button
          onClick={handleCheck}
          disabled={checking || loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 8, background: 'var(--ink)', color: 'var(--bg)', border: 'none', cursor: checking ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, opacity: checking ? 0.6 : 1 }}
        >
          <Icon name="refresh" size={13} />
          {checking ? t('haUpdate.checking') : t('haUpdate.checkNow')}
        </button>
      </div>

      {loading && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>{t('haUpdate.loadingMsg')}</div>
      )}

      {!loading && status && (
        <>
          {/* ── Status banner ── */}
          <div style={{ ...card, background: cfg.bg, border: `0.5px solid ${cfg.border}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `color-mix(in srgb, ${cfg.color} 15%, var(--surface))`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={cfg.icon} size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
                    {status.update_available ? t('haUpdate.updateAvailable') : t('haUpdate.upToDate')}
                  </h2>
                  <RiskBadge level={status.risk_level} />
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div>
                    <p style={{ fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('haUpdate.current')}</p>
                    <p style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{status.current_version || '—'}</p>
                  </div>
                  {status.update_available && (
                    <>
                      <div style={{ color: 'var(--ink-faint)', fontSize: 18, lineHeight: '2.2', alignSelf: 'flex-end' }}>→</div>
                      <div>
                        <p style={{ fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('haUpdate.newVersion')}</p>
                        <p style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 13, color: cfg.color, fontWeight: 700 }}>{status.latest_version}</p>
                      </div>
                    </>
                  )}
                </div>

                {status.what_to_do && (
                  <p style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.5 }}>{status.what_to_do}</p>
                )}

                {checkedStr && (
                  <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 6 }}>{t('haUpdate.lastChecked', { when: checkedStr })}</p>
                )}
              </div>
            </div>

            {status.update_available && !dismissed && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {status.release_url && (
                  <a
                    href={status.release_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 8, background: 'var(--ink)', color: 'var(--bg)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                  >
                    <Icon name="external" size={12} />
                    {t('haUpdate.releaseNotes')}
                  </a>
                )}
                {status.backup_url && (
                  <a
                    href={status.backup_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 8, background: 'none', color: 'var(--ink)', border: '0.5px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                  >
                    <Icon name="backup" size={12} />
                    {t('haUpdate.backupGuide')}
                  </a>
                )}
                <button
                  onClick={handleDismiss}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, background: 'none', color: 'var(--ink-faint)', border: '0.5px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
                >
                  <Icon name="dismiss" size={12} />
                  {t('haUpdate.dismiss')}
                </button>
              </div>
            )}
            {dismissed && (
              <p style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-faint)' }}>{t('haUpdate.dismissed')}</p>
            )}
          </div>

          {/* ── Backup reminder ── */}
          {status.update_available && status.backup_reminder && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'color-mix(in srgb, #f59e0b 8%, var(--surface))', border: '0.5px solid color-mix(in srgb, #f59e0b 25%, transparent)', fontSize: 12 }}>
              <Icon name="backup" size={14} />
              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{t('haUpdate.backupBefore')}</span>
              <span style={{ color: 'var(--ink-mute)' }}>{t('haUpdate.backupWhere')}</span>
            </div>
          )}

          {/* ── Risk analysis ── */}
          {status.update_available && (
            <div style={card}>
              <div style={{ marginBottom: status.risks?.length ? 12 : 0 }}>
                <p className="z-eyebrow" style={{ marginBottom: 3 }}>{t('haUpdate.whatMayBreak')}</p>
                {!status.release_notes_available && (
                  <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4 }}>
                    {t('haUpdate.notesUnavailable')}
                  </p>
                )}
                {status.release_notes_available && status.risks?.length === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 4 }}>
                    {t('haUpdate.noBreaking')}
                  </p>
                )}
              </div>

              {status.risks?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {status.risks.map(r => <RiskCard key={r.rule_id} risk={r} />)}
                </div>
              )}
            </div>
          )}

          {/* ── Your setup profile ── */}
          {status.update_available && status.profile && (
            <div style={card}>
              <p className="z-eyebrow" style={{ marginBottom: 10 }}>{t('haUpdate.setupProfile')}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                {[
                  { key: 'light_count',        labelKey: 'haUpdate.profileLights' },
                  { key: 'climate_count',       labelKey: 'haUpdate.profileClimate' },
                  { key: 'media_player_count',  labelKey: 'haUpdate.profileMedia' },
                  { key: 'fan_count',           labelKey: 'haUpdate.profileFans' },
                  { key: 'cover_count',         labelKey: 'haUpdate.profileCovers' },
                  { key: 'script_count',        labelKey: 'haUpdate.profileScripts' },
                  { key: 'automation_count',    labelKey: 'haUpdate.profileAutomations' },
                  { key: 'person_count',        labelKey: 'haUpdate.profilePersons' },
                  { key: 'zha_device_count',    labelKey: 'haUpdate.profileZha' },
                ].map(({ key, labelKey }) => {
                  const val = status.profile[key]
                  if (val === undefined) return null
                  return (
                    <div key={key} style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--bg)', border: '0.5px solid var(--line)' }}>
                      <p style={{ fontSize: 18, fontWeight: 700, fontFamily: '"IBM Plex Mono", monospace', color: val > 0 ? 'var(--ink)' : 'var(--ink-faint)' }}>{val}</p>
                      <p style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>{t(labelKey)}</p>
                    </div>
                  )
                })}
                {[
                  { key: 'mqtt_enabled', labelKey: 'haUpdate.profileMqtt' },
                  { key: 'has_zwave',    labelKey: 'haUpdate.profileZwave' },
                  { key: 'has_todo',     labelKey: 'haUpdate.profileTodo' },
                ].map(({ key, labelKey }) => {
                  const val = status.profile[key]
                  if (!val) return null
                  return (
                    <div key={key} style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--bg)', border: '0.5px solid var(--line)' }}>
                      <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--ok)' }}>✓</p>
                      <p style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>{t(labelKey)}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Raw breaking changes ── */}
          {status.update_available && status.breaking_changes_raw?.length > 0 && (
            <div style={card}>
              <button
                onClick={() => setShowRaw(v => !v)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                <p className="z-eyebrow" style={{ margin: 0 }}>{t('haUpdate.rawBreaking')}</p>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transition: 'transform 0.15s', transform: showRaw ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
              {showRaw && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--bg)', border: '0.5px solid var(--line)', maxHeight: 280, overflowY: 'auto' }} className="scrollbar-thin">
                  {status.breaking_changes_raw.map((line, i) => (
                    <p key={i} style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: '"IBM Plex Mono", monospace', lineHeight: 1.6, borderBottom: i < status.breaking_changes_raw.length - 1 ? '0.5px solid var(--line)' : 'none', padding: '4px 0' }}>
                      {line.replace(/^[-*•]\s*/, '')}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── History panel ── */}
      {showHistory && (
        <div style={card}>
          <p className="z-eyebrow" style={{ marginBottom: 10 }}>{t('haUpdate.updateHistory')}</p>
          {history.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{t('haUpdate.noUpdateHistory')}</p>
            : <div>{history.slice(0, 20).map((e, i) => <HistoryItem key={i} entry={e} />)}</div>
          }
        </div>
      )}

      {/* ── Safety note ── */}
      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg)', border: '0.5px solid var(--line)', fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--ink-faint)' }}>{t('haUpdate.safetyLabel')}</strong> {t('haUpdate.safetyText')}
      </div>
    </div>
  )
}
