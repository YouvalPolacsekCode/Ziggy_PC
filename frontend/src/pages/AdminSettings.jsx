import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, RefreshCw, Server, Bot, Key, Wifi, Sliders, Bug,
  Brain, BookMarked, Plus, Trash2, AlertTriangle, Check, Users, MapPin, Copy, Mail,
} from 'lucide-react'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Slider } from '../components/ui/Slider'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import {
  getHaSettings, patchHaSettings,
  getIntegrationsSettings, patchIntegrationsSettings,
  testPushNotification, getPushPreferences, patchPushPreferences, getPushDevices, revokePushDevice,
  getEmailSettings, patchEmailSettings, testEmail,
  getMqttSettings, patchMqttSettings,
  getFeaturesSettings, patchFeaturesSettings,
  getDebugSettings, patchDebugSettings,
  getOllamaSettings, patchOllamaSettings,
  getPatternLearningSettings, patchPatternLearningSettings,
  getRoomAliases, patchRoomAliases,
  getUsers, updateUser, deleteUser,
  createInvite, listInvites, revokeInvite,
  getPresencePersons, createPresencePerson, deletePresencePerson,
  getPresenceZone, savePresenceZone,
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

// ─── Presence section ─────────────────────────────────────────────────────────

const STALE_HOME_MS  = 8 * 60 * 60 * 1000  // 8 h — matches backend asymmetric staleness
const STALE_AWAY_MS  = 30 * 60 * 1000       // 30 min

function timeAgo(iso) {
  if (!iso) return 'never'
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function _isStale(p) {
  if (!p.last_seen) return true
  const age = Date.now() - new Date(p.last_seen)
  return p.state === 'home' ? age > STALE_HOME_MS : age > STALE_AWAY_MS
}

function presenceStateColor(p) {
  if (_isStale(p) || p.effective_state === 'unknown') return 'var(--ink-faint)'
  if (p.effective_state === 'home') return 'var(--ok)'
  if (p.effective_state === 'not_home') return 'var(--warn)'
  return 'var(--ink-faint)'
}

function presenceStateLabel(p) {
  if (_isStale(p)) return p.last_seen ? 'stale' : 'unknown'
  if (p.effective_state === 'home') return 'home'
  if (p.effective_state === 'not_home') return 'away'
  return 'unknown'
}

function PresenceSection() {
  const { addToast } = useUIStore()
  const [persons,   setPersons]  = useState([])
  const [loading,   setLoading]  = useState(true)
  const [newName,   setNewName]  = useState('')
  const [adding,    setAdding]   = useState(false)
  const [copiedId,  setCopiedId] = useState(null)
  const [zone,      setZone]     = useState(null)
  const [zoneEdit,  setZoneEdit] = useState(false)
  const [zoneDraft, setZoneDraft] = useState({ lat: '', lon: '', radius_m: 200 })
  const [zoneSaving, setZoneSaving] = useState(false)
  const [locating,  setLocating] = useState(false)

  const load = async () => {
    try {
      const [p, z] = await Promise.all([getPresencePersons(), getPresenceZone()])
      setPersons(p.persons ?? [])
      setZone(z)
      if (z?.lat != null) setZoneDraft({ lat: z.lat, lon: z.lon, radius_m: z.radius ?? 200 })
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    try {
      await createPresencePerson(name)
      setNewName('')
      await load()
      addToast(`${name} added`, 'success')
    } catch (e) { addToast(e.message || 'Failed to add person', 'error') }
    finally { setAdding(false) }
  }

  const handleDelete = async (p) => {
    if (!window.confirm(`Remove ${p.name} from presence tracking?`)) return
    try {
      await deletePresencePerson(p.id)
      await load()
      addToast(`${p.name} removed`, 'success')
    } catch (e) { addToast(e.message || 'Failed', 'error') }
  }

  const copyInvite = (p) => {
    const url = `${window.location.origin}/presence/join/${p.token}`
    navigator.clipboard.writeText(url).catch(() => {})
    setCopiedId(p.id)
    setTimeout(() => setCopiedId(null), 2000)
    addToast('Invite link copied', 'success')
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) { addToast('Geolocation not available', 'error'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setZoneDraft(d => ({ ...d, lat: parseFloat(pos.coords.latitude.toFixed(6)), lon: parseFloat(pos.coords.longitude.toFixed(6)) }))
        setLocating(false)
        setZoneEdit(true)
      },
      () => { addToast('Could not get location', 'error'); setLocating(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const saveZone = async () => {
    setZoneSaving(true)
    try {
      await savePresenceZone({ lat: parseFloat(zoneDraft.lat), lon: parseFloat(zoneDraft.lon), radius_m: parseFloat(zoneDraft.radius_m) || 200 })
      await load()
      setZoneEdit(false)
      addToast('Home zone saved', 'success')
    } catch (e) { addToast(e.message || 'Failed to save', 'error') }
    finally { setZoneSaving(false) }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 64 }}>
        <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Home zone card ── */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: zoneEdit ? '0.5px solid var(--line)' : 'none' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Home zone</p>
            <p style={{ fontSize: 11, color: zone?.configured ? 'var(--ok)' : 'var(--warn)', marginTop: 1 }}>
              {zone?.configured
                ? `${zone.lat?.toFixed(4)}, ${zone.lon?.toFixed(4)} · ${zone.radius}m radius`
                : zone?.lat != null
                  ? `Using HA location (${zone.lat?.toFixed(4)}, ${zone.lon?.toFixed(4)}) — save to Ziggy to confirm`
                  : 'Not configured — set your home location'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              onClick={useMyLocation}
              disabled={locating}
              className="z-btn-secondary"
              style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12 }}
            >
              {locating ? '…' : 'Use my location'}
            </button>
            {!zoneEdit && (
              <button onClick={() => setZoneEdit(true)} className="z-btn-secondary" style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12 }}>
                Edit
              </button>
            )}
          </div>
        </div>
        {zoneEdit && (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 3 }}>Latitude</p>
                <input value={zoneDraft.lat} onChange={e => setZoneDraft(d => ({ ...d, lat: e.target.value }))} className="z-input" style={{ width: '100%', height: 32, padding: '0 8px', fontSize: 12, boxSizing: 'border-box' }} placeholder="32.0853" />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 3 }}>Longitude</p>
                <input value={zoneDraft.lon} onChange={e => setZoneDraft(d => ({ ...d, lon: e.target.value }))} className="z-input" style={{ width: '100%', height: 32, padding: '0 8px', fontSize: 12, boxSizing: 'border-box' }} placeholder="34.7818" />
              </div>
              <div style={{ width: 90 }}>
                <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 3 }}>Radius (m)</p>
                <input type="number" min={50} max={2000} value={zoneDraft.radius_m} onChange={e => setZoneDraft(d => ({ ...d, radius_m: e.target.value }))} className="z-input" style={{ width: '100%', height: 32, padding: '0 8px', fontSize: 12, boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveZone} disabled={zoneSaving || !zoneDraft.lat || !zoneDraft.lon} className="z-btn-primary" style={{ height: 32, padding: '0 14px', borderRadius: 8, fontSize: 12 }}>
                {zoneSaving ? '…' : 'Save zone'}
              </button>
              <button onClick={() => setZoneEdit(false)} className="z-btn-secondary" style={{ height: 32, padding: '0 10px', borderRadius: 8, fontSize: 12 }}>
                Cancel
              </button>
            </div>
            <p style={{ fontSize: 10, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
              Tip: click "Use my location" while at home to auto-fill coordinates. 200m radius works well for most homes.
            </p>
          </div>
        )}
      </div>

      {/* ── People card ── */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
      {persons.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '20px 16px', textAlign: 'center' }}>
          No persons configured. Add a person to start tracking presence.
        </p>
      ) : (
        persons.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderBottom: i < persons.length - 1 ? '0.5px solid var(--line)' : 'none', flexWrap: 'wrap' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: presenceStateColor(p), flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 60 }}>{p.name}</span>
            <span style={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', color: presenceStateColor(p) }}>{presenceStateLabel(p)}</span>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{timeAgo(p.last_seen)}</span>
            <button
              onClick={() => copyInvite(p)}
              title="Copy invite link"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: copiedId === p.id ? 'var(--ok)' : 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }}
            >
              {copiedId === p.id ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button
              onClick={() => handleDelete(p)}
              title="Remove person"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))
      )}

      {/* Add row */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 6, borderTop: persons.length > 0 ? '0.5px solid var(--line)' : 'none' }}>
        <input
          placeholder="Name (e.g. Youval)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          className="z-input"
          style={{ flex: 1, height: 34, padding: '0 10px', fontSize: 12 }}
        />
        <button
          onClick={handleAdd}
          disabled={adding || !newName.trim()}
          className="z-btn-primary"
          style={{ height: 34, padding: '0 12px', borderRadius: 9, fontSize: 12 }}
        >
          {adding ? '…' : 'Add'}
        </button>
      </div>

      <p style={{ fontSize: 10, color: 'var(--ink-faint)', padding: '0 16px 12px', lineHeight: 1.6 }}>
        Add each household member, then copy their invite link and open it on their phone.
        Pin the page to the home screen for continuous background tracking.
      </p>
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
  const [categories, setCategories] = useState([])  // from /api/push/categories
  const [quietHours, setQuietHours] = useState({ enabled: false, start: '23:00', end: '07:00' })
  const [devices,    setDevices]    = useState([])
  const [currentEp,  setCurrentEp]  = useState(null)
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
    // Update local categories state
    setCategories(cs => cs.map(c => {
      if (c.id !== catId) return c
      const prev = c.conditions || {}
      const merged = Object.fromEntries(
        Object.entries({ ...prev, ...condPatch }).filter(([, v]) => v != null)
      )
      return { ...c, conditions: merged }
    }))
    // Persist via sensor-alerts patch
    const cat = categories.find(c => c.id === catId)
    if (!cat) return
    const prev = cat.conditions || {}
    const merged = Object.fromEntries(
      Object.entries({ ...prev, ...condPatch }).filter(([, v]) => v != null)
    )
    try {
      const allSensors = categories
        .filter(c => c.type === 'sensor')
        .map(c => ({
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

  const systemCats  = categories.filter(c => c.type === 'system')
  const sensorCats  = categories.filter(c => c.type === 'sensor')
  const qh          = quietHours

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
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: cond ? 10 : 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{cat.label}</p>
                    <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 1 }}>{cat.entity_id}</p>
                  </div>
                  <button className="z-toggle" aria-checked={!!cat.enabled} onClick={() => toggleCategory(cat.id)} />
                </div>
                {cat.enabled && (
                  <>
                    {/* Presence */}
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
                    {/* Time window */}
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
            const browser = parseBrowser(d.user_agent)
            const os      = parseOS(d.user_agent)
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

// ─── Main component (embeddable in Settings tabs) ────────────────────────────

const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', user: 'User', guest: 'Guest' }
const ROLE_COLORS = { super_admin: 'var(--accent)', admin: '#8b5cf6', user: 'var(--ok)', guest: 'var(--ink-faint)' }

export default function AdminSettings() {
  const { addToast } = useUIStore()
  const { role: myRole } = useAuthStore()
  const isSuperAdmin = myRole === 'super_admin'

  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Section state
  const [ha, setHa] = useState({ url: '', token_masked: '', token_configured: false })
  const [integrations, setIntegrations] = useState({})
  const [mqtt, setMqtt] = useState({ host: '', port: 1883, username: '', password: '', password_configured: false })
  const [features, setFeatures] = useState({})
  const [debug, setDebug] = useState({})
  const [ollama, setOllama] = useState({ base_url: '', model: '', timeout: 30 })
  const [patternLearning, setPatternLearning] = useState({})
  const [aliases, setAliases] = useState({ en: {}, he: {} })
  const [email,   setEmail]   = useState({ enabled: false, host: '', port: 587, username: '', password_configured: false, password_masked: '', from_address: '', from_name: 'Ziggy' })

  // Users + invites state (super_admin only)
  const [users,         setUsers]         = useState([])
  const [invites,       setInvites]       = useState([])
  const [inviteEmail,   setInviteEmail]   = useState('')
  const [inviteRole,    setInviteRole]    = useState('user')
  const [inviteLink,    setInviteLink]    = useState(null)
  const [inviteSaving,  setInviteSaving]  = useState(false)

  // Per-section saving
  const [saving, setSaving] = useState({})
  const setSav = (key, val) => setSaving((s) => ({ ...s, [key]: val }))

  // Room alias editor state
  const [newAlias, setNewAlias] = useState({ alias: '', room: '' })
  const [aliasFilter, setAliasFilter] = useState('')

  const loadAll = () => {
    // All calls fire in parallel — no sequential awaits, no page-level loading gate.
    // Each setter is called independently as its response arrives.
    getHaSettings().then(setHa).catch(() => {})
    getIntegrationsSettings().then(setIntegrations).catch(() => {})
    getMqttSettings().then(mq => setMqtt({ ...mq, password: '' })).catch(() => {})
    getFeaturesSettings().then(setFeatures).catch(() => {})
    getDebugSettings().then(setDebug).catch(() => {})
    getOllamaSettings().then(setOllama).catch(() => {})
    getPatternLearningSettings().then(pl => setPatternLearning({
      enabled: true, llm_synthesis: true, analysis_hour: 9, lookback_days: 30,
      min_occurrences: 5, max_pending_suggestions: 3, time_window_minutes: 45,
      sequence_gap_minutes: 5, ...pl
    })).catch(() => {})
    getRoomAliases().then(al => setAliases({ en: al?.en || {}, he: al?.he || {} })).catch(() => {})
    if (isSuperAdmin) {
      getEmailSettings().then(setEmail).catch(() => {})
      getUsers().then(setUsers).catch(() => {})
      listInvites().then(r => setInvites(r.filter(i => i.status === 'pending'))).catch(() => {})
    }
  }

  useEffect(() => { loadAll() }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    loadAll()
    setTimeout(() => setRefreshing(false), 1000)
  }

  // User management handlers
  const handleCreateInvite = async () => {
    setInviteSaving(true)
    setInviteLink(null)
    try {
      const res = await createInvite({ type: 'user', email: inviteEmail.trim() || undefined, role: inviteRole, public_url: window.location.origin })
      const url = `${window.location.origin}${res.invite_url}`
      setInviteLink(url)
      navigator.clipboard.writeText(url).catch(() => {})
      addToast('Invite link copied to clipboard', 'success')
      setInvites(prev => [...prev, { ...res, status: 'pending' }])
    } catch (e) { addToast(e.message || 'Failed to create invite', 'error') }
    finally { setInviteSaving(false) }
  }

  const handleUpdateRole = async (username, role) => {
    try {
      await updateUser(username, { role })
      setUsers((prev) => prev.map((u) => u.username === username ? { ...u, role } : u))
      addToast('Role updated', 'success')
    } catch (e) { addToast(e.message || 'Failed to update role', 'error') }
  }

  const handleDeleteUser = async (username) => {
    if (!window.confirm(`Remove "${username}" from this home?`)) return
    try {
      await deleteUser(username)
      setUsers((prev) => prev.filter((u) => u.username !== username))
      addToast(`User removed`, 'success')
    } catch (e) { addToast(e.message || 'Failed to delete user', 'error') }
  }

  const handleRevokeInvite = async (token) => {
    try {
      await revokeInvite(token)
      setInvites(prev => prev.filter(i => i.token !== token))
      addToast('Invite revoked', 'success')
    } catch (e) { addToast(e.message || 'Failed', 'error') }
  }

  // Generic section save helper
  const save = async (key, apiFn, payload) => {
    setSav(key, true)
    try {
      await apiFn(payload)
      addToast('Saved', 'success')
    } catch { addToast('Failed to save', 'error') }
    finally { setSav(key, false) }
  }

  // Room aliases
  const addAlias = () => {
    const { alias, room } = newAlias
    if (!alias.trim() || !room.trim()) return
    setAliases((s) => ({ ...s, en: { ...s.en, [alias.trim().toLowerCase()]: room.trim() } }))
    setNewAlias({ alias: '', room: '' })
  }
  const removeAlias = (key) => setAliases((s) => { const en = { ...s.en }; delete en[key]; return { ...s, en } })
  const saveAliases = () => save('aliases', patchRoomAliases, { en: aliases.en, he: aliases.he })

  const filteredAliases = Object.entries(aliases.en).filter(([k, v]) => {
    const q = aliasFilter.toLowerCase()
    return !q || k.includes(q) || v.includes(q)
  })

  const FEATURE_LABELS = {
    smart_home: { label: 'Smart home', subtitle: 'Device control & HA integration' },
    voice: { label: 'Voice assistant', subtitle: 'Microphone, wake word & TTS' },
    task_tracking: { label: 'Task tracking', subtitle: 'Tasks & reminders' },
    file_management: { label: 'File management', subtitle: 'Create & manage local files' },
    home_map: { label: 'Home Map', subtitle: 'Interactive floor plan in Rooms tab (experimental)' },
    buddy_mode: { label: 'Buddy mode', subtitle: 'Conversational AI personality' },
    ifttt: { label: 'IFTTT', subtitle: 'Webhook triggers' },
    local_storage: { label: 'Local storage', subtitle: 'SQLite / local DB' },
    zigbee_support: { label: 'Zigbee support', subtitle: 'ZHA device pairing' },
  }

  return (
    <div>
      {/* Inline toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Some changes require restarting Ziggy.</p>
        <button onClick={handleRefresh} disabled={refreshing} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: 7, cursor: 'pointer' }}>
          <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* ── Users (super_admin only) ────────────────────────────────────────── */}
      {isSuperAdmin && (
        <div style={{ marginBottom: 22 }}>
          <SectionTitle icon={Users}>Users & Access</SectionTitle>
          <Card>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {/* Active users */}
              {users.map((u) => (
                <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px' }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                  <select
                    value={u.role}
                    onChange={(e) => handleUpdateRole(u.username, e.target.value)}
                    style={{ fontSize: 11, padding: '3px 6px', borderRadius: 7, border: '0.5px solid var(--line)', background: 'var(--surface)', color: ROLE_COLORS[u.role] || 'var(--ink)', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {Object.entries(ROLE_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  <button onClick={() => handleDeleteUser(u.username)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }} title="Remove user">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              {/* Pending invites */}
              {invites.length > 0 && invites.map((inv) => (
                <div key={inv.token} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', opacity: 0.75 }}>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
                    {inv.email || '(open invite)'} · {ROLE_LABELS[inv.role] || inv.role}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--warn)', fontWeight: 600, background: 'var(--warn)15', padding: '2px 7px', borderRadius: 6, flexShrink: 0 }}>pending</span>
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.token}`).catch(()=>{}); addToast('Link copied', 'success') }} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 6, cursor: 'pointer', padding: '4px 6px', color: 'var(--ink-faint)', display: 'flex' }} title="Copy invite link">
                    <Copy size={11} />
                  </button>
                  <button onClick={() => handleRevokeInvite(inv.token)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }} title="Revoke">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              {/* Invite new user */}
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 2 }}>Invite user</p>
                {inviteLink ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Share this link — expires in 72h, single use.</p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <div style={{ flex: 1, background: 'var(--bg-2)', borderRadius: 9, padding: '0 10px', height: 34, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                        <span style={{ fontSize: 11, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inviteLink}</span>
                      </div>
                      <button onClick={() => { navigator.clipboard.writeText(inviteLink).catch(()=>{}); addToast('Copied!', 'success') }} className="z-btn-secondary" style={{ height: 34, padding: '0 10px', borderRadius: 9, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Copy size={12} /> Copy
                      </button>
                      <button onClick={() => { setInviteLink(null); setInviteEmail('') }} className="z-btn-secondary" style={{ height: 34, padding: '0 10px', borderRadius: 9, fontSize: 12 }}>New</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="email"
                      placeholder="Email (optional)"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="z-input"
                      style={{ flex: 2, height: 34, padding: '0 10px', fontSize: 12 }}
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      style={{ height: 34, padding: '0 6px', borderRadius: 9, border: '0.5px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12, cursor: 'pointer' }}
                    >
                      {Object.entries(ROLE_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                    </select>
                    <button
                      onClick={handleCreateInvite}
                      disabled={inviteSaving}
                      className="z-btn-primary"
                      style={{ height: 34, padding: '0 12px', borderRadius: 9, fontSize: 12, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}
                    >
                      {inviteSaving ? '…' : <><Plus size={12} /> Invite</>}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Presence tracking ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={MapPin}>Presence tracking</SectionTitle>
        <PresenceSection />
      </div>

      {/* ── Home Assistant ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Server} restart>Home Assistant</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {/* URL */}
            <div className="px-4 py-3">
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 6 }}>URL</p>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={ha.url} onChange={e => setHa(s => ({ ...s, url: e.target.value }))} placeholder="http://homeassistant.local:8123/" className="z-input" style={{ flex: 1, height: 36, padding: '0 12px', fontSize: 13 }} />
                <button onClick={() => save('ha-url', patchHaSettings, { url: ha.url })} disabled={saving['ha-url']} className="z-btn-primary" style={{ padding: '0 12px', borderRadius: 9, height: 36, fontSize: 12 }}>
                  {saving['ha-url'] ? '…' : 'Save'}
                </button>
              </div>
            </div>
            {/* Token */}
            <SecretField
              label="Long-lived token"
              masked={ha.token_masked}
              configured={ha.token_configured}
              placeholder="eyJhbGc…"
              onSave={(v) => patchHaSettings({ token: v })}
              onRefresh={() => getHaSettings().then(setHa)}
            />
          </div>
        </Card>
      </div>

      {/* ── Notifications ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Bot}>Notifications</SectionTitle>
        <PushPreferenceCenter />
      </div>

      {/* ── API Keys ────────────────────────────────────────────────────────── */}
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

      {/* ── Email (SMTP) ────────────────────────────────────────────────────── */}
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
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try { await testEmail(); addToast('Test email sent — check your inbox', 'success') }
                        catch (e) { addToast(e.message || 'Test failed', 'error') }
                      }}
                      className="w-full"
                    >
                      Send test email to yourself
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── MQTT ────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Wifi} restart>MQTT</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <p className="text-xs text-zinc-500 mb-1.5">Host</p>
                <input
                  value={mqtt.host}
                  onChange={(e) => setMqtt((s) => ({ ...s, host: e.target.value }))}
                  placeholder="10.100.102.21"
                  className={cn(
                    'w-full h-9 rounded-xl px-3 text-sm',
                    'bg-zinc-50 dark:bg-zinc-800',
                    'border border-zinc-200 dark:border-zinc-700',
                    'text-zinc-900 dark:text-zinc-100',
                    'placeholder:text-zinc-400',
                    'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                  )}
                />
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1.5">Port</p>
                <input
                  type="number"
                  value={mqtt.port}
                  onChange={(e) => setMqtt((s) => ({ ...s, port: parseInt(e.target.value) || 1883 }))}
                  className={cn(
                    'w-full h-9 rounded-xl px-3 text-sm',
                    'bg-zinc-50 dark:bg-zinc-800',
                    'border border-zinc-200 dark:border-zinc-700',
                    'text-zinc-900 dark:text-zinc-100',
                    'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                  )}
                />
              </div>
            </div>
            <Input
              label="Username"
              placeholder="ziggy"
              value={mqtt.username}
              onChange={(e) => setMqtt((s) => ({ ...s, username: e.target.value }))}
            />
            <Button
              variant="primary"
              onClick={() => save('mqtt', patchMqttSettings, { host: mqtt.host, port: mqtt.port, username: mqtt.username })}
              disabled={saving['mqtt']}
              className="w-full"
            >
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
              onRefresh={() => getMqttSettings().then((m) => setMqtt({ ...m, password: '' }))}
            />
          </div>
        </Card>
      </div>

      {/* ── Feature Flags ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Sliders} restart>Feature Flags</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {Object.entries(FEATURE_LABELS).map(([key, { label, subtitle }]) => (
              <SettingRow key={key} label={label} subtitle={subtitle}>
                <Toggle
                  checked={!!features[key]}
                  onCheckedChange={(v) => {
                    setFeatures((s) => ({ ...s, [key]: v }))
                    patchFeaturesSettings({ [key]: v }).catch(() => {})
                  }}
                />
              </SettingRow>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Debug ───────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Bug}>Debug</SectionTitle>
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <SettingRow label="Verbose logging" subtitle="Log all intent parsing steps">
              <Toggle
                checked={!!debug.verbose_logging}
                onCheckedChange={(v) => {
                  setDebug((s) => ({ ...s, verbose_logging: v }))
                  patchDebugSettings({ verbose_logging: v }).catch(() => {})
                }}
              />
            </SettingRow>
            <SettingRow label="Verbose mode" subtitle="Extra console output">
              <Toggle
                checked={!!debug.verbose}
                onCheckedChange={(v) => {
                  setDebug((s) => ({ ...s, verbose: v }))
                  patchDebugSettings({ verbose: v }).catch(() => {})
                }}
              />
            </SettingRow>
          </div>
        </Card>
      </div>

      {/* ── Ollama ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Brain}>Ollama (Local LLM)</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input
              label="Base URL"
              placeholder="http://localhost:11434/v1"
              value={ollama.base_url || ''}
              onChange={(e) => setOllama((s) => ({ ...s, base_url: e.target.value }))}
            />
            <Input
              label="Model"
              placeholder="qwen2.5:3b"
              value={ollama.model || ''}
              onChange={(e) => setOllama((s) => ({ ...s, model: e.target.value }))}
            />
            <div>
              <p className="text-xs text-zinc-500 mb-1.5">Timeout (seconds)</p>
              <input
                type="number"
                min={5}
                max={300}
                value={ollama.timeout || 30}
                onChange={(e) => setOllama((s) => ({ ...s, timeout: parseInt(e.target.value) || 30 }))}
                className={cn(
                  'w-full h-9 rounded-xl px-3 text-sm',
                  'bg-zinc-50 dark:bg-zinc-800',
                  'border border-zinc-200 dark:border-zinc-700',
                  'text-zinc-900 dark:text-zinc-100',
                  'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                )}
              />
            </div>
            <Button
              variant="primary"
              onClick={() => save('ollama', patchOllamaSettings, ollama)}
              disabled={saving['ollama']}
              className="w-full"
            >
              {saving['ollama'] ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Pattern Learning ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Sliders}>Pattern Learning</SectionTitle>
        <Card>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Enabled</p>
                <p className="text-xs text-zinc-400">Detect behavioral patterns from events</p>
              </div>
              <Toggle
                checked={!!patternLearning.enabled}
                onCheckedChange={(v) => setPatternLearning((s) => ({ ...s, enabled: v }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">LLM synthesis</p>
                <p className="text-xs text-zinc-400">Use AI to generate suggestions from patterns</p>
              </div>
              <Toggle
                checked={!!patternLearning.llm_synthesis}
                onCheckedChange={(v) => setPatternLearning((s) => ({ ...s, llm_synthesis: v }))}
              />
            </div>

            <div className="pt-1 border-t border-zinc-100 dark:divide-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Analysis hour</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.analysis_hour ?? 9}:00</span>
              </div>
              <Slider
                value={patternLearning.analysis_hour ?? 9}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, analysis_hour: v }))}
                min={0}
                max={23}
              />
              <p className="text-[10px] text-zinc-400 mt-1">Daily analysis runs at this hour</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Lookback days</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.lookback_days ?? 30}d</span>
              </div>
              <Slider
                value={patternLearning.lookback_days ?? 30}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, lookback_days: v }))}
                min={7}
                max={90}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Min occurrences</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.min_occurrences ?? 5}×</span>
              </div>
              <Slider
                value={patternLearning.min_occurrences ?? 5}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, min_occurrences: v }))}
                min={2}
                max={20}
              />
              <p className="text-[10px] text-zinc-400 mt-1">Minimum times a pattern must repeat</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Max pending suggestions</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.max_pending_suggestions ?? 3}</span>
              </div>
              <Slider
                value={patternLearning.max_pending_suggestions ?? 3}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, max_pending_suggestions: v }))}
                min={1}
                max={10}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Time window</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.time_window_minutes ?? 45}min</span>
              </div>
              <Slider
                value={patternLearning.time_window_minutes ?? 45}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, time_window_minutes: v }))}
                min={15}
                max={120}
              />
              <p className="text-[10px] text-zinc-400 mt-1">Events within this window are grouped</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">Sequence gap</p>
                <span className="text-xs font-semibold text-zinc-500">{patternLearning.sequence_gap_minutes ?? 5}min</span>
              </div>
              <Slider
                value={patternLearning.sequence_gap_minutes ?? 5}
                onValueChange={(v) => setPatternLearning((s) => ({ ...s, sequence_gap_minutes: v }))}
                min={1}
                max={60}
              />
            </div>

            <Button
              variant="primary"
              onClick={() => save('pl', patchPatternLearningSettings, patternLearning)}
              disabled={saving['pl']}
              className="w-full"
            >
              {saving['pl'] ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Room Aliases ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={BookMarked}>Room Aliases</SectionTitle>
        <Card>
          {/* Search + Add */}
          <div className="px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 flex flex-col gap-3">
            <input
              value={aliasFilter}
              onChange={(e) => setAliasFilter(e.target.value)}
              placeholder="Search aliases…"
              className={cn(
                'w-full h-9 rounded-xl px-3 text-sm',
                'bg-zinc-50 dark:bg-zinc-800',
                'border border-zinc-200 dark:border-zinc-700',
                'text-zinc-900 dark:text-zinc-100',
                'placeholder:text-zinc-400',
                'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
              )}
            />
            <div className="flex gap-2">
              <input
                value={newAlias.alias}
                onChange={(e) => setNewAlias((s) => ({ ...s, alias: e.target.value }))}
                placeholder="Alias (e.g. lounge)"
                className={cn(
                  'flex-1 h-9 rounded-xl px-3 text-sm',
                  'bg-zinc-50 dark:bg-zinc-800',
                  'border border-zinc-200 dark:border-zinc-700',
                  'text-zinc-900 dark:text-zinc-100',
                  'placeholder:text-zinc-400',
                  'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                )}
              />
              <input
                value={newAlias.room}
                onChange={(e) => setNewAlias((s) => ({ ...s, room: e.target.value }))}
                placeholder="Room ID (e.g. living_room)"
                className={cn(
                  'flex-1 h-9 rounded-xl px-3 text-sm',
                  'bg-zinc-50 dark:bg-zinc-800',
                  'border border-zinc-200 dark:border-zinc-700',
                  'text-zinc-900 dark:text-zinc-100',
                  'placeholder:text-zinc-400',
                  'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                )}
              />
              <Button size="sm" onClick={addAlias}>
                <Plus size={13} />
              </Button>
            </div>
          </div>

          {/* Alias list */}
          <div className="max-h-72 overflow-y-auto">
            {filteredAliases.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-6">No aliases found</p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredAliases.map(([alias, room]) => (
                  <div key={alias} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 truncate">{alias}</span>
                    <span className="text-zinc-300 dark:text-zinc-600 text-xs">→</span>
                    <Badge variant="default" className="text-[10px] shrink-0">{room}</Badge>
                    <button
                      onClick={() => removeAlias(alias)}
                      className="p-1 text-zinc-400 hover:text-red-500 transition-colors shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
            <Button variant="primary" onClick={saveAliases} disabled={saving['aliases']} className="w-full">
              {saving['aliases'] ? 'Saving…' : `Save aliases (${Object.keys(aliases.en).length})`}
            </Button>
          </div>
        </Card>
      </div>

    </div>
  )
}
