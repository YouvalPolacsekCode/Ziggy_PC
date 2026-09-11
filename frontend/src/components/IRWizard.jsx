/**
 * IRWizard — multi-step setup wizard for IR blaster virtual devices.
 *
 * Step 1: Find blaster by IP (auto-scan + manual entry)
 * Step 2: Device details (name, type, room, brand)
 * Step 3: Learn commands — direct python-broadlink (captures raw code for receive matching)
 * Step 4: Done
 */
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Radio, ChevronLeft, ChevronRight, Check, Loader2,
  Zap, Thermometer, Wind, Volume2, MonitorPlay, Plus, Trash2, Wifi,
} from 'lucide-react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import {
  discoverIrBlasters, createIrDevice, irLearn, irSend, getRooms,
  getIrCatalog, getIrUnassignedSignals, assignIrUnassignedSignal,
  createIrBlaster, listIrBlasters,
} from '../lib/api'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import logger from '../lib/logger'
import { T_ENTER } from '../lib/motion'

// Device type ids — labels resolved via t() in the component.
const DEVICE_TYPES = [
  { id: 'tv',        Icon: Radio },
  { id: 'ac',        Icon: Thermometer },
  { id: 'fan',       Icon: Wind },
  { id: 'soundbar',  Icon: Volume2 },
  { id: 'receiver',  Icon: Volume2 },
  { id: 'projector', Icon: MonitorPlay },
  { id: 'custom',    Icon: Zap },
]

const LEARN_DURATION = 20  // seconds

// ---------------------------------------------------------------------------

// Numbered 24px dots (13px figures) joined by hairlines — the same step
// indicator the other wizards use.
function StepIndicator({ step, total }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6" aria-hidden>
      {Array.from({ length: total }).map((_, i) => {
        const done   = i + 1 < step
        const active = i + 1 === step
        return (
          <div key={i} className="flex items-center gap-2">
            <div className={cn(
              'flex items-center justify-center w-6 h-6 rounded-full text-footnote font-semibold z-mono transition-colors duration-200',
              done   ? 'bg-ink text-bg' :
              active ? 'bg-surface-2 text-ink border border-ink' :
                       'bg-surface text-ink-mute border border-line',
            )}>
              {done ? <Check size={14} strokeWidth={2.5} /> : i + 1}
            </div>
            {i < total - 1 && (
              <div className={cn('w-6 h-px transition-colors duration-200', done ? 'bg-ink' : 'bg-line')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Select blaster
// ---------------------------------------------------------------------------

function StepSelectBlaster({ selected, onSelect, blasterName, onBlasterNameChange, deviceMode = false }) {
  const t = useT()
  const [discovered, setDiscovered]   = useState([])
  const [discovering, setDiscovering] = useState(false)
  const [manualIp, setManualIp]       = useState('')
  const [manualError, setManualError] = useState('')
  // Device (TV/AC) flow: pick from already-paired blasters instead of re-scanning
  // + re-naming. null = still loading.
  const [registered, setRegistered]   = useState(deviceMode ? null : [])
  const [showScan, setShowScan]       = useState(false)  // reveal LAN scan in device mode

  const runDiscover = () => {
    setDiscovering(true)
    discoverIrBlasters()
      .then(setDiscovered)
      .catch(() => {})
      .finally(() => setDiscovering(false))
  }

  // Select an already-registered blaster (device mode). Carries the registry id
  // so the device create can reference it without re-creating the blaster.
  const selectBlasterRecord = (b) => onSelect({
    blaster_host: b.ip || b.last_seen_ip || '',
    blaster_mac:  b.mac || null,
    blaster_id:   b.id || null,
    entity_id:    null,
    label:        b.name,
    default_name: b.name,
  })

  useEffect(() => {
    if (deviceMode) {
      // TV/AC flow: load paired blasters. Auto-select when there's exactly one
      // so the user doesn't even tap. If none exist, fall back to a LAN scan.
      listIrBlasters()
        .then((list) => {
          const arr = Array.isArray(list) ? list : []
          setRegistered(arr)
          if (arr.length === 0) { setShowScan(true); runDiscover() }
          else if (arr.length === 1 && !selected) selectBlasterRecord(arr[0])
        })
        .catch(() => { setRegistered([]); setShowScan(true); runDiscover() })
    } else {
      // Blaster-pairing flow: scan the LAN for a new blaster.
      runDiscover()
    }
  }, [deviceMode])

  // `mac` is optional — auto-discovered blasters always have one (the
  // backend's _device_info pulls it from python-broadlink), but the
  // manual-IP fallback path has no way to obtain it. The MAC anchor lets
  // the listener pick the right device after a DHCP shuffle in homes with
  // multiple Broadlinks; when missing, the listener lazy-backfills it on
  // first successful contact.
  //
  // `defaultName` is the humanized label from discovery (e.g. "Broadlink
  // RM4 Mini · FC67"). Stored separately from the rendered list label so
  // the parent's name-this-blaster input can prefill it without showing
  // the IP suffix the picker may include.
  const selectDirect = (host, label, mac = null, defaultName = null) =>
    onSelect({
      blaster_host: host,
      blaster_mac: mac,
      entity_id: null,
      label: label || host,
      // Pre-fill the rename input with the cleanest version of the name —
      // discovered string first, label second, host as a last resort.
      default_name: defaultName || label || host,
    })

  const handleManualIp = () => {
    const ip = manualIp.trim()
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      setManualError(t('wizard.ir.invalidIp'))
      return
    }
    setManualError('')
    selectDirect(ip, t('wizard.ir.broadlinkAt', { ip }))
  }

  return (
    <div className="space-y-4">

      {/* Device (TV/AC) flow: pick an already-paired blaster — no re-scan/rename. */}
      {deviceMode && Array.isArray(registered) && registered.length > 0 && (
        <div className="space-y-2">
          <p className="text-subhead text-ink-mute mb-1">{t('wizard.ir.chooseBlaster') || 'Choose a blaster'}</p>
          {registered.map((b) => {
            const host = b.ip || b.last_seen_ip || ''
            const isSel = (selected?.blaster_id && selected.blaster_id === b.id) || selected?.blaster_host === host
            return (
              <button
                key={b.id}
                onClick={() => selectBlasterRecord(b)}
                aria-pressed={isSel}
                className={cn(
                  'w-full text-start min-h-[56px] px-4 py-3 rounded-ctl border transition-colors duration-state ease-standard',
                  isSel ? 'border-line-2 bg-surface-2' : 'border-line bg-surface hover:bg-surface-2',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="z-dot" style={{ flexShrink: 0,
                    background: b.status === 'online' ? 'var(--ok)' : b.status === 'stale' ? 'var(--warn)' : 'var(--err)' }} />
                  <p className="text-body font-semibold text-ink flex-1">{b.name}</p>
                </div>
                {host && <p className="text-subhead text-ink-mute z-code mt-0.5">{host}</p>}
              </button>
            )
          })}
          {!showScan && (
            <button onClick={() => { setShowScan(true); runDiscover() }} className="min-h-[44px] px-2 text-subhead font-medium text-ink-mute hover:text-ink underline">
              {t('wizard.ir.scanForNew') || 'Pair a new blaster'}
            </button>
          )}
        </div>
      )}

      {(!deviceMode || showScan) && (<>

      {/* Auto-discover results */}
      {discovering ? (
        <div className="flex items-center gap-2 text-subhead text-ink-mute py-2">
          <Loader2 size={20} className="z-spin" aria-hidden /> {t('wizard.ir.scanning')}
        </div>
      ) : discovered.length > 0 ? (
        <div className="space-y-2">
          {discovered.map((d) => {
            const isSelected = selected?.blaster_host === d.host
            return (
              <button
                key={d.host}
                onClick={() => selectDirect(d.host, d.name || d.type, d.mac, d.name || d.type)}
                aria-pressed={isSelected}
                className={cn(
                  'w-full text-start min-h-[56px] px-4 py-3 rounded-ctl border transition-colors duration-state ease-standard',
                  isSelected
                    ? 'border-line-2 bg-surface-2'
                    : 'border-line bg-surface hover:bg-surface-2',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-body font-semibold text-ink">{d.name || d.type}</p>
                  <span className="z-chip">{t('wizard.ir.irReceiveBadge')}</span>
                </div>
                <p className="text-subhead text-ink-mute z-code mt-0.5">{d.host}</p>
              </button>
            )
          })}
          <button onClick={runDiscover} className="min-h-[44px] px-2 text-subhead font-medium text-ink-mute hover:text-ink underline">{t('wizard.scanAgain')}</button>
        </div>
      ) : null}

      {/* Manual IP — always visible, primary path when discovery fails */}
      <div>
        <p className="text-subhead font-semibold text-ink mb-1">
          {discovered.length > 0 ? t('wizard.ir.enterIpManual') : t('wizard.ir.enterIpHint')}
        </p>
        <p className="text-footnote text-ink-mute mb-2">
          {t('wizard.ir.ipFindHint')}
        </p>
        <div className="flex gap-2">
          <input
            value={manualIp}
            onChange={(e) => { setManualIp(e.target.value); setManualError('') }}
            onKeyDown={(e) => e.key === 'Enter' && handleManualIp()}
            placeholder={t('wizard.ir.ipPlaceholder')}
            dir="auto"
            className={cn(
              'flex-1 min-w-0 h-11 px-4 rounded-ctl text-body border z-code',
              'bg-surface text-ink',
              manualError
                ? 'border-err'
                : selected?.blaster_host === manualIp.trim() && manualIp.trim()
                ? 'border-ink-mute'
                : 'border-line',
              'focus:outline-none focus:border-ink-mute',
            )}
          />
          <button
            onClick={handleManualIp}
            disabled={!manualIp.trim()}
            className="z-btn-secondary z-button shrink-0"
          >
            {t('wizard.useThisIp')}
          </button>
        </div>
        {manualError && <p role="alert" className="text-subhead text-err-text mt-1">{manualError}</p>}
        {selected?.blaster_host && !selected?.entity_id && (
          <p className="text-subhead text-ink-mute mt-2">
            {t('wizard.selected', { host: selected.blaster_host })}
          </p>
        )}
      </div>

      </>)}

      {/* Name this blaster — only when pairing a NEW blaster (not the TV/AC
          device flow, where the blaster already has a name). Pre-filled with the
          humanized discovery name. Saving happens at step advance (create-by-MAC
          is idempotent, so re-selecting an existing blaster is a no-op). */}
      {!deviceMode && selected?.blaster_host && onBlasterNameChange && (
        <div className="border-t border-line pt-4">
          <label className="block text-subhead font-semibold text-ink mb-1">
            {t('wizard.ir.nameBlasterLabel') || 'Name this blaster'}
          </label>
          <p className="text-footnote text-ink-mute mb-2">
            {t('wizard.ir.nameBlasterHint') || 'Used everywhere this blaster appears — Devices page, Rooms, automations.'}
          </p>
          <input
            value={blasterName ?? ''}
            onChange={(e) => onBlasterNameChange(e.target.value)}
            placeholder={selected.default_name || selected.label || 'Blaster name'}
            dir="auto"
            className={cn(
              'w-full h-11 px-4 rounded-ctl text-body border',
              'bg-surface text-ink border-line',
              'focus:outline-none focus:border-ink-mute',
            )}
          />
        </div>
      )}

    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Device details
// ---------------------------------------------------------------------------

function StepDeviceDetails({ details, onChange }) {
  const t = useT()
  const [rooms, setRooms] = useState([])

  const typeLabel = (id) => {
    const map = {
      tv:        t('wizard.ir.typeTv'),
      ac:        t('wizard.ir.typeAc'),
      fan:       t('wizard.ir.typeFan'),
      soundbar:  t('wizard.ir.typeSoundbar'),
      receiver:  t('wizard.ir.typeReceiver'),
      projector: t('wizard.ir.typeProjector'),
      custom:    t('wizard.ir.typeCustom'),
    }
    return map[id] || id
  }

  useEffect(() => {
    getRooms().then((r) => setRooms(Array.isArray(r) ? r : r.areas ?? r.rooms ?? [])).catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-subhead font-semibold text-ink mb-1">{t('wizard.ir.deviceName')}</label>
        <Input
          value={details.name}
          onChange={(e) => onChange({ ...details, name: e.target.value })}
          placeholder={t('wizard.ir.deviceNamePh')}
          dir="auto"
        />
      </div>

      <div>
        <label className="block text-subhead font-semibold text-ink mb-2">{t('wizard.ir.deviceTypeRequired')}</label>
        <div className="grid grid-cols-3 gap-2">
          {DEVICE_TYPES.map(({ id, Icon }) => (
            <button
              key={id}
              onClick={() => onChange({ ...details, device_type: id })}
              aria-pressed={details.device_type === id}
              className={cn(
                'flex flex-col items-center justify-center gap-2 min-h-[64px] py-3 px-3 rounded-ctl border text-subhead transition-colors duration-state ease-standard',
                details.device_type === id
                  ? 'border-line-2 bg-surface-2 text-ink font-semibold'
                  : 'border-line bg-surface text-ink-mute hover:bg-surface-2',
              )}
            >
              <Icon size={24} strokeWidth={1.75} aria-hidden />
              {typeLabel(id)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-subhead font-semibold text-ink mb-1">{t('wizard.ir.room')}</label>
        <select
          value={details.room}
          onChange={(e) => onChange({ ...details, room: e.target.value })}
          className={cn(
            'w-full h-11 px-4 rounded-ctl text-body border',
            'bg-surface',
            'text-ink',
            'border-line',
            'focus:outline-none focus:border-ink-mute',
          )}
        >
          <option value="">{t('wizard.ir.selectRoom')}</option>
          {rooms.map((r) => (
            <option key={r.id ?? r.area_id ?? r.name} value={r.id ?? r.area_id ?? r.name}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-subhead font-semibold text-ink mb-1">{t('wizard.ir.brandOptional')}</label>
        <Input
          value={details.brand}
          onChange={(e) => onChange({ ...details, brand: e.target.value })}
          placeholder={t('wizard.ir.brandPh')}
          dir="auto"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single command row — catalog-driven. Renders a fixed, labelled slot from
// the backend catalog (not editable). Lets the user learn via long-press OR
// auto-bind a freshly-captured IR signal via the ⚡ button.
// ---------------------------------------------------------------------------

function CatalogCommandRow({ cmd, deviceId, learnedNow, onLearned, recentSignal }) {
  const t = useT()
  const [status, setStatus]   = useState(learnedNow ? 'learned' : 'idle')
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => { if (learnedNow) setStatus('learned') }, [learnedNow])

  const startLearning = async () => {
    if (!deviceId) return
    setStatus('learning')
    setCountdown(LEARN_DURATION)

    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(timerRef.current); return 0 }
        return c - 1
      })
    }, 1000)

    try {
      await irLearn(deviceId, cmd.id)
      setStatus('learned')
      onLearned?.(cmd.id)
    } catch {
      setStatus('error')
    } finally {
      clearInterval(timerRef.current)
      setCountdown(0)
    }
  }

  const bindRecent = async () => {
    if (!recentSignal || !deviceId) return
    try {
      await assignIrUnassignedSignal(recentSignal.id, deviceId, cmd.id)
      setStatus('learned')
      onLearned?.(cmd.id)
    } catch { setStatus('error') }
  }

  const testCommand = async () => {
    if (!deviceId) return
    try { await irSend(deviceId, cmd.id); if (status !== 'learned') setStatus('learned') }
    catch {}
  }

  useEffect(() => () => clearInterval(timerRef.current), [])

  return (
    <div className="flex items-center gap-2 min-h-[56px] py-2">
      {/* The learning pulse is the one loop on this screen — it means "the
          blaster is listening for your press". */}
      <div className={cn(
        'z-dot shrink-0',
        status === 'learned' ? 'bg-ok' :
        status === 'error'   ? 'bg-err' :
        status === 'learning'? 'bg-warn z-pulse' :
                               'bg-line',
      )} />

      <span className="flex-1 min-w-0 text-body text-ink">
        <span className="font-semibold">{cmd.label}</span>
        {cmd.id !== cmd.label && (
          <span className="text-footnote text-ink-mute ms-1 z-code">· {cmd.id}</span>
        )}
      </span>

      {recentSignal && status !== 'learned' && status !== 'learning' && (
        <button onClick={bindRecent}
          className="min-h-[44px] px-2 text-subhead font-medium text-ink underline whitespace-nowrap"
          title={t('wizard.unassignedSignals.bindRecent')}>
          {t('wizard.ir.bind')}
        </button>
      )}

      {status === 'learning' ? (
        <span className="text-subhead text-warn-text w-16 text-center z-mono">{countdown}s…</span>
      ) : (
        <Button
          size="sm"
          variant={status === 'learned' ? 'ghost' : 'secondary'}
          onClick={startLearning}
          className="w-16"
          title={t('wizard.unassignedSignals.learnNew')}
        >
          {status === 'learned' ? <Check size={20} strokeWidth={2} className="text-ok" aria-hidden /> : t('wizard.ir.learn')}
        </Button>
      )}

      <Button
        size="sm"
        variant="ghost"
        onClick={testCommand}
        disabled={!deviceId || status === 'learning' || status !== 'learned'}
        className="w-16"
        title={t('wizard.unassignedSignals.fireToVerify')}
      >
        {t('wizard.ir.test')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Learn commands. Pulls the catalog from the backend and renders
// it as core/optional groups. The user learns each command via the in-row
// Learn button OR the ⚡ bind button next to a freshly-captured signal.
// ---------------------------------------------------------------------------

function StepLearnCommands({ deviceType, deviceId, learnedSet, onLearnedChange }) {
  const t = useT()
  const [catalog, setCatalog] = useState(null)
  useEffect(() => {
    if (!deviceType) return
    getIrCatalog(deviceType).then(setCatalog).catch(() => setCatalog({ label: deviceType, groups: [] }))
  }, [deviceType])

  // Poll unassigned signals so ⚡-bind targets the newest physical press.
  const [signals, setSignals] = useState([])
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try { const list = await getIrUnassignedSignals(); if (alive) setSignals(list) }
      catch {}
    }
    refresh()
    const t = setInterval(refresh, 3000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  const recent = signals[0] || null

  const [expanded, setExpanded] = useState(new Set())
  const toggleGroup = (id) => setExpanded((s) => {
    const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  if (!catalog) {
    return <p className="text-subhead text-ink-mute py-4">{t('wizard.ir.loadingCommands')}</p>
  }

  const groups = catalog.groups || []

  return (
    <div>
      <p className="text-subhead text-ink-mute mb-3">
        {t('wizard.ir.coreHint')}
      </p>

      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {groups.map((g) => {
          const core   = g.commands.filter((c) => c.core)
          const extras = g.commands.filter((c) => !c.core)
          const learnedExtras = extras.filter((c) => learnedSet.has(c.id))
          const isOpen = expanded.has(g.id)
          return (
            <div key={g.id} className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="z-eyebrow">{g.label}</span>
                {extras.length > 0 && (
                  <button onClick={() => toggleGroup(g.id)}
                    className="min-h-[44px] px-2 text-subhead font-medium text-ink-mute hover:text-ink underline text-end">
                    {isOpen
                      ? t('wizard.ir.hideOptional', { n: extras.length })
                      : `${t('wizard.ir.showOptional', { n: extras.length })}${learnedExtras.length ? t('wizard.ir.optionalLearned', { n: learnedExtras.length }) : ''}`}
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {core.map((c) => (
                  <CatalogCommandRow key={c.id} cmd={c} deviceId={deviceId}
                    learnedNow={learnedSet.has(c.id)} onLearned={onLearnedChange}
                    recentSignal={recent} />
                ))}
                {isOpen && extras.map((c) => (
                  <CatalogCommandRow key={c.id} cmd={c} deviceId={deviceId}
                    learnedNow={learnedSet.has(c.id)} onLearned={onLearnedChange}
                    recentSignal={recent} />
                ))}
                {!isOpen && learnedExtras.map((c) => (
                  <CatalogCommandRow key={c.id} cmd={c} deviceId={deviceId}
                    learnedNow={true} onLearned={onLearnedChange}
                    recentSignal={recent} />
                ))}
              </div>
            </div>
          )
        })}
        {groups.length === 0 && (
          <p className="text-subhead text-ink-mute py-2">{t('wizard.ir.noCommandsForType')}</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Done
// ---------------------------------------------------------------------------

function StepDone({ deviceName }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center py-8 gap-4">
      <div className="w-16 h-16 rounded-full bg-ok-soft flex items-center justify-center text-ok" aria-hidden>
        <Check size={32} strokeWidth={2} />
      </div>
      <p className="z-title text-center">{t('wizard.ir.deviceReady', { name: deviceName })}</p>
      <p className="text-body text-ink-mute text-center">
        {t('wizard.ir.doneBody')}
      </p>
      <div className="flex items-center gap-3 px-4 py-3 rounded-ctl bg-surface-2 border border-line">
        <Wifi size={20} strokeWidth={1.75} className="text-ink-mute shrink-0" aria-hidden />
        <p className="text-subhead text-ink-mute">
          {t('wizard.ir.physicalDetect')}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 4

// Small confirmation shown at the end of the blaster-only ("pair IR blaster")
// flow — the blaster hardware is now registered; TV/AC remotes are a separate
// step (Add device → IR device).
function BlasterDone({ name }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center py-8 gap-4">
      <div className="w-16 h-16 rounded-full bg-ok-soft flex items-center justify-center text-ok" aria-hidden>
        <Check size={32} strokeWidth={2} />
      </div>
      <p className="z-title text-center">{t('wizard.ir.blasterReady', { name: name || '' })}</p>
      <p className="text-body text-ink-mute text-center">{t('wizard.ir.blasterPairedBody')}</p>
    </div>
  )
}

// `blasterOnly` = the "pair IR blaster" entry point (from Add device → IR
// Blaster). It runs step 1 only — discover + name + register the blaster
// hardware — then shows a done screen. The full flow (blasterOnly=false) then
// continues into TV/AC remote setup. Splitting these was the fix for "pairing a
// blaster shouldn't dump me straight into setting up a TV remote".
export default function IRWizard({ onClose, onCreated, blasterOnly = false }) {
  const t = useT()
  const totalSteps = blasterOnly ? 2 : TOTAL_STEPS
  const [step, setStep]               = useState(1)
  const [blaster, setBlaster]         = useState(null)
  // User-editable name for the blaster registry row, created at step 1
  // advance. Defaults to the humanized discovery label when the user picks
  // a blaster; can be overridden inline via the "Name this blaster" input.
  // null until a blaster is picked.
  const [blasterName, setBlasterName] = useState(null)
  const [details, setDetails]         = useState({ name: '', device_type: 'tv', room: '', brand: '' })
  // Track which catalog command ids the user has learned (or bound) in step 3.
  // Used to show ✓ next to each row and to drive the optional-expand counts.
  const [learnedSet, setLearnedSet]   = useState(new Set())
  const [savedDeviceId, setSavedDeviceId] = useState(null)
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState(null)

  const markLearned = (cmdId) => setLearnedSet((s) => {
    const next = new Set(s); next.add(cmdId); return next
  })

  const deviceNamespace = details.name
    ? details.name.toLowerCase().replace(/\s+/g, '_')
    : 'ir_device'

  const canNext = () => {
    if (step === 1) return !!blaster
    if (step === 2) return details.name.trim() && details.device_type
    return true
  }

  const handleNext = async () => {
    logger.action('ir_wizard_next', { from_step: step })
    // Step 1 → 2: register (or look up) the blaster row in the registry so
    // step 2's device-create can stamp blaster_id on the new IR device.
    // createIrBlaster is idempotent on MAC: re-running for the same
    // hardware returns the existing row instead of duplicating, so this
    // is safe to call on every Next-from-step-1 without side effects.
    if (step === 1 && blaster?.blaster_host) {
      try {
        const created = await createIrBlaster({
          name: (blasterName || blaster.default_name || blaster.label || '').trim() || 'IR Blaster',
          mac:  blaster.blaster_mac || null,
          ip:   blaster.blaster_host,
        })
        // Persist the registry id on the blaster object so step 2's device
        // create can include it. Future passes use the existing row.
        setBlaster((prev) => ({ ...(prev || {}), blaster_id: created?.id || null }))
        logger.action('ir_wizard_blaster_registered', {
          blaster_id: created?.id, name: created?.name,
        })
      } catch (e) {
        logger.error('ir_wizard_blaster_register_failed', e)
        setSaveError(e.message || t('wizard.ir.failedRegisterBlaster') || 'Could not register blaster')
        return
      }
      // Blaster-only flow: the hardware is registered — refresh + show done.
      // Full flow: continue into TV/AC device setup.
      if (blasterOnly) onCreated?.()
      setStep(2)
      return
    }
    // Step 2 → 3: create the device the FIRST time only. If the user went
    // back to step 2 after we already saved, just patch the existing device
    // with any edited fields rather than creating a second one — otherwise
    // every "Back → forward" cycle leaves an orphan in ir_devices.json.
    if (step === 2) {
      setSaving(true)
      setSaveError(null)
      try {
        const payload = {
          name: details.name.trim(),
          device_type: details.device_type,
          room: details.room.trim() || null,
          brand: details.brand.trim() || null,
          blaster_entity_id: `direct_${blaster.blaster_host}`,
          blaster_host: blaster.blaster_host,
          blaster_mac: blaster.blaster_mac || null,
          ha_device_namespace: deviceNamespace,
        }
        if (savedDeviceId) {
          // Already created on a previous step-2 pass — patch the editable
          // fields instead of creating again. blaster_host / ha namespace
          // are immutable after creation so we omit them from the patch.
          await patchIrDevice(savedDeviceId, {
            name: payload.name,
            device_type: payload.device_type,
            room: payload.room,
            brand: payload.brand,
          })
          logger.action('ir_wizard_device_patched', { device_id: savedDeviceId })
        } else {
          const created = await createIrDevice(payload)
          const newId = created.device?.id ?? created.id
          setSavedDeviceId(newId)
          // Seed learnedSet from anything the backend already had (defensive).
          setLearnedSet(new Set(created.device?.learned_commands || []))
          logger.action('ir_wizard_device_created', {
            device_id: newId,
            device_type: payload.device_type,
          })
        }
        setStep(3)
      } catch (e) {
        logger.error('ir_wizard_create_failed', e, { device_type: details.device_type })
        setSaveError(e.message || t('wizard.ir.failedCreate'))
      } finally {
        setSaving(false)
      }
      return
    }

    // Step 3 → 4: just advance (device already saved)
    if (step === 3) {
      onCreated?.()
      setStep(4)
      return
    }

    setStep((s) => Math.min(s + 1, TOTAL_STEPS))
  }

  const handleBack = () => setStep((s) => Math.max(s - 1, 1))

  const titles = blasterOnly
    ? [t('wizard.ir.titleStep1'), t('wizard.ir.blasterPairedTitle')]
    : [
        t('wizard.ir.titleStep1'),
        t('wizard.ir.titleStep2'),
        t('wizard.ir.titleStep3'),
        t('wizard.ir.titleStep4'),
      ]

  return (
    <Modal open fullScreen onClose={onClose} title={titles[step - 1]}>
      <StepIndicator step={step} total={totalSteps} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={T_ENTER}
        >
          {step === 1 && (
            <StepSelectBlaster
              deviceMode={!blasterOnly}
              selected={blaster}
              onSelect={(b) => {
                setBlaster(b)
                // Reset the rename input to the new blaster's default name.
                // Use the humanized discovery name as the prefill — already
                // cleaned ("Broadlink RM4 Mini · FC67" instead of "智能遥控").
                setBlasterName(b?.default_name || b?.label || '')
              }}
              blasterName={blasterName ?? ''}
              onBlasterNameChange={setBlasterName}
            />
          )}
          {step === 2 && blasterOnly && (
            <BlasterDone name={blasterName} />
          )}
          {step === 2 && !blasterOnly && (
            <StepDeviceDetails details={details} onChange={setDetails} />
          )}
          {step === 3 && !blasterOnly && (
            <StepLearnCommands
              deviceType={details.device_type}
              deviceId={savedDeviceId}
              learnedSet={learnedSet}
              onLearnedChange={markLearned}
            />
          )}
          {step === 4 && !blasterOnly && <StepDone deviceName={details.name} />}
        </motion.div>
      </AnimatePresence>

      {saveError && <p role="alert" className="mt-3 text-subhead text-err-text">{saveError}</p>}

      <div className="flex items-center justify-between gap-2 mt-6">
        {step > 1 && step < totalSteps ? (
          <Button variant="secondary" onClick={handleBack}>
            <ChevronLeft size={20} strokeWidth={1.75} className="icon-flip-rtl" aria-hidden /> {t('wizard.back')}
          </Button>
        ) : <div />}

        {step < totalSteps ? (
          <Button
            onClick={handleNext}
            disabled={!canNext() || saving}
          >
            {saving ? <Loader2 size={20} className="z-spin" aria-hidden /> : (
              <>
                {step === 2 ? t('wizard.saveContinue') : t('wizard.next')}
                <ChevronRight size={20} strokeWidth={1.75} className="icon-flip-rtl" aria-hidden />
              </>
            )}
          </Button>
        ) : (
          <Button onClick={onClose}>{t('wizard.close')}</Button>
        )}
      </div>
    </Modal>
  )
}
