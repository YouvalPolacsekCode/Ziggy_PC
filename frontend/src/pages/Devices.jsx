import { useEffect, useState, useRef, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, MoreVertical, EyeOff, Eye, Home, ChevronDown, ChevronUp, Plus, Tv2, Thermometer, Wind, Volume2, Zap, Trash2, MonitorPlay, Pencil, ChevronRight, Radio, Sparkles, Check, X, Link2, Unlink, Inbox, WifiOff, Power, Volume1, VolumeX, Snowflake, Flame } from 'lucide-react'
import { T_ENTER, T_STATE } from '../lib/motion'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Button } from '../components/ui/Button'
import { DeviceControls, TOGGLEABLE_DOMAINS, IRRemoteButton, isEntityOn } from '../components/ui/DeviceControls'
import { DeviceRemote as UnifiedDeviceRemote } from '../components/device/DeviceRemote'
import { commandAvailable, getKind, kindMeta, sendDeviceCommand, KIND } from '../lib/devices'
import { DeviceIcon } from '../lib/deviceIcons'
import { EntitySelect } from '../components/ui/EntitySelect'
import { Modal } from '../components/ui/Modal'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { domainIcon, formatEntityState } from '../lib/utils'
import { DOMAIN_GROUPS, domainGroup, groupLabel } from '../lib/domainRegistry'
import { controlDevice, assignEntityToArea, callHaService, getIrDevices, deleteIrDevice, patchIrDevice, irLearn, irSend, irSendChannel, getAllRooms, getIrUnassignedSignals, assignIrUnassignedSignal, dismissIrUnassignedSignal, getIrCatalog, irAddCustomCommand, irRemoveCustomCommand, irSaveSequence, irDeleteSequence, irRunSequence, removeRegistryEntity, deleteSmartSensor, reconcileSmartSensors, listIrBlasters } from '../lib/api'
import { cn, entityDisplayName } from '../lib/utils'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { PairingWizard } from '../components/PairingWizard'
import IRWizard from '../components/IRWizard'
import UnassignedSignalsPanel from '../components/UnassignedSignalsPanel'
import { getRoomPhoto } from '../lib/roomPhotos'
import { useT, useLang, translateNamePhrase } from '../lib/i18n'

function _fmtAgo(isoOrDateStr) {
  if (!isoOrDateStr) return ''
  const d = new Date(isoOrDateStr.replace(' ', 'T'))
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const IR_TYPE_ICONS = {
  tv:        Tv2,
  ac:        Thermometer,
  fan:       Wind,
  soundbar:  Volume2,
  projector: MonitorPlay,
  custom:    Zap,
}

const IR_DEVICE_TYPES = ['tv', 'ac', 'fan', 'soundbar', 'receiver', 'projector', 'custom']

// Master switch for the "N unknown IR signals" header pill. Hidden for now per
// user request — the capture/assign detection and its modal are untouched, so
// flipping this back to true restores the tag with no other changes.
const SHOW_UNKNOWN_IR_TAG = false

// One menu-row recipe for every popover on this page: 44px tall, 17px, full
// width, surface-2 on hover. Colour comes from the caller.
const MENU_ITEM_CLS = 'w-full flex items-center gap-2 px-4 min-h-[44px] text-body text-start hover:bg-surface-2 transition-colors'
// Fixed-position card menus: wide enough for 17px labels + a trailing check.
const MENU_W = 224
// Filter / view-mode chips: 40px tall (the touch/desktop compromise), 15px,
// capsule. Active = surface-2 fill + ink text + line-2 hairline — never
// inverted; count badges sit in surface-3 / ink-mute.
const CHIP_BTN_STYLE = { minHeight: 40, padding: '8px 12px', fontSize: 15, lineHeight: '20px', gap: 6, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }
const CHIP_ACTIVE_STYLE = { background: 'var(--surface-2)', color: 'var(--ink)', borderColor: 'var(--line-2)' }
const CHIP_COUNT_STYLE = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'var(--surface-3)', color: 'var(--ink-mute)', fontSize: 11, fontWeight: 500, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }
// In-card icon target (chevron-to-detail, kebab): a full 44×44 hit area with a
// quiet 18px glyph — no border, so three of them in a card header don't read
// as a toolbar.
const CARD_ICON_BTN_STYLE = {
  width: 44, height: 44, borderRadius: 'var(--r-ctl)', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 0,
}

// Assumed-state chip + picker popover. Splits out of DeviceCard so the
// popover can render with `position: fixed` (anchored via getBoundingClientRect
// off the chip), escaping any ancestor with overflow constraints. The
// previous `absolute top-full` version got clipped on narrow cards because
// the chip's parent flex row didn't always reserve enough vertical space.
function AssumedStatePicker({ irDevice, assumedState, irConfidence, isStale, ageHours, irStateOptions, onIrStateChange, acFacts = [], suffix = null }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0, left: 0 })
  const btnRef  = useRef(null)
  const menuRef = useRef(null)

  const handleOpen = (e) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const menuW = 130
      // Right-edge guard so the popover doesn't overflow the viewport.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8))
      setPos({ top: r.bottom + 4, left })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const h = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  // Chip tone: -text tokens for the words, a 12% tint for the fill. Stale
  // reads as warn, an assumed "on" as ok, "off"/unknown as plain chip.
  const isOnish = !isStale && (assumedState === 'on' || (assumedState && assumedState !== 'off'))
  const chipStyle = isStale
    ? { background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', borderColor: 'color-mix(in srgb, var(--warn) 30%, var(--line))', color: 'var(--warn-text)' }
    : isOnish
    ? { background: 'color-mix(in srgb, var(--ok) 12%, var(--surface))', borderColor: 'color-mix(in srgb, var(--ok) 30%, var(--line))', color: 'var(--ok-text)' }
    : assumedState === 'off'
    ? { color: 'var(--ink-mute)' }
    : { color: 'var(--ink-mute)', borderStyle: 'dashed' }

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title={isStale
          ? t('devices.irAssumedTooltipStale', { hours: Math.round(ageHours) })
          : t('devices.irAssumedTooltipNormal', { confidence: irConfidence })}
        className="z-chip capitalize"
        style={{ ...chipStyle, gap: 4, minHeight: 36, padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
      >
        <span>{assumedState ?? t('common.unknown')}</span>
        {acFacts.length > 0 && (
          <span>· {acFacts.join(' · ')}</span>
        )}
        {suffix && <span>· {suffix}</span>}
        <ChevronDown size={14} strokeWidth={1.75} style={{ flexShrink: 0 }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }} transition={T_ENTER}
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: 180 }}
            className="bg-surface rounded-[16px] shadow-xl border border-line overflow-hidden"
          >
            <p className="z-eyebrow" style={{ padding: '12px 16px 4px' }}>{t('devices.setAssumedState')}</p>
            {irStateOptions.map((s) => (
              <button key={s}
                onClick={() => { onIrStateChange(irDevice.id, s); setOpen(false) }}
                className={cn(MENU_ITEM_CLS, 'capitalize', assumedState === s ? 'text-ink font-semibold' : 'text-ink-2')}
              >
                <span className="flex-1">{s}</span>
                {assumedState === s && <Check size={16} strokeWidth={2} className="text-ink shrink-0" />}
              </button>
            ))}
            <div className="border-t border-line mt-1">
              <button
                onClick={() => { onIrStateChange(irDevice.id, 'unknown'); setOpen(false) }}
                className={cn(MENU_ITEM_CLS, 'text-ink-mute')}
              >{t('devices.clearAssumption')}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Compact horizontal AC stepper for the IR AC card on the Devices page.
// One row: [▼ 28px] [22°] [▲ 28px]. Sits next to the assumed-state chip so
// the card height matches every other card kind. Same chevron + accent
// language as the big stepper on the full ACRemote — just sized to fit
// inline. Each arrow disables when its IR command isn't learned.
function CompactAcStepper({ entity }) {
  const t = useT()
  const addToast = useUIStore.getState().addToast
  const upOk   = commandAvailable(entity, 'temp_up')
  const downOk = commandAvailable(entity, 'temp_down')
  const fire = async (cmd) => {
    try { await sendDeviceCommand(entity, cmd) }
    catch (e) { addToast(e.message || t('devices.commandFailed'), 'error') }
  }
  const memTemp = entity?._irDevice?.ac_memory?.temp ?? null

  const arrow = (enabled, dir, onClick, label) => {
    const Icon = dir === 'up' ? ChevronUp : ChevronDown
    return (
      <button
        onClick={(e) => { e.stopPropagation(); if (enabled) onClick() }}
        disabled={!enabled}
        aria-label={label}
        title={enabled ? label : t('devices.commandNotLearned', { label })}
        style={{
          width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // Quiet secondary control: surface-2 plate, ink glyph. A disabled
          // (unlearned) arrow keeps the plate and goes ink-faint — no opacity
          // on the glyph, the token carries the dimming.
          background: 'var(--surface-2)',
          color: enabled ? 'var(--ink)' : 'var(--ink-faint)',
          border: '0.5px solid var(--line)',
          borderRadius: 'var(--r-ctl)', cursor: enabled ? 'pointer' : 'not-allowed',
          flexShrink: 0,
          padding: 0,
        }}
      >
        <Icon size={18} strokeWidth={2} />
      </button>
    )
  }
  return (
    <div onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      {arrow(downOk, 'down', () => fire('temp_down'), t('devices.cooler'))}
      <span className="z-mono" style={{
        fontSize: 15, color: 'var(--ink)', minWidth: 36, textAlign: 'center', fontWeight: 600,
      }}>
        {memTemp != null ? `${Math.round(memTemp)}°` : '—'}
      </span>
      {arrow(upOk, 'up', () => fire('temp_up'), t('devices.warmer'))}
    </div>
  )
}

const INPUT_CLS = 'z-input'

function CommandRow({ cmd, learned, deviceId, onLearned, onRemove, recentSignal }) {
  const t = useT()
  // cmd: { id, label, core, custom? }
  const [status, setStatus] = useState(learned ? 'learned' : 'idle')
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => { setStatus(learned ? 'learned' : 'idle') }, [learned])

  const startLearn = async () => {
    setStatus('learning')
    setCountdown(20)
    timerRef.current = setInterval(() => setCountdown((c) => { if (c <= 1) { clearInterval(timerRef.current); return 0 } return c - 1 }), 1000)
    try {
      await irLearn(deviceId, cmd.id)
      setStatus('learned')
      onLearned?.()
    } catch { setStatus('error') }
    finally { clearInterval(timerRef.current); setCountdown(0) }
  }

  // Bind the most-recently captured (still-unassigned) IR signal to this slot.
  // Lets the user "just press the remote first, then click here" instead of
  // racing a 20-second learn timer.
  const bindRecent = async () => {
    if (!recentSignal) return
    try {
      await assignIrUnassignedSignal(recentSignal.id, deviceId, cmd.id)
      setStatus('learned')
      onLearned?.()
    } catch { setStatus('error') }
  }

  const test = async () => {
    try { await irSend(deviceId, cmd.id); if (status !== 'learned') setStatus('learned') } catch {}
  }

  useEffect(() => () => clearInterval(timerRef.current), [])

  const dot = status === 'learned' ? 'bg-ok'
    : status === 'error' ? 'bg-err'
    : status === 'learning' ? 'bg-warn animate-pulse'
    : 'bg-line'

  // Text-only row actions (bind / learn / test): 44px tall targets, 15px,
  // ink for the affordance — the accent is not spent on list rows.
  const rowBtn = 'min-h-[44px] px-2 text-subhead font-medium whitespace-nowrap transition-colors'

  return (
    <div className="flex items-center gap-2 min-h-[44px]">
      <div className={cn('w-2 h-2 rounded-full shrink-0', dot)} />
      <span className="flex-1 min-w-0 text-subhead text-ink-2 truncate">
        <span className="font-medium text-ink">{cmd.label}</span>
        {cmd.id !== cmd.label.toLowerCase().replace(/[^a-z0-9]+/g, '_') && (
          <span className="z-code text-ink-mute ms-1" style={{ fontSize: 13 }}>· {cmd.id}</span>
        )}
      </span>
      {recentSignal && status !== 'learned' && status !== 'learning' && (
        <button onClick={bindRecent} className={cn(rowBtn, 'text-ink hover:text-ink-2')} title={t('devices.irEdit.bindRecent')}>
          {t('devices.irEdit.bind')}
        </button>
      )}
      {status === 'learning'
        ? <span className="z-mono text-subhead text-warn-text w-10 text-end">{countdown}s</span>
        : <button onClick={startLearn} className={cn(rowBtn, 'text-ink hover:text-ink-2')}>{status === 'learned' ? t('devices.irEdit.relearn') : t('devices.irEdit.learn')}</button>
      }
      <button onClick={test} disabled={status !== 'learned'} className={cn(rowBtn, 'text-ink-mute hover:text-ink disabled:text-ink-faint')}>{t('devices.irEdit.test')}</button>
      {onRemove && (
        <button onClick={onRemove} style={{ ...CARD_ICON_BTN_STYLE, color: 'var(--err-text)' }} title={t('devices.irEdit.removeCustomTitle')} aria-label={t('devices.irEdit.removeCustomTitle')}>
          <Trash2 size={16} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

function CommandGroup({ group, learnedSet, deviceId, recentSignal, onLearned, onRemoveCustom, showOptional, onToggleShowOptional }) {
  const t = useT()
  const coreCmds   = group.commands.filter((c) => c.core || c.custom)
  const extraCmds  = group.commands.filter((c) => !c.core && !c.custom)
  const hasExtras  = extraCmds.length > 0
  const learnedExtras = extraCmds.filter((c) => learnedSet.has(c.id))
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="z-eyebrow">{group.label}</span>
        {hasExtras && (
          <button onClick={onToggleShowOptional}
            className="min-h-[44px] px-2 text-footnote font-medium text-ink-mute hover:text-ink transition-colors">
            {showOptional
              ? t('devices.irEdit.hideOptional', { n: extraCmds.length })
              : learnedExtras.length
                ? t('devices.irEdit.optionalLearned', { n: extraCmds.length, learned: learnedExtras.length })
                : t('devices.irEdit.optionalCount', { n: extraCmds.length })}
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {coreCmds.map((c) => (
          <CommandRow key={c.id} cmd={c} learned={learnedSet.has(c.id)} deviceId={deviceId}
            recentSignal={recentSignal} onLearned={onLearned}
            onRemove={c.custom ? () => onRemoveCustom?.(c.id) : null} />
        ))}
        {showOptional && extraCmds.map((c) => (
          <CommandRow key={c.id} cmd={c} learned={learnedSet.has(c.id)} deviceId={deviceId}
            recentSignal={recentSignal} onLearned={onLearned} />
        ))}
        {!showOptional && learnedExtras.map((c) => (
          // Always surface learned extras even when group is collapsed — so the
          // user sees what's already wired up without expanding.
          <CommandRow key={c.id} cmd={c} learned={true} deviceId={deviceId}
            recentSignal={recentSignal} onLearned={onLearned} />
        ))}
      </div>
    </div>
  )
}

function UnassignedSignalsBanner({ signals, deviceId, onAssigned, onDismissed }) {
  const t = useT()
  if (!signals?.length) return null
  return (
    <div className="mb-3 p-3 rounded-[10px]" style={{ background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))' }}>
      <p className="text-subhead font-semibold text-ink mb-1">
        {signals.length === 1 ? t('devices.irEdit.recentOne') : t('devices.irEdit.recentMany', { n: signals.length })}
      </p>
      <p className="text-footnote text-warn-text mb-2">
        {t('devices.irEdit.bindHint')}
      </p>
      <div className="flex gap-2 flex-wrap">
        {signals.slice(0, 3).map((s) => (
          <button key={s.id} onClick={() => onDismissed(s.id)}
            className="z-chip z-code" style={{ gap: 4, minHeight: 36, cursor: 'pointer', fontFamily: 'inherit' }}>
            <X size={14} strokeWidth={1.75} /> {s.id.slice(0, 8)}
          </button>
        ))}
      </div>
    </div>
  )
}

function SequenceRow({ seq, deviceId, allCommands, onDeleted }) {
  const t = useT()
  const [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true)
    try { await irRunSequence(deviceId, seq.name) }
    catch {}
    finally { setRunning(false) }
  }
  return (
    <div className="flex items-center gap-2 min-h-[44px]">
      <span className="flex-1 min-w-0 text-subhead text-ink-2 truncate">
        <span className="font-medium text-ink capitalize">{seq.name.replace(/_/g, ' ')}</span>
        <span className="text-footnote text-ink-mute ms-1">· {t('devices.irEdit.stepsLabel', { n: seq.steps.length })}</span>
      </span>
      <button onClick={run} disabled={running}
        className="min-h-[44px] px-2 text-subhead font-medium text-ink hover:text-ink-2 disabled:text-ink-faint transition-colors">
        {running ? '…' : t('devices.irEdit.run')}
      </button>
      <button onClick={() => onDeleted(seq.name)} aria-label={t('devices.irEdit.deleteMacroConfirm', { name: seq.name })}
        style={{ ...CARD_ICON_BTN_STYLE, color: 'var(--err-text)' }}>
        <Trash2 size={16} strokeWidth={1.75} />
      </button>
    </div>
  )
}

function SequenceBuilder({ deviceId, allCommands, onSaved, onCancel }) {
  const t = useT()
  const [name, setName] = useState('')
  const [steps, setSteps] = useState([])
  const [picker, setPicker] = useState(false)
  const addStep = (commandId) => {
    setSteps((s) => [...s, { command: commandId, delay_after_ms: 400 }])
    setPicker(false)
  }
  const save = async () => {
    const seqName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
    if (!seqName || !steps.length) return
    await irSaveSequence(deviceId, seqName, steps)
    onSaved()
  }
  return (
    <div className="mb-3 p-3 rounded-[10px] border border-line bg-surface-2 space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('devices.irEdit.macroNamePlaceholder')} dir="auto"
        className="z-input" />
      <div className="space-y-1">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-subhead min-h-[44px]">
            <span className="z-code flex-1 text-ink-2 truncate" style={{ fontSize: 13 }}>{i + 1}. {s.command}</span>
            <input type="number" value={s.delay_after_ms} min={0} max={10000} step={100}
              onChange={(e) => setSteps((arr) => arr.map((x, j) => j === i ? { ...x, delay_after_ms: Number(e.target.value) || 0 } : x))}
              className="z-input text-end" style={{ width: 88, padding: '8px 12px' }} />
            <span className="text-footnote text-ink-mute">ms</span>
            <button onClick={() => setSteps((arr) => arr.filter((_, j) => j !== i))}
              style={{ ...CARD_ICON_BTN_STYLE, color: 'var(--err-text)' }} aria-label={t('common.remove')}>
              <Trash2 size={16} strokeWidth={1.75} />
            </button>
          </div>
        ))}
      </div>
      <div className="relative">
        <button onClick={() => setPicker((v) => !v)}
          className="z-btn-secondary w-full" style={{ borderStyle: 'dashed' }}>
          {t('devices.irEdit.addStep')}
        </button>
        {picker && (
          <div className="absolute top-full left-0 right-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-[10px] border border-line bg-surface shadow-lg">
            {allCommands.length === 0 && <p className="px-4 py-3 text-subhead text-ink-mute">{t('devices.irEdit.learnSomeFirst')}</p>}
            {allCommands.map((c) => (
              <button key={c.id} onClick={() => addStep(c.id)}
                className={cn(MENU_ITEM_CLS, 'text-ink-2')}>
                <span className="flex-1 truncate">{c.label}</span>
                <span className="z-code text-ink-mute" style={{ fontSize: 13 }}>{c.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="z-btn-secondary">{t('devices.irEdit.cancel')}</button>
        <button onClick={save} disabled={!name.trim() || !steps.length}
          className="z-btn-primary disabled:opacity-40">
          {t('devices.irEdit.saveMacro')}
        </button>
      </div>
    </div>
  )
}

function IREditModal({ device, onClose, onSaved }) {
  const t = useT()
  const [tab, setTab] = useState('details')
  const [form, setForm] = useState({
    name: device.name || '',
    device_type: device.device_type || device.type || 'tv',
    room: device.room || '',
    brand: device.brand || '',
  })
  const [rooms, setRooms] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Live device state — we re-fetch after learn/custom/sequence operations
  // so the modal always reflects current learned_commands.
  const [liveDevice, setLiveDevice] = useState(device)
  const reloadDevice = async () => {
    try {
      const devices = await getIrDevices()
      const fresh = devices.find((d) => d.id === device.id)
      if (fresh) setLiveDevice(fresh)
    } catch {}
  }
  const learnedSet = new Set(liveDevice.learned_commands || [])

  // Catalog for current device type — re-fetched if user changes type.
  const [catalog, setCatalog] = useState(null)
  useEffect(() => {
    getIrCatalog(form.device_type).then(setCatalog).catch(() => setCatalog({ label: form.device_type, groups: [] }))
  }, [form.device_type])

  // Recent IR signals captured by the receive listener that haven't been
  // bound to a command yet. The user clicks ⚡ bind next to a command to
  // assign the newest one without a 20-second learn race.
  const [unassignedSignals, setUnassignedSignals] = useState([])
  const refreshSignals = async () => {
    try { setUnassignedSignals(await getIrUnassignedSignals()) } catch {}
  }
  useEffect(() => { refreshSignals() }, [])
  // Poll periodically while the modal is open so freshly-captured signals
  // appear within a few seconds of the user pressing their physical remote.
  useEffect(() => {
    const t = setInterval(refreshSignals, 3000)
    return () => clearInterval(t)
  }, [])
  const newestSignal = unassignedSignals[0] || null

  // Optional groups expanded state — collapsed by default to keep the UI dense.
  const [expandedGroups, setExpandedGroups] = useState(new Set())
  const toggleGroup = (id) => setExpandedGroups((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Sequences
  const [buildingSeq, setBuildingSeq] = useState(false)

  useEffect(() => {
    getAllRooms().then((r) => setRooms(Array.isArray(r) ? r : r.rooms ?? [])).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    // Idempotent PATCH — retry once so a transient remote-tunnel "upstream
    // error" doesn't fail an edit (incl. room change) that would otherwise apply.
    const payload = {
      name: form.name.trim(),
      device_type: form.device_type,
      room: form.room || null,
      brand: form.brand.trim() || null,
    }
    try {
      try { await patchIrDevice(device.id, payload) }
      catch (first) { await new Promise(r => setTimeout(r, 600)); await patchIrDevice(device.id, payload) }
      onSaved()
    } catch (e) {
      setError(e.message || t('devices.irEdit.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // Merge catalog groups with user-defined custom commands as a synthetic
  // "Custom" group so they get the same row UI (learn / bind / test).
  const customCommands = liveDevice.custom_commands || []
  const catalogGroups = Array.isArray(catalog?.groups) ? catalog.groups : []
  const groups = catalog ? [
    ...catalogGroups,
    ...(customCommands.length > 0 ? [{
      id: 'custom',
      label: t('devices.irEdit.tabCommands'),
      commands: customCommands.map((c) => ({ id: c.id, label: c.label || c.id, core: true, custom: true })),
    }] : []),
  ] : []

  // Flat list of every command across all groups — used by the macro builder
  // step picker. Filter to learned-only so users can't build a macro that
  // references an unlearned slot (and silently fails at runtime).
  const allLearnedCommands = groups.flatMap((g) => g.commands)
    .filter((c) => learnedSet.has(c.id))
    .map((c) => ({ id: c.id, label: c.label }))

  // Sequences
  const sequences = Object.entries(liveDevice.sequences || {}).map(([name, steps]) => ({
    name,
    steps: Array.isArray(steps) ? steps : [],
  }))

  const handleAddCustom = async () => {
    const id = prompt(t('devices.irEdit.addCustomPromptId'))
    if (!id) return
    const label = prompt(t('devices.irEdit.addCustomPromptLabel')) || undefined
    try {
      await irAddCustomCommand(device.id, id, label)
      await reloadDevice()
    } catch (e) { setError(e.message || t('devices.irEdit.addFailed')) }
  }
  const handleRemoveCustom = async (cmdId) => {
    if (!confirm(t('devices.irEdit.removeCustomConfirm', { id: cmdId }))) return
    try { await irRemoveCustomCommand(device.id, cmdId); await reloadDevice() }
    catch (e) { setError(e.message || t('devices.irEdit.removeFailed')) }
  }
  const handleDeleteSequence = async (name) => {
    if (!confirm(t('devices.irEdit.deleteMacroConfirm', { name }))) return
    try { await irDeleteSequence(device.id, name); await reloadDevice() }
    catch (e) { setError(e.message || t('devices.irEdit.deleteFailed')) }
  }
  const handleSequenceSaved = async () => {
    setBuildingSeq(false)
    await reloadDevice()
  }
  const handleSignalDismissed = async (signalId) => {
    try { await dismissIrUnassignedSignal(signalId); await refreshSignals() } catch {}
  }
  const onLearnedRefresh = async () => {
    await reloadDevice()
    await refreshSignals()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface rounded-[16px] shadow-2xl border border-line flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h2 dir="auto" className="z-title3 truncate">{device.name}</h2>
            <p className="z-subhead">{t('devices.commandsLearned', { n: learnedSet.size })}</p>
          </div>
          <button onClick={onClose} className="z-icon-btn" aria-label={t('common.close')}><X size={18} strokeWidth={1.75} /></button>
        </div>

        {/* Tabs — active = surface-2 fill + ink + line-2, never inverted */}
        <div className="flex gap-2 px-5 pb-3 shrink-0">
          {[
            { id: 'details', label: t('devices.irEdit.tabDetails') },
            { id: 'commands', label: t('devices.irEdit.tabCommands') },
            { id: 'macros', label: t('devices.irEdit.tabMacros') },
          ].map((tabDef) => (
            <button key={tabDef.id} onClick={() => setTab(tabDef.id)}
              className={cn('px-3 min-h-[40px] rounded-[10px] text-subhead font-medium transition-colors border',
                tab === tabDef.id ? 'bg-surface-2 text-ink border-line-2' : 'text-ink-mute border-transparent hover:bg-surface-2'
              )}
            >{tabDef.label}{tabDef.id === 'macros' && sequences.length > 0 ? ` (${sequences.length})` : ''}</button>
          ))}
        </div>

        {/* Body */}
        <div className="px-5 pb-2 overflow-y-auto flex-1">
          {tab === 'details' && (
            <div className="space-y-3">
              <div>
                <label className="block text-footnote text-ink-mute mb-1">{t('devices.irEdit.name')}</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} dir="auto" className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-footnote text-ink-mute mb-1">{t('devices.irEdit.type')}</label>
                <div className="flex flex-wrap gap-2">
                  {IR_DEVICE_TYPES.map((dt) => (
                    <button key={dt} onClick={() => setForm({ ...form, device_type: dt })}
                      className={cn('z-chip capitalize transition-colors', form.device_type === dt ? 'font-semibold' : 'hover:bg-surface-3')}
                      style={{
                        minHeight: 36, cursor: 'pointer', fontFamily: 'inherit',
                        ...(form.device_type === dt ? { background: 'var(--surface-3)', color: 'var(--ink)', borderColor: 'var(--line-2)' } : { color: 'var(--ink-mute)' }),
                      }}
                    >{dt}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-footnote text-ink-mute mb-1">{t('devices.irEdit.room')}</label>
                <select value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} className={INPUT_CLS}>
                  <option value="">{t('devices.irEdit.noRoom')}</option>
                  {rooms.map((r) => <option key={r.id ?? r.name} value={r.id ?? r.area_id ?? r.name}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-footnote text-ink-mute mb-1">{t('devices.irEdit.brand')}</label>
                <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder={t('devices.irEdit.brandPlaceholder')} dir="auto" className={INPUT_CLS + ' placeholder:text-ink-mute'} />
              </div>
            </div>
          )}

          {tab === 'commands' && (
            <div>
              <UnassignedSignalsBanner
                signals={unassignedSignals} deviceId={device.id}
                onDismissed={handleSignalDismissed}
              />
              <p className="z-subhead mb-3">
                {t('devices.irEdit.commandsHelp')}
              </p>
              {groups.length === 0 && <p className="z-subhead py-4">{t('devices.irEdit.loadingCatalog')}</p>}
              {groups.map((g) => (
                <CommandGroup
                  key={g.id} group={g} learnedSet={learnedSet} deviceId={device.id}
                  recentSignal={newestSignal} onLearned={onLearnedRefresh}
                  onRemoveCustom={handleRemoveCustom}
                  showOptional={expandedGroups.has(g.id)}
                  onToggleShowOptional={() => toggleGroup(g.id)}
                />
              ))}
              <button onClick={handleAddCustom}
                className="z-btn-secondary w-full mt-2" style={{ borderStyle: 'dashed' }}>
                {t('devices.irEdit.addCustom')}
              </button>
            </div>
          )}

          {tab === 'macros' && (
            <div>
              <p className="z-subhead mb-3">
                {t('devices.irEdit.macrosHelp')}
              </p>
              {sequences.length === 0 && !buildingSeq && (
                <p className="z-subhead py-2">{t('devices.irEdit.noMacros')}</p>
              )}
              {sequences.map((s) => (
                <SequenceRow key={s.name} seq={s} deviceId={device.id}
                  allCommands={allLearnedCommands} onDeleted={handleDeleteSequence} />
              ))}
              {buildingSeq ? (
                <SequenceBuilder deviceId={device.id} allCommands={allLearnedCommands}
                  onSaved={handleSequenceSaved} onCancel={() => setBuildingSeq(false)} />
              ) : (
                <button onClick={() => setBuildingSeq(true)}
                  className="z-btn-secondary w-full mt-2" style={{ borderStyle: 'dashed' }}>
                  {t('devices.irEdit.newMacro')}
                </button>
              )}
            </div>
          )}
        </div>

        {error && <p className="px-5 pb-1 text-subhead text-err-text">{error}</p>}

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-line shrink-0">
          <button onClick={onClose} className="z-btn-secondary">{t('common.close')}</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="z-btn-primary disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('devices.irEdit.saveDetails')}
          </button>
        </div>
      </div>
    </div>
  )
}

const IR_STATE_OPTIONS = {
  default:  ['on', 'off'],
  ac:       ['cool', 'heat', 'fan_only', 'off'],
  fan:      ['on', 'off'],
  tv:       ['on', 'off'],
  soundbar: ['on', 'off'],
  projector:['on', 'off'],
}

// Quick-fire button definitions per device type.
// Each entry: { cmd, icon, label } — icon is a Lucide component (16px);
// only shown when the command is learned.
const IR_QUICK_BUTTONS = {
  tv: [
    { cmd: 'power',       icon: Power,    label: 'Power' },
    { cmd: 'volume_up',   icon: Volume2,  label: 'Vol+' },
    { cmd: 'volume_down', icon: Volume1,  label: 'Vol−' },
    { cmd: 'mute',        icon: VolumeX,  label: 'Mute' },
  ],
  soundbar: [
    { cmd: 'power',       icon: Power,    label: 'Power' },
    { cmd: 'volume_up',   icon: Volume2,  label: 'Vol+' },
    { cmd: 'volume_down', icon: Volume1,  label: 'Vol−' },
    { cmd: 'mute',        icon: VolumeX,  label: 'Mute' },
  ],
  projector: [
    { cmd: 'power',       icon: Power,    label: 'Power' },
  ],
  fan: [
    { cmd: 'power',        icon: Power,   label: 'Power' },
    { cmd: 'speed_low',    icon: Wind,    label: 'Low' },
    { cmd: 'speed_medium', icon: Wind,    label: 'Med' },
    { cmd: 'speed_high',   icon: Wind,    label: 'High' },
  ],
  ac: [
    { cmd: 'power',     icon: Power,      label: 'Power' },
    { cmd: 'mode_cool', icon: Snowflake,  label: 'Cool' },
    { cmd: 'mode_heat', icon: Flame,      label: 'Heat' },
    { cmd: 'mode_fan',  icon: Wind,       label: 'Fan' },
  ],
}
const IR_DEFAULT_QUICK = [{ cmd: 'power', icon: Power, label: 'Power' }]

function IRQuickControls({ device, onCommand }) {
  const t = useT()
  const dtype   = device.device_type || device.type || ''
  const learned = new Set(device.learned_commands || [])
  const cmds    = device.commands || {}

  const canDo = (cmd) => cmd in cmds && learned.has(cmd)

  // Map raw English labels in the IR_QUICK_BUTTONS const to translation keys.
  const labelKey = (label) => {
    switch (label) {
      case 'Power': return t('devices.irQuick.power')
      case 'Vol+':  return t('devices.irQuick.volUp')
      case 'Vol−':  return t('devices.irQuick.volDown')
      case 'Mute':  return t('devices.irQuick.mute')
      case 'Low':   return t('devices.irQuick.low')
      case 'Med':   return t('devices.irQuick.med')
      case 'High':  return t('devices.irQuick.high')
      case 'Cool':  return t('devices.irQuick.cool')
      case 'Heat':  return t('devices.irQuick.heat')
      case 'Fan':   return t('devices.irQuick.fan')
      default:      return label
    }
  }

  const buttons = (IR_QUICK_BUTTONS[dtype] || IR_DEFAULT_QUICK).filter((b) => canDo(b.cmd))
  if (buttons.length === 0) return null

  return (
    <div className="mt-3 pt-3 border-t border-line flex gap-2 flex-wrap">
      {buttons.map(({ cmd, icon: Icon, label }) => {
        const localized = labelKey(label)
        return (
          <button
            key={cmd}
            onClick={() => onCommand(device.id, cmd)}
            title={localized}
            className="z-chip hover:bg-surface-3 transition-colors"
            style={{ minHeight: 36, gap: 6, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Icon size={16} strokeWidth={1.75} />
            <span>{localized}</span>
          </button>
        )
      })}
    </div>
  )
}

function IRDeviceCard({ device, onDelete, onEdit, onStateChange, onCommand }) {
  const t = useT()
  const Icon = IR_TYPE_ICONS[device.device_type ?? device.type] || Zap
  const learnedCount = (device.learned_commands || []).length
  const totalCount = Object.keys(device.commands || {}).length
  const room = (device.room || '').replace(/_/g, ' ')
  const [showStatePicker, setShowStatePicker] = useState(false)

  // Universal state engine — derives values + confidence band from the
  // canonical device.state record. Falls back to legacy fields when the
  // record is missing (devices migrated server-side before this client
  // refresh). The confidence band drives the live/estimated/stale UX
  // distinction; without it the card can't tell if the AC card's "24°C
  // cool" is "I just confirmed this from the physical remote" or "I sent
  // this command 3 days ago and have no idea what the AC is doing now".
  const stateRec = device.state || {}
  const stateValues = stateRec.values || {}
  const confidence = (() => {
    const live = stateRec.live_at
    const est = stateRec.estimated_at
    if (!live && !est) return 'unknown'
    const now = Date.now() / 1000
    if (live && now - live <= 30) return 'live'
    if (est && now - est <= 6 * 3600) return 'estimated'
    if (live && now - live <= 6 * 3600) return 'estimated'
    return 'stale'
  })()

  const assumedState = (() => {
    if (typeof stateValues.power === 'boolean') {
      return stateValues.power ? 'on' : 'off'
    }
    return device.assumed_state && device.assumed_state !== 'unknown'
      ? device.assumed_state : null
  })()
  const stateOptions = IR_STATE_OPTIONS[device.device_type ?? device.type] || IR_STATE_OPTIONS.default

  // Per-device-class state facts surfaced inline on the chip. Generic over
  // template — AC shows temp/mode/fan; TV shows volume/muted; streamer
  // shows playing/app; STB shows channel; soundbar shows volume/muted.
  const isAc = (device.device_type ?? device.type) === 'ac'
  const acMemory = isAc ? (device.ac_memory || {}) : null
  const stateFacts = []
  if (stateValues.temp != null) stateFacts.push(`${stateValues.temp}°C`)
  else if (acMemory?.temp != null) stateFacts.push(`${acMemory.temp}°C`)
  if (stateValues.mode) stateFacts.push(String(stateValues.mode).toLowerCase())
  else if (acMemory?.mode) stateFacts.push(String(acMemory.mode).toLowerCase())
  if (stateValues.fan && !stateValues.fan.toString().includes('auto')) {
    stateFacts.push(`fan ${String(stateValues.fan).toLowerCase()}`)
  } else if (acMemory?.fan) stateFacts.push(`fan ${String(acMemory.fan).toLowerCase()}`)
  if (stateValues.volume != null) stateFacts.push(`vol ${stateValues.volume}`)
  if (stateValues.muted === true) stateFacts.push(t('common.muted') || 'muted')
  if (stateValues.channel != null && (device.device_type === 'stb' || stateRec.template === 'stb')) {
    stateFacts.push(`ch ${stateValues.channel}`)
  }
  if (stateValues.playing === true) stateFacts.push(t('entitySelect.action.media_play').toLowerCase())
  // Keep AC's legacy chip-suffix alias name so the rest of the component
  // (which still reads acFacts) doesn't change shape.
  const acFacts = stateFacts

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-3 min-w-0">
        <div style={{ width: 44, height: 44, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={22} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p dir="auto" className="z-headline truncate">{device.name}</p>
          {room && <p dir="auto" className="z-subhead capitalize">{room}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="z-footnote">{t('devices.commandsCount', { learned: learnedCount, total: totalCount })}</span>
            {/* Interactive assumed-state chip — surfaces decoded values
                from physical-remote packets (AC: temp/mode/fan; TV: volume,
                muted; streamer: playing; STB: channel) plus a confidence
                indicator: pulsing green dot for 'live' (RX-confirmed in the
                last 30s), amber dot for 'estimated' (Ziggy command or older
                RX), no dot for 'unknown'/'stale'. The dot is what lets the
                user see at a glance that Ziggy actually heard the physical
                remote press they just made. */}
            <div className="relative">
              <button
                onClick={() => setShowStatePicker((v) => !v)}
                title={t('devices.irAssumedTooltipPlain')}
                className="z-chip capitalize"
                style={{
                  gap: 6, minHeight: 36, padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit',
                  ...(assumedState === 'on' || (assumedState && assumedState !== 'off')
                    ? { background: 'color-mix(in srgb, var(--ok) 12%, var(--surface))', borderColor: 'color-mix(in srgb, var(--ok) 30%, var(--line))', color: 'var(--ok-text)' }
                    : assumedState === 'off'
                    ? { color: 'var(--ink-mute)' }
                    : { color: 'var(--ink-mute)', borderStyle: 'dashed' }),
                }}
              >
                {/* Confidence dot: 8px; live pulses (the one meaningful loop). */}
                {confidence === 'live' && (
                  <span
                    title="Live: physical-remote press confirmed in the last 30s"
                    className="inline-block w-2 h-2 rounded-full bg-ok animate-pulse"
                  />
                )}
                {confidence === 'estimated' && (
                  <span
                    title="Estimated: from Ziggy's last command (no recent RX)"
                    className="inline-block w-2 h-2 rounded-full bg-warn"
                  />
                )}
                {confidence === 'stale' && (
                  <span
                    title="Stale: no observation for hours"
                    className="inline-block w-2 h-2 rounded-full bg-ink-faint"
                  />
                )}
                <span>{assumedState ?? t('common.unknown')}</span>
                {acFacts.length > 0 && (
                  <span>· {acFacts.join(' · ')}</span>
                )}
                <span>{t('devices.assumedSuffix')}</span>
                <ChevronDown size={14} strokeWidth={1.75} style={{ flexShrink: 0 }} />
              </button>
              <AnimatePresence>
                {showStatePicker && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: -4 }}
                    transition={T_ENTER}
                    className="absolute bottom-full left-0 mb-1 z-50 bg-surface rounded-[16px] shadow-xl border border-line overflow-hidden min-w-[180px]"
                  >
                    <p className="z-eyebrow" style={{ padding: '12px 16px 4px' }}>{t('devices.setAssumedState')}</p>
                    {stateOptions.map((s) => (
                      <button
                        key={s}
                        onClick={() => { onStateChange(device.id, s); setShowStatePicker(false) }}
                        className={cn(MENU_ITEM_CLS, 'capitalize', assumedState === s ? 'text-ink font-semibold' : 'text-ink-2')}
                      >
                        <span className="flex-1">{s}</span>
                        {assumedState === s && <Check size={16} strokeWidth={2} className="text-ink shrink-0" />}
                      </button>
                    ))}
                    <div className="border-t border-line mt-1 pt-1 pb-1">
                      <button
                        onClick={() => { onStateChange(device.id, 'unknown'); setShowStatePicker(false) }}
                        className={cn(MENU_ITEM_CLS, 'text-ink-mute')}
                      >
                        {t('devices.clearAssumption')}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center shrink-0">
        <button
          onClick={() => onEdit(device)}
          style={CARD_ICON_BTN_STYLE}
          className="hover:bg-surface-2 transition-colors"
          title={t('devices.editIrDevice')}
          aria-label={t('devices.editIrDevice')}
        >
          <Pencil size={18} strokeWidth={1.75} />
        </button>
        <button
          onClick={() => onDelete(device.id)}
          style={{ ...CARD_ICON_BTN_STYLE, color: 'var(--err-text)' }}
          className="hover:bg-surface-2 transition-colors"
          title={t('devices.removeIrDevice')}
          aria-label={t('devices.removeIrDevice')}
        >
          <Trash2 size={18} strokeWidth={1.75} />
        </button>
      </div>
      </div>
      <IRQuickControls device={device} onCommand={onCommand} />
    </Card>
  )
}

// Status-based filter chips — always visible regardless of device inventory.
// Labels are resolved at render time via useT() in the page component so
// they react to the active language. Icons are Lucide components (16px),
// rendered by the chip row — never emoji.
function buildStatusFilters(t) {
  return [
    { id: 'all',           label: t('devices.filterAll') },
    { id: 'unassigned',    label: t('devices.filterUnassigned'),   icon: Inbox },
    { id: 'noroom',        label: t('devices.filterNoRoom'),       icon: Home },
    { id: 'offline',       label: t('devices.filterOffline'),      icon: WifiOff },
    { id: 'active',        label: t('devices.filterActive'),       icon: Power },
    { id: 'connected',     label: t('devices.filterConnected'),    icon: Link2 },
    { id: 'ir',            label: t('devices.filterIr'),           icon: Radio },
    { id: 'smart_sensors', label: t('devices.filterSmartSensors'), icon: Sparkles },
  ]
}

// Build domain-group chips from the live entity list — only include groups that have
// at least one entity present. Called inside the component so it reacts to store updates.
function buildGroupFilters(entities, irEntities) {
  const occupiedGroups = new Set()
  for (const e of entities) {
    const g = domainGroup(e)
    if (g && g !== 'other') occupiedGroups.add(g)
  }
  if (irEntities?.length) occupiedGroups.add('ir')
  return DOMAIN_GROUPS
    .filter((g) => g.id !== 'other' && occupiedGroups.has(g.id))
    .map((g) => ({ id: g.id, label: groupLabel(g.id), isGroup: true }))
}

// DOMAIN_GROUPS and domainGroup are now imported from domainRegistry.js.
// Adding a new HA domain there automatically updates grouping here.
// (DOMAIN_GROUPS and domainGroup imported at top of file)

// ── Smart Sensor card ─────────────────────────────────────────────────────────
// Ziggy-created template helpers (currently: occupancy sensors fused from
// multiple physical motion/contact sensors by Pro Mode). These are NOT bought
// hardware — visual treatment leans friendly + accent-tinted to telegraph
// "Ziggy made this" without exposing HA entity_ids to the end user.
//
// Live state comes from the same enriched-entity record the rest of the page
// consumes (HA → /api/ha/entities → store.entities). The Ziggy-only metadata
// (origin, ziggy_sources, friendly source names) is attached by the page
// before render — see `smartSensorEntries` in the Devices component.
function SmartSensorCard({ entity, lang }) {
  const t = useT()
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const menuRef = useRef(null)

  const entryId = entity._ziggyEntryId || null
  // Same resolver the detail page uses — display_name → friendly_name →
  // humanized slug. Never the raw entity_id (Bug: presence device showed
  // "binary_sensor.bedroom_occupied" in the list, "Bedroom Occupied" in detail).
  const displayName = entityDisplayName(entity)

  const handleDelete = async () => {
    if (!entryId || deleting) return
    setDeleting(true)
    try {
      await deleteSmartSensor(entryId)
      setConfirmOpen(false)
      useUIStore.getState().addToast(t('devices.smartSensor.deleted', { name: displayName }), 'success')
      // Rebuild devices + entities so the card disappears immediately.
      await useDeviceStore.getState().fetchAll?.({ force: true })
    } catch (e) {
      useUIStore.getState().addToast(t('devices.smartSensor.deleteFailed'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  // Live state pill — for occupancy-style binary sensors, "on" == occupied.
  // Anything else (off/unknown/unavailable) treats as "clear" so the pill
  // never lies about presence when HA momentarily reports unavailable.
  const isOccupied = entity.state === 'on'
  const isUnavailable = entity.state === 'unavailable' || entity.state === 'unknown'

  const sources = Array.isArray(entity._ziggySources) ? entity._ziggySources : []
  const sourceLabels = Array.isArray(entity._ziggySourceLabels) ? entity._ziggySourceLabels : []

  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const roomLabel = entity._roomName
    ? translateNamePhrase(entity._roomName, lang)
    : (entity.room || '').replace(/_/g, ' ')

  return (
    <motion.div layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={T_ENTER}
    >
      {/* Plain card — the Sparkles plate is what says "Ziggy made this";
          the card no longer wears an accent tint. */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div style={{
            width: 44, height: 44, borderRadius: 'var(--r-ctl)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-2)',
            color: 'var(--ink-2)',
            flexShrink: 0,
          }}>
            <Sparkles size={22} strokeWidth={1.75} />
          </div>
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              style={CARD_ICON_BTN_STYLE}
              className="hover:bg-surface-2 transition-colors"
              aria-label={t('common.more')}
            >
              <MoreVertical size={18} strokeWidth={1.75} />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: -4 }}
                  transition={T_ENTER}
                  style={{ position: 'absolute', top: '100%', insetInlineEnd: 0, marginTop: 4, zIndex: 50, minWidth: 224 }}
                  className="bg-surface rounded-[16px] shadow-2xl border border-line overflow-hidden py-1"
                >
                  <button
                    onClick={() => { setSourcesOpen(true); setMenuOpen(false) }}
                    className={cn(MENU_ITEM_CLS, 'text-ink-2')}
                  >
                    <Eye size={16} strokeWidth={1.75} /> {t('devices.smartSensor.viewSources')}
                  </button>
                  {/* Delete — removes the fused HA template helper AND clears
                      Ziggy's KV record so it doesn't reappear on reload. Only
                      offered when we hold the entry_id (older KV records without
                      one can't be targeted). */}
                  {entryId && (
                    <button
                      onClick={() => { setConfirmOpen(true); setMenuOpen(false) }}
                      className={cn(MENU_ITEM_CLS, 'text-err-text')}
                    >
                      <Trash2 size={16} strokeWidth={1.75} /> {t('devices.smartSensor.delete')}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <p dir="auto" className="z-headline truncate">
          {entityDisplayName(entity)}
        </p>

        <p dir="auto" className="z-subhead mb-2">
          {t('devices.smartSensor.subtitle', { n: sources.length })}
          {roomLabel && (
            <> · <span className="capitalize">{roomLabel}</span></>
          )}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="z-chip" style={{
            gap: 8, fontWeight: 600,
            background: isOccupied && !isUnavailable
              ? 'color-mix(in srgb, var(--ok) 12%, var(--surface))'
              : 'var(--surface-2)',
            color: isUnavailable
              ? 'var(--ink-faint)'
              : isOccupied ? 'var(--ok-text)' : 'var(--ink-mute)',
            borderColor: isOccupied && !isUnavailable
              ? 'color-mix(in srgb, var(--ok) 30%, var(--line))'
              : 'var(--line)',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isUnavailable ? 'var(--ink-faint)' : isOccupied ? 'var(--ok)' : 'var(--ink-mute)',
            }} />
            {isOccupied
              ? t('devices.smartSensor.statusOccupied')
              : t('devices.smartSensor.statusClear')}
          </span>
        </div>

        {/* Source-sensor reveal — friendly names only, never raw entity_ids.
            Falls back to a count if no friendly names were available from the
            HA entity registry. */}
        <AnimatePresence initial={false}>
          {sourcesOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={T_STATE}
              style={{ overflow: 'hidden' }}
            >
              <div style={{
                marginTop: 12, paddingTop: 12,
                borderTop: '0.5px solid var(--line)',
              }}>
                <p className="z-eyebrow mb-2">
                  {t('devices.smartSensor.sourcesTitle')}
                </p>
                {sourceLabels.length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sourceLabels.map((label, i) => (
                      <li key={i} dir="auto" style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 15, lineHeight: '20px', color: 'var(--ink-2)',
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink-faint)', flexShrink: 0 }} />
                        <span className="truncate">{label}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="z-subhead">
                    {t('devices.smartSensor.subtitle', { n: sources.length })}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Delete confirmation — smart sensors are user-visible automations, so a
          double-confirm avoids an accidental teardown of a fused room sensor. */}
      <Modal
        open={confirmOpen}
        onClose={() => { if (!deleting) setConfirmOpen(false) }}
        title={t('devices.smartSensor.deleteTitle')}
        maxWidth={420}
      >
        <p dir="auto" className="text-subhead text-ink-2 leading-relaxed mb-4">
          {t('devices.smartSensor.deleteBody', { name: displayName })}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? t('common.deleting') : t('devices.smartSensor.delete')}
          </Button>
        </div>
      </Modal>
    </motion.div>
  )
}

// True if the registry-side device record marks this row as a Ziggy-created
// smart sensor (template helper). Either marker is sufficient — `status` is
// the runtime state, `origin` is the provenance tag.
function _isSmartSensorRecord(d) {
  return (
    d?.status === 'smart_sensor' ||
    d?.origin === 'ziggy_template' ||
    d?.device_type === 'smart_sensor'
  )
}

// ── Collapsible group header ───────────────────────────────────────────────────
function CollapsibleGroup({ label, count, open, onToggle, children, action, room, onRoomClick }) {
  const t = useT()
  const photo = room ? getRoomPhoto(room) : null
  return (
    <div style={{ marginBottom: 20 }}>
      {/* Section header: 32px room tile (photo, or a plain surface-2 square
          with a line Home glyph when no photo was chosen), 17/600 label,
          13px count, 18px chevron. The whole label row is the toggle target. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 4px 8px', minHeight: 52 }}>
        {room && (
          photo ? (
            <div style={{ width: 32, height: 32, borderRadius: 'var(--r-ctl)', overflow: 'hidden', background: 'var(--surface-2)', flexShrink: 0 }}>
              <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ) : (
            <div className="z-room-plain" style={{ width: 32, height: 32, borderRadius: 'var(--r-ctl)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)', flexShrink: 0 }}>
              <Home size={18} strokeWidth={1.75} />
            </div>
          )
        )}
        <button onClick={onToggle} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, minHeight: 44, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'start', fontFamily: 'inherit' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span dir="auto" style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
            {count != null && <span className="z-mono" style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ink-mute)' }}>{count === 1 ? t('devices.deviceCountOne') : t('devices.deviceCountMany', { n: count })}</span>}
          </div>
          <span style={{ color: 'var(--ink-mute)', display: 'inline-flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)', flexShrink: 0 }}>
            <ChevronDown size={18} strokeWidth={1.75} />
          </span>
        </button>
        {onRoomClick && (
          <button onClick={onRoomClick} style={{ minHeight: 44, padding: '0 8px', borderRadius: 'var(--r-ctl)', background: 'transparent', border: 'none', fontSize: 15, fontWeight: 500, color: 'var(--ink-mute)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}>
            {t('devices.openRoom')}
            <ChevronRight size={16} strokeWidth={1.75} className="icon-flip-rtl" />
          </button>
        )}
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T_STATE} style={{ overflow: 'hidden' }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Assign-to-room inline dropdown ──────────────────────────────────────────
function AssignRoomDropdown({ entityId, rooms, onAssign }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="relative mt-3">
      {/* Secondary button, full width — the card's toggle stays the only
          strong control. */}
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        aria-expanded={open}
        className="z-btn-secondary"
        style={{ width: '100%', justifyContent: 'space-between', fontSize: 15, fontWeight: 500 }}
      >
        <span>{t('devices.assignToRoom')}</span>
        <ChevronDown size={16} strokeWidth={1.75} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)' }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={T_ENTER}
            style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4, zIndex: 50, background: 'var(--surface)', borderRadius: 'var(--r-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '0.5px solid var(--line)', overflow: 'hidden' }}
          >
            <div style={{ padding: '4px 0', maxHeight: 264, overflowY: 'auto' }}>
              <button onClick={() => { onAssign(entityId, null); setOpen(false) }}
                className={cn(MENU_ITEM_CLS, 'text-ink-mute border-b border-line')}
              >
                <Home size={16} strokeWidth={1.75} style={{ flexShrink: 0 }} />
                {t('devices.noRoom')}
              </button>
              {rooms.map(r => (
                <button key={r.id} onClick={() => { onAssign(entityId, r.id); setOpen(false) }}
                  className={cn(MENU_ITEM_CLS, 'text-ink-2')}
                >
                  <span dir="auto" className="truncate">{r.name}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Per-card "…" context menu ─────────────────────────────────────────────────
function DeviceMenu({ entity, rooms, onHide, onUnhide, isHidden, onAssign, extraItems = [] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: undefined, right: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const currentRoom = rooms.find((r) => (r.entities || []).includes(entity.entity_id))

  const NAV_HEIGHT = 64

  const handleOpen = (e) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const menuW = MENU_W
      // Subtract navbar height so menu never hides behind it
      const spaceBelow = window.innerHeight - rect.bottom - NAV_HEIGHT
      const wouldClipLeft = rect.right - menuW < 0
      setMenuPos({
        top:    spaceBelow >= 260 ? rect.bottom + 4 : undefined,
        bottom: spaceBelow  < 260 ? window.innerHeight - rect.top + 4 : undefined,
        left:  wouldClipLeft ? rect.left : undefined,
        right: wouldClipLeft ? undefined : window.innerWidth - rect.right,
      })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const h = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close()
    }
    document.addEventListener('mousedown', h)
    // Close on any scroll so the fixed menu doesn't drift from its trigger
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  return (
    <div>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={CARD_ICON_BTN_STYLE}
        className="hover:bg-surface-2 transition-colors"
        aria-label={t('common.more')}
        aria-expanded={open}
      >
        <MoreVertical size={18} strokeWidth={1.75} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, zIndex: 9999, width: MENU_W }}
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={T_ENTER}
            className="bg-surface rounded-[16px] shadow-2xl border border-line overflow-hidden"
          >
            <div className="py-1">
              {currentRoom && (
                <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-ok shrink-0" />
                  <span className="text-subhead text-ink-2 font-medium truncate" dir="auto">{currentRoom.name}</span>
                </div>
              )}
              <p className="z-eyebrow px-4 pt-2 pb-1">
                {t('devices.assignToRoom')}
              </p>
              <button
                onClick={() => { onAssign(entity.entity_id, null); setOpen(false) }}
                className={cn(MENU_ITEM_CLS, !currentRoom ? 'text-ink font-semibold' : 'text-ink-mute')}
              >
                <Home size={16} strokeWidth={1.75} className="shrink-0" />
                <span className="flex-1">{t('devices.noRoom')}</span>
                {!currentRoom && <Check size={16} strokeWidth={2} className="text-ink shrink-0" />}
              </button>
              {rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { onAssign(entity.entity_id, r.id); setOpen(false) }}
                  className={cn(MENU_ITEM_CLS, currentRoom?.id === r.id ? 'text-ink font-semibold' : 'text-ink-2')}
                >
                  <span dir="auto" className="flex-1 truncate">{r.name}</span>
                  {currentRoom?.id === r.id && <Check size={16} strokeWidth={2} className="text-ink shrink-0" />}
                </button>
              ))}
              <div className="border-t border-line mt-1 pt-1">
                <button
                  onClick={() => {
                    isHidden ? onUnhide(entity.entity_id) : onHide(entity.entity_id)
                    setOpen(false)
                  }}
                  className={cn(MENU_ITEM_CLS, 'text-ink-mute')}
                >
                  {isHidden
                    ? <><Eye size={16} strokeWidth={1.75} /> {t('devices.showDevice')}</>
                    : <><EyeOff size={16} strokeWidth={1.75} /> {t('devices.hideDevice')}</>
                  }
                </button>
                {extraItems.map((item, i) => (
                  <button key={i} onClick={() => { item.onClick(); setOpen(false) }}
                    className={cn(MENU_ITEM_CLS, item.className || 'text-ink-2')}
                  >
                    {item.icon} {item.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Link IR device to a Wi-Fi/HA entity ──────────────────────────────────────
// Maps IR device type → HA domain for the entity picker filter
const IR_TYPE_TO_DOMAIN_FE = {
  tv: 'media_player', soundbar: 'media_player', projector: 'media_player',
  ac: 'climate', fan: 'fan', custom: 'switch',
}

function LinkIrModal({ irDevice, open, onClose, onLink }) {
  const t = useT()
  const [entityId, setEntityId] = useState('')
  const domain = IR_TYPE_TO_DOMAIN_FE[irDevice?.type] || 'media_player'

  return (
    <Modal open={open} onClose={() => { setEntityId(''); onClose() }} title={t('devices.linkModalTitle', { name: irDevice?.name || '' })}>
      <p className="text-footnote text-ink-mute mb-4 -mt-1 leading-relaxed">
        {t('devices.linkModalDescription')}
      </p>
      <EntitySelect
        domain={domain}
        value={entityId}
        onChange={setEntityId}
        placeholder={t('devices.linkModalEntityPlaceholder', { domain: domain.replace('_', ' ') })}
        label={t('devices.linkModalEntityLabel')}
      />
      <div className="flex gap-2 mt-4">
        <Button variant="secondary" onClick={() => { setEntityId(''); onClose() }} className="flex-1">{t('common.cancel')}</Button>
        <Button onClick={() => { onLink(entityId); setEntityId('') }} disabled={!entityId} className="flex-1">
          {t('devices.linkDevices')}
        </Button>
      </div>
    </Modal>
  )
}

// ── Shared status constants ───────────────────────────────────────────────────
const STATUS_DOT = {
  lost:         'bg-err',
  unclaimed:    'bg-warn',
  unconfigured: 'bg-line',
  connected:    'bg-ok',
}
function getStatusLabel(t, status) {
  switch (status) {
    case 'lost':         return t('devices.statusLost')
    case 'unclaimed':    return t('devices.statusUnclaimed')
    case 'unconfigured': return t('devices.statusUnconfigured')
    default:             return null
  }
}

// Normalize a room display name to the slug IR manager uses (matches backend _norm_room_key)
function normRoomSlug(name) {
  return name.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

// ── IR card context menu ──────────────────────────────────────────────────────
// Uses fixed positioning so it never gets clipped by card/grid overflow.
function IRCardMenu({ irDevice, rooms, onEdit, onDelete, onAssign, onLinkToWifi, onUnlinkFromWifi }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const NAV_HEIGHT_IR = 64

  const handleOpen = (e) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const menuW = MENU_W
      const spaceBelow = window.innerHeight - rect.bottom - NAV_HEIGHT_IR
      const wouldClipLeft = rect.right - menuW < 0
      setMenuPos({
        top:    spaceBelow >= 300 ? rect.bottom + 4 : undefined,
        bottom: spaceBelow  < 300 ? window.innerHeight - rect.top + 4 : undefined,
        left:  wouldClipLeft ? rect.left : undefined,
        right: wouldClipLeft ? undefined : window.innerWidth - rect.right,
      })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const h = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  const currentRoomSlug = irDevice?.room || ''
  const currentRoom = rooms.find((r) => normRoomSlug(r.name) === currentRoomSlug)

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={CARD_ICON_BTN_STYLE}
        className="hover:bg-surface-2 transition-colors"
        aria-label={t('common.more')}
        aria-expanded={open}
      >
        <MoreVertical size={18} strokeWidth={1.75} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, zIndex: 9999, width: MENU_W }}
            initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }} transition={T_ENTER}
            className="bg-surface rounded-[16px] shadow-2xl border border-line overflow-hidden"
          >
            <div className="py-1">
              {currentRoom && (
                <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-ok shrink-0" />
                  <span className="text-subhead text-ink-2 font-medium truncate" dir="auto">{currentRoom.name}</span>
                </div>
              )}
              <p className="z-eyebrow px-4 pt-2 pb-1">{t('devices.assignToRoom')}</p>
              <button onClick={() => { onAssign(null); setOpen(false) }}
                className={cn(MENU_ITEM_CLS, !currentRoom ? 'text-ink font-semibold' : 'text-ink-mute')}
              >
                <Home size={16} strokeWidth={1.75} className="shrink-0" />
                <span className="flex-1">{t('devices.noRoom')}</span>
                {!currentRoom && <Check size={16} strokeWidth={2} className="text-ink shrink-0" />}
              </button>
              {rooms.map((r) => (
                <button key={r.id} onClick={() => { onAssign(r.id); setOpen(false) }}
                  className={cn(MENU_ITEM_CLS, currentRoom?.id === r.id ? 'text-ink font-semibold' : 'text-ink-2')}
                >
                  <span dir="auto" className="flex-1 truncate">{r.name}</span>
                  {currentRoom?.id === r.id && <Check size={16} strokeWidth={2} className="text-ink shrink-0" />}
                </button>
              ))}
              <div className="border-t border-line mt-1 pt-1">
                <button onClick={() => { onEdit(); setOpen(false) }}
                  className={cn(MENU_ITEM_CLS, 'text-ink-2')}
                >
                  <Pencil size={16} strokeWidth={1.75} /> {t('devices.editIrDevice')}
                </button>
                {irDevice?.ha_entity_id ? (
                  <button onClick={() => { onUnlinkFromWifi?.(); setOpen(false) }}
                    className={cn(MENU_ITEM_CLS, 'text-ink-2')}
                  >
                    <Unlink size={16} strokeWidth={1.75} /> {t('devices.unlinkFromWifi')}
                  </button>
                ) : (
                  <button onClick={() => { onLinkToWifi?.(); setOpen(false) }}
                    className={cn(MENU_ITEM_CLS, 'text-ink-2')}
                  >
                    <Link2 size={16} strokeWidth={1.75} /> {t('devices.linkToWifi')}
                  </button>
                )}
                <button onClick={() => { onDelete(); setOpen(false) }}
                  className={cn(MENU_ITEM_CLS, 'text-err-text')}
                >
                  <Trash2 size={16} strokeWidth={1.75} /> {t('common.remove')}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Device card ───────────────────────────────────────────────────────────────
const IR_STATE_OPTIONS_MAP = {
  ac:      ['cool', 'heat', 'fan_only', 'off'],
  default: ['on', 'off'],
}

const DeviceCard = forwardRef(function DeviceCard({
  entity, rooms, onToggle, onService, onHide, onUnhide, onAssign,
  onIrCommand, onIrChannel, onIrStateChange, onEditIr, onDeleteIr,
  onLinkIr, onUnlinkIr,
  isHidden, showAssign, ziggyStatus,
}, ref) {
  const t = useT()
  const navigate = useNavigate()
  const isIr = entity._ir === true
  const irDevice = entity._irDevice
  const linkedIr = entity._linkedIr || null  // IR device linked to this HA entity

  const isOn = isEntityOn(entity)
  const isOff = entity.state === 'off' || entity.state === 'unavailable' || entity.state === 'unknown'
  const isToggleable = !isIr && TOGGLEABLE_DOMAINS.has(entity.domain) && entity.state !== 'unavailable'
  const { primary: stateLabel, secondary: stateSecondary } = (!isIr && !isHidden)
    ? formatEntityState(entity)
    : { primary: isHidden ? t('devices.hidden') : '', secondary: null }
  const isActive = !isOff
  const statusBadgeLabel = !isIr && !linkedIr && ziggyStatus && ziggyStatus !== 'connected' ? getStatusLabel(t, ziggyStatus) : null
  const showStatusBadge = !!statusBadgeLabel

  // Controls collapsed by default — expand on demand
  const [controlsExpanded, setControlsExpanded] = useState(false)

  // IR assumed-state picker — popover state lives inside AssumedStatePicker now.
  const irStateOptions = IR_STATE_OPTIONS_MAP[irDevice?.type] || IR_STATE_OPTIONS_MAP.default
  const assumedState = irDevice?.assumed_state && irDevice.assumed_state !== 'unknown' ? irDevice.assumed_state : null
  // Stale check: if we assumed 'on' but the last IR activity was hours ago and
  // no real-state link exists, downgrade confidence — the assumption may be wrong.
  const STALE_AFTER_HOURS = 4
  const lastActivityIso = irDevice?.assumed_state_at || irDevice?.last_command_sent_at
  const ageHours = lastActivityIso
    ? (Date.now() - new Date(String(lastActivityIso).replace(' ', 'T')).getTime()) / 3_600_000
    : Infinity
  const isStale = assumedState === 'on' && !irDevice?.ha_entity_id && ageHours > STALE_AFTER_HOURS
  // State confidence: confirmed (has HA entity link), estimated (we sent a command), unknown (no info)
  const irConfidence = irDevice?.ha_entity_id ? 'confirmed'
    : isStale ? 'stale'
    : (assumedState != null) ? 'estimated'
    : 'unknown'

  // The card's kind decides whether a "Show controls" footer exists at all.
  // IR: any controllable kind. HA: controllable, visible, and reachable.
  const isControllableKind = kindMeta(getKind(entity)).controllable
  const showsExpander = isIr
    ? isControllableKind
    : (!isHidden && isControllableKind && entity.state !== 'unavailable')
  const irLabel = t('deviceCard.irBadge')

  return (
    <motion.div
      ref={ref} layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: isHidden ? 0.45 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={T_ENTER}
    >
      <Card className="p-4">
        {/* ── Card header: 44px icon plate, then chevron / toggle / kebab ── */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div style={{
            width: 44, height: 44, borderRadius: 'var(--r-ctl)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative', flexShrink: 0,
            background: isActive ? 'var(--ink)' : 'var(--surface-2)',
            color: isActive ? 'var(--bg)' : 'var(--ink)',
          }}>
            {/* Always use the kind-derived icon. The non-IR branch used to
                read `domainIcon(entity.domain, ...)` which only knew the raw
                HA domain — a Switcher Touch boiler (`switch.switcher_touch_*`)
                showed the generic switch icon, while the detail page showed
                the boiler via getKind. Routing both through getKind+kindMeta
                keeps vendor heuristics (Switcher boilers, future overrides)
                in one place and the icon consistent across views. */}
            <DeviceIcon kind={getKind(entity)} customIcon={entity.icon} size={24} fill />
            {!isIr && !linkedIr && ziggyStatus && STATUS_DOT[ziggyStatus] && (
              <span className={cn('absolute -top-1 -right-1 w-2 h-2 rounded-full border-2', STATUS_DOT[ziggyStatus])} style={{ borderColor: 'var(--surface)' }} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Navigate to full device detail page — same for HA and IR.
                DeviceDetail handles `ir.<id>` entity_ids via its isIrTarget branch. */}
            <button
              onClick={() => navigate(`/devices/${encodeURIComponent(entity.entity_id)}`)}
              style={CARD_ICON_BTN_STYLE}
              className="hover:bg-surface-2 transition-colors"
              title={t('devices.deviceDetailsTooltip')}
              aria-label={t('devices.deviceDetailsTooltip')}
            >
              <ChevronRight size={18} strokeWidth={1.75} className="icon-flip-rtl" />
            </button>
            {isToggleable && (
              <Toggle checked={isOn} onCheckedChange={(v) => onToggle(entity.entity_id, v)} />
            )}
            {/* IR power toggle — mirrors the HA Toggle above so AC/TV/fan
                IR cards have a one-tap power switch right in the header.
                Optimistically flips the assumed_state so the slider position
                rotates instantly; reverts on send failure. */}
            {isIr && kindMeta(getKind(entity)).toggle && commandAvailable(entity, 'toggle') && (
              <Toggle
                checked={isOn}
                onCheckedChange={async () => {
                  const irId = irDevice?.id
                  if (!irId) return
                  const store = useDeviceStore.getState()
                  const prev = irDevice?.assumed_state
                  const next = isOn ? 'off' : 'on'
                  store.updateIrAssumedState?.(irId, next)
                  try { await sendDeviceCommand(entity, 'toggle') }
                  catch { store.updateIrAssumedState?.(irId, prev ?? 'unknown') }
                }}
              />
            )}
            {isIr ? (
              <IRCardMenu
                irDevice={irDevice}
                rooms={rooms}
                onEdit={() => onEditIr(irDevice)}
                onDelete={() => onDeleteIr(irDevice.id)}
                onAssign={(roomId) => onAssign(entity.entity_id, roomId)}
                onLinkToWifi={() => onLinkIr(irDevice)}
                onUnlinkFromWifi={() => onUnlinkIr(irDevice.id)}
              />
            ) : linkedIr ? (
              // Merged HA+IR card — HA menu with IR extras
              <DeviceMenu
                entity={entity}
                rooms={rooms}
                onHide={onHide}
                onUnhide={onUnhide}
                isHidden={isHidden}
                onAssign={onAssign}
                extraItems={[
                  { label: t('devices.editIrRemote'), icon: <Pencil size={16} strokeWidth={1.75} />, onClick: () => onEditIr(linkedIr) },
                  { label: t('devices.unlinkIr'), icon: <Unlink size={16} strokeWidth={1.75} />, onClick: () => onUnlinkIr(linkedIr.id), className: 'text-ink-2' },
                ]}
              />
            ) : (
              <DeviceMenu entity={entity} rooms={rooms} onHide={onHide} onUnhide={onUnhide} isHidden={isHidden} onAssign={onAssign} />
            )}
          </div>
        </div>

        {/* ── Name ── */}
        <p dir="auto" className="z-headline truncate">
          {entityDisplayName(entity)}
        </p>

        {/* ── State ── */}
        {isIr ? (
          // Standalone IR: assumed-state chip with picker, plus the AC temp
          // stepper for IR ACs. `flex-wrap` lets the stepper drop to a second
          // line on the narrowest cards. The chip carries " · IR" so the
          // control path is stated in the state line, not as a badge on
          // the icon. The popover is fixed-positioned so it never clips.
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', rowGap: 4, marginTop: 4 }}>
            <AssumedStatePicker
              irDevice={irDevice}
              assumedState={assumedState}
              irConfidence={irConfidence}
              isStale={isStale}
              ageHours={ageHours}
              irStateOptions={irStateOptions}
              onIrStateChange={onIrStateChange}
              suffix={irLabel}
              acFacts={(() => {
                if (irDevice?.type !== 'ac') return []
                const m = irDevice?.ac_memory || {}
                const facts = []
                if (m.temp != null) facts.push(`${m.temp}°C`)
                if (m.mode) facts.push(String(m.mode).toLowerCase())
                if (m.fan) facts.push(`fan ${String(m.fan).toLowerCase()}`)
                return facts
              })()}
            />
            {getKind(entity) === KIND.AC && (
              <CompactAcStepper entity={entity} />
            )}
          </div>
        ) : showStatusBadge ? (
          <p className="text-subhead font-medium text-err-text">{statusBadgeLabel}</p>
        ) : (
          // Read-only kinds (sensors, motion, door, etc.) collapse primary +
          // secondary onto one line so the tile is just name + reading.
          // 15px; ok-text when the device is doing something, ink-mute
          // otherwise. A merged HA+IR card states " · IR" here.
          <p className={cn('text-subhead font-medium truncate', (!isHidden && entity.state !== 'unavailable' && isActive) ? 'text-ok-text' : 'text-ink-mute')}>
            {stateLabel}
            {!isControllableKind && stateSecondary && (
              <span className="text-ink-mute font-normal"> · {stateSecondary}</span>
            )}
            {linkedIr && <span className="text-ink-mute font-normal"> · {irLabel}</span>}
          </p>
        )}
        {!isIr && stateSecondary && !isHidden && isControllableKind && (
          <p className="z-footnote truncate">{stateSecondary}</p>
        )}
        {isIr && irDevice?.last_command_sent_at && (
          <p className="z-footnote truncate">
            {t('devices.last')}: {irDevice.last_command_sent?.replace(/_/g, ' ')} · {_fmtAgo(irDevice.last_command_sent_at)}
          </p>
        )}

        {/* IR Walk Wizard entry — only for IR ACs Ziggy hasn't learned yet
            (no synthesized command set). Ghost button, ink, 44px tall; the
            wizard lives at /ir-walk/:deviceId. */}
        {isIr && getKind(entity) === KIND.AC && irDevice &&
          (irDevice.synth_commands || []).length === 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/ir-walk/${irDevice.id}`) }}
            className="mt-1 inline-flex items-center gap-2 hover:bg-surface-2 transition-colors"
            style={{ minHeight: 44, padding: '0 8px', marginInlineStart: -8, borderRadius: 'var(--r-ctl)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 600, color: 'var(--ink)', fontFamily: 'inherit' }}
          >
            <Sparkles size={16} strokeWidth={1.75} />
            {t('devices.teachZiggyRemote')}
          </button>
        )}

        {/* "Show controls" — a full-width 44px footer row inside the card,
            quiet ink-mute text with a 16px chevron, separated by a hairline.
            Same toggle behaviour as before; just no longer an accent link. */}
        {showsExpander && (
          <button
            onClick={() => setControlsExpanded(v => !v)}
            aria-expanded={controlsExpanded}
            className="hover:text-ink transition-colors"
            style={{
              width: '100%', minHeight: 44, marginTop: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              background: 'none', border: 'none', borderTop: '0.5px solid var(--line)', cursor: 'pointer',
              color: 'var(--ink-mute)', fontSize: 15, fontWeight: 500,
              fontFamily: 'inherit', padding: '12px 0 0', textAlign: 'start',
            }}
          >
            {controlsExpanded ? t('devices.hideControls') : t('devices.showControls')}
            <ChevronDown size={16} strokeWidth={1.75}
              style={{ flexShrink: 0, transform: controlsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)' }} />
          </button>
        )}

        {/* Expanded control surface — animated height + fade so opening
            and closing doesn't snap the list around. Sits directly under
            the footer row (which already draws the hairline). */}
        {showsExpander && (
          <AnimatePresence initial={false}>
            {controlsExpanded && (
              <motion.div
                key="controls"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={T_STATE}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ paddingTop: 4 }}>
                  <UnifiedDeviceRemote entity={entity} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {showAssign && !isIr && (
          <AssignRoomDropdown entityId={entity.entity_id} rooms={rooms} onAssign={onAssign} />
        )}
      </Card>
    </motion.div>
  )
})

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Devices() {
  const t = useT()
  const lang = useLang()
  // Per-field selectors: subscribing to one large destructure caused this
  // page to re-render on every WS-driven store change, even when none of
  // the fields it actually reads had changed.
  const rawEntities           = useDeviceStore(s => s.entities)
  const deviceGroups          = useDeviceStore(s => s.deviceGroups)
  const groupByEntityId       = useDeviceStore(s => s.groupByEntityId)
  const groupById             = useDeviceStore(s => s.groupById)
  const rooms                 = useDeviceStore(s => s.rooms)
  const deviceStatusMap       = useDeviceStore(s => s.deviceStatusMap)
  const loading               = useDeviceStore(s => s.loading)
  const hiddenEntities        = useDeviceStore(s => s.hiddenEntities)
  const showHidden            = useDeviceStore(s => s.showHidden)
  const rawZiggyRooms         = useDeviceStore(s => s.ziggyRooms)
  const unclaimedDevices      = useDeviceStore(s => s.unclaimedDevices)
  const noRoomDevices         = useDeviceStore(s => s.noRoomDevices)
  const fetchAll              = useDeviceStore(s => s.fetchAll)
  const hideEntity            = useDeviceStore(s => s.hideEntity)
  const unhideEntity          = useDeviceStore(s => s.unhideEntity)
  const toggleShowHidden      = useDeviceStore(s => s.toggleShowHidden)
  const getUnassigned         = useDeviceStore(s => s.getUnassigned)
  const getNoRoom             = useDeviceStore(s => s.getNoRoom)
  const updateIrAssumedState  = useDeviceStore(s => s.updateIrAssumedState)
  const getActiveCount        = useDeviceStore(s => s.getActiveCount)
  const getTotalControllable  = useDeviceStore(s => s.getTotalControllable)
  const getGroupedEntities    = useDeviceStore(s => s.getGroupedEntities)
  const getGroupedZiggyRooms  = useDeviceStore(s => s.getGroupedZiggyRooms)

  // Grouped view: one card per physical device. Non-primary siblings drop
  // out (e.g. Switcher's power/current sensors are absorbed into the switch's
  // card as metric pills). Falls back to raw `entities` when no groups
  // returned (HA registry unavailable).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entities    = getGroupedEntities()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ziggyRooms  = getGroupedZiggyRooms()
  const { addToast } = useUIStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState(searchParams.get('filter') || 'all')
  // Inline-remove state for the attention banner so a single tap can clear
  // a ghost registry row (entity was deleted directly in HA).
  const [removingAttention, setRemovingAttention] = useState(null)

  // Reuse store data if it was fetched in the last 2 min. WebSocket pushes
  // keep entity state live in the meantime, so a re-fetch only matters when
  // device membership changes (rare). Back-navigation from a device detail
  // page no longer fires 2× fresh HA WS handshakes (areas + rooms-with-devices)
  // just to redraw the same list — and even when the cache is stale, the
  // skeleton no longer hides the cached entities while the refresh runs.
  useEffect(() => { fetchAll({ maxAge: 120_000 }) }, [])

  // Fire-and-forget: prune orphaned smart-sensor KV records (HA helper deleted
  // out from under us) on page load. Server-side throttled to once / 5 min. If
  // anything was pruned, refresh so the dead card disappears in place.
  useEffect(() => {
    reconcileSmartSensors()
      .then((r) => { if (r?.pruned?.length) fetchAll({ force: true }) })
      .catch(() => {})
  }, [])

  // Sync filter from URL param (used by Rooms page "Unassigned" card)
  useEffect(() => {
    const f = searchParams.get('filter')
    if (f) setDomain(f)
  }, [searchParams])

  // HA-area room list with entity assignments (needed by DeviceMenu to detect current room)
  const allRooms = rooms.map((r) => ({ id: r.id, name: r.name, entities: r.entities || [] }))

  // Full room picker list: use ziggyRooms (all rooms) enriched with HA entity lists
  // This ensures every room the user created is shown, not only HA areas
  const haAreaMap = Object.fromEntries(rooms.map((r) => [r.id, r]))
  const roomsForPicker = ziggyRooms.map((zr) => ({
    id:       zr.id,
    name:     zr.name,
    entities: haAreaMap[zr.id]?.entities || [],
  }))
  const unassigned = getUnassigned()
  const noRoomEntities = getNoRoom()

  // ── Smart sensor enrichment ──────────────────────────────────────────────────
  // Walk every device record returned by the registry (room devices + no-room
  // + unclaimed) and pluck out the Ziggy-created template helpers. Then join
  // each one with its live HA entity record (state) and friendly source-sensor
  // labels so the card can render without ever showing a raw entity_id.
  const entityById = (() => {
    const m = {}
    for (const e of entities) m[e.entity_id] = e
    return m
  })()
  const smartSensorEntries = (() => {
    const out = []
    const seen = new Set()
    const consider = (d, roomName) => {
      if (!d || !d.entity_id || seen.has(d.entity_id)) return
      if (!_isSmartSensorRecord(d)) return
      seen.add(d.entity_id)
      const liveEntity = entityById[d.entity_id]
      if (!liveEntity) return  // entity not yet in HA — skip until it shows up
      const sources = Array.isArray(d.ziggy_sources) ? d.ziggy_sources : []
      // Resolve friendly names from the live entity registry, falling back to
      // null so the card can hide unknown labels instead of leaking entity_ids.
      const sourceLabels = sources
        .map((sid) => {
          const se = entityById[sid]
          if (!se) return null
          return se.display_name || se.friendly_name || null
        })
        .filter(Boolean)
      out.push({
        ...liveEntity,
        // Ziggy-only metadata — prefixed `_` so it never collides with HA fields
        _ziggySmartSensor: true,
        _ziggySources:     sources,
        _ziggySourceLabels: sourceLabels,
        // Opaque HA config-entry id — never rendered, only used to target the
        // DELETE /api/smart-sensors/{entry_id} endpoint.
        _ziggyEntryId:     d.entry_id || null,
        _roomName:         roomName || liveEntity._roomName || null,
        // Mirror the registry's friendly room slug if present so rendering can
        // capitalize / format it the same as other cards.
        room:              d.room || liveEntity.room || null,
        // Preserve the registry's display name when HA's friendly name is
        // missing — but the registry sometimes stores the raw entity_id as
        // `name`, which must never surface as a display name. Prefer a real
        // HA friendly name, and drop any registry name that is just the id.
        display_name:      liveEntity.display_name
                             || liveEntity.friendly_name
                             || (d.name && d.name !== liveEntity.entity_id ? d.name : null),
      })
    }
    for (const room of ziggyRooms) {
      for (const d of (room.devices || [])) consider(d, room.name)
    }
    for (const d of (noRoomDevices || [])) consider(d, null)
    for (const d of (unclaimedDevices || [])) consider(d, null)
    return out
  })()
  const smartSensorIdSet = new Set(smartSensorEntries.map(e => e.entity_id))

  // Dynamic filter chips — only groups that have at least one entity present.
  const irEntities = entities.filter(e => e._ir)
  const groupFilters = buildGroupFilters(entities, irEntities)
  // Hide the Smart Sensors chip until at least one exists — keeps the chip
  // bar honest for users who haven't asked Ziggy to set up any smart rooms yet.
  const baseStatusFilters = buildStatusFilters(t)
    .filter(f => f.id !== 'smart_sensors' || smartSensorEntries.length > 0)
  const DOMAIN_FILTER = [...baseStatusFilters, ...groupFilters]

  // If the current filter is a group that no longer has any devices, reset to 'all'.
  useEffect(() => {
    if (domain !== 'all' && !DOMAIN_FILTER.some(f => f.id === domain)) {
      setDomain('all')
    }
  }, [entities.length])

  const filtered = (() => {
    if (domain === 'unassigned') return unassigned
    if (domain === 'noroom') return noRoomEntities
    // Smart sensors are surfaced as their own enriched list — they don't live
    // in the main `entities` filter path (so they never show up twice when
    // any other filter is active).
    if (domain === 'smart_sensors') {
      return smartSensorEntries.filter((e) =>
        !search ||
        (e.display_name || e.friendly_name || '').toLowerCase().includes(search.toLowerCase())
      )
    }
    return entities.filter((e) => {
      const isHidden = hiddenEntities.has(e.entity_id)
      if (isHidden && !showHidden) return false
      // Hide Ziggy smart sensors from the generic device list — they get
      // their own dedicated section / chip so users never see two cards
      // for the same template helper.
      if (smartSensorIdSet.has(e.entity_id)) return false
      let matchDomain = true
      if (domain === 'active') matchDomain = isEntityOn(e)
      // IR devices are fire-and-forget — they have NO connectivity state. Their
      // `state` is just the assumed on/off (default 'unknown' before first use),
      // so treating 'unknown' as offline made every untoggled IR remote show up
      // in the "disconnected devices" review. Exclude IR from both connectivity
      // filters entirely. Also exclude IR+Wi-Fi MERGED devices (`_linkedIr`): a
      // TV whose Wi-Fi media_player goes 'unavailable' when powered OFF is not
      // "disconnected" — it's off and still IR-controllable, so it must not land
      // in the disconnected-devices filter.
      else if (domain === 'offline') matchDomain = !e._ir && !e._linkedIr && (e.state === 'unavailable' || e.state === 'unknown')
      else if (domain === 'connected') matchDomain = !e._ir && e.state !== 'unavailable' && e.state !== 'unknown'
      else if (domain === 'ir') matchDomain = e._ir === true || Boolean(e._linkedIr)
      else if (domain !== 'all') {
        // Check if it's a group ID (e.g. 'security', 'climate') or a direct domain name
        const isGroupFilter = groupFilters.some((f) => f.id === domain)
        matchDomain = isGroupFilter ? domainGroup(e) === domain : e.domain === domain
      }
      const matchSearch = !search ||
        (e.display_name || e.friendly_name || '').toLowerCase().includes(search.toLowerCase()) ||
        e.entity_id.toLowerCase().includes(search.toLowerCase())
      return matchDomain && matchSearch
    })
  })()

  const handleToggle = async (entityId, on) => {
    const entity = entities.find((e) => e.entity_id === entityId)
    if (entity?.state === 'unavailable') {
      addToast(t('devices.deviceUnavailable'), 'error')
      return
    }
    try {
      await controlDevice(entityId, on ? 'turn_on' : 'turn_off')
      addToast(on ? t('devices.turnedOn') : t('devices.turnedOff'), 'success')
    } catch { addToast(t('common.failed'), 'error') }
  }

  const handleService = async (entity, service, data) => {
    try {
      await callHaService(entity.domain, service, { entity_id: entity.entity_id, ...data })
    } catch {
      addToast(t('devices.controlFailed'), 'error')
    }
  }

  const handleAssign = async (entityId, roomId) => {
    // The assign call is idempotent (PATCH sets an absolute room). Remote
    // (tunnel/relay) hops occasionally return a transient "upstream error";
    // one retry clears it without ever double-applying.
    const doAssign = async () => {
      if (entityId?.startsWith('ir.')) {
        // IR device — assign by normalized room name slug, not HA area ID.
        // Send '' (empty string) to unassign; backend treats '' as "no room".
        const irId = entityId.replace('ir.', '')
        const room = roomsForPicker.find((r) => r.id === roomId)
        const roomSlug = roomId === null
          ? ''
          : room ? normRoomSlug(room.name) : roomId
        await patchIrDevice(irId, { room: roomSlug })
      } else {
        await assignEntityToArea(entityId, roomId)
      }
    }
    try {
      try { await doAssign() }
      catch (first) { await new Promise(r => setTimeout(r, 600)); await doAssign() }
    } catch (e) {
      addToast(e.message || t('common.failed'), 'error')
      return
    }
    // The assignment succeeded. Refresh is best-effort — a slow/failed refetch
    // (common over a remote tunnel, which fires a burst of requests) must NOT
    // be reported as an assignment failure, which was surfacing "upstream
    // error" on a room change that actually took effect.
    addToast(roomId ? t('devices.assigned') : t('devices.removedFromRoom'), 'success')
    try { await fetchAll() } catch {}
  }

  const [showPairing, setShowPairing]         = useState(false)
  const [showIRWizard, setShowIRWizard]       = useState(false)
  const [showIRBlaster, setShowIRBlaster]     = useState(false)  // "pair IR blaster" (blaster-only) flow
  const [editingIrDevice, setEditingIrDevice] = useState(null)
  const [linkingIrDevice, setLinkingIrDevice] = useState(null) // IR device being linked to HA entity
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())

  // Paired IR blasters — infrastructure (not controllable tiles), shown as a
  // small status strip so the user can see "RM4 · online" without digging into
  // Settings → IR Hubs. Loaded once + refreshed after pairing one.
  // Seed from a localStorage cache so the (collapsed) IR-blasters strip is
  // present on the very first paint instead of popping in a beat later when the
  // async list resolves — that late insert was the "jumps into position" jank.
  const [blasters, setBlasters] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ziggy_blasters_cache') || '[]') } catch { return [] }
  })
  const [blastersOpen, setBlastersOpen] = useState(false)  // collapsed by default
  const loadBlasters = () => listIrBlasters()
    .then(b => {
      const list = Array.isArray(b) ? b : []
      setBlasters(list)
      try { localStorage.setItem('ziggy_blasters_cache', JSON.stringify(list)) } catch {}
    })
    .catch(() => {})
  useEffect(() => { loadBlasters() }, [])

  // Unassigned IR signals — captured physical-remote presses that didn't
  // match any device. Show a badge in the header so the user discovers it.
  const [showUnassignedSignals, setShowUnassignedSignals]   = useState(false)
  const [unassignedSignalCount, setUnassignedSignalCount]   = useState(0)
  const [unassignedRefreshTick, setUnassignedRefreshTick]   = useState(0)

  useEffect(() => {
    const refresh = () => {
      getIrUnassignedSignals()
        .then((sigs) => setUnassignedSignalCount(Array.isArray(sigs) ? sigs.length : 0))
        .catch(() => {})
    }
    refresh()
    const onSignal = () => { refresh(); setUnassignedRefreshTick((t) => t + 1) }
    window.addEventListener('ziggy:ir_unknown_signal', onSignal)
    return () => window.removeEventListener('ziggy:ir_unknown_signal', onSignal)
  }, [])

  const handleLinkIr = async (haEntityId) => {
    if (!linkingIrDevice || !haEntityId) return
    try {
      await patchIrDevice(linkingIrDevice.id, { ha_entity_id: haEntityId })
      await fetchAll()
      addToast(t('devices.devicesLinked'), 'success')
    } catch { addToast(t('devices.failedToLink'), 'error') }
    setLinkingIrDevice(null)
  }

  const handleUnlinkIr = async (irId) => {
    try {
      await patchIrDevice(irId, { ha_entity_id: '' })
      await fetchAll()
      addToast(t('devices.irDeviceUnlinked'), 'success')
    } catch { addToast(t('devices.failedToUnlink'), 'error') }
  }
  const toggleGroup = (id) => setCollapsedGroups((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleDeleteIr = async (irId) => {
    try {
      await deleteIrDevice(irId)
      await fetchAll()
      addToast(t('devices.irDeviceRemoved'), 'success')
    } catch { addToast(t('devices.failedToRemove'), 'error') }
  }

  const handleIrStateChange = async (id, newState) => {
    try {
      await patchIrDevice(id, { assumed_state: newState === 'unknown' ? null : newState })
      updateIrAssumedState(id, newState === 'unknown' ? 'unknown' : newState)
      addToast(t('devices.stateSet', { state: newState }), 'success')
    } catch { addToast(t('devices.failedUpdateState'), 'error') }
  }

  const handleIrCommand = async (deviceId, cmd) => {
    try {
      await irSend(deviceId, cmd)
      addToast(t('devices.commandSent'), 'success')
    } catch { addToast(t('devices.irCommandFailed'), 'error') }
  }

  const handleIrChannel = async (deviceId, channel) => {
    try {
      await irSendChannel(deviceId, channel)
      addToast(t('devices.channelChanged', { channel }), 'success')
    } catch { addToast(t('devices.channelChangeFailed'), 'error') }
  }

  const activeCount = getActiveCount()
  const hiddenCount = hiddenEntities.size

  // Devices in DeviceRegistry with status needing attention (lost/unconfigured) — not visible in HA entity list
  const allZiggyDevices = [
    ...ziggyRooms.flatMap((r) => (r.devices || []).map((d) => ({ ...d, roomName: r.name }))),
    ...(unclaimedDevices || []).map((d) => ({ ...d, roomName: null })),
  ]
  const NON_DEVICE_DOMAINS = new Set(['automation', 'script', 'scene', 'timer', 'counter', 'input_select', 'input_number', 'input_text', 'input_datetime', 'input_button', 'group', 'zone'])
  const attentionDevices = allZiggyDevices.filter((d) => {
    if (d.status !== 'lost' && d.status !== 'unconfigured') return false
    const domain = (d.entity_id || '').split('.')[0] || d.device_type || ''
    return !NON_DEVICE_DOMAINS.has(domain)
  })

  // ── By-room grouping (primary view) ──────────────────────────────────────────
  const [viewMode, setViewMode] = useState('room') // 'room' | 'type'

  const deviceCardProps = (entity, assign = false) => ({
    entity,
    rooms: roomsForPicker,
    onToggle: handleToggle,
    onService: handleService,
    onHide: hideEntity,
    onUnhide: unhideEntity,
    onAssign: handleAssign,
    onIrCommand: handleIrCommand,
    onIrChannel: handleIrChannel,
    onIrStateChange: handleIrStateChange,
    onEditIr: setEditingIrDevice,
    onDeleteIr: handleDeleteIr,
    onLinkIr: setLinkingIrDevice,
    onUnlinkIr: handleUnlinkIr,
    isHidden: hiddenEntities.has(entity.entity_id),
    showAssign: assign,
    ziggyStatus: deviceStatusMap[entity.entity_id],
  })

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>
      {/* Header — wraps on narrow screens so the action buttons drop to a new
          row instead of overflowing horizontally (which used to shove the
          "pair device" button off the page edge when the show-hidden pill
          appeared). */}
      {/* Header: eyebrow → display title → one 44px icon action. The
          device cards are this screen's primary; pairing is a quiet
          icon button, not an inverted CTA. No count subtitle — the
          counts already live on the filter chips and group headers. */}
      <div className="z-page-head">
        <div>
          <p className="z-eyebrow">{t('devices.eyebrow')}</p>
          <h1 className="z-display" style={{ margin: 0 }}>{t('devices.title')}</h1>
        </div>
        <button onClick={() => setShowPairing(true)} className="z-icon-btn" aria-label={t('devices.pairDevice')} title={t('devices.pairDevice')}>
          <Plus size={20} strokeWidth={1.75} />
        </button>
      </div>
      {(hiddenCount > 0 || (SHOW_UNKNOWN_IR_TAG && unassignedSignalCount > 0)) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: -8, marginBottom: 16 }}>
          {hiddenCount > 0 && (
            <button onClick={toggleShowHidden} aria-pressed={showHidden} className="z-chip" style={{
              ...CHIP_BTN_STYLE,
              ...(showHidden ? CHIP_ACTIVE_STYLE : { background: 'var(--surface)', color: 'var(--ink-mute)' }),
            }}>
              {showHidden ? <Eye size={16} strokeWidth={1.75} /> : <EyeOff size={16} strokeWidth={1.75} />}
              {showHidden ? t('devices.showingHidden') : t('devices.showHidden')}
              <span style={CHIP_COUNT_STYLE}>{hiddenCount}</span>
            </button>
          )}
          {/* Unknown-IR-signals tag hidden for now (user request). The detection
              + modal still exist; flip SHOW_UNKNOWN_IR_TAG to bring the pill back. */}
          {SHOW_UNKNOWN_IR_TAG && unassignedSignalCount > 0 && (
            <button
              onClick={() => setShowUnassignedSignals(true)}
              title={t('devices.unassignedSignalsTooltip')}
              className="z-chip"
              style={{ ...CHIP_BTN_STYLE, background: 'var(--surface)', color: 'var(--ink-mute)' }}
            >
              <Radio size={16} strokeWidth={1.75} />
              {t('devices.unknownSignals', { n: unassignedSignalCount })}
            </button>
          )}
        </div>
      )}

      {/* Unassigned banner */}
      {unassigned.length > 0 && domain !== 'unassigned' && domain !== 'noroom' && (
        <motion.button initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={T_ENTER}
          onClick={() => setDomain('unassigned')}
          style={{
            width: '100%', marginBottom: 16, minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '12px 16px', borderRadius: 'var(--r-card)', textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit',
            background: `color-mix(in srgb, var(--warn) 8%, var(--surface))`, border: '0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)' }}>
              {unassigned.length === 1 ? t('devices.unassignedBannerOne', { n: unassigned.length }) : t('devices.unassignedBannerMany', { n: unassigned.length })}
            </p>
            <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--warn-text)', marginTop: 2 }}>{t('devices.unassignedBannerHint')}</p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 15, color: 'var(--warn-text)', fontWeight: 500, flexShrink: 0 }}>
            {t('devices.review')}
            <ChevronRight size={16} strokeWidth={1.75} className="icon-flip-rtl" />
          </span>
        </motion.button>
      )}

      {/* Attention banner — each row is now actionable. Tap the row to open
          the device page (which has the ghost UI for full cleanup), or tap
          the trash icon for one-shot removal from Ziggy's registry. */}
      {attentionDevices.length > 0 && domain !== 'attention' && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={T_ENTER}
          className="z-card"
          style={{ marginBottom: 16, borderColor: 'color-mix(in srgb, var(--warn) 30%, var(--line))', overflow: 'hidden' }}
        >
          <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)' }}>
            <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)' }}>
              {attentionDevices.length === 1 ? t('devices.attentionTitleOne', { n: attentionDevices.length }) : t('devices.attentionTitleMany', { n: attentionDevices.length })}
            </p>
            <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink-mute)', marginTop: 2 }}>{t('devices.attentionSubtitle')}</p>
          </div>
          <div>
            {attentionDevices.map((d, i) => {
              const eid = d.entity_id
              const busy = removingAttention === eid
              const handleRemove = async (ev) => {
                ev.stopPropagation()
                if (!eid || busy) return
                setRemovingAttention(eid)
                try {
                  await removeRegistryEntity(eid)
                  await fetchAll({ force: true })
                  addToast(t('devices.removedFromZiggy'), 'success')
                } catch (e) {
                  addToast(e.message || t('devices.failedToRemove'), 'error')
                } finally {
                  setRemovingAttention(null)
                }
              }
              return (
                <div
                  key={eid || i}
                  onClick={() => eid && navigate(`/devices/${encodeURIComponent(eid)}`)}
                  role={eid ? 'button' : undefined}
                  tabIndex={eid ? 0 : undefined}
                  onKeyDown={(e) => { if (eid && e.key === 'Enter') navigate(`/devices/${encodeURIComponent(eid)}`) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, minHeight: 44,
                    padding: '8px 8px 8px 16px', borderBottom: '0.5px solid var(--line)',
                    cursor: eid ? 'pointer' : 'default',
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.status === 'lost' ? 'var(--warn)' : 'var(--line-2)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p dir="auto" style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{translateNamePhrase(d.display_name || eid || d.device_type, lang)}</p>
                    <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink-mute)' }} dir="auto">{d.roomName ? `${translateNamePhrase(d.roomName, lang)} · ` : ''}{getStatusLabel(t, d.status) || d.status}</p>
                  </div>
                  {eid && (
                    <button
                      onClick={handleRemove}
                      disabled={busy}
                      title={t('devices.removeFromZiggy')}
                      aria-label={t('devices.removeFromZiggy')}
                      className="hover:bg-surface-2 transition-colors"
                      style={{ ...CARD_ICON_BTN_STYLE, color: 'var(--err-text)', cursor: busy ? 'default' : 'pointer' }}
                    >
                      <Trash2 size={18} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Search */}
      {domain !== 'unassigned' && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <span style={{ position: 'absolute', insetInlineStart: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-mute)', display: 'inline-flex', pointerEvents: 'none' }}>
            <Search size={18} strokeWidth={1.75} />
          </span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('devices.searchPlaceholderShort')} dir="auto" className="z-input" style={{ paddingInlineStart: 44 }} />
        </div>
      )}

      {/* View mode + filter chips */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, marginBottom: 20 }} className="scrollbar-thin">
        {/* View mode toggle — active = surface-2 + ink + line-2, never inverted */}
        {[{ id: 'room', label: t('devices.byRoom') }, { id: 'type', label: t('devices.byType') }].map(v => (
          <button key={v.id} onClick={() => setViewMode(v.id)} aria-pressed={viewMode === v.id} className="z-chip" style={{
            ...CHIP_BTN_STYLE,
            ...(viewMode === v.id ? CHIP_ACTIVE_STYLE : { background: 'var(--surface)', color: 'var(--ink-mute)' }),
          }}>{v.label}</button>
        ))}
        <div style={{ width: 1, background: 'var(--line)', flexShrink: 0, margin: '0 2px' }} />
        {DOMAIN_FILTER.map(f => {
          const active = domain === f.id && viewMode === 'type'
          const Icon = f.icon
          const count = f.id === 'unassigned' ? unassigned.length : f.id === 'noroom' ? noRoomEntities.length : 0
          return (
            <button key={f.id} onClick={() => { setDomain(f.id); if (f.id !== 'all') setViewMode('type') }} aria-pressed={active} className="z-chip" style={{
              ...CHIP_BTN_STYLE,
              ...(active ? CHIP_ACTIVE_STYLE : { background: 'var(--surface)', color: 'var(--ink-mute)' }),
            }}>
              {Icon && <Icon size={16} strokeWidth={1.75} style={{ flexShrink: 0 }} />}
              {f.label}
              {count > 0 && <span style={CHIP_COUNT_STYLE}>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* IR Blasters — collapsible status strip (infrastructure, not control
          tiles). Collapsed by default; the only place blasters are surfaced.
          Rows are display-only — no navigation. */}
      {domain === 'all' && blasters.length > 0 && (
        <CollapsibleGroup
          label={t('devices.irBlastersTitle') || 'IR Blasters'}
          count={blasters.length}
          open={blastersOpen}
          onToggle={() => setBlastersOpen(v => !v)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
            {blasters.map(b => {
              const host = b.ip || b.last_seen_ip || ''
              const color = b.status === 'online' ? 'var(--ok)' : b.status === 'stale' ? 'var(--warn)' : 'var(--err)'
              return (
                <div
                  key={b.id}
                  className="z-card-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', minHeight: 56 }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p dir="auto" style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</p>
                    {host && <p className="z-code" style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ink-mute)' }}>{host}</p>}
                  </div>
                  <Zap size={18} strokeWidth={1.75} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                </div>
              )
            })}
          </div>
        </CollapsibleGroup>
      )}

      {/* Unassigned section info */}
      {domain === 'unassigned' && filtered.length > 0 && (
        <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 'var(--r-card)', background: `color-mix(in srgb, var(--warn) 8%, var(--surface))`, border: `0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))` }}>
          <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{t('devices.unassignedTitle')}</p>
          <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--warn-text)' }}>{t('devices.unassignedHint')}</p>
        </div>
      )}
      {domain === 'noroom' && filtered.length > 0 && (
        <div className="z-card" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{t('devices.noRoomTitle')}</p>
          <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--ink-mute)' }}>{t('devices.noRoomHint')}</p>
        </div>
      )}

      {/* Loading skeleton — only when we have nothing to show. Once entities
          are populated, keep the existing list visible during a re-fetch
          (stale-while-revalidate) so back-navigation never goes blank just
          because the TTL expired. */}
      {loading && entities.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3,4,5,6].map(i => <div key={i} style={{ height: 60, borderRadius: 10, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty state — only when truly empty (not just refreshing).
          In `all` mode the Smart Sensors group lives outside `filtered`, so
          we skip the empty banner when at least one smart sensor exists. */}
      {!loading && filtered.length === 0 && !(domain === 'all' && smartSensorEntries.length > 0) && (() => {
        // One 17px line, one 15px line, one secondary action. When a filter
        // or search narrowed the list to nothing, the action clears it;
        // when the home genuinely has no devices, it opens pairing.
        const narrowed = domain !== 'all' || search.trim() !== ''
        const title = domain === 'unassigned' ? t('devices.emptyAllAssigned')
          : domain === 'noroom' ? t('devices.emptyNoNoRoom')
          : domain === 'smart_sensors' ? t('devices.groupSmartSensors')
          : t('devices.emptyNoDevices')
        const hint = domain === 'smart_sensors' ? t('devices.smartSensor.empty') : t('devices.emptyHint')
        return (
          <div style={{ textAlign: 'center', padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <p style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)' }}>{title}</p>
            <p className="z-subhead" style={{ maxWidth: 'var(--page-max-w-narrow)' }}>{hint}</p>
            {narrowed ? (
              <button className="z-btn-secondary" style={{ marginTop: 12 }} onClick={() => { setDomain('all'); setSearch(''); setViewMode('room'); setSearchParams({}) }}>
                {t('devices.emptyShowAll')}
              </button>
            ) : (
              <button className="z-btn-secondary" style={{ marginTop: 12 }} onClick={() => setShowPairing(true)}>
                <Plus size={16} strokeWidth={1.75} /> {t('devices.pairDevice')}
              </button>
            )}
          </div>
        )
      })()}

      {/* ── By-room view (default) ── */}
      {viewMode === 'room' && domain === 'all' && (filtered.length > 0 || smartSensorEntries.length > 0) && (() => {
        const entitySet = new Set(filtered.map(e => e.entity_id))
        // Resolve a room device entry to its enriched entity object.
        // HA entities have `d.entity_id`; standalone IR devices in rooms only
        // have `d.ir_device_id` (entity_id is null) — we map these to `ir.<id>`.
        const resolveDevice = (d) => {
          if (d.entity_id) return entities.find(e => e.entity_id === d.entity_id)
          if (d.ir_device_id) return entities.find(e => e.entity_id === `ir.${d.ir_device_id}`)
          return null
        }
        // Promoted sibling tiles (user set "show as its own tile" / is_tile) are
        // kept in `filtered`, but the room grid assembles each room's items from
        // ziggyRooms[].devices — the registry's PRIMARY-only device rows. A
        // promoted sibling is never a primary row, so without this it lands in
        // no bucket (room / No Room / Unassigned / IR) and vanishes from the
        // default room view (it only showed under the by-type view, which reads
        // `filtered` directly). Place each promoted sibling into the same room as
        // its group's primary, or No Room when that primary is roomless.
        const primaryToRoomId = {}
        for (const room of ziggyRooms) {
          for (const d of (room.devices || [])) {
            if (d.entity_id) primaryToRoomId[d.entity_id] = room.id
          }
        }
        const siblingsByRoom = {}
        const noRoomSiblings = []
        for (const sib of filtered) {
          if (!sib._promotedTile) continue
          const gid = groupByEntityId[sib.entity_id]
          const primaryId = gid ? (groupById[gid] && groupById[gid].primary_entity_id) : null
          const rid = primaryId != null ? primaryToRoomId[primaryId] : undefined
          if (rid != null) (siblingsByRoom[rid] = siblingsByRoom[rid] || []).push(sib)
          else noRoomSiblings.push(sib)
        }
        const roomGroups = ziggyRooms.map(room => ({
          room,
          items: [
            ...(room.devices || [])
              .map(resolveDevice)
              .filter(e => e && entitySet.has(e.entity_id)),
            ...(siblingsByRoom[room.id] || []),
          ],
        })).filter(g => g.items.length > 0)
        // Use the same unassigned set as the filter chip so counts are consistent.
        // unassigned = getUnassigned() = non-IR entities in DEVICE_DOMAINS not in any HA area.
        const unroomedItems = unassigned.filter(e => entitySet.has(e.entity_id))

        // getNoRoom()/getUnassigned() both drop `_ir` entities, and a roomless
        // IR device isn't in any room's device list either — so without this it
        // falls through every bucket and is invisible in the default view,
        // showing only under the 📡 IR filter. Surface roomless IR devices here
        // (a room-assigned IR device already appears in its roomGroup above).
        const roomedIrIds = new Set(
          ziggyRooms.flatMap(r => (r.devices || [])
            .filter(d => d.ir_device_id)
            .map(d => `ir.${d.ir_device_id}`))
        )
        const irNoRoom = filtered.filter(e => e._ir && !roomedIrIds.has(e.entity_id))
        const noRoomItems = [
          ...noRoomEntities.filter(e => entitySet.has(e.entity_id)),
          ...irNoRoom,
          ...noRoomSiblings,
        ]

        return (
          <>
            {roomGroups.map(({ room, items }) => (
              <CollapsibleGroup key={room.id} label={translateNamePhrase(room.name, lang)} count={items.length} open={!collapsedGroups.has(room.id)} onToggle={() => toggleGroup(room.id)} room={room} onRoomClick={() => navigate(`/rooms/${room.id}`)}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {items.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity)} />)}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            ))}
            {/* ── Smart Sensors group ───────────────────────────────────────
                Ziggy-created template helpers (occupancy etc.). Placed BELOW
                room groups (so physical devices stay top of view) but ABOVE
                No Room / Unassigned so the new section is high-visibility
                for the user who just asked Ziggy to set up a smart room.
                Default OPEN — this is the freshly-created surface they're
                hunting for. */}
            {smartSensorEntries.length > 0 && (
              <CollapsibleGroup
                label={t('devices.groupSmartSensors')}
                count={smartSensorEntries.length}
                open={!collapsedGroups.has('__smart_sensors__')}
                onToggle={() => toggleGroup('__smart_sensors__')}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {smartSensorEntries.map(entity => (
                      <SmartSensorCard key={entity.entity_id} entity={entity} lang={lang} />
                    ))}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            )}
            {noRoomItems.length > 0 && (
              <CollapsibleGroup label={t('devices.filterNoRoom')} count={noRoomItems.length} open={!collapsedGroups.has('__noroom__')} onToggle={() => toggleGroup('__noroom__')}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {noRoomItems.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity)} />)}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            )}
            {unroomedItems.length > 0 && (
              <CollapsibleGroup label={t('devices.filterUnassigned')} count={unroomedItems.length} open={!collapsedGroups.has('__unassigned__')} onToggle={() => toggleGroup('__unassigned__')}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {unroomedItems.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity, true)} />)}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            )}
          </>
        )
      })()}

      {/* ── By-type view ── */}
      {(viewMode === 'type' || domain !== 'all') && domain !== 'unassigned' && domain !== 'noroom' && domain !== 'smart_sensors' && filtered.length > 0 && (() => {
        const groups = DOMAIN_GROUPS.map(g => ({
          ...g, items: filtered.filter(e => domainGroup(e) === g.id),
        })).filter(g => g.items.length > 0)
        return (
          <>
            {groups.map(g => (
              <CollapsibleGroup key={g.id} label={groupLabel(g.id)} count={g.items.length} open={!collapsedGroups.has(g.id)} onToggle={() => toggleGroup(g.id)}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {g.items.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity)} />)}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            ))}
            {/* Mirror the by-room placement: Smart Sensors appears in By-type
                view too when no narrowing filter is active, so the user can
                still find them regardless of which view mode they're in. */}
            {domain === 'all' && smartSensorEntries.length > 0 && (
              <CollapsibleGroup
                label={t('devices.groupSmartSensors')}
                count={smartSensorEntries.length}
                open={!collapsedGroups.has('__smart_sensors__')}
                onToggle={() => toggleGroup('__smart_sensors__')}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {smartSensorEntries.map(entity => (
                      <SmartSensorCard key={entity.entity_id} entity={entity} lang={lang} />
                    ))}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            )}
          </>
        )
      })()}

      {/* ── Smart Sensors flat view (chip-filter mode) ──
          When the user activates the Smart Sensors chip we render the
          group as a single flat collapsible — same SmartSensorCard, no
          domain-group fan-out. */}
      {domain === 'smart_sensors' && filtered.length > 0 && (
        <CollapsibleGroup
          label={t('devices.groupSmartSensors')}
          count={filtered.length}
          open={!collapsedGroups.has('__smart_sensors_only__')}
          onToggle={() => toggleGroup('__smart_sensors_only__')}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
            <AnimatePresence mode="popLayout">
              {filtered.map(entity => (
                <SmartSensorCard key={entity.entity_id} entity={entity} lang={lang} />
              ))}
            </AnimatePresence>
          </div>
        </CollapsibleGroup>
      )}

      {/* Unassigned flat view */}
      {domain === 'unassigned' && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {filtered.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity, true)} />)}
          </AnimatePresence>
        </div>
      )}

      {/* No Room flat view */}
      {domain === 'noroom' && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {filtered.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity)} />)}
          </AnimatePresence>
        </div>
      )}

      <PairingWizard
        open={showPairing}
        onClose={() => setShowPairing(false)}
        onAddIrDevice={() => setShowIRWizard(true)}
        onAddIrBlaster={() => setShowIRBlaster(true)}
      />

      {showIRWizard && (
        <IRWizard
          onClose={() => setShowIRWizard(false)}
          onCreated={() => { fetchAll(); loadBlasters(); setShowIRWizard(false) }}
        />
      )}

      {showIRBlaster && (
        <IRWizard
          blasterOnly
          onClose={() => setShowIRBlaster(false)}
          onCreated={() => { fetchAll(); loadBlasters() }}
        />
      )}

      {editingIrDevice && (
        <IREditModal
          device={editingIrDevice}
          onClose={() => setEditingIrDevice(null)}
          onSaved={() => { fetchAll(); setEditingIrDevice(null) }}
        />
      )}

      <LinkIrModal
        irDevice={linkingIrDevice}
        open={!!linkingIrDevice}
        onClose={() => setLinkingIrDevice(null)}
        onLink={handleLinkIr}
      />

      <UnassignedSignalsPanel
        open={showUnassignedSignals}
        onClose={() => {
          setShowUnassignedSignals(false)
          // Refresh count + IR device list after closing — likely the user
          // just bound a signal, which adds a learned command.
          getIrUnassignedSignals()
            .then((sigs) => setUnassignedSignalCount(Array.isArray(sigs) ? sigs.length : 0))
            .catch(() => {})
          fetchAll()
        }}
        refreshSignal={unassignedRefreshTick}
      />
    </div>
  )
}
