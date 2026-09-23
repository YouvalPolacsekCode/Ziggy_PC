// Settings → Wall → paired tablets (embedded by Settings.jsx WallPage).
//
// Admin surface for the wall dashboard: pair a new tablet, see which panels
// are alive, and decide what each one is allowed to do.
//
// The capability model matters more here than anywhere else in Ziggy, because
// a wall tablet is the one screen in the home that is shared, always unlocked,
// and reachable by children and visitors. So this page is deliberately blunt:
// a row of switches, and a PIN that gates the dangerous ones.

import { useCallback, useEffect, useState } from 'react'
import {
  listWallTablets, mintWallPairCode, removeWallTablet,
  putWallPolicy, setWallPin,
} from '../lib/api'
import { useT, t as i18nT } from '../lib/i18n'
import { Toggle } from '../components/ui/Toggle'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'

// Mirrors services/wall_policy.CAPABILITIES minus `presence`, which the
// backend forces off for every tablet (a wall panel is furniture, not a
// person) and does not offer as a switch on purpose.
const CAPS = ['lights', 'climate', 'media', 'scenes', 'lists', 'automations', 'cameras', 'locks', 'devices', 'settings']

function relTime(ts) {
  if (!ts) return i18nT('common.never')
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (secs < 90) return i18nT('time.justNow')
  if (secs < 3600) return i18nT('time.minutesAgo', { n: Math.floor(secs / 60) })
  if (secs < 86400) return i18nT('time.hoursAgo', { n: Math.floor(secs / 3600) })
  return i18nT('time.daysAgo', { n: Math.floor(secs / 86400) })
}

const card = {
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 'var(--r-card)', padding: 12, marginBottom: 12,
}

// Active-filter chip: surface-2 fill + ink + hairline. Never inverted, never
// accent — the PIN gate is a state, not the screen's primary action.
function chipStyle(on) {
  return {
    minHeight: 40, padding: '0 16px', borderRadius: 999,
    background: on ? 'var(--surface-2)' : 'transparent',
    color: on ? 'var(--ink)' : 'var(--ink-mute)',
    border: '0.5px solid var(--line)',
    fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0,
    transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
  }
}

function TabletCard({ tablet, onChanged }) {
  const t = useT()
  const [policy, setPolicy] = useState(tablet.policy)
  const [saving, setSaving] = useState(false)
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { setPolicy(tablet.policy) }, [tablet.policy])

  const save = useCallback(async (next) => {
    const prev = policy
    setPolicy(next)          // optimistic — a switch that lags feels broken
    setSaving(true)
    try {
      const res = await putWallPolicy(tablet.id, next)
      setPolicy(res.policy)
    } catch (e) {
      setPolicy(prev)
      setMsg(e?.userMessage || t('wallTablets.saveFailed'))
    } finally { setSaving(false) }
  }, [policy, tablet.id, t])

  const toggleCap = (key, on) =>
    save({ ...policy, capabilities: { ...policy.capabilities, [key]: on } })

  const togglePinReq = (key, on) => save({
    ...policy,
    pin_required: on
      ? [...new Set([...policy.pin_required, key])]
      : policy.pin_required.filter((k) => k !== key),
  })

  const savePin = useCallback(async () => {
    setMsg('')
    try {
      const res = await setWallPin(tablet.id, pin || null)
      setPolicy(res.policy)
      setPin('')
      setMsg(res.policy.has_pin ? t('wallTablets.pinSet') : t('wallTablets.pinCleared'))
    } catch (e) { setMsg(e?.userMessage || t('wallTablets.pinFailed')) }
  }, [tablet.id, pin, t])

  const unpair = useCallback(async () => {
    if (!window.confirm(t('wallTablets.unpairConfirm', { name: tablet.display_name }))) return
    try { await removeWallTablet(tablet.id); onChanged() }
    catch (e) { setMsg(e?.userMessage || t('wallTablets.unpairFailed')) }
  }, [tablet, onChanged, t])

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)' }} dir="auto">{tablet.display_name}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }} dir="auto">
            {tablet.room ? `${tablet.room} · ` : ''}{t('wallTablets.lastSeen', { ago: relTime(tablet.last_seen) })}
          </div>
        </div>
        <Button variant="danger" onClick={unpair}>{t('wallTablets.unpair')}</Button>
      </div>

      <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('wallTablets.whatMayDo')}</p>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {CAPS.map((key) => {
          const on = policy?.capabilities?.[key] !== false
          const pinned = policy?.pin_required?.includes(key)
          const label = t(`wallTablets.cap.${key}`)
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '8px 0',
                                    borderBottom: '0.5px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{label}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>{t(`wallTablets.capHint.${key}`)}</div>
              </div>
              {on && (
                <button
                  type="button"
                  onClick={() => togglePinReq(key, !pinned)}
                  title={t('wallTablets.requirePin')}
                  aria-label={t('wallTablets.requirePin')}
                  aria-pressed={!!pinned}
                  style={chipStyle(pinned)}
                >{t('wallTablets.pinChip')}</button>
              )}
              <Toggle checked={on} disabled={saving} onCheckedChange={(v) => toggleCap(key, v)} aria-label={label} />
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Input
            value={pin}
            inputMode="numeric"
            maxLength={8}
            dir="ltr"
            placeholder={policy?.has_pin ? t('wallTablets.pinChangePh') : t('wallTablets.pinSetPh')}
            aria-label={policy?.has_pin ? t('wallTablets.pinChangePh') : t('wallTablets.pinSetPh')}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <button onClick={savePin} className="z-btn-secondary">{pin ? t('wallTablets.savePin') : t('wallTablets.clearPin')}</button>
        {policy?.has_pin && <span style={{ fontSize: 13, color: 'var(--ok-text)' }}>{t('wallTablets.pinIsSet')}</span>}
      </div>
      {msg && <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 8 }} dir="auto">{msg}</div>}
    </div>
  )
}

export default function WallTabletsSection() {
  const t = useT()
  const [tablets, setTablets] = useState([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listWallTablets()
      .then((r) => setTablets(r?.tablets || []))
      .catch((e) => setError(e?.userMessage || t('wallTablets.loadFailed')))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => { load() }, [load])

  // Codes expire after 5 minutes; count it down so nobody walks to the wall
  // with a code that died on the way.
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!code) return
    const id = setInterval(() => {
      const s = Math.max(0, Math.floor(code.expires_at - Date.now() / 1000))
      setLeft(s)
      if (s === 0) setCode(null)
    }, 1000)
    return () => clearInterval(id)
  }, [code])

  const mint = useCallback(async () => {
    setError('')
    try {
      const res = await mintWallPairCode('')
      setCode(res)
      setLeft(res.ttl_s || 300)
    } catch (e) { setError(e?.userMessage || t('wallTablets.codeFailed')) }
  }, [t])

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '0 0 12px' }}>{t('wallTablets.subtitle')}</p>
      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginBottom: 4 }}>{t('wallTablets.pairTitle')}</div>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '0 0 12px' }}>
          {t('wallTablets.pairHow')}
        </p>
        {code ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div className="z-code" style={{ fontSize: 34, fontWeight: 700, lineHeight: '41px', color: 'var(--ink)' }}>{code.code}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums' }}>
              {t('wallTablets.expiresIn', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })}
            </div>
          </div>
        ) : (
          <button onClick={mint} className="z-btn-primary">{t('wallTablets.generateCode')}</button>
        )}
      </div>

      {error && <div style={{ color: 'var(--err-text)', fontSize: 13, marginBottom: 12 }} dir="auto">{error}</div>}

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{t('common.loading')}</p>
      ) : tablets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ fontSize: 15, color: 'var(--ink)' }}>{t('wallTablets.emptyTitle')}</p>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>{t('wallTablets.emptyBody')}</p>
        </div>
      ) : (
        tablets.map((tb) => <TabletCard key={tb.id} tablet={tb} onChanged={load} />)
      )}
    </div>
  )
}
