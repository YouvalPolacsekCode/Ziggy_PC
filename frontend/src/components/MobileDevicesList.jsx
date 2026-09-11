// MobileDevicesList — Settings section: shows phones paired to the current
// user, with last-seen, live WS connection status, and a revoke button.

import { useCallback, useEffect, useState } from 'react'
import { Smartphone, RefreshCw, Trash2 } from 'lucide-react'
import { listMyMobileDevices, revokeMobileDevice } from '../lib/mobileApi'
import { useT, t as i18nT } from '../lib/i18n'
import { Button } from './ui/Button'

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
    <section className="z-card-soft" style={{
      padding: 12,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="z-eyebrow" style={{ flex: 1 }}>
          {t('mobileDevices.pairedPhones', { n: devices.length })}
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label={t('common.refresh')}
          className="z-icon-btn"
          style={{ background: 'transparent', border: 'none' }}
        >
          <RefreshCw size={20} strokeWidth={1.75} className={loading ? 'z-spin' : undefined} />
        </button>
      </header>

      {error && (
        <div role="alert" style={{ fontSize: 13, lineHeight: '20px', color: 'var(--err-text)' }}>{error}</div>
      )}

      {!loading && devices.length === 0 && (
        <div className="z-subhead" style={{ padding: '8px 0' }}>
          {t('mobileDevices.empty')}
        </div>
      )}

      {devices.map(d => (
        <div key={d.device_id} className="z-card-sm" style={{
          display: 'flex', alignItems: 'center', gap: 12, minHeight: 48,
          padding: '8px 8px 8px 16px',
        }}>
          <Smartphone size={24} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.model || platformLabel(d)}
              <span className="z-footnote" style={{ marginInlineStart: 8 }}>
                {platformLabel(d)} {d.os_version ? `· ${d.os_version}` : ''}
              </span>
            </div>
            <div className="z-footnote z-mono" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
              <span className={`z-dot ${d.ws_connected ? 'z-dot-ok' : ''}`} style={d.ws_connected ? undefined : { background: 'var(--ink-faint)' }} aria-hidden />
              {d.ws_connected ? t('common.connected').toLowerCase() : t('common.offline').toLowerCase()}
              <span aria-hidden>·</span>
              {t('mobileDevices.lastSeen', { ago: timeAgo(d.last_seen) })}
              {d.app_version && <>
                <span aria-hidden>·</span>
                <span className="z-code">v{d.app_version}</span>
              </>}
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => revoke(d.device_id)}
            disabled={busy === d.device_id}
            aria-label={t('mobileDevices.revoke')}
            title={t('mobileDevices.unpairTitle')}
          >
            <Trash2 size={16} strokeWidth={1.75} aria-hidden />
            {busy === d.device_id ? t('mobileDevices.removing') : t('mobileDevices.revoke')}
          </Button>
        </div>
      ))}
    </section>
  )
}
