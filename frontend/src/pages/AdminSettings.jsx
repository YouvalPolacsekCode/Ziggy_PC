import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RefreshCw, Bot, Key, Wifi, Sliders,
  Brain, Trash2, AlertTriangle, Check, Mail,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Slider } from '../components/ui/Slider'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import {
  getIntegrationsSettings, patchIntegrationsSettings,
  testPushNotification, getPushPreferences, patchPushPreferences, getPushDevices, revokePushDevice,
  getEmailSettings, patchEmailSettings, testEmail,
  getMqttSettings, patchMqttSettings,
  getFeaturesSettings, patchFeaturesSettings,
  getOllamaSettings, patchOllamaSettings,
  getPatternLearningSettings, patchPatternLearningSettings,
  patchSensorAlertsSettings,
  getPushCategories,
} from '../lib/api'
import { cn } from '../lib/utils'

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, children, restart }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      {Icon && <Icon size={13} style={{ color: 'var(--ink-faint)' }} />}
      <p className="z-eyebrow" style={{ flex: 1 }}>{children}</p>
      {restart && (
        <span style={{ fontSize: 10, color: 'var(--warn)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
          <AlertTriangle size={10} />
          Restart required
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
      addToast('Saved', 'success')
      onRefresh?.()
      setEditing(false)
      setValue('')
    } catch { addToast('Failed to save', 'error') }
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
          <input autoFocus type="password" placeholder={placeholder || 'Enter new value…'} value={value} onChange={e => setValue(e.target.value)} onKeyDown={handleKeyDown} className="z-input" style={{ flex: 1, height: 36, padding: '0 12px', fontSize: 13 }} />
          <button onClick={handleSave} disabled={saving} className="z-btn-primary" style={{ padding: '0 12px', borderRadius: 9, height: 36, fontSize: 12 }}>{saving ? '…' : 'Save'}</button>
          <button onClick={() => { setEditing(false); setValue('') }} className="z-btn-secondary" style={{ padding: '0 10px', borderRadius: 9, height: 36, fontSize: 12 }}>Cancel</button>
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
          : <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{subtitle || 'Not configured'}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {configured && <Check size={12} style={{ color: 'var(--ok)' }} />}
        <button onClick={() => setEditing(true)} className="z-btn-secondary" style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12 }}>
          {configured ? 'Update' : 'Set'}
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

function PushPreferenceCenter() {
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
    catch { addToast('Failed to save', 'error') }
  }

  const saveQuietHours = async (qh) => {
    try {
      await patchPushPreferences({ quiet_hours: qh })
      setQuietHours(qh)
    } catch { addToast('Failed to save', 'error') }
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
    } catch { addToast('Failed to save', 'error') }
  }

  const handleRevoke = async (ep) => {
    try {
      await revokePushDevice(ep)
      setDevices(d => d.filter(x => x.endpoint !== ep))
      addToast('Device removed', 'success')
    } catch { addToast('Failed to remove', 'error') }
  }

  const systemCats = categories.filter(c => c.type === 'system')
  const sensorCats = categories.filter(c => c.type === 'sensor')
  const qh         = quietHours

  const SEV_PRESENCE_OPTS = [
    { value: 'always', label: 'Always' },
    { value: 'home',   label: 'When home' },
    { value: 'away',   label: 'When away' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Browser status + test */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '0.5px solid var(--line)' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>This browser</p>
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>
              {'Notification' in window
                ? Notification.permission === 'granted' ? 'Subscribed — will receive notifications'
                : Notification.permission === 'denied'  ? 'Blocked — enable in browser settings'
                : 'Permission not yet granted'
                : 'Push not supported in this browser'}
            </p>
          </div>
          <span style={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', color: Notification.permission === 'granted' ? 'var(--ok)' : 'var(--ink-faint)' }}>
            {'Notification' in window ? Notification.permission : 'unsupported'}
          </span>
        </div>
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Send a test to verify this device is working.</p>
          <button
            onClick={async () => { try { await testPushNotification(); addToast('Test sent', 'success') } catch { addToast('Not subscribed on this device', 'error') } }}
            className="z-btn-secondary"
            style={{ padding: '5px 11px', borderRadius: 9, fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
          >Send test</button>
        </div>
      </div>

      {/* Quiet hours */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: qh.enabled ? '0.5px solid var(--line)' : 'none', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Quiet hours</p>
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>Suppress non-critical notifications. Also defines "night" for anomaly detection.</p>
          </div>
          <button className="z-toggle" aria-checked={qh.enabled} onClick={() => saveQuietHours({ ...qh, enabled: !qh.enabled })} />
        </div>
        {qh.enabled && (
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', flexShrink: 0 }}>From</p>
            <input type="time" value={qh.start} onChange={e => saveQuietHours({ ...qh, start: e.target.value })} className="z-input" style={{ width: 100, height: 32, padding: '0 8px', fontSize: 12 }} />
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', flexShrink: 0 }}>to</p>
            <input type="time" value={qh.end}   onChange={e => saveQuietHours({ ...qh, end:   e.target.value })} className="z-input" style={{ width: 100, height: 32, padding: '0 8px', fontSize: 12 }} />
          </div>
        )}
      </div>

      {/* System category toggles */}
      {!loadingCats && systemCats.length > 0 && (
        <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px 6px', borderBottom: '0.5px solid var(--line)' }}>
            <p className="z-eyebrow">What reaches your phone</p>
          </div>
          {systemCats.map((cat, i) => (
            <div key={cat.id} style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: i < systemCats.length - 1 ? '0.5px solid var(--line)' : 'none', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {cat.label}
                  {cat.bypass_quiet_hours && <span style={{ fontSize: 9, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', padding: '1px 5px', borderRadius: 4 }}>always</span>}
                </p>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{cat.description}</p>
              </div>
              <button className="z-toggle" aria-checked={!!cat.enabled} onClick={() => toggleCategory(cat.id)} />
            </div>
          ))}
        </div>
      )}

      {/* Sensor categories — each with presence + time conditions */}
      {!loadingCats && sensorCats.length > 0 && (
        <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px 6px', borderBottom: '0.5px solid var(--line)' }}>
            <p className="z-eyebrow">Sensor alerts</p>
          </div>
          {sensorCats.map((cat, i) => {
            const cond        = cat.conditions || {}
            const presence    = cond.presence || 'always'
            const timeEnabled = !!(cond.time_start && cond.time_end)
            return (
              <div key={cat.id} style={{ padding: '12px 16px', borderBottom: i < sensorCats.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: cond ? 10 : 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{cat.label}</p>
                    <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 1 }}>{cat.entity_id}</p>
                  </div>
                  <button className="z-toggle" aria-checked={!!cat.enabled} onClick={() => toggleCategory(cat.id)} />
                </div>
                {cat.enabled && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <p style={{ fontSize: 11, color: 'var(--ink-mute)', width: 68, flexShrink: 0 }}>Alert when</p>
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
                      <p style={{ fontSize: 11, color: 'var(--ink-mute)', width: 68, flexShrink: 0 }}>Time</p>
                      <button className="z-toggle" aria-checked={timeEnabled}
                        onClick={() => updateSensorCondition(cat.id, cat.entity_id,
                          timeEnabled ? { time_start: null, time_end: null } : { time_start: '22:00', time_end: '06:00' }
                        )} />
                      {timeEnabled && (
                        <>
                          <input type="time" value={cond.time_start || '22:00'} onChange={e => updateSensorCondition(cat.id, cat.entity_id, { time_start: e.target.value })} className="z-input" style={{ width: 90, height: 28, padding: '0 8px', fontSize: 12 }} />
                          <p style={{ fontSize: 11, color: 'var(--ink-mute)' }}>to</p>
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

      {/* Subscribed devices */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px 6px', borderBottom: devices.length > 0 ? '0.5px solid var(--line)' : 'none' }}>
          <p className="z-eyebrow">Subscribed devices</p>
        </div>
        {devices.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '14px 16px' }}>No devices subscribed yet.</p>
        ) : (
          devices.map((d, i) => {
            const browser   = parseBrowser(d.user_agent)
            const os        = parseOS(d.user_agent)
            const isCurrent = d.endpoint === currentEp
            const ago = d.subscribed_at
              ? (() => { const diff = Math.floor((Date.now() - new Date(d.subscribed_at)) / 86400000); return diff === 0 ? 'today' : diff === 1 ? 'yesterday' : `${diff}d ago` })()
              : ''
            return (
              <div key={d.endpoint} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: i < devices.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {browser}{os ? ` · ${os}` : ''}
                    {isCurrent && <span style={{ fontSize: 9, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ok)', background: 'color-mix(in srgb, var(--ok) 12%, var(--surface))', padding: '1px 5px', borderRadius: 4 }}>this device</span>}
                  </p>
                  {ago && <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 1 }}>subscribed {ago}</p>}
                </div>
                <button onClick={() => handleRevoke(d.endpoint)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }} title="Revoke">
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminSettings() {
  const { addToast } = useUIStore()
  const { role: myRole } = useAuthStore()
  const isSuperAdmin = myRole === 'super_admin'

  const [refreshing, setRefreshing] = useState(false)

  const [integrations,   setIntegrations]   = useState({})
  const [mqtt,           setMqtt]           = useState({ host: '', port: 1883, username: '', password: '', password_configured: false })
  const [features,       setFeatures]       = useState({})
  const [ollama,         setOllama]         = useState({ base_url: '', model: '', timeout: 30 })
  const [patternLearning, setPatternLearning] = useState({})
  const [email,          setEmail]          = useState({ enabled: false, host: '', port: 587, username: '', password_configured: false, password_masked: '', from_address: '', from_name: 'Ziggy' })

  const [saving, setSaving] = useState({})
  const setSav = (key, val) => setSaving(s => ({ ...s, [key]: val }))

  const loadAll = () => {
    getIntegrationsSettings().then(setIntegrations).catch(() => {})
    getMqttSettings().then(mq => setMqtt({ ...mq, password: '' })).catch(() => {})
    getFeaturesSettings().then(setFeatures).catch(() => {})
    getOllamaSettings().then(setOllama).catch(() => {})
    getPatternLearningSettings().then(pl => setPatternLearning({
      enabled: true, llm_synthesis: true, analysis_hour: 9, lookback_days: 30,
      min_occurrences: 5, max_pending_suggestions: 3, time_window_minutes: 45,
      sequence_gap_minutes: 5, ...pl
    })).catch(() => {})
    if (isSuperAdmin) {
      getEmailSettings().then(setEmail).catch(() => {})
    }
  }

  useEffect(() => { loadAll() }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    loadAll()
    setTimeout(() => setRefreshing(false), 1000)
  }

  const save = async (key, apiFn, payload) => {
    setSav(key, true)
    try { await apiFn(payload); addToast('Saved', 'success') }
    catch { addToast('Failed to save', 'error') }
    finally { setSav(key, false) }
  }

  const FEATURE_LABELS = {
    smart_home:     { label: 'Smart home',       subtitle: 'Device control & HA integration' },
    voice:          { label: 'Voice assistant',   subtitle: 'Microphone, wake word & TTS' },
    task_tracking:  { label: 'Task tracking',     subtitle: 'Tasks & reminders' },
    file_management:{ label: 'File management',   subtitle: 'Create & manage local files' },
    home_map:       { label: 'Home Map',          subtitle: 'Interactive floor plan in Rooms tab (experimental)' },
    buddy_mode:     { label: 'Buddy mode',        subtitle: 'Conversational AI personality' },
    ifttt:          { label: 'IFTTT',             subtitle: 'Webhook triggers' },
    local_storage:  { label: 'Local storage',     subtitle: 'SQLite / local DB' },
    zigbee_support: { label: 'Zigbee support',    subtitle: 'ZHA device pairing' },
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Some changes require restarting Ziggy.</p>
        <button onClick={handleRefresh} disabled={refreshing} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: 7, cursor: 'pointer' }}>
          <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* ── Notifications ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Bot}>Notifications</SectionTitle>
        <PushPreferenceCenter />
      </div>

      {/* ── API Keys ───────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Key}>API Keys</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <SecretField
              label="OpenAI"
              subtitle="Used for intent parsing & AI responses"
              masked={integrations.openai_key_masked}
              configured={integrations.openai_configured}
              placeholder="sk-proj-…"
              onSave={(v) => patchIntegrationsSettings({ openai_key: v })}
              onRefresh={() => getIntegrationsSettings().then(setIntegrations)}
            />
            <SecretField
              label="SerpAPI"
              subtitle="Web search capability"
              masked={integrations.serpapi_key_masked}
              configured={integrations.serpapi_configured}
              placeholder="67b5c8e5…"
              onSave={(v) => patchIntegrationsSettings({ serpapi_key: v })}
              onRefresh={() => getIntegrationsSettings().then(setIntegrations)}
            />
            <SecretField
              label="IFTTT"
              subtitle="Webhook triggers"
              masked={integrations.ifttt_key_masked}
              configured={integrations.ifttt_configured}
              placeholder="Webhook key…"
              onSave={(v) => patchIntegrationsSettings({ ifttt_key: v })}
              onRefresh={() => getIntegrationsSettings().then(setIntegrations)}
            />
          </div>
        </Card>
      </div>

      {/* ── Email (SMTP) — super_admin only ────────────────────────────────────── */}
      {isSuperAdmin && (
        <div style={{ marginBottom: 22 }}>
          <SectionTitle icon={Mail}>Email (SMTP)</SectionTitle>
          <Card>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <SettingRow label="Enable email sending" subtitle="Required for invite emails">
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
                        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>SMTP host</p>
                        <input value={email.host} onChange={e => setEmail(s => ({ ...s, host: e.target.value }))} placeholder="smtp.gmail.com" className="z-input" style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>Port</p>
                        <input type="number" value={email.port} onChange={e => setEmail(s => ({ ...s, port: parseInt(e.target.value) || 587 }))} className="z-input" style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }} />
                      </div>
                    </div>
                    <div>
                      <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>Username (your email)</p>
                      <input type="email" value={email.username} onChange={e => setEmail(s => ({ ...s, username: e.target.value }))} placeholder="you@gmail.com" className="z-input" style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>From name</p>
                      <input value={email.from_name} onChange={e => setEmail(s => ({ ...s, from_name: e.target.value }))} placeholder="Ziggy" className="z-input" style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }} />
                    </div>
                    <Button variant="primary" onClick={() => save('email-smtp', patchEmailSettings, { host: email.host, port: email.port, username: email.username, from_name: email.from_name, from_address: email.username })} disabled={saving['email-smtp']} className="w-full">
                      {saving['email-smtp'] ? 'Saving…' : 'Save SMTP settings'}
                    </Button>
                  </div>
                  <SecretField
                    label="App password"
                    subtitle="Gmail: Settings → Security → App passwords"
                    masked={email.password_masked}
                    configured={email.password_configured}
                    placeholder="Gmail app password…"
                    onSave={(v) => patchEmailSettings({ password: v })}
                    onRefresh={() => getEmailSettings().then(setEmail)}
                  />
                  <div style={{ padding: '12px 16px' }}>
                    <Button variant="secondary" onClick={async () => {
                      try { await testEmail(); addToast('Test email sent — check your inbox', 'success') }
                      catch (e) { addToast(e.message || 'Test failed', 'error') }
                    }} className="w-full">
                      Send test email to yourself
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── MQTT ───────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Wifi} restart>MQTT</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <p className="text-xs text-zinc-500 mb-1.5">Host</p>
                <input
                  value={mqtt.host}
                  onChange={e => setMqtt(s => ({ ...s, host: e.target.value }))}
                  placeholder="10.100.102.21"
                  className={cn('w-full h-9 rounded-xl px-3 text-sm', 'bg-zinc-50 dark:bg-zinc-800', 'border border-zinc-200 dark:border-zinc-700', 'text-zinc-900 dark:text-zinc-100', 'placeholder:text-zinc-400', 'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent')}
                />
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1.5">Port</p>
                <input
                  type="number"
                  value={mqtt.port}
                  onChange={e => setMqtt(s => ({ ...s, port: parseInt(e.target.value) || 1883 }))}
                  className={cn('w-full h-9 rounded-xl px-3 text-sm', 'bg-zinc-50 dark:bg-zinc-800', 'border border-zinc-200 dark:border-zinc-700', 'text-zinc-900 dark:text-zinc-100', 'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent')}
                />
              </div>
            </div>
            <Input label="Username" placeholder="ziggy" value={mqtt.username} onChange={e => setMqtt(s => ({ ...s, username: e.target.value }))} />
            <Button variant="primary" onClick={() => save('mqtt', patchMqttSettings, { host: mqtt.host, port: mqtt.port, username: mqtt.username })} disabled={saving['mqtt']} className="w-full">
              {saving['mqtt'] ? 'Saving…' : 'Save connection'}
            </Button>
          </div>
          <div className="border-t border-zinc-100 dark:border-zinc-800">
            <SecretField
              label="Password"
              masked={mqtt.password_masked}
              configured={mqtt.password_configured}
              placeholder="MQTT password…"
              onSave={(v) => patchMqttSettings({ password: v })}
              onRefresh={() => getMqttSettings().then(m => setMqtt({ ...m, password: '' }))}
            />
          </div>
        </Card>
      </div>

      {/* ── Feature Flags ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Sliders} restart>Feature Flags</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {Object.entries(FEATURE_LABELS).map(([key, { label, subtitle }]) => (
              <SettingRow key={key} label={label} subtitle={subtitle}>
                <Toggle
                  checked={!!features[key]}
                  onCheckedChange={(v) => {
                    setFeatures(s => ({ ...s, [key]: v }))
                    patchFeaturesSettings({ [key]: v }).catch(() => {})
                  }}
                />
              </SettingRow>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Developer Tools ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Sliders}>Developer Tools</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Admin Console</p>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>Debug tools, cloud administration, diagnostics</p>
            </div>
            <a href="/ops" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, textDecoration: 'none', flexShrink: 0 }}>
              Open →
            </a>
          </div>
        </Card>
      </div>

      {/* ── Ollama ─────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Brain}>Ollama (Local LLM)</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input label="Base URL" placeholder="http://localhost:11434/v1" value={ollama.base_url || ''} onChange={e => setOllama(s => ({ ...s, base_url: e.target.value }))} />
            <Input label="Model" placeholder="qwen2.5:3b" value={ollama.model || ''} onChange={e => setOllama(s => ({ ...s, model: e.target.value }))} />
            <div>
              <p className="text-xs text-zinc-500 mb-1.5">Timeout (seconds)</p>
              <input
                type="number" min={5} max={300}
                value={ollama.timeout || 30}
                onChange={e => setOllama(s => ({ ...s, timeout: parseInt(e.target.value) || 30 }))}
                className={cn('w-full h-9 rounded-xl px-3 text-sm', 'bg-zinc-50 dark:bg-zinc-800', 'border border-zinc-200 dark:border-zinc-700', 'text-zinc-900 dark:text-zinc-100', 'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent')}
              />
            </div>
            <Button variant="primary" onClick={() => save('ollama', patchOllamaSettings, ollama)} disabled={saving['ollama']} className="w-full">
              {saving['ollama'] ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Pattern Learning ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Sliders}>Pattern Learning</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Enabled</p>
                <p className="text-xs text-zinc-400">Detect behavioral patterns from events</p>
              </div>
              <Toggle checked={!!patternLearning.enabled} onCheckedChange={(v) => setPatternLearning(s => ({ ...s, enabled: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">LLM synthesis</p>
                <p className="text-xs text-zinc-400">Use AI to generate suggestions from patterns</p>
              </div>
              <Toggle checked={!!patternLearning.llm_synthesis} onCheckedChange={(v) => setPatternLearning(s => ({ ...s, llm_synthesis: v }))} />
            </div>
            <div className="pt-1 border-t border-zinc-100 dark:divide-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Analysis hour</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.analysis_hour ?? 9}:00</span>
              </div>
              <Slider value={patternLearning.analysis_hour ?? 9} onValueChange={(v) => setPatternLearning(s => ({ ...s, analysis_hour: v }))} min={0} max={23} />
              <p className="text-[10px] text-zinc-400 mt-1">Daily analysis runs at this hour</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Lookback days</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.lookback_days ?? 30}d</span>
              </div>
              <Slider value={patternLearning.lookback_days ?? 30} onValueChange={(v) => setPatternLearning(s => ({ ...s, lookback_days: v }))} min={7} max={90} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Min occurrences</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.min_occurrences ?? 5}×</span>
              </div>
              <Slider value={patternLearning.min_occurrences ?? 5} onValueChange={(v) => setPatternLearning(s => ({ ...s, min_occurrences: v }))} min={2} max={20} />
              <p className="text-[10px] text-zinc-400 mt-1">Minimum times a pattern must repeat</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Max pending suggestions</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.max_pending_suggestions ?? 3}</span>
              </div>
              <Slider value={patternLearning.max_pending_suggestions ?? 3} onValueChange={(v) => setPatternLearning(s => ({ ...s, max_pending_suggestions: v }))} min={1} max={10} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Time window</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.time_window_minutes ?? 45}min</span>
              </div>
              <Slider value={patternLearning.time_window_minutes ?? 45} onValueChange={(v) => setPatternLearning(s => ({ ...s, time_window_minutes: v }))} min={15} max={120} />
              <p className="text-[10px] text-zinc-400 mt-1">Events within this window are grouped</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Sequence gap</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.sequence_gap_minutes ?? 5}min</span>
              </div>
              <Slider value={patternLearning.sequence_gap_minutes ?? 5} onValueChange={(v) => setPatternLearning(s => ({ ...s, sequence_gap_minutes: v }))} min={1} max={60} />
            </div>
            <Button variant="primary" onClick={() => save('pl', patchPatternLearningSettings, patternLearning)} disabled={saving['pl']} className="w-full">
              {saving['pl'] ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card>
      </div>

    </div>
  )
}
