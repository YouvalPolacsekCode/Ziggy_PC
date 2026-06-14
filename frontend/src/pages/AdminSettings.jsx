// Operator-tier settings library.
//
// After the 2026-06 settings refactor this file is no longer mounted as a
// standalone page. It exports:
//
//   PushPreferenceCenter  — consumed by Settings/NotificationsPage (user-facing)
//   ApiKeysPage           — mounted at /ops/api-keys
//   EmailPage             — mounted at /ops/email          (super_admin only)
//   EngineTuningPage      — mounted at /ops/engine-tuning  (Ollama + Pattern Learning)
//
// IR Blasters and System Diagnostics moved out: IR Blasters now lives in
// Settings/IrHubsPage (it's a homeowner concern), System Diagnostics lives in
// Settings.jsx and is route-mounted at /ops/system-diagnostics.

import { useEffect, useState } from 'react'
import {
  RefreshCw, Bot, Key, Sliders, Brain, Trash2, AlertTriangle, Check, Mail,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Slider } from '../components/ui/Slider'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../lib/i18n'
import {
  getIntegrationsSettings, patchIntegrationsSettings,
  testPushNotification, getPushPreferences, patchPushPreferences, getPushDevices, revokePushDevice,
  getEmailSettings, patchEmailSettings, testEmail,
  getOllamaSettings, patchOllamaSettings,
  getPatternLearningSettings, patchPatternLearningSettings,
  patchSensorAlertsSettings,
  getPushCategories,
} from '../lib/api'
import { cn } from '../lib/utils'

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, children, restart }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      {Icon && <Icon size={13} style={{ color: 'var(--ink-faint)' }} />}
      <p className="z-eyebrow" style={{ flex: 1 }}>{children}</p>
      {restart && (
        <span style={{ fontSize: 10, color: 'var(--warn)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
          <AlertTriangle size={10} />
          {t('adminSettings.restartRequired')}
        </span>
      )}
    </div>
  )
}

function SettingRow({ label, subtitle, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</p>
        {subtitle && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// ─── Secret field — masked display + inline edit ──────────────────────────────

function SecretField({ label, subtitle, masked, configured, onSave, onRefresh, placeholder }) {
  const t = useT()
  const { addToast } = useUIStore()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const trimmed = value.trim()
    if (!trimmed) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(trimmed)
      addToast(t('adminSettings.saved'), 'success')
      onRefresh?.()
      setEditing(false)
      setValue('')
    } catch { addToast(t('adminSettings.failedSave'), 'error') }
    finally { setSaving(false) }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') { setEditing(false); setValue('') }
  }

  if (editing) {
    return (
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{label}</p>
        <div style={{ display: 'flex', gap: 6 }}>
          <input autoFocus type="password" placeholder={placeholder || t('adminSettings.enterNew')} value={value} onChange={e => setValue(e.target.value)} onKeyDown={handleKeyDown} dir="auto" className="z-input" style={{ flex: 1, height: 36, padding: '0 12px', fontSize: 13 }} />
          <button onClick={handleSave} disabled={saving} className="z-btn-primary" style={{ padding: '0 12px', borderRadius: 9, height: 36, fontSize: 12 }}>{saving ? '…' : t('adminSettings.save')}</button>
          <button onClick={() => { setEditing(false); setValue('') }} className="z-btn-secondary" style={{ padding: '0 10px', borderRadius: 9, height: 36, fontSize: 12 }}>{t('adminSettings.cancel')}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</p>
        {configured
          ? <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2, fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{masked}</p>
          : <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{subtitle || t('adminSettings.notConfigured')}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {configured && <Check size={12} style={{ color: 'var(--ok)' }} />}
        <button onClick={() => setEditing(true)} className="z-btn-secondary" style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12 }}>
          {configured ? t('adminSettings.update') : t('adminSettings.set')}
        </button>
      </div>
    </div>
  )
}

// ─── Push notification preference center ─────────────────────────────────────

function parseBrowser(ua) {
  if (!ua) return 'Unknown browser'
  if (ua.includes('Edg/'))    return 'Edge'
  if (ua.includes('Chrome/')) return 'Chrome'
  if (ua.includes('Firefox/'))return 'Firefox'
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari'
  return 'Browser'
}

function parseOS(ua) {
  if (!ua) return ''
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac OS'))  return 'macOS'
  if (ua.includes('iPhone'))  return 'iPhone'
  if (ua.includes('iPad'))    return 'iPad'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('Linux'))   return 'Linux'
  return ''
}

export function PushPreferenceCenter() {
  const t = useT()
  const { addToast } = useUIStore()
  const [categories,  setCategories]  = useState([])
  const [quietHours,  setQuietHours]  = useState({ enabled: false, start: '23:00', end: '07:00' })
  const [devices,     setDevices]     = useState([])
  const [currentEp,   setCurrentEp]   = useState(null)
  const [loadingCats, setLoadingCats] = useState(true)

  const load = async () => {
    getPushCategories()
      .then(r => { setCategories(r.categories ?? []); setLoadingCats(false) })
      .catch(() => setLoadingCats(false))
    getPushPreferences()
      .then(p => { if (p?.preferences?.quiet_hours) setQuietHours(p.preferences.quiet_hours) })
      .catch(() => {})
    getPushDevices()
      .then(d => setDevices(d.devices ?? []))
      .catch(() => {})
  }

  useEffect(() => {
    load()
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(reg => reg.pushManager.getSubscription())
        .then(sub => { if (sub) setCurrentEp(sub.endpoint) })
        .catch(() => {})
    }
  }, [])

  const toggleCategory = async (catId) => {
    const cat = categories.find(c => c.id === catId)
    if (!cat) return
    const next = !cat.enabled
    setCategories(cs => cs.map(c => c.id === catId ? { ...c, enabled: next } : c))
    try { await patchPushPreferences({ categories: { [catId]: next } }) }
    catch { addToast(t('adminSettings.failedSave'), 'error') }
  }

  const saveQuietHours = async (qh) => {
    try {
      await patchPushPreferences({ quiet_hours: qh })
      setQuietHours(qh)
    } catch { addToast(t('adminSettings.failedSave'), 'error') }
  }

  const updateSensorCondition = async (catId, entityId, condPatch) => {
    setCategories(cs => cs.map(c => {
      if (c.id !== catId) return c
      const prev = c.conditions || {}
      const merged = Object.fromEntries(Object.entries({ ...prev, ...condPatch }).filter(([, v]) => v != null))
      return { ...c, conditions: merged }
    }))
    const cat = categories.find(c => c.id === catId)
    if (!cat) return
    const prev = cat.conditions || {}
    const merged = Object.fromEntries(Object.entries({ ...prev, ...condPatch }).filter(([, v]) => v != null))
    try {
      const allSensors = categories.filter(c => c.type === 'sensor').map(c => ({
        entity_id:  c.entity_id,
        label:      c.label,
        conditions: c.id === catId ? merged : (c.conditions || {}),
      }))
      await patchSensorAlertsSettings({ sensors: allSensors.map(s => s) })
    } catch { addToast(t('adminSettings.failedSave'), 'error') }
  }

  const handleRevoke = async (ep) => {
    try {
      await revokePushDevice(ep)
      setDevices(d => d.filter(x => x.endpoint !== ep))
      addToast(t('adminSettings.deviceRemoved'), 'success')
    } catch { addToast(t('adminSettings.failedRemove'), 'error') }
  }

  const systemCats = categories.filter(c => c.type === 'system')
  const sensorCats = categories.filter(c => c.type === 'sensor')
  const qh         = quietHours

  const SEV_PRESENCE_OPTS = [
    { value: 'always', label: t('adminSettings.alwaysOpt') },
    { value: 'home',   label: t('adminSettings.whenHome') },
    { value: 'away',   label: t('adminSettings.whenAway') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '0.5px solid var(--line)' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('adminSettings.thisBrowser')}</p>
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>
              {'Notification' in window
                ? Notification.permission === 'granted' ? t('adminSettings.subscribed')
                : Notification.permission === 'denied'  ? t('adminSettings.blocked')
                : t('adminSettings.permNotYet')
                : t('adminSettings.pushNotSupported')}
            </p>
          </div>
          <span style={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', color: Notification.permission === 'granted' ? 'var(--ok)' : 'var(--ink-faint)' }}>
            {'Notification' in window ? Notification.permission : t('adminSettings.unsupported')}
          </span>
        </div>
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('adminSettings.sendTestDesc')}</p>
          <button
            onClick={async () => { try { await testPushNotification(); addToast(t('adminSettings.testSent'), 'success') } catch { addToast(t('adminSettings.notSubscribed'), 'error') } }}
            className="z-btn-secondary"
            style={{ padding: '5px 11px', borderRadius: 9, fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
          >{t('adminSettings.sendTest')}</button>
        </div>
      </div>

      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: qh.enabled ? '0.5px solid var(--line)' : 'none', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('adminSettings.quietHours')}</p>
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{t('adminSettings.quietHoursDesc')}</p>
          </div>
          <button className="z-toggle" aria-checked={qh.enabled} onClick={() => saveQuietHours({ ...qh, enabled: !qh.enabled })} />
        </div>
        {qh.enabled && (
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', flexShrink: 0 }}>{t('adminSettings.from')}</p>
            <input type="time" value={qh.start} onChange={e => saveQuietHours({ ...qh, start: e.target.value })} className="z-input" style={{ width: 100, height: 32, padding: '0 8px', fontSize: 12 }} />
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', flexShrink: 0 }}>{t('adminSettings.to')}</p>
            <input type="time" value={qh.end}   onChange={e => saveQuietHours({ ...qh, end:   e.target.value })} className="z-input" style={{ width: 100, height: 32, padding: '0 8px', fontSize: 12 }} />
          </div>
        )}
      </div>

      {!loadingCats && systemCats.length > 0 && (
        <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px 6px', borderBottom: '0.5px solid var(--line)' }}>
            <p className="z-eyebrow">{t('adminSettings.whatReaches')}</p>
          </div>
          {systemCats.map((cat, i) => (
            <div key={cat.id} style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: i < systemCats.length - 1 ? '0.5px solid var(--line)' : 'none', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {cat.label}
                  {cat.bypass_quiet_hours && <span style={{ fontSize: 9, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', padding: '1px 5px', borderRadius: 4 }}>{t('adminSettings.always')}</span>}
                </p>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{cat.description}</p>
              </div>
              <button className="z-toggle" aria-checked={!!cat.enabled} onClick={() => toggleCategory(cat.id)} />
            </div>
          ))}
        </div>
      )}

      {!loadingCats && sensorCats.length > 0 && (
        <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px 6px', borderBottom: '0.5px solid var(--line)' }}>
            <p className="z-eyebrow">{t('adminSettings.sensorAlerts')}</p>
          </div>
          {sensorCats.map((cat, i) => {
            const cond        = cat.conditions || {}
            const presence    = cond.presence || 'always'
            const timeEnabled = !!(cond.time_start && cond.time_end)
            return (
              <div key={cat.id} style={{ padding: '12px 16px', borderBottom: i < sensorCats.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                {/* CLAUDE.md memory: user must never see HA entity_ids.
                    Sensor label is human-friendly; the raw entity_id row was
                    removed in the 2026-06 settings refactor. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: cond ? 10 : 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{cat.label}</p>
                  </div>
                  <button className="z-toggle" aria-checked={!!cat.enabled} onClick={() => toggleCategory(cat.id)} />
                </div>
                {cat.enabled && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <p style={{ fontSize: 11, color: 'var(--ink-mute)', width: 68, flexShrink: 0 }}>{t('adminSettings.alertWhen')}</p>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {SEV_PRESENCE_OPTS.map(opt => (
                          <button key={opt.value} onClick={() => updateSensorCondition(cat.id, cat.entity_id, { presence: opt.value })}
                            style={{ fontSize: 11, padding: '3px 9px', borderRadius: 7, fontFamily: 'inherit',
                              border: `0.5px solid ${presence === opt.value ? 'var(--accent)' : 'var(--line)'}`,
                              background: presence === opt.value ? 'color-mix(in srgb, var(--accent) 15%, var(--surface))' : 'transparent',
                              color: presence === opt.value ? 'var(--accent)' : 'var(--ink-mute)', cursor: 'pointer' }}
                          >{opt.label}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <p style={{ fontSize: 11, color: 'var(--ink-mute)', width: 68, flexShrink: 0 }}>{t('adminSettings.time')}</p>
                      <button className="z-toggle" aria-checked={timeEnabled}
                        onClick={() => updateSensorCondition(cat.id, cat.entity_id,
                          timeEnabled ? { time_start: null, time_end: null } : { time_start: '22:00', time_end: '06:00' }
                        )} />
                      {timeEnabled && (
                        <>
                          <input type="time" value={cond.time_start || '22:00'} onChange={e => updateSensorCondition(cat.id, cat.entity_id, { time_start: e.target.value })} className="z-input" style={{ width: 90, height: 28, padding: '0 8px', fontSize: 12 }} />
                          <p style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{t('adminSettings.to')}</p>
                          <input type="time" value={cond.time_end || '06:00'} onChange={e => updateSensorCondition(cat.id, cat.entity_id, { time_end: e.target.value })} className="z-input" style={{ width: 90, height: 28, padding: '0 8px', fontSize: 12 }} />
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px 6px', borderBottom: devices.length > 0 ? '0.5px solid var(--line)' : 'none' }}>
          <p className="z-eyebrow">{t('adminSettings.subscribedDevices')}</p>
        </div>
        {devices.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '14px 16px' }}>{t('adminSettings.noDevicesSubbed')}</p>
        ) : (
          devices.map((d, i) => {
            const browser   = parseBrowser(d.user_agent)
            const os        = parseOS(d.user_agent)
            const isCurrent = d.endpoint === currentEp
            const ago = d.subscribed_at
              ? (() => { const diff = Math.floor((Date.now() - new Date(d.subscribed_at)) / 86400000); return diff === 0 ? t('adminSettings.today') : diff === 1 ? t('adminSettings.yesterday') : t('adminSettings.daysAgo', { n: diff }) })()
              : ''
            return (
              <div key={d.endpoint} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: i < devices.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {browser}{os ? ` · ${os}` : ''}
                    {isCurrent && <span style={{ fontSize: 9, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ok)', background: 'color-mix(in srgb, var(--ok) 12%, var(--surface))', padding: '1px 5px', borderRadius: 4 }}>{t('adminSettings.thisDevice')}</span>}
                  </p>
                  {ago && <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 1 }}>{t('adminSettings.subscribed_ago', { when: ago })}</p>}
                </div>
                <button onClick={() => handleRevoke(d.endpoint)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }} title={t('adminSettings.revokeTitle')}>
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}

// ─── Shared toolbar (refresh button) for ops sub-pages ───────────────────────

function OpsToolbar({ refreshing, onRefresh }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
      <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('adminSettings.restartHint')}</p>
      <button onClick={onRefresh} disabled={refreshing} title={t('adminSettings.refresh')} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: 7, cursor: 'pointer' }}>
        <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// /ops sub-page exports
// ═══════════════════════════════════════════════════════════════════════════════

export function ApiKeysPage() {
  const t = useT()
  const [integrations, setIntegrations] = useState({})
  const [refreshing, setRefreshing] = useState(false)
  const load = () => getIntegrationsSettings().then(setIntegrations).catch(() => {})
  useEffect(() => { load() }, [])
  const onRefresh = () => { setRefreshing(true); load(); setTimeout(() => setRefreshing(false), 600) }
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 48px' }}>
      <OpsToolbar refreshing={refreshing} onRefresh={onRefresh} />
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Key}>{t('adminSettings.sectionApiKeys')}</SectionTitle>
        <Card>
          <div className="divide-y divide-line">
            <SecretField
              label={t('adminSettings.openai')}
              subtitle={t('adminSettings.openaiDesc')}
              masked={integrations.openai_key_masked}
              configured={integrations.openai_configured}
              placeholder={t('adminSettings.openaiPh')}
              onSave={(v) => patchIntegrationsSettings({ openai_key: v })}
              onRefresh={load}
            />
            <SecretField
              label={t('adminSettings.serpapi')}
              subtitle={t('adminSettings.serpapiDesc')}
              masked={integrations.serpapi_key_masked}
              configured={integrations.serpapi_configured}
              placeholder={t('adminSettings.serpapiPh')}
              onSave={(v) => patchIntegrationsSettings({ serpapi_key: v })}
              onRefresh={load}
            />
            <SecretField
              label={t('adminSettings.ifttt')}
              subtitle={t('adminSettings.iftttDesc')}
              masked={integrations.ifttt_key_masked}
              configured={integrations.ifttt_configured}
              placeholder={t('adminSettings.iftttPh')}
              onSave={(v) => patchIntegrationsSettings({ ifttt_key: v })}
              onRefresh={load}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}

export function EmailPage() {
  const t = useT()
  const { addToast } = useUIStore()
  const myRole = useAuthStore(s => s.role)
  const isSuperAdmin = myRole === 'super_admin'

  const [email, setEmail] = useState({ enabled: false, host: '', port: 587, username: '', password_configured: false, password_masked: '', from_address: '', from_name: 'Ziggy' })
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = () => { if (isSuperAdmin) getEmailSettings().then(setEmail).catch(() => {}) }
  useEffect(() => { load() }, [isSuperAdmin])
  const onRefresh = () => { setRefreshing(true); load(); setTimeout(() => setRefreshing(false), 600) }

  if (!isSuperAdmin) {
    return <p style={{ padding: 24, fontSize: 12, color: 'var(--ink-faint)' }}>Restricted to super admins.</p>
  }

  const saveSmtp = async () => {
    setSaving(true)
    try { await patchEmailSettings({ host: email.host, port: email.port, username: email.username, from_name: email.from_name, from_address: email.username }); addToast(t('adminSettings.saved'), 'success') }
    catch { addToast(t('adminSettings.failedSave'), 'error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 48px' }}>
      <OpsToolbar refreshing={refreshing} onRefresh={onRefresh} />
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Mail}>{t('adminSettings.sectionEmail')}</SectionTitle>
        <Card>
          <div className="divide-y divide-line">
            <SettingRow label={t('adminSettings.enableEmail')} subtitle={t('adminSettings.emailReq')}>
              <Toggle
                checked={!!email.enabled}
                onCheckedChange={(v) => {
                  setEmail(s => ({ ...s, enabled: v }))
                  patchEmailSettings({ enabled: v }).catch(() => {})
                }}
              />
            </SettingRow>
            {email.enabled && (
              <>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 2 }}>
                      <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('adminSettings.smtpHost')}</p>
                      <input value={email.host} onChange={e => setEmail(s => ({ ...s, host: e.target.value }))} placeholder={t('adminSettings.smtpHostPh')} dir="auto" className="z-input" style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('adminSettings.port')}</p>
                      <input type="number" value={email.port} onChange={e => setEmail(s => ({ ...s, port: parseInt(e.target.value) || 587 }))} dir="auto" className="z-input" style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('adminSettings.smtpUsername')}</p>
                    <input type="email" value={email.username} onChange={e => setEmail(s => ({ ...s, username: e.target.value }))} placeholder={t('adminSettings.smtpUserPh')} dir="auto" className="z-input" style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{t('adminSettings.fromName')}</p>
                    <input value={email.from_name} onChange={e => setEmail(s => ({ ...s, from_name: e.target.value }))} placeholder={t('adminSettings.fromNamePh')} dir="auto" className="z-input" style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }} />
                  </div>
                  <Button variant="primary" onClick={saveSmtp} disabled={saving} className="w-full">
                    {saving ? t('adminSettings.saving') : t('adminSettings.saveSmtp')}
                  </Button>
                </div>
                <SecretField
                  label={t('adminSettings.appPassword')}
                  subtitle={t('adminSettings.appPasswordDesc')}
                  masked={email.password_masked}
                  configured={email.password_configured}
                  placeholder={t('adminSettings.appPasswordPh')}
                  onSave={(v) => patchEmailSettings({ password: v })}
                  onRefresh={load}
                />
                <div style={{ padding: '12px 16px' }}>
                  <Button variant="secondary" onClick={async () => {
                    try { await testEmail(); addToast(t('adminSettings.testEmailSent'), 'success') }
                    catch (e) { addToast(e.message || t('adminSettings.testFailed'), 'error') }
                  }} className="w-full">
                    {t('adminSettings.sendTestEmail')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

export function EngineTuningPage() {
  const t = useT()
  const { addToast } = useUIStore()
  const [ollama, setOllama] = useState({ base_url: '', model: '', timeout: 30 })
  const [patternLearning, setPatternLearning] = useState({})
  const [saving, setSaving] = useState({})
  const [refreshing, setRefreshing] = useState(false)

  const setSav = (key, val) => setSaving(s => ({ ...s, [key]: val }))

  const load = () => {
    getOllamaSettings().then(setOllama).catch(() => {})
    getPatternLearningSettings().then(pl => setPatternLearning({
      enabled: true, llm_synthesis: true, analysis_hour: 9, lookback_days: 30,
      min_occurrences: 5, max_pending_suggestions: 3, time_window_minutes: 45,
      sequence_gap_minutes: 5, ...pl
    })).catch(() => {})
  }
  useEffect(() => { load() }, [])
  const onRefresh = () => { setRefreshing(true); load(); setTimeout(() => setRefreshing(false), 600) }

  const save = async (key, apiFn, payload) => {
    setSav(key, true)
    try { await apiFn(payload); addToast(t('adminSettings.saved'), 'success') }
    catch { addToast(t('adminSettings.failedSave'), 'error') }
    finally { setSav(key, false) }
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 48px' }}>
      <OpsToolbar refreshing={refreshing} onRefresh={onRefresh} />

      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Brain}>{t('adminSettings.sectionOllama')}</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input label={t('adminSettings.baseUrl')} placeholder={t('adminSettings.ollamaBaseUrlPh')} value={ollama.base_url || ''} onChange={e => setOllama(s => ({ ...s, base_url: e.target.value }))} dir="auto" />
            <Input label={t('adminSettings.model')} placeholder={t('adminSettings.ollamaModelPh')} value={ollama.model || ''} onChange={e => setOllama(s => ({ ...s, model: e.target.value }))} dir="auto" />
            <div>
              <p className="text-xs text-ink-mute mb-1.5">{t('adminSettings.timeoutSec')}</p>
              <input
                type="number" min={5} max={300}
                value={ollama.timeout || 30}
                onChange={e => setOllama(s => ({ ...s, timeout: parseInt(e.target.value) || 30 }))}
                dir="auto"
                className={cn('w-full h-9 rounded-xl px-3 text-sm', 'bg-surface-2', 'border border-line', 'text-ink', 'focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent')}
              />
            </div>
            <Button variant="primary" onClick={() => save('ollama', patchOllamaSettings, ollama)} disabled={saving['ollama']} className="w-full">
              {saving['ollama'] ? t('adminSettings.saving') : t('adminSettings.save')}
            </Button>
          </div>
        </Card>
      </div>

      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Sliders}>{t('adminSettings.sectionPattern')}</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{t('adminSettings.plEnabled')}</p>
                <p className="text-xs text-ink-mute">{t('adminSettings.plEnabledDesc')}</p>
              </div>
              <Toggle checked={!!patternLearning.enabled} onCheckedChange={(v) => setPatternLearning(s => ({ ...s, enabled: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{t('adminSettings.plLLM')}</p>
                <p className="text-xs text-ink-mute">{t('adminSettings.plLLMDesc')}</p>
              </div>
              <Toggle checked={!!patternLearning.llm_synthesis} onCheckedChange={(v) => setPatternLearning(s => ({ ...s, llm_synthesis: v }))} />
            </div>
            <div className="pt-1 border-t border-line">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-ink-2">{t('adminSettings.plAnalysisHour')}</p>
                <span className="text-xs font-semibold text-ink-mute">{patternLearning.analysis_hour ?? 9}:00</span>
              </div>
              <Slider value={patternLearning.analysis_hour ?? 9} onValueChange={(v) => setPatternLearning(s => ({ ...s, analysis_hour: v }))} min={0} max={23} />
              <p className="text-[10px] text-ink-mute mt-1">{t('adminSettings.plAnalysisHourDesc')}</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-ink-2">{t('adminSettings.plLookback')}</p>
                <span className="text-xs font-semibold text-ink-mute">{patternLearning.lookback_days ?? 30}d</span>
              </div>
              <Slider value={patternLearning.lookback_days ?? 30} onValueChange={(v) => setPatternLearning(s => ({ ...s, lookback_days: v }))} min={7} max={90} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-ink-2">{t('adminSettings.plMinOccur')}</p>
                <span className="text-xs font-semibold text-ink-mute">{patternLearning.min_occurrences ?? 5}×</span>
              </div>
              <Slider value={patternLearning.min_occurrences ?? 5} onValueChange={(v) => setPatternLearning(s => ({ ...s, min_occurrences: v }))} min={2} max={20} />
              <p className="text-[10px] text-ink-mute mt-1">{t('adminSettings.plMinOccurDesc')}</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-ink-2">{t('adminSettings.plMaxPending')}</p>
                <span className="text-xs font-semibold text-ink-mute">{patternLearning.max_pending_suggestions ?? 3}</span>
              </div>
              <Slider value={patternLearning.max_pending_suggestions ?? 3} onValueChange={(v) => setPatternLearning(s => ({ ...s, max_pending_suggestions: v }))} min={1} max={10} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-ink-2">{t('adminSettings.plTimeWindow')}</p>
                <span className="text-xs font-semibold text-ink-mute">{patternLearning.time_window_minutes ?? 45}min</span>
              </div>
              <Slider value={patternLearning.time_window_minutes ?? 45} onValueChange={(v) => setPatternLearning(s => ({ ...s, time_window_minutes: v }))} min={15} max={120} />
              <p className="text-[10px] text-ink-mute mt-1">{t('adminSettings.plTimeWindowDesc')}</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-ink-2">{t('adminSettings.plSeqGap')}</p>
                <span className="text-xs font-semibold text-ink-mute">{patternLearning.sequence_gap_minutes ?? 5}min</span>
              </div>
              <Slider value={patternLearning.sequence_gap_minutes ?? 5} onValueChange={(v) => setPatternLearning(s => ({ ...s, sequence_gap_minutes: v }))} min={1} max={60} />
            </div>
            <Button variant="primary" onClick={() => save('pl', patchPatternLearningSettings, patternLearning)} disabled={saving['pl']} className="w-full">
              {saving['pl'] ? t('adminSettings.saving') : t('adminSettings.save')}
            </Button>
          </div>
        </Card>
      </div>

    </div>
  )
}

// No default export — /admin route was removed in the 2026-06 settings refactor.
