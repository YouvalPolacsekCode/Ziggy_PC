import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, Moon, User, Lock, LogOut, RefreshCw,
  Plus, Trash2, Wifi, Shield, Users, MapPin,
  Radio, Cloud, Activity, Check, Copy, Zap,
  Smartphone,
} from 'lucide-react'
import { PairWithPhone } from '../components/PairWithPhone'
import { MobileDevicesList } from '../components/MobileDevicesList'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Modal } from '../components/ui/Modal'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import {
  getHealth, getHaDevices, getActivity, zhaPermit,
  getGeneralSettings, patchGeneralSettings,
  getAuthStatus, changePassword,
  getUsers, updateUser, deleteUser,
  createInvite, listInvites, revokeInvite,
  getPresencePersons, createPresencePerson, deletePresencePerson,
  getPresenceZone, savePresenceZone, getPresenceDebug, setPresenceLanHost,
  pingMePresence, getMyPresencePerson,
  listPresenceZones, createPresenceZone, updatePresenceZone, deletePresenceZone,
} from '../lib/api'
import AdminSettings from './AdminSettings'
import { MemoryPanel } from './Memory'
import QuickAsks from './QuickAsks'
import VirtualDevices from './VirtualDevices'
import { useT, setLang as setI18nLang, LANGS } from '../lib/i18n'
import { useFeature } from '../stores/featuresStore'

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEZONES = [
  'UTC', 'Asia/Jerusalem', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'America/New_York', 'America/Chicago',
  'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney',
]
const LANGUAGES = LANGS
const ROLE_LABELS = {
  super_admin: { label: 'Super Admin', color: 'var(--accent)' },
  admin:       { label: 'Admin',       color: '#8b5cf6'       },
  user:        { label: 'User',        color: 'var(--ok)'     },
  guest:       { label: 'Guest',       color: 'var(--ink-faint)' },
}
const ROLE_ORDER_FE = { guest: 0, user: 1, admin: 2, super_admin: 3 }

function hasRole(userRole, minRole) {
  return (ROLE_ORDER_FE[userRole] ?? 0) >= (ROLE_ORDER_FE[minRole] ?? 999)
}

// ─── Presence helpers ─────────────────────────────────────────────────────────

const STALE_HOME_MS = 8 * 60 * 60 * 1000
const STALE_AWAY_MS = 30 * 60 * 1000

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

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, paddingLeft: 2 }}>
      {Icon && <Icon size={12} style={{ color: 'var(--ink-faint)' }} />}
      <p className="z-eyebrow">{children}</p>
    </div>
  )
}

function SettingRow({ icon: Icon, label, subtitle, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {Icon && <Icon size={16} style={{ flexShrink: 0, color: 'var(--ink-faint)' }} />}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</p>
          {subtitle && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

// ─── System Status Card ───────────────────────────────────────────────────────

function StatusRow({ icon: Icon, label, value, valueColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px' }}>
      <Icon size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', color: valueColor || 'var(--ink-2)' }}>
        {value}
      </span>
    </div>
  )
}

function SystemStatusCard() {
  const [loaded, setLoaded] = useState(false)
  const [health, setHealth] = useState(null)
  const [deviceCount, setDeviceCount] = useState(null)
  const [lastEventTs, setLastEventTs] = useState(null)

  useEffect(() => {
    Promise.allSettled([
      getHealth(),
      getHaDevices(),
      getActivity(1),
    ]).then(([healthRes, devicesRes, activityRes]) => {
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value)
      if (devicesRes.status === 'fulfilled') setDeviceCount((devicesRes.value?.devices ?? []).length)
      if (activityRes.status === 'fulfilled') {
        const items = activityRes.value?.activity ?? []
        setLastEventTs(items[0]?.ts ?? null)
      }
      setLoaded(true)
    })
  }, [])

  if (!loaded) {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 64 }}>
          <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
        </div>
      </Card>
    )
  }

  const bridgeOk     = health?.ha_connected ?? false
  const offlineCount = health?.offline_count ?? 0
  const linkStyle    = { color: 'inherit', textDecoration: 'none', fontWeight: 600, fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 }

  return (
    <Card>
      <div className="divide-y divide-line">
        <StatusRow icon={Cloud}    label="Ziggy"      value="Online"                                            valueColor="var(--ok)" />
        <StatusRow icon={Wifi}     label="Bridge"     value={bridgeOk ? 'Connected' : 'Offline'}                valueColor={bridgeOk ? 'var(--ok)' : 'var(--accent)'} />

        {/* Zigbee row — device count and offline count are separate links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px' }}>
          <Radio size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }}>Zigbee</span>
          {deviceCount !== null ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link to="/devices" style={{ ...linkStyle, color: 'var(--ink-2)' }}>
                {deviceCount} device{deviceCount !== 1 ? 's' : ''}
              </Link>
              {offlineCount > 0 && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>·</span>
                  <Link to="/devices?filter=offline" style={{ ...linkStyle, color: 'var(--warn)' }}>
                    {offlineCount} offline
                  </Link>
                </>
              )}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>Unavailable</span>
          )}
        </div>

        <StatusRow icon={Activity} label="Last event" value={lastEventTs ? timeAgo(lastEventTs) : 'No events'} valueColor="var(--ink-mute)" />
      </div>
    </Card>
  )
}

// ─── Zigbee Bridge Section ────────────────────────────────────────────────────

function ZigbeeBridgeSection({ isAdmin }) {
  const { addToast } = useUIStore()
  const [health, setHealth]           = useState(null)
  const [deviceCount, setDeviceCount] = useState(null)
  const [pairing, setPairing]         = useState(false)
  const [pairingActive, setPairingActive] = useState(false)
  const [countdown, setCountdown]     = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    Promise.allSettled([getHealth(), getHaDevices()]).then(([h, d]) => {
      if (h.status === 'fulfilled') setHealth(h.value)
      if (d.status === 'fulfilled') setDeviceCount((d.value?.devices ?? []).length)
    })
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const handlePermitJoin = async () => {
    setPairing(true)
    try {
      await zhaPermit(60)
      setPairingActive(true)
      setCountdown(60)
      timerRef.current = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { clearInterval(timerRef.current); setPairingActive(false); return 0 }
          return c - 1
        })
      }, 1000)
      addToast('Pairing mode active — press the button on your device', 'success')
    } catch (e) {
      addToast(e.message || 'Failed to start pairing', 'error')
    } finally {
      setPairing(false)
    }
  }

  const connected        = health?.ha_connected ?? false
  const coordinatorName  = health?.coordinator_title || (connected ? 'ZHA / Coordinator' : null)

  return (
    <Card>
      <div className="divide-y divide-line">

        {/* Coordinator status */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Wifi size={16} style={{ color: connected ? 'var(--ok)' : 'var(--ink-faint)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Coordinator</p>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>
                {coordinatorName ?? 'Not detected'}
              </p>
            </div>
          </div>
          <span style={{
            fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600,
            padding: '2px 8px', borderRadius: 6, flexShrink: 0,
            color:      connected ? 'var(--ok)' : 'var(--ink-faint)',
            background: connected ? 'color-mix(in srgb, var(--ok) 12%, var(--surface))' : 'var(--bg-2)',
          }}>
            {connected ? 'paired' : 'offline'}
          </span>
        </div>

        {/* Device count */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Radio size={16} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Devices on network</p>
          </div>
          {deviceCount !== null ? (
            <Link to="/devices" style={{ fontSize: 12, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink-2)', textDecoration: 'none', fontWeight: 600 }}>
              {deviceCount}
            </Link>
          ) : (
            <span style={{ fontSize: 12, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink-faint)' }}>—</span>
          )}
        </div>

        {/* Pairing mode — admin+ only */}
        {isAdmin && (
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Zap size={16} style={{ color: pairingActive ? 'var(--accent)' : 'var(--ink-faint)', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Pairing mode</p>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pairingActive
                    ? `Open for ${countdown}s — press the button on your device`
                    : 'Allow new devices to join the network'}
                </p>
              </div>
            </div>
            <button
              onClick={handlePermitJoin}
              disabled={pairing || pairingActive || !connected}
              className={pairingActive ? 'z-btn-primary' : 'z-btn-secondary'}
              style={{ padding: '5px 12px', borderRadius: 9, fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {pairing ? '…' : pairingActive ? `${countdown}s` : 'Add device'}
            </button>
          </div>
        )}

      </div>
    </Card>
  )
}

// ─── Presence Section ─────────────────────────────────────────────────────────

function PresenceSection() {
  const { addToast } = useUIStore()
  const [persons,    setPersons]   = useState([])
  const [loading,    setLoading]   = useState(true)
  const [newName,    setNewName]   = useState('')
  const [adding,     setAdding]    = useState(false)
  const [copiedId,   setCopiedId]  = useState(null)
  const [zone,       setZone]      = useState(null)
  const [zoneEdit,   setZoneEdit]  = useState(false)
  const [zoneDraft,  setZoneDraft] = useState({ lat: '', lon: '', radius_m: 100 })
  const [zoneSaving, setZoneSaving] = useState(false)
  const [locating,   setLocating]  = useState(false)
  const [debugOpen,  setDebugOpen] = useState(false)
  const [debug,      setDebug]     = useState(null)
  const [myPersonId, setMyPersonId] = useState(null)
  const [extraZones, setExtraZones] = useState([])
  const [zoneAdding,  setZoneAdding]  = useState(false)
  const [zoneNewName, setZoneNewName] = useState('')
  const [zoneNewRadius, setZoneNewRadius] = useState('500')
  const [editingZoneId, setEditingZoneId] = useState(null)
  const [zoneEditDraft, setZoneEditDraft] = useState({ name: '', lat: '', lon: '', radius_m: '' })
  const [editingTrackerId, setEditingTrackerId] = useState(null)
  const [trackerDraft, setTrackerDraft] = useState('')
  const [trackerSaving, setTrackerSaving] = useState(false)

  // ── "Track my location" — JWT-authenticated self-tracking ───────────────
  // No invite link needed. Persists across reloads via localStorage so the
  // toggle survives the user closing/reopening the PWA.
  const TRACK_ME_KEY = 'ziggy_track_me_on'
  const [trackMe,        setTrackMe]        = useState(() => localStorage.getItem(TRACK_ME_KEY) === '1')
  const [trackMeStatus,  setTrackMeStatus]  = useState('idle')
  const [trackMePerson,  setTrackMePerson]  = useState(null)
  const watchIdRef = useRef(null)
  const lastPingRef = useRef(0)

  const stopWatch = () => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
    }
    watchIdRef.current = null
  }

  useEffect(() => {
    if (!trackMe) {
      stopWatch()
      setTrackMeStatus('idle')
      return
    }
    if (!('geolocation' in navigator)) {
      // Use a short status code rather than building an error string with
      // raw exception text. The render step (see below) maps these codes
      // to user-friendly labels — no leakage of raw err.message into the UI.
      setTrackMeStatus('unavailable')
      return
    }
    setTrackMeStatus('requesting')
    const MIN_INTERVAL_MS = 20 * 1000
    const sendPing = async (pos) => {
      const now = Date.now()
      if (now - lastPingRef.current < MIN_INTERVAL_MS) return
      lastPingRef.current = now
      try {
        const r = await pingMePresence(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.timestamp || now)
        setTrackMeStatus(r.state === 'home' ? 'home' : r.state === 'not_home' ? 'away' : 'pinging')
        setTrackMePerson(r.person)
        load()  // refresh the people list in the UI
      } catch {
        // Network / backend errors all collapse to a generic state — the
        // render step shows "Connection issue", not raw HTTP text.
        setTrackMeStatus('error')
      }
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => sendPing(pos),
      (err) => setTrackMeStatus(err.code === 1 ? 'permission_denied' : 'error'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
    return stopWatch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackMe])

  const toggleTrackMe = () => {
    const next = !trackMe
    localStorage.setItem(TRACK_ME_KEY, next ? '1' : '0')
    setTrackMe(next)
  }

  const beginEditTracker = (p) => {
    setEditingTrackerId(p.id)
    setTrackerDraft(p.lan_host || '')
  }
  const saveTracker = async (p) => {
    setTrackerSaving(true)
    try {
      await setPresenceLanHost(p.id, trackerDraft.trim() || null)
      await load()
      setEditingTrackerId(null)
      addToast(trackerDraft.trim() ? `LAN probe → ${trackerDraft.trim()}` : 'LAN probe cleared', 'success')
    } catch (e) { addToast(e.message || 'Failed to save', 'error') }
    finally { setTrackerSaving(false) }
  }

  const load = async () => {
    try {
      const [p, z] = await Promise.all([getPresencePersons(), getPresenceZone()])
      setPersons(p.persons ?? [])
      setZone(z)
      if (z?.lat != null) setZoneDraft({ lat: z.lat, lon: z.lon, radius_m: z.radius ?? 200 })
    } catch {}
    // "(you)" identification — best-effort, ignore 404 (no linked person yet).
    try {
      const me = await getMyPresencePerson()
      setMyPersonId(me?.person?.id ?? null)
    } catch { setMyPersonId(null) }
    try {
      const z = await listPresenceZones()
      setExtraZones(z.zones ?? [])
    } catch { setExtraZones([]) }
    finally { setLoading(false) }
  }

  const addZone = async () => {
    const name = zoneNewName.trim()
    if (!name) { addToast('Name is required', 'error'); return }
    if (!navigator.geolocation) { addToast('Geolocation not available — open this in Ziggy on a device', 'error'); return }
    setZoneAdding(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await createPresenceZone({
            name,
            lat:      parseFloat(pos.coords.latitude.toFixed(6)),
            lon:      parseFloat(pos.coords.longitude.toFixed(6)),
            radius_m: parseFloat(zoneNewRadius) || 200,
          })
          setZoneNewName('')
          await load()
          addToast(`Zone '${name}' created at your current location`, 'success')
        } catch (e) { addToast(e.message || 'Failed to create zone', 'error') }
        finally { setZoneAdding(false) }
      },
      () => { addToast('Could not get current location — set lat/lon manually after creating', 'error'); setZoneAdding(false) },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const beginEditZone = (z) => {
    setEditingZoneId(z.id)
    setZoneEditDraft({ name: z.name, lat: z.lat, lon: z.lon, radius_m: z.radius_m })
  }
  const saveZoneEdit = async (z) => {
    try {
      await updatePresenceZone(z.id, {
        name:     zoneEditDraft.name.trim() || z.name,
        lat:      parseFloat(zoneEditDraft.lat),
        lon:      parseFloat(zoneEditDraft.lon),
        radius_m: parseFloat(zoneEditDraft.radius_m) || z.radius_m,
      })
      setEditingZoneId(null)
      await load()
      addToast(`Zone '${z.name}' updated`, 'success')
    } catch (e) { addToast(e.message || 'Failed to update', 'error') }
  }
  const removeZone = async (z) => {
    if (!window.confirm(`Delete zone '${z.name}'?`)) return
    try {
      await deletePresenceZone(z.id)
      await load()
      addToast(`Zone '${z.name}' deleted`, 'success')
    } catch (e) { addToast(e.message || 'Failed to delete', 'error') }
  }

  const loadDebug = async () => {
    try { setDebug(await getPresenceDebug()) } catch {}
  }
  useEffect(() => {
    if (!debugOpen) return
    loadDebug()
    const t = setInterval(loadDebug, 5000)
    return () => clearInterval(t)
  }, [debugOpen])

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

      {/* Track my location card — JWT-authenticated self-tracking */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Track my location</p>
            <p style={{ fontSize: 11, color: trackMe ? 'var(--ok)' : 'var(--ink-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {trackMe
                ? (trackMeStatus === 'home'  ? `Active · home${trackMePerson ? ' · ' + trackMePerson.name : ''}`
                  : trackMeStatus === 'away'  ? `Active · away${trackMePerson ? ' · ' + trackMePerson.name : ''}`
                  : trackMeStatus === 'permission_denied' ? 'Location permission denied'
                  : trackMeStatus === 'unavailable'      ? 'Location unavailable on this device'
                  : trackMeStatus === 'error'            ? 'Connection issue — will retry'
                  : trackMeStatus === 'requesting'       ? 'Requesting permission…'
                  : trackMeStatus === 'pinging'          ? 'Updating location…'
                  : `Active · ${trackMeStatus}`)
                : 'Off — turn on to let this device report its GPS to Ziggy'}
            </p>
          </div>
          <Toggle checked={trackMe} onCheckedChange={toggleTrackMe} />
        </div>
      </div>

      {/* Home zone card */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: zoneEdit ? '0.5px solid var(--line)' : 'none' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Home zone</p>
            <p style={{ fontSize: 11, color: zone?.configured ? 'var(--ok)' : 'var(--warn)', marginTop: 1 }}>
              {zone?.configured
                ? `${zone.lat?.toFixed(4)}, ${zone.lon?.toFixed(4)} · ${zone.radius}m radius`
                : zone?.lat != null
                  ? `Using detected location (${zone.lat?.toFixed(4)}, ${zone.lon?.toFixed(4)}) — save to confirm`
                  : 'Not configured — set your home location'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={useMyLocation} disabled={locating} className="z-btn-secondary" style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12 }}>
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
              Tip: click "Use my location" while at home to auto-fill. 100 m radius is the default; the engine adds GPS-jitter hysteresis on top.
            </p>
            <p style={{ fontSize: 10, color: 'var(--ink-faint)', lineHeight: 1.5, paddingTop: 4, borderTop: '0.5px solid var(--line)', marginTop: 4 }}>
              <strong style={{ color: 'var(--ink-mute)' }}>Want a head-start automation?</strong> Add a second zone below — e.g. a "Near Home" zone at 2–3 km — and Ziggy will track entry/exit for that zone alongside the primary Home zone.
            </p>
          </div>
        )}
      </div>

      {/* Additional zones card */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ padding: '11px 16px', borderBottom: extraZones.length > 0 ? '0.5px solid var(--line)' : 'none' }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>Additional zones</p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>
            Extra named zones for automations (e.g. "Near Home", "Work").
          </p>
        </div>
        {extraZones.map((z, i) => (
          <div key={z.id} style={{ padding: '10px 16px', borderBottom: i < extraZones.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
            {editingZoneId === z.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input value={zoneEditDraft.name} onChange={e => setZoneEditDraft(d => ({ ...d, name: e.target.value }))}
                       className="z-input" placeholder="Name" style={{ height: 28, padding: '0 8px', fontSize: 12 }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={zoneEditDraft.lat} onChange={e => setZoneEditDraft(d => ({ ...d, lat: e.target.value }))}
                         className="z-input" placeholder="Latitude" style={{ flex: 1, height: 28, padding: '0 8px', fontSize: 12 }} />
                  <input value={zoneEditDraft.lon} onChange={e => setZoneEditDraft(d => ({ ...d, lon: e.target.value }))}
                         className="z-input" placeholder="Longitude" style={{ flex: 1, height: 28, padding: '0 8px', fontSize: 12 }} />
                  <input type="number" value={zoneEditDraft.radius_m} onChange={e => setZoneEditDraft(d => ({ ...d, radius_m: e.target.value }))}
                         className="z-input" placeholder="Radius (m)" style={{ width: 100, height: 28, padding: '0 8px', fontSize: 12 }} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => saveZoneEdit(z)} className="z-btn-primary" style={{ height: 28, padding: '0 12px', borderRadius: 7, fontSize: 12 }}>Save</button>
                  <button onClick={() => setEditingZoneId(null)} className="z-btn-secondary" style={{ height: 28, padding: '0 10px', borderRadius: 7, fontSize: 12 }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{z.name}</p>
                  <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
                    {z.lat?.toFixed(4)}, {z.lon?.toFixed(4)} · {z.radius_m}m
                  </p>
                </div>
                <button onClick={() => beginEditZone(z)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 11, padding: '4px 8px' }}>edit</button>
                <button onClick={() => removeZone(z)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }} title="Delete">
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        ))}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: extraZones.length > 0 ? '0.5px solid var(--line)' : 'none' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={zoneNewName} onChange={e => setZoneNewName(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && addZone()}
                   className="z-input" placeholder="Zone name (e.g. Near Home, Work)" style={{ flex: 1, height: 32, padding: '0 10px', fontSize: 12 }} />
            <input type="number" min={50} max={50000} value={zoneNewRadius} onChange={e => setZoneNewRadius(e.target.value)}
                   className="z-input" placeholder="Radius (m)" style={{ width: 100, height: 32, padding: '0 10px', fontSize: 12 }} />
            <button onClick={addZone} disabled={zoneAdding || !zoneNewName.trim()} className="z-btn-primary"
                    style={{ height: 32, padding: '0 12px', borderRadius: 8, fontSize: 12 }}>
              {zoneAdding ? '…' : 'Add at current location'}
            </button>
          </div>
          <p style={{ fontSize: 10, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
            Adds a zone centred on this device's GPS. Edit lat/lon afterwards if you need a different centre.
          </p>
        </div>
      </div>

      {/* People card */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        {persons.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '20px 16px', textAlign: 'center' }}>
            No persons configured. Add a person to start tracking presence.
          </p>
        ) : (
          persons.map((p, i) => (
            <div key={p.id} style={{ borderBottom: i < persons.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', flexWrap: 'wrap' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: presenceStateColor(p), flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 60 }}>
                  {p.name}
                  {p.id === myPersonId && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>(you)</span>}
                </span>
                <span style={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', color: presenceStateColor(p) }}>{presenceStateLabel(p)}</span>
                <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{timeAgo(p.last_seen)}</span>
                <button onClick={() => copyInvite(p)} title="Copy invite link" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: copiedId === p.id ? 'var(--ok)' : 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }}>
                  {copiedId === p.id ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <button onClick={() => handleDelete(p)} title="Remove person" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }}>
                  <Trash2 size={13} />
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px 11px 32px', fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
                {editingTrackerId === p.id ? (
                  <>
                    <input
                      autoFocus
                      placeholder="youval-iphone.local or 192.168.1.42"
                      value={trackerDraft}
                      onChange={e => setTrackerDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveTracker(p); if (e.key === 'Escape') setEditingTrackerId(null) }}
                      className="z-input"
                      style={{ flex: 1, height: 26, padding: '0 8px', fontSize: 11 }}
                    />
                    <button onClick={() => saveTracker(p)} disabled={trackerSaving} className="z-btn-primary" style={{ height: 26, padding: '0 10px', borderRadius: 6, fontSize: 11 }}>
                      {trackerSaving ? '…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingTrackerId(null)} className="z-btn-secondary" style={{ height: 26, padding: '0 8px', borderRadius: 6, fontSize: 11 }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      LAN probe: {p.lan_host || <span style={{ color: 'var(--ink-faint)' }}>(none — GPS only)</span>}
                      {p.lan_last_seen && <span style={{ color: 'var(--ok)', paddingLeft: 6 }}>· last seen {timeAgo(p.lan_last_seen)}</span>}
                    </span>
                    <button onClick={() => beginEditTracker(p)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
                      {p.lan_host ? 'edit' : 'add'}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
        <div style={{ padding: '12px 16px', display: 'flex', gap: 6, borderTop: persons.length > 0 ? '0.5px solid var(--line)' : 'none' }}>
          <input
            placeholder="Name (e.g. Youval)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="z-input"
            style={{ flex: 1, height: 34, padding: '0 10px', fontSize: 12 }}
          />
          <button onClick={handleAdd} disabled={adding || !newName.trim()} className="z-btn-primary" style={{ height: 34, padding: '0 12px', borderRadius: 9, fontSize: 12 }}>
            {adding ? '…' : 'Add'}
          </button>
        </div>
        <p style={{ fontSize: 10, color: 'var(--ink-faint)', padding: '0 16px 12px', lineHeight: 1.6 }}>
          Add each household member, then copy their invite link and open it on their phone.
        </p>
      </div>

      {/* Debug card */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <button
          onClick={() => setDebugOpen(v => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink)' }}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>Presence debug</span>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
            {debugOpen ? 'hide' : 'show'}
          </span>
        </button>
        {debugOpen && (
          <div style={{ borderTop: '0.5px solid var(--line)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!debug ? (
              <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Loading…</p>
            ) : (
              <>
                {/* Tunables */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
                  {Object.entries(debug.tunables || {}).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span>{k}</span><span style={{ color: 'var(--ink)' }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
                {/* Per-person debug */}
                {(debug.persons ?? []).map(p => (
                  <div key={p.id} style={{ borderTop: '0.5px solid var(--line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <span style={{ fontFamily: '"IBM Plex Mono", monospace', color: presenceStateColor(p) }}>
                        {presenceStateLabel(p)} · {p.last_distance_m != null ? `${p.last_distance_m}m` : '—'} · acc {p.last_accuracy != null ? `${Math.round(p.last_accuracy)}m` : '—'}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
                      cand: {p.candidate_state ?? '—'} since {p.candidate_since ? new Date(p.candidate_since).toLocaleTimeString() : '—'}
                      {' · '}
                      last txn: {p.last_transition_to ?? '—'} at {p.last_transition_at ? new Date(p.last_transition_at).toLocaleTimeString() : '—'}
                    </div>
                    {(p.history ?? []).slice().reverse().slice(0, 6).map((h, idx) => (
                      <div key={idx} style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {new Date(h.ts).toLocaleTimeString()} · {h.src} · raw={h.raw} · d={h.dist ?? '—'}m · {h.result} · {h.reason}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

    </div>
  )
}

// ─── Users & Access Section ───────────────────────────────────────────────────

function UsersAndAccessSection({ currentUsername }) {
  const { addToast } = useUIStore()
  const [users,        setUsers]        = useState([])
  const [invites,      setInvites]      = useState([])
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviteRole,   setInviteRole]   = useState('user')
  const [inviteLink,   setInviteLink]   = useState(null)
  const [inviteSaving, setInviteSaving] = useState(false)

  const load = async () => {
    try { setUsers(await getUsers()) } catch {}
    try { setInvites((await listInvites()).filter(i => i.status === 'pending')) } catch {}
  }

  useEffect(() => { load() }, [])

  const handleUpdateRole = async (username, role) => {
    try {
      await updateUser(username, { role })
      setUsers(u => u.map(x => x.username === username ? { ...x, role } : x))
      addToast('Role updated', 'success')
    } catch (e) { addToast(e.message || 'Failed to update role', 'error') }
  }

  const handleDeleteUser = async (username) => {
    if (!window.confirm(`Remove "${username}" from this home?`)) return
    try {
      await deleteUser(username)
      setUsers(u => u.filter(x => x.username !== username))
      addToast('User removed', 'success')
    } catch (e) { addToast(e.message || 'Failed', 'error') }
  }

  const handleCreateInvite = async () => {
    setInviteSaving(true)
    setInviteLink(null)
    try {
      const res = await createInvite({ type: 'user', email: inviteEmail.trim() || undefined, role: inviteRole, public_url: window.location.origin })
      const url = `${window.location.origin}${res.invite_url}`
      setInviteLink(url)
      navigator.clipboard.writeText(url).catch(() => {})
      addToast('Invite link copied', 'success')
      setInvites(prev => [...prev, { ...res, status: 'pending' }])
    } catch (e) { addToast(e.message || 'Failed to create invite', 'error') }
    finally { setInviteSaving(false) }
  }

  const handleRevokeInvite = async (token) => {
    try {
      await revokeInvite(token)
      setInvites(prev => prev.filter(i => i.token !== token))
      addToast('Invite revoked', 'success')
    } catch (e) { addToast(e.message || 'Failed', 'error') }
  }

  const ROLE_OPT_LABELS = { super_admin: 'Super Admin', admin: 'Admin', user: 'User', guest: 'Guest' }

  return (
    <Card>
      <div className="divide-y divide-line">

        {/* Active users */}
        {users.map(u => {
          const roleInfo = ROLE_LABELS[u.role] || ROLE_LABELS.user
          const isSelf = u.username.toLowerCase() === currentUsername?.toLowerCase()
          return (
            <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px' }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.username}
                {isSelf && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 999, background: 'var(--bg-2)', color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600 }}>YOU</span>}
              </span>
              {isSelf ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: roleInfo.color, fontFamily: '"IBM Plex Mono", monospace' }}>
                  {roleInfo.label}
                </span>
              ) : (
                <select
                  value={u.role}
                  onChange={e => handleUpdateRole(u.username, e.target.value)}
                  style={{ fontSize: 11, padding: '3px 6px', borderRadius: 7, border: '0.5px solid var(--line)', background: 'var(--surface)', color: roleInfo.color, fontWeight: 600, cursor: 'pointer' }}
                >
                  {Object.entries(ROLE_OPT_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              )}
              {!isSelf && (
                <button onClick={() => handleDeleteUser(u.username)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }} title="Remove">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )
        })}

        {/* Pending invites */}
        {invites.map(inv => (
          <div key={inv.token} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', opacity: 0.75 }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
              {inv.email || '(open invite)'} · {ROLE_OPT_LABELS[inv.role] || inv.role}
            </span>
            <span style={{ fontSize: 10, color: 'var(--warn)', fontWeight: 600, background: 'var(--warn)15', padding: '2px 7px', borderRadius: 6, flexShrink: 0 }}>pending</span>
            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.token}`).catch(() => {}); addToast('Link copied', 'success') }} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 6, cursor: 'pointer', padding: '4px 6px', color: 'var(--ink-faint)', display: 'flex' }}>
              <Copy size={11} />
            </button>
            <button onClick={() => handleRevokeInvite(inv.token)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }}>
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
                <button onClick={() => { navigator.clipboard.writeText(inviteLink).catch(() => {}); addToast('Copied!', 'success') }} className="z-btn-secondary" style={{ height: 34, padding: '0 10px', borderRadius: 9, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
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
                onChange={e => setInviteEmail(e.target.value)}
                className="z-input"
                style={{ flex: 2, height: 34, padding: '0 10px', fontSize: 12 }}
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                style={{ height: 34, padding: '0 6px', borderRadius: 9, border: '0.5px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12, cursor: 'pointer' }}
              >
                {Object.entries(ROLE_OPT_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
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
  )
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '0.5px solid var(--line)' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '8px 14px', fontSize: 13, fontWeight: 500,
            color: active === tab.id ? 'var(--ink)' : 'var(--ink-faint)',
            borderBottom: active === tab.id ? '2px solid var(--ink)' : '2px solid transparent',
            marginBottom: -1, transition: 'color 0.12s',
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'inherit',
          }}
        >
          {tab.icon && <tab.icon size={13} />}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ─── Music settings entry card (flag-gated) ───────────────────────────────────

function MusicSettingsLink() {
  const enabled = useFeature('media_music')
  const t = useT()
  if (!enabled) return null
  return (
    <div style={{ marginBottom: 22 }}>
      <SectionTitle>{t('media.settingsLinkSection')}</SectionTitle>
      <Card>
        <Link
          to="/settings/music"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', textDecoration: 'none', color: 'var(--ink)',
          }}
        >
          <div>
            <p style={{ fontSize: 13, fontWeight: 500 }}>{t('media.settingsLinkTitle')}</p>
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{t('media.settingsLinkSubtitle')}</p>
          </div>
          <span style={{ color: 'var(--ink-faint)' }}>›</span>
        </Link>
      </Card>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Settings() {
  const { theme, toggleTheme, addToast } = useUIStore()
  const { logout, role, setRole } = useAuthStore()
  const t = useT()

  const [activeTab,    setActiveTab]    = useState('general')
  const [refreshing,   setRefreshing]   = useState(false)
  const [username,     setUsername]     = useState('')
  const [general,      setGeneral]      = useState({ language: 'en', timezone: 'UTC' })
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [showChangePw, setShowChangePw] = useState(false)
  const [pwForm,       setPwForm]       = useState({ username: '', password: '', confirm: '' })
  const [pwError,      setPwError]      = useState('')
  const [savingPw,     setSavingPw]     = useState(false)

  const isAdmin      = hasRole(role, 'admin')
  const isSuperAdmin = hasRole(role, 'super_admin')

  const TABS = [
    { id: 'general', label: t('settings.tabGeneral') },
    ...(isAdmin ? [{ id: 'admin', label: t('settings.tabAdmin'), icon: Shield }] : []),
  ]

  // Drives <html dir>/<html lang> AND swaps the in-memory i18n dictionary.
  // The selector below calls this immediately on change so the UI flips before
  // we even round-trip to the server.
  const applyLanguage = (lang) => {
    setI18nLang(lang)
  }

  const loadAll = () => {
    getGeneralSettings().then(g => {
      const merged = { language: 'en', timezone: 'UTC', ...g }
      setGeneral(merged)
      applyLanguage(merged.language)
    }).catch(() => {})
    getAuthStatus().then(auth => {
      setUsername(auth?.username || '')
      setPwForm(f => ({ ...f, username: auth?.username || '' }))
      if (auth?.role) setRole(auth.role)
    }).catch(() => {})
  }

  useEffect(() => { loadAll() }, [])

  const handleRefresh = () => {
    setRefreshing(true)
    loadAll()
    setTimeout(() => setRefreshing(false), 1000)
  }

  const saveGeneral = async () => {
    setSavingGeneral(true)
    try {
      await patchGeneralSettings(general)
      applyLanguage(general.language)
      addToast(t('common.saved'), 'success')
    }
    catch { addToast(t('common.failedToSave'), 'error') }
    finally { setSavingGeneral(false) }
  }

  const handleChangePassword = async () => {
    if (!pwForm.username.trim()) { setPwError(t('settings.usernameRequired')); return }
    if (pwForm.password.length < 4) { setPwError(t('settings.passwordMinLen')); return }
    if (pwForm.password !== pwForm.confirm) { setPwError(t('settings.passwordsMismatch')); return }
    setSavingPw(true)
    try {
      await changePassword({ username: pwForm.username, password: pwForm.password })
      addToast(t('settings.passwordUpdated'), 'success')
      setShowChangePw(false)
      setPwForm(f => ({ ...f, password: '', confirm: '' }))
      setPwError('')
    } catch (e) { setPwError(e.message || t('common.failedToSave')) }
    finally { setSavingPw(false) }
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 48px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('settings.eyebrow')}</p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>{t('settings.title')}</h1>
        </div>
        {activeTab === 'general' && (
          <button onClick={handleRefresh} disabled={refreshing} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: 7, cursor: 'pointer' }}>
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        )}
      </div>

      {TABS.length > 1 && <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />}

      {/* ── General tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <>
          <MusicSettingsLink />
          {/* Appearance */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle>{t('settings.appearance')}</SectionTitle>
            <Card>
              <SettingRow icon={theme === 'dark' ? Moon : Sun} label={theme === 'dark' ? t('settings.themeDark') : t('settings.themeLight')} subtitle={t('common.toggleTheme')}>
                <Toggle checked={theme === 'dark'} onCheckedChange={toggleTheme} />
              </SettingRow>
            </Card>
          </div>

          {/* Language & Region */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle>{t('settings.languageRegion')}</SectionTitle>
            <Card>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Select
                  label={t('settings.language')}
                  value={general.language}
                  onChange={e => {
                    const v = e.target.value
                    setGeneral(s => ({ ...s, language: v }))
                    // Flip the in-memory dict immediately — don't wait for Save.
                    // The persisted store keeps it across reloads even if the
                    // user navigates away without hitting Save.
                    applyLanguage(v)
                  }}
                  options={LANGUAGES}
                />
                <Select label={t('settings.timezone')} value={general.timezone} onChange={e => setGeneral(s => ({ ...s, timezone: e.target.value }))} options={TIMEZONES.map(tz => ({ value: tz, label: tz }))} />
                <button onClick={saveGeneral} disabled={savingGeneral} className="z-btn-primary" style={{ width: '100%' }}>
                  {savingGeneral ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </Card>
          </div>

          {/* Account */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle>{t('settings.account')}</SectionTitle>
            <Card>
              <div>
                <SettingRow icon={User} label={t('settings.profile')} subtitle={username || t('settings.account')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {role && (
                      <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 999, background: 'var(--bg-2)', color: ROLE_LABELS[role]?.color || 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase' }}>
                        {ROLE_LABELS[role]?.label || role}
                      </span>
                    )}
                    <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 999, background: 'var(--bg-2)', color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase' }}>Local</span>
                  </div>
                </SettingRow>

                <div style={{ borderTop: '0.5px solid var(--line)' }}>
                  <button
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                    onClick={() => { setShowChangePw(v => !v); setPwError('') }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Lock size={16} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('settings.changePassword')}</p>
                    </div>
                    <span style={{ color: 'var(--ink-faint)', transform: showChangePw ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </span>
                  </button>
                  <AnimatePresence>
                    {showChangePw && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <Input label={t('common.username')} placeholder={t('common.username')} value={pwForm.username} onChange={e => setPwForm(s => ({ ...s, username: e.target.value }))} />
                          <Input label={t('settings.newPassword')} type="password" placeholder="••••••••" value={pwForm.password} onChange={e => setPwForm(s => ({ ...s, password: e.target.value }))} />
                          <Input label={t('common.confirmPassword')} type="password" placeholder="••••••••" value={pwForm.confirm} onChange={e => setPwForm(s => ({ ...s, confirm: e.target.value }))} error={pwError} />
                          <button onClick={handleChangePassword} disabled={savingPw} className="z-btn-primary" style={{ width: '100%' }}>
                            {savingPw ? t('common.saving') : t('settings.changePassword')}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div style={{ borderTop: '0.5px solid var(--line)' }}>
                  <button onClick={logout} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--accent)' }}>
                    <LogOut size={16} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{t('common.signOut')}</span>
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* System Status */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle icon={Activity}>System Status</SectionTitle>
            <SystemStatusCard />
          </div>

          {/* Presence tracking */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle icon={MapPin}>Presence tracking</SectionTitle>
            <PresenceSection />
          </div>

          {/* Ziggy Home (mobile app) */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle icon={Smartphone}>Ziggy Home (mobile)</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <PairWithPhone />
              <MobileDevicesList />
            </div>
          </div>

          {/* Zigbee Bridge */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle icon={Radio}>Zigbee Bridge</SectionTitle>
            <ZigbeeBridgeSection isAdmin={isAdmin} />
          </div>

          {/* Users & Access — super_admin only */}
          {isSuperAdmin && (
            <div style={{ marginBottom: 22 }}>
              <SectionTitle icon={Users}>Users & Access</SectionTitle>
              <UsersAndAccessSection currentUsername={username} />
            </div>
          )}

          {/* Quick Asks */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle>Quick Asks</SectionTitle>
            <div style={{ borderRadius: 18, background: 'var(--surface)', border: '0.5px solid var(--line)', padding: '16px 16px 8px' }}>
              <QuickAsks embedded />
            </div>
          </div>

          {/* Memory */}
          <div style={{ marginBottom: 22 }}>
            <SectionTitle>Memory</SectionTitle>
            <div style={{ borderRadius: 18, background: 'var(--surface)', border: '0.5px solid var(--line)', padding: 16 }}>
              <MemoryPanel />
            </div>
          </div>

        </>
      )}

      {/* ── Admin tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'admin' && isAdmin && (
        <>
          <AdminSettings />

          {/* Capabilities (Virtual Devices) — admin only */}
          <div style={{ marginTop: 32 }}>
            <SectionTitle>Capabilities</SectionTitle>
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 14 }}>Virtual devices and custom capabilities for automation triggers.</p>
            <VirtualDevices embedded />
          </div>
        </>
      )}

    </div>
  )
}
