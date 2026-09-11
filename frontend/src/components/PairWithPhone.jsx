// PairWithPhone — embeddable section for the PWA Settings page.
// Lets a logged-in user generate a short-lived pair code that their phone
// (Ziggy Home native app) redeems to bind itself to their account.
//
// Renders nothing on the native side (where the user pairs the OTHER way).

import { useEffect, useRef, useState } from 'react'
import { mintPairCode } from '../lib/mobileApi'
import { isNative } from '../lib/native'
import { useT } from '../lib/i18n'
import { Button } from './ui/Button'

export function PairWithPhone() {
  if (isNative()) return null

  const t = useT()
  const [code, setCode]           = useState(null)
  const [expiresIn, setExpiresIn] = useState(0)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const qrRef                     = useRef(null)

  // Render a QR encoding `ziggy://pair?code=XXXXXX&base=<this-home-origin>`
  // whenever code changes. Embedding this home's own origin lets the phone
  // route the pair request (and every request thereafter) to THIS home rather
  // than the compiled-in default — the fix for multi-home / fresh Canary Homes.
  // A relay hint is added when the PWA knows one. The `qrcode` lib is loaded
  // lazily so if it's not installed yet the section still works (text code only).
  useEffect(() => {
    if (!code || !qrRef.current) return
    let cancelled = false
    ;(async () => {
      try {
        const mod = await import('qrcode')
        if (cancelled || !qrRef.current) return
        let payload = `ziggy://pair?code=${code}`
        const origin = (typeof window !== 'undefined' && window.location?.origin) || ''
        // Only embed a real remote origin — a localhost/dev origin would send
        // the phone nowhere useful, so fall back to code-only in that case.
        if (origin && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0)/i.test(origin)) {
          payload += `&base=${encodeURIComponent(origin)}`
        }
        const relay = (typeof window !== 'undefined' && window.__RELAY_URL__) || ''
        if (relay) payload += `&relay=${encodeURIComponent(relay)}`
        await mod.default.toCanvas(qrRef.current, payload, {
          width: 160, margin: 2, color: { dark: '#111111', light: '#ffffff' },
        })
      } catch {
        // qrcode lib not installed — text fallback only, no user-visible error.
      }
    })()
    return () => { cancelled = true }
  }, [code])

  // Tick down the visible expiry every second
  useEffect(() => {
    if (!code) return
    const t = setInterval(() => {
      setExpiresIn(s => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(t)
  }, [code])

  // Auto-clear when expired
  useEffect(() => {
    if (code && expiresIn === 0) setCode(null)
  }, [expiresIn, code])

  const generate = async () => {
    setLoading(true); setError(null)
    try {
      const res = await mintPairCode()
      setCode(res.code)
      setExpiresIn(res.ttl_seconds ?? 300)
    } catch (e) {
      setError(e.message || t('pairPhone.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="z-card-soft" style={{
      padding: 16,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div>
        <h3 className="z-headline" style={{ margin: 0 }}>{t('pairPhone.title')}</h3>
        <p className="z-subhead" style={{ margin: '4px 0 0' }}>
          {t('pairPhone.subtitle')}
        </p>
      </div>

      {!code && (
        <button
          onClick={generate}
          disabled={loading}
          className="z-btn-primary z-button"
          style={{ alignSelf: 'flex-start', cursor: loading ? 'wait' : 'pointer' }}
        >
          {loading ? t('pairPhone.generating') : t('pairPhone.generate')}
        </button>
      )}

      {code && (
        <div className="z-card-sm" style={{
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          padding: 12,
        }}>
          {/* QR modules are scanner-facing, not UI chrome: they stay pure
              black-on-white regardless of palette so phones can read them. */}
          <canvas
            ref={qrRef}
            width={160} height={160}
            style={{
              borderRadius: 'var(--r-chip)', background: '#ffffff',
              flexShrink: 0,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <code className="z-code" style={{
              fontSize: 22, lineHeight: '28px', letterSpacing: '0.2em', fontWeight: 700,
              color: 'var(--ink)',
            }}>
              {code}
            </code>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className="z-footnote">{t('pairPhone.expiresIn')}</div>
              <div className="z-mono" style={{ fontSize: 17, lineHeight: '22px', color: 'var(--ink)', fontWeight: 600 }}>
                {Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, '0')}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={generate} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
              {t('pairPhone.newCode')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ fontSize: 15, lineHeight: '20px', color: 'var(--err-text)' }}>{error}</div>
      )}
    </section>
  )
}
