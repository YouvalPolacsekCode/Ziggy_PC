// "What are you adding?" — the way in for every device that doesn't announce
// itself on the network.
//
// Only 295 of Home Assistant's 852 config-flow integrations advertise over
// zeroconf/DHCP/SSDP. The rest can never show up in a discovery list, and the
// gap falls hardest on small local brands — every Israeli-made device (Risco,
// SwitchBee, CoolAutomation, Tami4) is invisible, along with Tadiran and
// Electra. So this is not a fallback for an edge case: for a home here it is
// the main road, which is why it sits beside the discovered list rather than
// under a "didn't find it?" link.
//
// Two screens: category, then brand. No model step — Home Assistant's flows
// are per integration, not per model, so asking for one would cost the user a
// tap and change nothing.
import { useEffect, useState } from 'react'
import { ChevronLeft, Loader2, Send } from 'lucide-react'
import { Input } from './ui/Input'
import { Button } from './ui/Button'
import { getWifiBrands, requestWifiBrand } from '../lib/api'
import { useT } from '../lib/i18n'
import logger from '../lib/logger'

export default function WifiBrandPicker({ busyBrand, onPick }) {
  const t = useT()
  const [cats,    setCats]    = useState(null)
  const [brands,  setBrands]  = useState([])
  const [active,  setActive]  = useState(null)   // chosen category id
  const [ask,     setAsk]     = useState('')     // "can't find yours" text
  const [asked,   setAsked]   = useState(false)

  useEffect(() => {
    let alive = true
    getWifiBrands()
      .then(r => { if (alive) { setCats(r?.categories || []); setBrands(r?.brands || []) } })
      .catch(e => { logger.error('[WifiBrandPicker] load failed', e); if (alive) setCats([]) })
    return () => { alive = false }
  }, [])

  const sendAsk = async () => {
    const text = ask.trim()
    if (!text) return
    try { await requestWifiBrand(text, active) } catch (e) { logger.error('[WifiBrandPicker] request failed', e) }
    setAsked(true); setAsk('')
  }

  if (cats === null) {
    return (
      <div className="w-full flex justify-center py-6">
        <Loader2 className="w-6 h-6 animate-spin text-accent" aria-hidden />
      </div>
    )
  }

  // ── Category grid ─────────────────────────────────────────────────────
  if (!active) {
    return (
      <div className="w-full text-start space-y-2">
        <p className="text-body font-semibold text-ink">{t('wizard.brandPick.whatTitle')}</p>
        <p className="text-subhead text-ink-mute">{t('wizard.brandPick.whatHint')}</p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          {cats.map(c => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className="z-btn-secondary z-button w-full justify-start"
            >
              {t(`wizard.brandPick.cat.${c.id}`)}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Brands in the chosen category ─────────────────────────────────────
  const inCat = brands.filter(b => b.category === active)
  return (
    <div className="w-full text-start space-y-2">
      <button
        onClick={() => { setActive(null); setAsked(false) }}
        className="inline-flex items-center gap-1 text-subhead text-ink-mute"
      >
        <ChevronLeft size={16} className="icon-flip-rtl" aria-hidden />
        {t('wizard.brandPick.back')}
      </button>

      <p className="text-body font-semibold text-ink">
        {t('wizard.brandPick.pickBrand', { d: t(`wizard.brandPick.cat.${active}`) })}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        {inCat.map(b => (
          <button
            key={b.brand}
            onClick={() => onPick?.(b.brand, b.label)}
            disabled={!!busyBrand}
            className="z-btn-secondary z-button disabled:opacity-60"
          >
            {busyBrand === b.brand && <Loader2 size={16} className="animate-spin" aria-hidden />}
            {b.label}
          </button>
        ))}
      </div>

      {/* The catalogue is curated, so it is permanently incomplete. This box
          is how we learn which brand to add next, from a real home. */}
      <div className="pt-2 border-t border-line mt-2">
        {asked ? (
          <p className="text-subhead text-ink-mute">{t('wizard.brandPick.askThanks')}</p>
        ) : (
          <>
            <p className="text-subhead text-ink-mute mb-1">{t('wizard.brandPick.askTitle')}</p>
            <div className="flex items-center gap-2">
              <Input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder={t('wizard.brandPick.askPh')}
                onKeyDown={(e) => { if (e.key === 'Enter') sendAsk() }}
              />
              <Button onClick={sendAsk} disabled={!ask.trim()} className="shrink-0">
                <Send size={16} strokeWidth={1.75} aria-hidden />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
