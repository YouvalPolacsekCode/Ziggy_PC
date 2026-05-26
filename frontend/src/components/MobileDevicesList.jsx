// MobileDevicesList — Settings section: shows phones paired to the current
// user, with last-seen, live WS connection status, and a revoke button.

import { useCallback, useEffect, useState } from 'react'
import { Smartphone, RefreshCw, Trash2, Circle } from 'lucide-react'
import { listMyMobileDevices, revokeMobileDevice } from '../lib/mobileApi'
import { useT, t as i18nT } from '../lib/i18n'

function timeAgo(iso) {
  if (!iso) return i18nT('common.never')
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return i18nT('common.unknown')
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return i18nT('time.secondsAgo', { n: s })
  if (s < 3600) return i18nT('time.minutesAgo', { n: Math.floor(s / 60) })
  if (s < 86400) return i18nT('time.hoursAgo', { n: Math.floor(s / 3600) })
  return i18nT('time.daysAgo', { n: Math.floor(s / 86400) })
}

function platformLabel(d) {
  const p = (d.platform || '').toLowerCase()
  return p === 'ios' ? 'iPhone' : p === 'android' ? 'Android' : (d.platform || i18nT('common.unknown'))
}

export function MobileDevicesList() {
  const t = useT()
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(null)   // device_id currently being revoked

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { devices } = await listMyMobileDevices()
      setDevices(Array.isArray(devices) ? devices : [])
    } catch (e) {
      setError(e.message || t('mobileDevices.failedLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const revoke = async (deviceId) => {
    if (!window.confirm(t('mobileDevices.unpairConfirm'))) return
    setBusy(deviceId)
    try {
      await revokeMobileDevice(deviceId)
      setDevices(ds => ds.filter(d => d.device_id !== deviceId))
    } catch (e) {
      alert(e.message || t('mobileDevices.revokeFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section style={{
      padding: 12,
      borderRadius: 12,
      background: 'var(--bg-2)',
      border: '0.5px solid var(--line)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink-faint)' }}>
          {t('mobileDevices.pairedPhones', { n: devices.length })}
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label={t('common.refresh')}
          style={{
            background: 'transparent', border: 'none', padding: 4,
            cursor: 'pointer', color: 'var(--ink-faint)',
          }}
        >
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </header>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--danger, #c00)' }}>{error}</div>
      )}

      {!loading && devices.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '8px 4px' }}>
          {t('mobileDevices.empty')}
        </div>
      )}

      {devices.map(d => (
        <div key={d.device_id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderRadius: 8,
          background: 'var(--bg-1)', border: '1px solid var(--line)',
        }}>
          <Smartphone size={18} style={{ color: 'var(--ink-faint)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              {d.model || platformLabel(d)}
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-faint)', fontWeight: 400 }}>
                {platformLabel(d)} {d.os_version ? `· ${d.os_version}` : ''}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Circle
                size={6}
                fill={d.ws_connected ? '#1aa356' : '#7e8089'}
                color={d.ws_connected ? '#1aa356' : '#7e8089'}
              />
              {d.ws_connected ? t('common.connected').toLowerCase() : t('common.offline').toLowerCase()}
              <span style={{ color: 'var(--line)' }}>·</span>
              {t('mobileDevices.lastSeen', { ago: timeAgo(d.last_seen) })}
              {d.app_version && <>
                <span style={{ color: 'var(--line)' }}>·</span>
                v{d.app_version}
              </>}
            </div>
          </div>
          <button
            onClick={() => revoke(d.device_id)}
            disabled={busy === d.device_id}
            aria-label={t('mobileDevices.revoke')}
            title={t('mobileDevices.unpairTitle')}
            style={{
              background: 'transparent', border: '1px solid var(--line)',
              borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
              color: 'var(--ink-faint)', display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11,
            }}
          >
            <Trash2 size={12} />
            {busy === d.device_id ? t('mobileDevices.removing') : t('mobileDevices.revoke')}
          </button>
        </div>
      ))}
    </section>
  )
}
