import { useEffect, useState } from 'react'
import {
  RefreshCw, Shield, CheckCircle2, AlertTriangle, AlertCircle, Info, ChevronRight,
  ExternalLink, Archive, X, History, ArrowRight, Code, Check,
} from 'lucide-react'
import { getUpdateStatus, forceUpdateCheck, dismissUpdate } from '../lib/api'
import { useT } from '../lib/i18n'

// ── Icons ─────────────────────────────────────────────────────────────────────
// Named lookup kept so call sites read the same; the glyphs are Lucide line
// icons at the shared 1.75 stroke.
const ICONS = {
  refresh: RefreshCw, shield: Shield, check: CheckCircle2, warn: AlertTriangle,
  alert: AlertCircle, info: Info, chev: ChevronRight, external: ExternalLink,
  backup: Archive, dismiss: X, history: History, zigbee: ArrowRight, code: Code,
}
function Icon({ name, size = 16, style }) {
  const Cmp = ICONS[name] || Info
  return <Cmp size={size} strokeWidth={1.75} style={style} aria-hidden />
}

// ── Risk level config ─────────────────────────────────────────────────────────
// `text` is the AA-safe token for words; `color` is for the ≥20px icon and the
// 8px dot only.
const RISK_CONFIG = {
  safe:    { color: 'var(--ok)',       text: 'var(--ok-text)',   bg: 'color-mix(in srgb, var(--ok) 10%, var(--surface))',       border: 'color-mix(in srgb, var(--ok) 30%, var(--line))',       labelKey: 'haUpdate.riskSafe',    icon: 'check'  },
  low:     { color: 'var(--warn)',     text: 'var(--warn-text)', bg: 'color-mix(in srgb, var(--warn) 10%, var(--surface))',     border: 'color-mix(in srgb, var(--warn) 30%, var(--line))',     labelKey: 'haUpdate.riskLow',     icon: 'info'   },
  medium:  { color: 'var(--warn)',     text: 'var(--warn-text)', bg: 'color-mix(in srgb, var(--warn) 10%, var(--surface))',     border: 'color-mix(in srgb, var(--warn) 30%, var(--line))',     labelKey: 'haUpdate.riskMedium',  icon: 'warn'   },
  high:    { color: 'var(--err)',      text: 'var(--err-text)',  bg: 'color-mix(in srgb, var(--err) 10%, var(--surface))',      border: 'color-mix(in srgb, var(--err) 30%, var(--line))',      labelKey: 'haUpdate.riskHigh',    icon: 'alert'  },
  unknown: { color: 'var(--ink-mute)', text: 'var(--ink-mute)',  bg: 'var(--surface-2)',                                        border: 'var(--line)',                                          labelKey: 'haUpdate.riskUnknown', icon: 'info' },
}

function RiskBadge({ level, size = 'md' }) {
  const t = useT()
  const cfg = RISK_CONFIG[level] || RISK_CONFIG.unknown
  const sm = size === 'sm'
  return (
    <span className="z-chip" style={{
      padding: sm ? '2px 8px' : '4px 12px',
      fontSize: sm ? 11 : 13, lineHeight: sm ? '13px' : '18px', fontWeight: 500,
      color: cfg.text, background: cfg.bg, borderColor: cfg.border, gap: 4,
    }}>
      <Icon name={cfg.icon} size={sm ? 12 : 14} />
      {t(cfg.labelKey)}
    </span>
  )
}

// ── Risk item card ────────────────────────────────────────────────────────────
function RiskCard({ risk }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const weightColor = risk.weight >= 3 ? 'var(--err)' : 'var(--warn)'

  return (
    <div className="z-card-sm" style={{ overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{ width: '100%', minHeight: 56, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start', color: 'var(--ink)' }}
      >
        <span className="z-dot" style={{ background: weightColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)' }}>{risk.feature}</p>
          <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: open ? 'normal' : 'nowrap' }}>{risk.message}</p>
        </div>
        {!risk.verifiable && (
          <span className="z-caption" style={{ border: '0.5px solid var(--line)', borderRadius: 'var(--r-chip)', padding: '2px 8px', flexShrink: 0 }}>{t('haUpdate.unverified')}</span>
        )}
        <ChevronRight size={20} strokeWidth={1.75} className="icon-flip-rtl" aria-hidden
          style={{ color: 'var(--ink-faint)', transition: 'transform var(--dur-state) var(--ease-standard)', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '0.5px solid var(--line)' }}>
          <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {risk.triggered_by?.length > 0 && (
              <div>
                <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('haUpdate.fromNotes')}</p>
                {risk.triggered_by.map((line, i) => (
                  <p key={i} className="z-footnote" style={{ padding: '4px 8px', background: 'var(--surface-2)', borderRadius: 'var(--r-chip)', marginBottom: 4 }}>
                    {line.replace(/^[-*•]+\s*/, '')}
                  </p>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 16px', borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }}>
              <Info size={20} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
              <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink)', margin: 0 }}>{risk.action}</p>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '8px 0', borderBottom: '0.5px solid var(--line)' }}>
      <span className="z-dot" style={{ background: cfg.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="z-code">{entry.current_version}</span>
          <ArrowRight size={16} strokeWidth={1.75} className="icon-flip-rtl" aria-hidden style={{ color: 'var(--ink-faint)' }} />
          <span className="z-code">{entry.latest_version}</span>
        </p>
        <p className="z-footnote z-mono" style={{ marginTop: 2 }}>{dateStr}</p>
      </div>
      <RiskBadge level={entry.risk_level} size="sm" />
      {entry.dismissed && <span className="z-footnote">{t('haUpdate.dismissedTag')}</span>}
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

  const card = { padding: 16, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)' }

  return (
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div className="z-page-head" style={{ flexWrap: 'wrap', marginBottom: 0 }}>
        <div>
          <p className="z-eyebrow">{t('haUpdate.eyebrow')}</p>
          <h1 className="z-display">{t('haUpdate.title')}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowHistory(v => !v)}
            title={t('haUpdate.viewHistoryTitle')}
            aria-pressed={showHistory}
            className="z-btn-secondary z-button"
          >
            <Icon name="history" size={18} />
            {t('haUpdate.history')}
          </button>
          <button
            onClick={handleCheck}
            disabled={checking || loading}
            className="z-btn-primary z-button"
          >
            <Icon name="refresh" size={18} style={checking ? { animation: 'spin 1s linear infinite' } : undefined} />
            {checking ? t('haUpdate.checking') : t('haUpdate.checkNow')}
          </button>
        </div>
      </div>

      {loading && (
        <div className="z-subhead" style={{ padding: 32, textAlign: 'center' }}>{t('haUpdate.loadingMsg')}</div>
      )}

      {!loading && status && (
        <>
          {/* ── Status banner ── */}
          <div style={{ ...card, background: cfg.bg, border: `0.5px solid ${cfg.border}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 'var(--r-ctl)', background: `color-mix(in srgb, ${cfg.color} 15%, var(--surface))`, color: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={cfg.icon} size={24} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                  <h2 className="z-title" style={{ margin: 0 }}>
                    {status.update_available ? t('haUpdate.updateAvailable') : t('haUpdate.upToDate')}
                  </h2>
                  <RiskBadge level={status.risk_level} />
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                  <div>
                    <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('haUpdate.current')}</p>
                    <p className="z-code" style={{ fontSize: 22, lineHeight: '28px', color: 'var(--ink)', fontWeight: 600 }}>{status.current_version || '—'}</p>
                  </div>
                  {status.update_available && (
                    <>
                      <ArrowRight size={24} strokeWidth={1.75} className="icon-flip-rtl" aria-hidden style={{ color: 'var(--ink-faint)', marginBottom: 2 }} />
                      <div>
                        <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('haUpdate.newVersion')}</p>
                        <p className="z-code" style={{ fontSize: 22, lineHeight: '28px', color: cfg.text, fontWeight: 600 }}>{status.latest_version}</p>
                      </div>
                    </>
                  )}
                </div>

                {status.what_to_do && (
                  <p className="z-body">{status.what_to_do}</p>
                )}

                {checkedStr && (
                  <p className="z-footnote z-mono" style={{ marginTop: 8 }}>{t('haUpdate.lastChecked', { when: checkedStr })}</p>
                )}
              </div>
            </div>

            {status.update_available && !dismissed && (
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                {status.release_url && (
                  <a
                    href={status.release_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="z-btn-secondary"
                    style={{ textDecoration: 'none' }}
                  >
                    <Icon name="external" size={18} />
                    {t('haUpdate.releaseNotes')}
                  </a>
                )}
                {status.backup_url && (
                  <a
                    href={status.backup_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="z-btn-secondary"
                    style={{ textDecoration: 'none' }}
                  >
                    <Icon name="backup" size={18} />
                    {t('haUpdate.backupGuide')}
                  </a>
                )}
                <button
                  onClick={handleDismiss}
                  className="z-btn-secondary z-button"
                  style={{ color: 'var(--ink-mute)' }}
                >
                  <Icon name="dismiss" size={18} />
                  {t('haUpdate.dismiss')}
                </button>
              </div>
            )}
            {dismissed && (
              <p className="z-footnote" style={{ marginTop: 12 }}>{t('haUpdate.dismissed')}</p>
            )}
          </div>

          {/* ── Backup reminder ── */}
          {status.update_available && status.backup_reminder && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 'var(--r-card)', background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--warn) 25%, var(--line))' }}>
              <Archive size={20} strokeWidth={1.75} aria-hidden style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)' }}>{t('haUpdate.backupBefore')}</p>
                <p className="z-subhead" style={{ marginTop: 2 }}>{t('haUpdate.backupWhere')}</p>
              </div>
            </div>
          )}

          {/* ── Risk analysis ── */}
          {status.update_available && (
            <div style={card}>
              <div style={{ marginBottom: status.risks?.length ? 12 : 0 }}>
                <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('haUpdate.whatMayBreak')}</p>
                {!status.release_notes_available && (
                  <p className="z-subhead" style={{ marginTop: 4 }}>
                    {t('haUpdate.notesUnavailable')}
                  </p>
                )}
                {status.release_notes_available && status.risks?.length === 0 && (
                  <p className="z-subhead" style={{ marginTop: 4 }}>
                    {t('haUpdate.noBreaking')}
                  </p>
                )}
              </div>

              {status.risks?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {status.risks.map(r => <RiskCard key={r.rule_id} risk={r} />)}
                </div>
              )}
            </div>
          )}

          {/* ── Your setup profile ── */}
          {status.update_available && status.profile && (
            <div style={card}>
              <p className="z-eyebrow" style={{ marginBottom: 12 }}>{t('haUpdate.setupProfile')}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
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
                    <div key={key} className="z-card-sm" style={{ padding: '12px 16px', background: 'var(--surface-2)' }}>
                      <p className="z-mono" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 600, color: val > 0 ? 'var(--ink)' : 'var(--ink-faint)' }}>{val}</p>
                      <p className="z-footnote" style={{ marginTop: 2 }}>{t(labelKey)}</p>
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
                    <div key={key} className="z-card-sm" style={{ padding: '12px 16px', background: 'var(--surface-2)' }}>
                      <div style={{ height: 28, display: 'flex', alignItems: 'center', color: 'var(--ok)' }}>
                        <Check size={24} strokeWidth={2} aria-hidden />
                      </div>
                      <p className="z-footnote" style={{ marginTop: 2 }}>{t(labelKey)}</p>
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
                aria-expanded={showRaw}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minHeight: 44, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                <p className="z-eyebrow" style={{ margin: 0 }}>{t('haUpdate.rawBreaking')}</p>
                <ChevronRight size={20} strokeWidth={1.75} className="icon-flip-rtl" aria-hidden
                  style={{ color: 'var(--ink-faint)', transition: 'transform var(--dur-state) var(--ease-standard)', transform: showRaw ? 'rotate(90deg)' : 'none', flexShrink: 0 }} />
              </button>
              {showRaw && (
                <div className="scrollbar-thin" style={{ marginTop: 12, padding: '12px 16px', borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', border: '0.5px solid var(--line)', maxHeight: 280, overflowY: 'auto' }}>
                  {status.breaking_changes_raw.map((line, i) => (
                    <p key={i} className="z-footnote" style={{ borderBottom: i < status.breaking_changes_raw.length - 1 ? '0.5px solid var(--line)' : 'none', padding: '4px 0' }}>
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
          <p className="z-eyebrow" style={{ marginBottom: 12 }}>{t('haUpdate.updateHistory')}</p>
          {history.length === 0
            ? <p className="z-subhead">{t('haUpdate.noUpdateHistory')}</p>
            : <div>{history.slice(0, 20).map((e, i) => <HistoryItem key={i} entry={e} />)}</div>
          }
        </div>
      )}

      {/* ── Safety note ── */}
      <div className="z-footnote" style={{ padding: 16, borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }}>
        <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{t('haUpdate.safetyLabel')}</strong> {t('haUpdate.safetyText')}
      </div>
    </div>
  )
}
