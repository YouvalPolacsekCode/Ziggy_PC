// Place newly-paired air conditioners in rooms.
//
// A multi-split home onboards several units in one tap. They arrive
// indistinguishable — same hardware, frequently the same reported name, no
// room — so dropping them on the Devices page leaves the user with four
// nameless air conditioners and no way to tell which is which. That is not a
// paired home; it's a puzzle.
//
// So: one row per unit, pre-filled with whatever name the unit reported (often
// the name its owner set in the vendor app), a room picker, and a button that
// makes the unit run for a few seconds so the user can hear which room it's
// in. An AC cannot blink; running is the only channel it has.
import { useState, useEffect } from 'react'
import { Volume2, Check, Loader2 } from 'lucide-react'
import { Input } from './ui/Input'
import { Button } from './ui/Button'
import {
  getClimateUnits, identifyClimateUnit, getAllRooms,
  renameHaDevice, assignDeviceToArea,
} from '../lib/api'
import { useT } from '../lib/i18n'
import logger from '../lib/logger'

// Gree discovers asynchronously after the config entry is created, so the
// units do not all exist the instant pairing reports success. Poll briefly
// rather than showing an empty list and calling it done.
const POLL_MS = 1500
const POLL_TRIES = 10

export default function AcRoomMapping({ entryId, onDone }) {
  const t = useT()
  const [units,   setUnits]   = useState(null)   // null = still looking
  const [rooms,   setRooms]   = useState([])
  const [draft,   setDraft]   = useState({})     // device_id → {name, area_id}
  const [pulsing, setPulsing] = useState(null)
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    let alive = true
    let tries = 0

    const poll = async () => {
      try {
        const res = await getClimateUnits(entryId)
        const found = res?.units || []
        if (!alive) return
        // Keep polling while nothing has shown up yet — but stop once we have
        // something, otherwise a slow sixth unit holds the whole screen hostage.
        if (found.length === 0 && ++tries < POLL_TRIES) {
          setTimeout(poll, POLL_MS)
          return
        }
        setUnits(found)
        setDraft(Object.fromEntries(found.map(u => [u.device_id, {
          name: u.name || '', area_id: u.area_id || '',
        }])))
      } catch (e) {
        logger.error('[AcRoomMapping] load failed', e)
        if (alive) setUnits([])
      }
    }

    poll()
    getAllRooms().then(r => alive && setRooms(r?.rooms || r || [])).catch(() => {})
    return () => { alive = false }
  }, [entryId])

  const pulse = async (u) => {
    setPulsing(u.device_id)
    try { await identifyClimateUnit(u.entity_id) }
    catch (e) { logger.error('[AcRoomMapping] identify failed', e) }
    // Clear once the unit has had time to be heard; the backend restores it.
    setTimeout(() => setPulsing(p => (p === u.device_id ? null : p)), 20_000)
  }

  const save = async () => {
    setSaving(true)
    try {
      for (const u of units) {
        const d = draft[u.device_id] || {}
        const name = (d.name || '').trim()
        if (name && name !== u.name) {
          try { await renameHaDevice(u.device_id, name) }
          catch (e) { logger.error('[AcRoomMapping] rename failed', u.device_id, e) }
        }
        if (d.area_id && d.area_id !== u.area_id) {
          try { await assignDeviceToArea(u.device_id, d.area_id) }
          catch (e) { logger.error('[AcRoomMapping] area assign failed', u.device_id, e) }
        }
      }
    } finally {
      setSaving(false)
      onDone?.()
    }
  }

  if (units === null) {
    return (
      <div className="w-full flex flex-col items-center gap-2 py-6">
        <Loader2 className="w-6 h-6 animate-spin text-accent" aria-hidden />
        <p className="text-subhead text-ink-mute">{t('wizard.acMap.looking')}</p>
      </div>
    )
  }

  if (units.length === 0) return null

  return (
    <div className="w-full text-start space-y-3">
      <div>
        <p className="text-body font-semibold text-ink">
          {t('wizard.acMap.foundTitle', { n: units.length })}
        </p>
        <p className="text-subhead text-ink-mute">{t('wizard.acMap.foundHint')}</p>
      </div>

      <div className="space-y-2">
        {units.map((u) => {
          const d = draft[u.device_id] || {}
          return (
            <div key={u.device_id} className="bg-surface-2 rounded-card p-3 space-y-2">
              <Input
                value={d.name || ''}
                onChange={(e) => setDraft(s => ({ ...s, [u.device_id]: { ...s[u.device_id], name: e.target.value } }))}
                placeholder={t('wizard.acMap.namePh')}
              />
              <div className="flex items-center gap-2">
                <select
                  value={d.area_id || ''}
                  onChange={(e) => setDraft(s => ({ ...s, [u.device_id]: { ...s[u.device_id], area_id: e.target.value } }))}
                  className="z-input flex-1"
                >
                  <option value="">{t('wizard.acMap.pickRoom')}</option>
                  {rooms.map(r => (
                    <option key={r.area_id || r.id} value={r.area_id || r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => pulse(u)}
                  disabled={!!pulsing}
                  className="z-btn-secondary z-button shrink-0 disabled:opacity-60"
                  title={t('wizard.acMap.identifyHint')}
                >
                  {pulsing === u.device_id
                    ? <Loader2 size={16} className="animate-spin" aria-hidden />
                    : <Volume2 size={16} strokeWidth={1.75} aria-hidden />}
                  {t('wizard.acMap.identify')}
                </button>
              </div>
              {pulsing === u.device_id && (
                <p className="text-caption text-ink-mute">{t('wizard.acMap.identifyRunning')}</p>
              )}
            </div>
          )
        })}
      </div>

      <Button onClick={save} disabled={saving} className="w-full">
        {saving ? <Loader2 size={18} className="animate-spin" aria-hidden />
                : <Check size={18} strokeWidth={1.75} aria-hidden />}
        {t('wizard.acMap.save')}
      </Button>
    </div>
  )
}
