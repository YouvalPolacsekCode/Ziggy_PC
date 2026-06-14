// Settings: drill-down hub.
//
// Each section is a clickable card that navigates to a dedicated sub-route at
// /settings/<slug>. Sub-page components are named exports consumed by App.jsx's
// lazy-route table — keeping them co-located here keeps the section logic
// (PresenceSection, UsersAndAccessSection, etc.) reused without duplication.
//
// System Diagnostics and Presence Debug are also exported from here because
// /ops surfaces them — they share data/components with this file's
// SystemStatusCard, ZigbeeBridgeSection, and the debug fields formerly inside
// PresenceSection.

import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, Moon, User, Lock, LogOut, RefreshCw,
  Plus, Trash2, Wifi, Shield, Users, MapPin,
  Radio, Cloud, Activity, Check, Copy, Zap,
  Smartphone, Bell, ChevronLeft,
} from 'lucide-react'
import { PairWithPhone } from '../components/PairWithPhone'
import { MobileDevicesList } from '../components/MobileDevicesList'
import BlastersSection from '../components/settings/BlastersSection'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import {
  getHealth, getHaDevices, getActivity, zhaPermit,
  getGeneralSettings, patchGeneralSettings,
  getAuthStatus, changePassword,
  getUsers, updateUser, deleteUser,
  createInvite, listInvites, revokeInvite,
  getPresenceZone, savePresenceZone, getPresenceDebug,
  pingMePresence, getMyPresencePerson,
  listPresenceZones, createPresenceZone, updatePresenceZone, deletePresenceZone,
} from '../lib/api'
import { MemoryPanel } from './Memory'
import { PushPreferenceCenter } from './AdminSettings'
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

// ─── Sub-page chrome — breadcrumb + back to /settings ────────────────────────

function SettingsPageWrapper({ title, eyebrow, children }) {
  const navigate = useNavigate()
  const t = useT()
  useEffect(() => {
    document.title = `Ziggy · ${title}`
    return () => { document.title = 'Ziggy' }
  }, [title])
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 48px' }}>
      <button
        onClick={() => navigate('/settings')}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--ink-faint)', fontSize: 12, fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 0', marginBottom: 14,
        }}
      >
        <ChevronLeft size={13} />
        {t('settings.title')}
      </button>
      <div style={{ marginBottom: 20 }}>
        {eyebrow && <p className="z-eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</p>}
        <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>{title}</h1>
      </div>
      {children}
    </div>
  )
}

// ─── Hub card — clickable section title + chevron ─────────────────────────────

function HubCard({ icon: Icon, title, subtitle, to, badge }) {
  return (
    <Link
      to={to}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', textDecoration: 'none', color: 'var(--ink)',
        background: 'var(--surface)', borderRadius: 13,
        border: '0.5px solid var(--line)',
        transition: 'border-color 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ink-mute)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {Icon && (
          <div style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-2)',
          }}>
            <Icon size={15} style={{ color: 'var(--ink-mute)' }} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
            {title}
            {badge && (
              <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 999, background: 'var(--bg-2)', color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase' }}>
                {badge}
              </span>
            )}
          </p>
          {subtitle && (
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <span style={{ color: 'var(--ink-faint)', fontSize: 18, flexShrink: 0, marginLeft: 8 }}>›</span>
    </Link>
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
  const t = useT()
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
  const sh           = health?.system_health
  const coordState   = sh?.zigbee?.coordinator_state || null
  const coordRawTitle = sh?.zigbee?.coordinator_raw_title || null
  const lastRecovery = sh?.recovery?.last_attempt_at || null
  const recoveryResult = sh?.recovery?.last_result || null
  const coordStateColor = coordState === 'loaded' ? 'var(--ok)' :
                          coordState === 'setup_in_progress' ? 'var(--warn)' :
                          coordState && coordState !== 'unknown' ? 'var(--err)' : 'var(--ink-mute)'

  return (
    <Card>
      <div className="divide-y divide-line">
        <StatusRow icon={Cloud}    label={t('systemStatus.ziggyLabel')}  value={t('systemStatus.online')}                                                            valueColor="var(--ok)" />
        <StatusRow icon={Wifi}     label={t('systemStatus.bridgeLabel')} value={bridgeOk ? t('systemStatus.bridgeConnected') : t('systemStatus.bridgeOffline')}     valueColor={bridgeOk ? 'var(--ok)' : 'var(--accent)'} />
        {coordState && coordRawTitle && (
          <StatusRow icon={Radio} label={coordRawTitle} value={coordState} valueColor={coordStateColor} />
        )}
        {lastRecovery && (
          <StatusRow icon={Activity} label={t('systemStatus.lastRecovery')} value={`${timeAgo(new Date(lastRecovery * 1000).toISOString())}${recoveryResult ? ' · ' + recoveryResult : ''}`} valueColor={recoveryResult === 'success' ? 'var(--ok)' : 'var(--ink-mute)'} />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px' }}>
          <Radio size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }}>{t('systemStatus.zigbeeLabel')}</span>
          {deviceCount !== null ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link to="/devices" style={{ ...linkStyle, color: 'var(--ink-2)' }}>
                {deviceCount === 1 ? t('systemStatus.deviceCount', { n: deviceCount }) : t('systemStatus.deviceCountPlural', { n: deviceCount })}
              </Link>
              {offlineCount > 0 && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>·</span>
                  <Link to="/devices?filter=offline" style={{ ...linkStyle, color: 'var(--warn)' }}>
                    {t('systemStatus.offlineCount', { n: offlineCount })}
                  </Link>
                </>
              )}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{t('systemStatus.unavailable')}</span>
          )}
        </div>

        <StatusRow icon={Activity} label={t('systemStatus.lastEvent')} value={lastEventTs ? timeAgo(lastEventTs) : t('systemStatus.noEvents')} valueColor="var(--ink-mute)" />
      </div>
    </Card>
  )
}

// ─── Zigbee Bridge Section ────────────────────────────────────────────────────

function ZigbeeBridgeSection({ isAdmin }) {
  const t = useT()
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
      addToast(t('zigbeeBridge.pairingStartedToast'), 'success')
    } catch (e) {
      addToast(e.message || t('zigbeeBridge.pairingFailedToast'), 'error')
    } finally {
      setPairing(false)
    }
  }

  const connected        = health?.ha_connected ?? false
  // Per CLAUDE.md baseline, user-visible surfaces never use HA terminology.
  // The HA-reported title (when present) is shown verbatim; the local fallback
  // is the neutral "Coordinator" label, not "ZHA / Coordinator".
  const coordinatorName  = health?.coordinator_title || (connected ? t('zigbeeBridge.coordinatorFallback') : null)

  return (
    <Card>
      <div className="divide-y divide-line">

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Wifi size={16} style={{ color: connected ? 'var(--ok)' : 'var(--ink-faint)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('zigbeeBridge.coordinatorLabel')}</p>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }} dir="auto">
                {coordinatorName ?? t('zigbeeBridge.notDetected')}
              </p>
            </div>
          </div>
          <span style={{
            fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600,
            padding: '2px 8px', borderRadius: 6, flexShrink: 0,
            color:      connected ? 'var(--ok)' : 'var(--ink-faint)',
            background: connected ? 'color-mix(in srgb, var(--ok) 12%, var(--surface))' : 'var(--bg-2)',
          }}>
            {connected ? t('zigbeeBridge.statusPaired') : t('zigbeeBridge.statusOffline')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Radio size={16} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('zigbeeBridge.devicesOnNetwork')}</p>
          </div>
          {deviceCount !== null ? (
            <Link to="/devices" style={{ fontSize: 12, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink-2)', textDecoration: 'none', fontWeight: 600 }}>
              {deviceCount}
            </Link>
          ) : (
            <span style={{ fontSize: 12, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink-faint)' }}>—</span>
          )}
        </div>

        {isAdmin && (
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Zap size={16} style={{ color: pairingActive ? 'var(--accent)' : 'var(--ink-faint)', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('zigbeeBridge.pairingMode')}</p>
                <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
                  {pairingActive
                    ? t('zigbeeBridge.pairingActive', { n: countdown })
                    : t('zigbeeBridge.pairingIdle')}
                </p>
              </div>
            </div>
            <button
              onClick={handlePermitJoin}
              disabled={pairing || pairingActive || !connected}
              className={pairingActive ? 'z-btn-primary' : 'z-btn-secondary'}
              style={{ padding: '5px 12px', borderRadius: 9, fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {pairing ? '…' : pairingActive ? `${countdown}s` : t('zigbeeBridge.addDevice')}
            </button>
          </div>
        )}

      </div>
    </Card>
  )
}

// ─── Presence Section (Home Sensing) ──────────────────────────────────────────
// Trimmed: only Track-my-location, Home zone editor, Additional zones.
// People list, LAN-probe field, and Presence debug were removed — household
// members get a presence record auto-created on first /api/presence/me/ping,
// and the debug card moved to /ops/presence-debug.

function PresenceSection() {
  const { addToast } = useUIStore()
  const [loading,    setLoading]   = useState(true)
  const [zone,       setZone]      = useState(null)
  const [zoneEdit,   setZoneEdit]  = useState(false)
  const [zoneDraft,  setZoneDraft] = useState({ lat: '', lon: '', radius_m: 100 })
  const [zoneSaving, setZoneSaving] = useState(false)
  const [locating,   setLocating]  = useState(false)
  const [extraZones, setExtraZones] = useState([])
  const [zoneAdding,  setZoneAdding]  = useState(false)
  const [zoneNewName, setZoneNewName] = useState('')
  const [zoneNewRadius, setZoneNewRadius] = useState('500')
  const [editingZoneId, setEditingZoneId] = useState(null)
  const [zoneEditDraft, setZoneEditDraft] = useState({ name: '', lat: '', lon: '', radius_m: '' })

  // ── "Track my location" — JWT-authenticated self-tracking ───────────────
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
      } catch {
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

  const load = async () => {
    try {
      const z = await getPresenceZone()
      setZone(z)
      if (z?.lat != null) setZoneDraft({ lat: z.lat, lon: z.lon, radius_m: z.radius ?? 200 })
    } catch {}
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

  useEffect(() => { load() }, [])

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

      {/* Track my location card */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('homeSensing.trackMe.title')}</p>
            <p style={{ fontSize: 11, color: trackMe ? 'var(--ok)' : 'var(--ink-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
              {trackMe
                ? (trackMeStatus === 'home'  ? `${t('homeSensing.trackMe.activeHome')}${trackMePerson ? ' · ' + trackMePerson.name : ''}`
                  : trackMeStatus === 'away'  ? `${t('homeSensing.trackMe.activeAway')}${trackMePerson ? ' · ' + trackMePerson.name : ''}`
                  : trackMeStatus === 'permission_denied' ? t('homeSensing.trackMe.permDenied')
                  : trackMeStatus === 'unavailable'      ? t('homeSensing.trackMe.unavailable')
                  : trackMeStatus === 'error'            ? t('homeSensing.trackMe.error')
                  : trackMeStatus === 'requesting'       ? t('homeSensing.trackMe.requesting')
                  : trackMeStatus === 'pinging'          ? t('homeSensing.trackMe.pinging')
                  : t('homeSensing.trackMe.activeOther', { status: trackMeStatus }))
                : t('homeSensing.trackMe.off')}
            </p>
          </div>
          <Toggle checked={trackMe} onCheckedChange={toggleTrackMe} />
        </div>
      </div>

      {/* Home zone card */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: zoneEdit ? '0.5px solid var(--line)' : 'none' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('homeSensing.homeZone.title')}</p>
            <p style={{ fontSize: 11, color: zone?.configured ? 'var(--ok)' : 'var(--warn)', marginTop: 1 }} dir="auto">
              {zone?.configured
                ? t('homeSensing.homeZone.summary', { lat: zone.lat?.toFixed(4), lon: zone.lon?.toFixed(4), radius: zone.radius })
                : zone?.lat != null
                  ? t('homeSensing.homeZone.detected', { lat: zone.lat?.toFixed(4), lon: zone.lon?.toFixed(4) })
                  : t('homeSensing.homeZone.notConfigured')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={useMyLocation} disabled={locating} className="z-btn-secondary" style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12 }}>
              {locating ? '…' : t('homeSensing.useMyLocation')}
            </button>
            {!zoneEdit && (
              <button onClick={() => setZoneEdit(true)} className="z-btn-secondary" style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12 }}>
                {t('homeSensing.edit')}
              </button>
            )}
          </div>
        </div>
        {zoneEdit && (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 3 }}>{t('homeSensing.latitude')}</p>
                <input value={zoneDraft.lat} onChange={e => setZoneDraft(d => ({ ...d, lat: e.target.value }))} className="z-input" style={{ width: '100%', height: 32, padding: '0 8px', fontSize: 12, boxSizing: 'border-box' }} placeholder="32.0853" />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 3 }}>{t('homeSensing.longitude')}</p>
                <input value={zoneDraft.lon} onChange={e => setZoneDraft(d => ({ ...d, lon: e.target.value }))} className="z-input" style={{ width: '100%', height: 32, padding: '0 8px', fontSize: 12, boxSizing: 'border-box' }} placeholder="34.7818" />
              </div>
              <div style={{ width: 90 }}>
                <p style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 3 }}>{t('homeSensing.radiusM')}</p>
                <input type="number" min={50} max={2000} value={zoneDraft.radius_m} onChange={e => setZoneDraft(d => ({ ...d, radius_m: e.target.value }))} className="z-input" style={{ width: '100%', height: 32, padding: '0 8px', fontSize: 12, boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveZone} disabled={zoneSaving || !zoneDraft.lat || !zoneDraft.lon} className="z-btn-primary" style={{ height: 32, padding: '0 14px', borderRadius: 8, fontSize: 12 }}>
                {zoneSaving ? '…' : t('homeSensing.saveZone')}
              </button>
              <button onClick={() => setZoneEdit(false)} className="z-btn-secondary" style={{ height: 32, padding: '0 10px', borderRadius: 8, fontSize: 12 }}>
                {t('homeSensing.cancel')}
              </button>
            </div>
            <p style={{ fontSize: 10, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
              {t('homeSensing.zoneTip')}
            </p>
          </div>
        )}
      </div>

      {/* Additional zones card */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ padding: '11px 16px', borderBottom: extraZones.length > 0 ? '0.5px solid var(--line)' : 'none' }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t('homeSensing.extraZones.title')}</p>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>
            {t('homeSensing.extraZones.desc')}
          </p>
        </div>
        {extraZones.map((z, i) => (
          <div key={z.id} style={{ padding: '10px 16px', borderBottom: i < extraZones.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
            {editingZoneId === z.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input value={zoneEditDraft.name} onChange={e => setZoneEditDraft(d => ({ ...d, name: e.target.value }))} dir="auto"
                       className="z-input" placeholder={t('homeSensing.extraZones.namePh')} style={{ height: 28, padding: '0 8px', fontSize: 12 }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={zoneEditDraft.lat} onChange={e => setZoneEditDraft(d => ({ ...d, lat: e.target.value }))}
                         className="z-input" placeholder={t('homeSensing.extraZones.latPh')} style={{ flex: 1, height: 28, padding: '0 8px', fontSize: 12 }} />
                  <input value={zoneEditDraft.lon} onChange={e => setZoneEditDraft(d => ({ ...d, lon: e.target.value }))}
                         className="z-input" placeholder={t('homeSensing.extraZones.lonPh')} style={{ flex: 1, height: 28, padding: '0 8px', fontSize: 12 }} />
                  <input type="number" value={zoneEditDraft.radius_m} onChange={e => setZoneEditDraft(d => ({ ...d, radius_m: e.target.value }))}
                         className="z-input" placeholder={t('homeSensing.extraZones.radiusPh')} style={{ width: 100, height: 28, padding: '0 8px', fontSize: 12 }} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => saveZoneEdit(z)} className="z-btn-primary" style={{ height: 28, padding: '0 12px', borderRadius: 7, fontSize: 12 }}>{t('homeSensing.extraZones.save')}</button>
                  <button onClick={() => setEditingZoneId(null)} className="z-btn-secondary" style={{ height: 28, padding: '0 10px', borderRadius: 7, fontSize: 12 }}>{t('homeSensing.extraZones.cancel')}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }} dir="auto">{z.name}</p>
                  <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
                    {z.lat?.toFixed(4)}, {z.lon?.toFixed(4)} · {z.radius_m}m
                  </p>
                </div>
                <button onClick={() => beginEditZone(z)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 11, padding: '4px 8px' }}>{t('homeSensing.extraZones.editAction')}</button>
                <button onClick={() => removeZone(z)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }} title={t('homeSensing.extraZones.deleteAria')}>
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        ))}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: extraZones.length > 0 ? '0.5px solid var(--line)' : 'none' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={zoneNewName} onChange={e => setZoneNewName(e.target.value)} dir="auto"
                   onKeyDown={e => e.key === 'Enter' && addZone()}
                   className="z-input" placeholder={t('homeSensing.extraZones.newNamePh')} style={{ flex: 1, height: 32, padding: '0 10px', fontSize: 12 }} />
            <input type="number" min={50} max={50000} value={zoneNewRadius} onChange={e => setZoneNewRadius(e.target.value)}
                   className="z-input" placeholder={t('homeSensing.extraZones.radiusPh')} style={{ width: 100, height: 32, padding: '0 10px', fontSize: 12 }} />
            <button onClick={addZone} disabled={zoneAdding || !zoneNewName.trim()} className="z-btn-primary"
                    style={{ height: 32, padding: '0 12px', borderRadius: 8, fontSize: 12 }}>
              {zoneAdding ? '…' : t('homeSensing.extraZones.add')}
            </button>
          </div>
          <p style={{ fontSize: 10, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
            {t('homeSensing.extraZones.help')}
          </p>
        </div>
      </div>

    </div>
  )
}

// ─── Presence Debug (ops-only) ────────────────────────────────────────────────
// Engine internals: candidate state, transitions, distance/accuracy history.
// Surfaced via /ops/presence-debug — never on a user-facing page.

function PresenceDebugCard() {
  const t = useT()
  const [debug,   setDebug]   = useState(null)
  const [persons, setPersons] = useState([])

  const loadDebug = async () => {
    try { setDebug(await getPresenceDebug()) } catch {}
  }

  useEffect(() => {
    loadDebug()
    const intervalId = setInterval(loadDebug, 5000)
    // Lazy import the persons list so we can show names beside their debug
    // history rows. If it fails, the cards still render with raw IDs.
    import('../lib/api').then(({ getPresencePersons }) =>
      getPresencePersons().then(r => setPersons(r.persons ?? [])).catch(() => {})
    )
    return () => clearInterval(intervalId)
  }, [])

  if (!debug) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--ink-faint)' }}>{t('common.loading')}</div>
    )
  }

  // Backend debug may not include name; merge from /persons list as a fallback.
  const merged = (debug.persons ?? []).map(p => {
    if (p.name) return p
    const match = persons.find(x => x.id === p.id) || {}
    return { ...match, ...p }
  })

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
        {Object.entries(debug.tunables || {}).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
            <span>{k}</span><span style={{ color: 'var(--ink)' }}>{String(v)}</span>
          </div>
        ))}
      </div>
      {merged.map(p => (
        <div key={p.id} style={{ borderTop: '0.5px solid var(--line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>{p.name || p.id}</span>
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

        {invites.map(inv => (
          <div key={inv.token} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', opacity: 0.75 }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
              {inv.email || '(open invite)'} · {ROLE_OPT_LABELS[inv.role] || inv.role}
            </span>
            <span style={{ fontSize: 10, color: 'var(--warn)', fontWeight: 600, background: 'var(--warn)15', padding: '2px 7px', borderRadius: 6, flexShrink: 0 }}>{t('members.pending')}</span>
            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.token}`).catch(() => {}); addToast(t('members.linkCopied'), 'success') }} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 6, cursor: 'pointer', padding: '4px 6px', color: 'var(--ink-faint)', display: 'flex' }}>
              <Copy size={11} />
            </button>
            <button onClick={() => handleRevokeInvite(inv.token)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 6, display: 'flex' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 2 }}>{t('members.inviteUser')}</p>
          {inviteLink ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t('members.linkShare')}</p>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1, background: 'var(--bg-2)', borderRadius: 9, padding: '0 10px', height: 34, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                  <span style={{ fontSize: 11, fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inviteLink}</span>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(inviteLink).catch(() => {}); addToast(t('members.copied'), 'success') }} className="z-btn-secondary" style={{ height: 34, padding: '0 10px', borderRadius: 9, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Copy size={12} /> {t('members.copy')}
                </button>
                <button onClick={() => { setInviteLink(null); setInviteEmail('') }} className="z-btn-secondary" style={{ height: 34, padding: '0 10px', borderRadius: 9, fontSize: 12 }}>{t('members.newLink')}</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="email"
                placeholder={t('members.emailPh')}
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
                {inviteSaving ? '…' : <><Plus size={12} /> {t('members.invite')}</>}
              </button>
            </div>
          )}
        </div>

      </div>
    </Card>
  )
}

// ─── Account form (used inside AccountPage) ───────────────────────────────────

function AccountForms({ username, role, logout }) {
  const t = useT()
  const { addToast } = useUIStore()
  const [showChangePw, setShowChangePw] = useState(false)
  const [pwForm, setPwForm] = useState({ username: username || '', password: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    setPwForm(f => ({ ...f, username: username || '' }))
  }, [username])

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
    <Card>
      <div>
        <SettingRow icon={User} label={t('settings.profile')} subtitle={username || t('settings.account')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {role && (
              <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 999, background: 'var(--bg-2)', color: ROLE_LABELS[role]?.color || 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase' }}>
                {ROLE_LABELS[role]?.label || role}
              </span>
            )}
            <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 999, background: 'var(--bg-2)', color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, textTransform: 'uppercase' }}>{t('members.local')}</span>
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
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-page exports — each is route-mounted under /settings/<slug> in App.jsx
// ═══════════════════════════════════════════════════════════════════════════════

export function AppearancePage() {
  const t = useT()
  const theme = useUIStore(s => s.theme)
  const toggleTheme = useUIStore(s => s.toggleTheme)
  return (
    <SettingsPageWrapper title={t('settings.appearance')}>
      <Card>
        <SettingRow icon={theme === 'dark' ? Moon : Sun} label={theme === 'dark' ? t('settings.themeDark') : t('settings.themeLight')} subtitle={t('common.toggleTheme')}>
          <Toggle checked={theme === 'dark'} onCheckedChange={toggleTheme} />
        </SettingRow>
      </Card>
    </SettingsPageWrapper>
  )
}

export function LanguagePage() {
  const t = useT()
  const { addToast } = useUIStore()
  const [general, setGeneral] = useState({ language: 'en', timezone: 'UTC' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getGeneralSettings().then(g => {
      const merged = { language: 'en', timezone: 'UTC', ...g }
      setGeneral(merged)
      setI18nLang(merged.language)
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await patchGeneralSettings(general)
      setI18nLang(general.language)
      addToast(t('common.saved'), 'success')
    } catch { addToast(t('common.failedToSave'), 'error') }
    finally { setSaving(false) }
  }

  return (
    <SettingsPageWrapper title={t('settings.languageRegion')}>
      <Card>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Select
            label={t('settings.language')}
            value={general.language}
            onChange={e => {
              const v = e.target.value
              setGeneral(s => ({ ...s, language: v }))
              setI18nLang(v)
            }}
            options={LANGUAGES}
          />
          <Select label={t('settings.timezone')} value={general.timezone} onChange={e => setGeneral(s => ({ ...s, timezone: e.target.value }))} options={TIMEZONES.map(tz => ({ value: tz, label: tz }))} />
          <button onClick={save} disabled={saving} className="z-btn-primary" style={{ width: '100%' }}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </Card>
    </SettingsPageWrapper>
  )
}

export function AccountPage() {
  const t = useT()
  const logout = useAuthStore(s => s.logout)
  const role   = useAuthStore(s => s.role)
  const setRole = useAuthStore(s => s.setRole)
  const [username, setUsername] = useState('')

  useEffect(() => {
    getAuthStatus().then(auth => {
      setUsername(auth?.username || '')
      if (auth?.role) setRole(auth.role)
    }).catch(() => {})
  }, [setRole])

  return (
    <SettingsPageWrapper title={t('settings.account')}>
      <AccountForms username={username} role={role} logout={logout} />
    </SettingsPageWrapper>
  )
}

export function NotificationsPage() {
  const t = useT()
  return (
    <SettingsPageWrapper title={t('adminSettings.sectionNotifications')}>
      <PushPreferenceCenter />
    </SettingsPageWrapper>
  )
}

export function HomeSensingPage() {
  const t = useT()
  return (
    <SettingsPageWrapper title={t('settings.homeSensing')}>
      <PresenceSection />
    </SettingsPageWrapper>
  )
}

export function MobilePage() {
  const t = useT()
  return (
    <SettingsPageWrapper title={t('settings.mobileApp')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PairWithPhone />
        <MobileDevicesList />
      </div>
    </SettingsPageWrapper>
  )
}

export function UsersPage() {
  const t = useT()
  const role = useAuthStore(s => s.role)
  const [username, setUsername] = useState('')
  useEffect(() => {
    getAuthStatus().then(a => setUsername(a?.username || '')).catch(() => {})
  }, [])
  if (!hasRole(role, 'super_admin')) {
    return (
      <SettingsPageWrapper title={t('settings.usersAndAccess')}>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: 16 }}>Restricted to super admins.</p>
      </SettingsPageWrapper>
    )
  }
  return (
    <SettingsPageWrapper title={t('settings.usersAndAccess')}>
      <UsersAndAccessSection currentUsername={username} />
    </SettingsPageWrapper>
  )
}

export function MemoryPage() {
  const t = useT()
  return (
    <SettingsPageWrapper title={t('settings.memory')}>
      <div style={{ borderRadius: 18, background: 'var(--surface)', border: '0.5px solid var(--line)', padding: 16 }}>
        <MemoryPanel />
      </div>
    </SettingsPageWrapper>
  )
}

export function IrHubsPage() {
  const t = useT()
  return (
    <SettingsPageWrapper title={t('settings.irHubs')}>
      <BlastersSection />
    </SettingsPageWrapper>
  )
}

// ─── /ops sub-pages — wrapped by App.jsx's OpsPageWrapper, no extra chrome ──

export function SystemDiagnosticsPage() {
  const t = useT()
  const role = useAuthStore(s => s.role)
  const isAdmin = hasRole(role, 'admin')
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 48px' }}>
      <div style={{ marginBottom: 22 }}>
        <SectionTitle icon={Activity}>{t('opsPage.systemStatus')}</SectionTitle>
        <SystemStatusCard />
      </div>
      <div>
        <SectionTitle icon={Radio}>{t('opsPage.zigbeeBridge')}</SectionTitle>
        <ZigbeeBridgeSection isAdmin={isAdmin} />
      </div>
    </div>
  )
}

export function PresenceDebugPage() {
  const t = useT()
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 48px' }}>
      <div style={{ marginBottom: 8 }}>
        <SectionTitle icon={MapPin}>{t('opsPage.presenceInternals')}</SectionTitle>
      </div>
      <Card>
        <PresenceDebugCard />
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settings hub (default export, mounted at /settings)
// ═══════════════════════════════════════════════════════════════════════════════

export default function Settings() {
  const t = useT()
  const role = useAuthStore(s => s.role)
  const setRole = useAuthStore(s => s.setRole)
  const [refreshing, setRefreshing] = useState(false)
  const musicEnabled = useFeature('media_music')

  const isSuperAdmin = hasRole(role, 'super_admin')

  useEffect(() => {
    getAuthStatus().then(a => { if (a?.role) setRole(a.role) }).catch(() => {})
  }, [setRole])

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 600)
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px 48px' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('settings.eyebrow')}</p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>{t('settings.title')}</h1>
        </div>
        <button onClick={handleRefresh} disabled={refreshing} style={{ background: 'transparent', border: '0.5px solid var(--line)', borderRadius: 8, color: 'var(--ink-faint)', padding: 7, cursor: 'pointer' }}>
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <HubCard icon={Moon}        title={t('settings.appearance')}      subtitle={t('settings.appearanceSub')}      to="/settings/appearance" />
        <HubCard icon={MapPin}      title={t('settings.languageRegion')}  subtitle={t('settings.languageSub')}        to="/settings/language" />
        <HubCard icon={User}        title={t('settings.account')}         subtitle={t('settings.accountSub')}         to="/settings/account" />
        <HubCard icon={Bell}        title={t('adminSettings.sectionNotifications')} subtitle={t('settings.notificationsSub')} to="/settings/notifications" />
        <HubCard icon={MapPin}      title={t('settings.homeSensing')}     subtitle={t('settings.homeSensingSub')}     to="/settings/home-sensing" />
        <HubCard icon={Smartphone}  title={t('settings.mobileApp')}       subtitle={t('settings.mobileSub')}          to="/settings/mobile" />
        {isSuperAdmin && (
          <HubCard icon={Users}     title={t('settings.usersAndAccess')}  subtitle={t('settings.usersSub')}           to="/settings/users" />
        )}
        <HubCard icon={Cloud}       title={t('settings.memory')}          subtitle={t('settings.memorySub')}          to="/settings/memory" />
        <HubCard icon={Radio}       title={t('settings.irHubs')}          subtitle={t('settings.irHubsSub')}          to="/settings/ir-hubs" />
        {musicEnabled && (
          <HubCard icon={Activity}  title={t('media.settingsLinkTitle')}  subtitle={t('media.settingsLinkSubtitle')}  to="/settings/music" />
        )}
      </div>

      {isSuperAdmin && (
        <div style={{ marginTop: 22 }}>
          <SectionTitle icon={Shield}>{t('settings.advanced')}</SectionTitle>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 10 }}>{t('settings.advancedHint')}</p>
          <Link to="/ops" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 13, textDecoration: 'none', color: 'var(--ink)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Shield size={14} style={{ color: 'var(--ink-mute)' }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t('nav.opsConsole')}</span>
            </div>
            <span style={{ color: 'var(--ink-faint)', fontSize: 18 }}>›</span>
          </Link>
        </div>
      )}

    </div>
  )
}
