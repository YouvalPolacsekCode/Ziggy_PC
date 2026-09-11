// MobileDiagnostics — internal "is everything working?" page for the Ziggy
// Home native app. Reachable at /mobile-diagnostics. Renders on web too (so
// you can sanity-check the page itself), but most rows show "n/a (PWA)".

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import {
  isNative, platform, plugin,
  getDeviceInfo, getCurrentPosition,
} from '../lib/native'
import {
  getDeviceId, getDeviceToken, getWebhookId, getDeviceWsUrl,
  sendLocation,
} from '../lib/mobileApi'
import { createMobileWs } from '../lib/mobileWs'
import { useT } from '../lib/i18n'

// Status words at 13px use the AA-safe text tokens, never the raw fills.
const STATUS_COLOR = {
  good: 'var(--ok-text)',
  warn: 'var(--warn-text)',
  bad:  'var(--err-text)',
}

function Row({ label, value, status }) {
  const color = STATUS_COLOR[status] || 'var(--ink-mute)'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', minHeight: 44,
      borderTop: '0.5px solid var(--line)',
    }}>
      <div style={{ flex: 1, fontSize: 15, color: 'var(--ink)' }}>{label}</div>
      <div className="z-code" style={{ fontSize: 13, color, textAlign: 'end', overflowWrap: 'anywhere' }}>
        {value}
      </div>
    </div>
  )
}

export default function MobileDiagnostics() {
  const t = useT()
  const [diag, setDiag] = useState({})
  const [wsStatus, setWsStatus] = useState('idle')
  const [pingResult, setPingResult] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const native = isNative()
    const [deviceInfo, devId, devTok, whId, wsUrl] = await Promise.all([
      getDeviceInfo(),
      getDeviceId(),
      getDeviceToken(),
      getWebhookId(),
      getDeviceWsUrl(),
    ])

    let locPerm = 'unknown'
    if (native) {
      const Geo = plugin('Geolocation')
      try {
        const res = await Geo?.checkPermissions?.()
        locPerm = res?.location || 'unknown'
      } catch { locPerm = 'unknown' }
    } else if (navigator.permissions) {
      try {
        const p = await navigator.permissions.query({ name: 'geolocation' })
        locPerm = p?.state || 'unknown'
      } catch {}
    }

    let pushPerm = 'unknown'
    if (native) {
      const Push = plugin('PushNotifications')
      try { pushPerm = (await Push?.checkPermissions?.())?.receive || 'unknown' } catch {}
    } else if (typeof Notification !== 'undefined') {
      pushPerm = Notification.permission
    }

    setDiag({
      native, platform: platform(),
      deviceInfo, devId, devTok: devTok ? t('mobileDiag.tokenPresent') : null, whId, wsUrl,
      locPerm, pushPerm,
    })
  }, [])

  useEffect(() => { load() }, [load])

  // Live WS check — opens a transient WS using existing creds, reports status.
  useEffect(() => {
    if (!diag.devTok || !diag.wsUrl) return
    setWsStatus('connecting')
    const ws = createMobileWs({
      onStatus: (s) => setWsStatus(s),
    })
    ws.start()
    return () => ws.stop()
  }, [diag.devTok, diag.wsUrl])

  const testPing = async () => {
    setBusy(true); setPingResult(null)
    try {
      const pos = await getCurrentPosition()
      const res = await sendLocation({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy_m: Math.round(pos.coords.accuracy),
        source: isNative() ? 'native_test' : 'web_test',
        client_ts: new Date().toISOString(),
      })
      setPingResult(JSON.stringify(res))
    } catch (e) {
      setPingResult('error: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const paired = !!diag.devTok

  return (
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
      <div className="z-page-head" style={{ alignItems: 'center' }}>
        <div>
          <h1 className="z-display" style={{ margin: 0 }}>{t('mobileDiag.title')}</h1>
        </div>
        <Link to="/" className="z-btn-secondary" style={{ textDecoration: 'none' }}>
          <ChevronLeft size={18} strokeWidth={1.75} className="icon-flip-rtl" />
          {t('nav.home')}
        </Link>
      </div>

      <section className="z-card" style={{ overflow: 'hidden' }}>
        <Row label={t('mobileDiag.runningNative')}
             value={diag.native ? t('common.yes').toLowerCase() : t('mobileDiag.noWeb')}
             status={diag.native ? 'good' : 'warn'} />
        <Row label={t('mobileDiag.platform')}    value={diag.platform || '—'} />
        <Row label={t('mobileDiag.model')}       value={diag.deviceInfo?.model || '—'} />
        <Row label={t('mobileDiag.osVersion')}   value={diag.deviceInfo?.os_version || '—'} />
        <Row label={t('mobileDiag.appVersion')}  value={diag.deviceInfo?.app_version || '—'} />
        <Row label={t('mobileDiag.paired')}      value={paired ? t('common.yes').toLowerCase() : t('common.no').toLowerCase()}
                                     status={paired ? 'good' : 'bad'} />
        <Row label={t('mobileDiag.deviceId')}    value={diag.devId || '—'} />
        <Row label={t('mobileDiag.authToken')}   value={diag.devTok || t('mobileDiag.missing')}
                                     status={diag.devTok ? 'good' : 'bad'} />
        <Row label={t('mobileDiag.webhookId')}   value={diag.whId || '—'} />
        <Row label={t('mobileDiag.wsUrl')}       value={diag.wsUrl || '—'} />
        <Row label={t('mobileDiag.wsStatus')}    value={wsStatus}
                                      status={wsStatus === 'open' ? 'good' : wsStatus === 'closed' || wsStatus === 'error' ? 'bad' : 'warn'} />
        <Row label={t('mobileDiag.locPerm')}     value={diag.locPerm}
                                         status={diag.locPerm === 'granted' || diag.locPerm === 'while_using' ? 'good' : diag.locPerm === 'denied' ? 'bad' : 'warn'} />
        <Row label={t('mobileDiag.pushPerm')}    value={diag.pushPerm}
                                     status={diag.pushPerm === 'granted' ? 'good' : diag.pushPerm === 'denied' ? 'bad' : 'warn'} />
      </section>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          onClick={testPing}
          disabled={busy || !paired}
          className="z-btn-primary"
          style={{ cursor: busy ? 'wait' : undefined }}
        >
          {busy ? t('mobileDiag.sendingPing') : t('mobileDiag.sendPing')}
        </button>
        <button onClick={load} className="z-btn-secondary">
          {t('mobileDiag.reload')}
        </button>
      </div>

      {pingResult && (
        <pre className="z-code" style={{
          marginTop: 12, padding: 12, borderRadius: 'var(--r-ctl)',
          background: 'var(--surface-2)', border: '0.5px solid var(--line)',
          fontSize: 13, lineHeight: '18px', color: 'var(--ink-mute)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>{pingResult}</pre>
      )}
    </div>
  )
}
