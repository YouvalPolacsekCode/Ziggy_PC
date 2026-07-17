import { useEffect, useState, useRef, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, MoreVertical, EyeOff, Eye, Home, ChevronDown, ChevronUp, Plus, Tv2, Thermometer, Wind, Volume2, Zap, Trash2, MonitorPlay, Pencil, ChevronRight, Radio, Sparkles } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Button } from '../components/ui/Button'
import { DeviceControls, TOGGLEABLE_DOMAINS, IRRemoteButton, isEntityOn } from '../components/ui/DeviceControls'
import { DeviceRemote as UnifiedDeviceRemote } from '../components/device/DeviceRemote'
import { commandAvailable, getKind, kindMeta, sendDeviceCommand, KIND } from '../lib/devices'
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

// Assumed-state chip + picker popover. Splits out of DeviceCard so the
// popover can render with `position: fixed` (anchored via getBoundingClientRect
// off the chip), escaping any ancestor with overflow constraints. The
// previous `absolute top-full` version got clipped on narrow cards because
// the chip's parent flex row didn't always reserve enough vertical space.
function AssumedStatePicker({ irDevice, assumedState, irConfidence, isStale, ageHours, irStateOptions, onIrStateChange, acFacts = [] }) {
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

  const chipClass = cn(
    'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors whitespace-nowrap',
    isStale
      ? 'bg-warn-soft border-warn-soft text-warn'
      : assumedState === 'on' || (assumedState && assumedState !== 'off')
      ? 'bg-ok-soft border-ok-soft text-ok'
      : assumedState === 'off'
      ? 'bg-surface-2 border-line text-ink-mute'
      : 'bg-surface-2/50 border-dashed border-line text-ink-mute',
  )

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title={isStale
          ? t('devices.irAssumedTooltipStale', { hours: Math.round(ageHours) })
          : t('devices.irAssumedTooltipNormal', { confidence: irConfidence })}
        className={chipClass}
      >
        <span>{assumedState ?? t('common.unknown')}</span>
        {acFacts.length > 0 && (
          <span className="opacity-80">· {acFacts.join(' · ')}</span>
        )}
        <span className="text-[9px] opacity-60 ml-0.5">▾</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }} transition={{ duration: 0.1 }}
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: 130 }}
            className="bg-surface rounded-xl shadow-xl border border-line overflow-hidden"
          >
            <p className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-ink-mute">{t('devices.setAssumedState')}</p>
            {irStateOptions.map((s) => (
              <button key={s}
                onClick={() => { onIrStateChange(irDevice.id, s); setOpen(false) }}
                className={cn('w-full text-left px-3 py-2 text-xs capitalize hover:bg-surface-2', assumedState === s ? 'text-accent font-semibold' : 'text-ink-2')}
              >
                {assumedState === s && <span className="text-accent mr-1 text-[10px]">✓</span>}{s}
              </button>
            ))}
            <div className="border-t border-line mt-1">
              <button
                onClick={() => { onIrStateChange(irDevice.id, 'unknown'); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-xs text-ink-mute hover:bg-surface-2"
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
          width: 22, height: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // Solid info-blue button with a white chevron when learned —
          // earlier the 12%-tinted background made the icon nearly
          // invisible in dark mode. Disabled stays neutral grey.
          background: enabled ? 'var(--info)' : 'var(--surface-2)',
          color: enabled ? '#fff' : 'var(--ink-ghost)',
          border: `0.5px solid ${enabled ? 'var(--info)' : 'var(--line)'}`,
          borderRadius: 6, cursor: enabled ? 'pointer' : 'not-allowed',
          opacity: enabled ? 1 : 0.45,
          flexShrink: 0,
          padding: 0,
          boxShadow: enabled ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
        }}
      >
        {/* Explicit white stroke + thick line — previously relying on
            `currentColor` inheritance could fall through to the parent's
            ink color depending on theme. Forcing color="#fff" guarantees
            the chevron's two strokes render as white on the info-blue. */}
        <Icon size={14} strokeWidth={3.2} color={enabled ? '#fff' : undefined} stroke={enabled ? '#fff' : undefined} />
      </button>
    )
  }
  return (
    <div onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      {arrow(downOk, 'down', () => fire('temp_down'), t('devices.cooler'))}
      <span className="z-mono" style={{
        fontSize: 10.5, color: 'var(--ink)', minWidth: 22, textAlign: 'center', fontWeight: 600,
      }}>
        {memTemp != null ? `${Math.round(memTemp)}°` : '—'}
      </span>
      {arrow(upOk, 'up', () => fire('temp_up'), t('devices.warmer'))}
    </div>
  )
}

const INPUT_CLS = 'w-full h-10 px-3 rounded-xl text-sm border border-line bg-surface-2 text-ink focus:outline-none focus:ring-2 focus:ring-accent'

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

  return (
    <div className="flex items-center gap-2 py-1">
      <div className={cn('w-2 h-2 rounded-full shrink-0', dot)} />
      <span className="flex-1 min-w-0 text-xs text-ink-2">
        <span className="font-medium">{cmd.label}</span>
        {cmd.id !== cmd.label.toLowerCase().replace(/[^a-z0-9]+/g, '_') && (
          <span className="text-[10px] text-ink-mute ml-1 font-mono truncate">· {cmd.id}</span>
        )}
      </span>
      {recentSignal && status !== 'learned' && status !== 'learning' && (
        <button onClick={bindRecent} className="text-[10px] text-accent hover:text-accent whitespace-nowrap" title={t('devices.irEdit.bindRecent')}>
          {t('devices.irEdit.bind')}
        </button>
      )}
      {status === 'learning'
        ? <span className="text-xs text-warn w-10 text-right font-mono">{countdown}s</span>
        : <button onClick={startLearn} className="text-xs text-accent hover:text-accent w-12 text-right">{status === 'learned' ? t('devices.irEdit.relearn') : t('devices.irEdit.learn')}</button>
      }
      <button onClick={test} disabled={status !== 'learned'} className="text-xs text-ink-mute hover:text-ink-2 w-8 text-right disabled:opacity-30">{t('devices.irEdit.test')}</button>
      {onRemove && (
        <button onClick={onRemove} className="text-ink-faint hover:text-err transition-colors" title={t('devices.irEdit.removeCustomTitle')}>
          <Trash2 className="w-3.5 h-3.5" />
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
        <span className="text-[10px] uppercase tracking-wider text-ink-mute font-semibold">{group.label}</span>
        {hasExtras && (
          <button onClick={onToggleShowOptional}
            className="text-[10px] text-accent hover:text-accent">
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
    <div className="mb-3 p-2 rounded-lg bg-warn-soft border border-warn-soft">
      <p className="text-[10px] uppercase tracking-wider text-warn font-semibold mb-1">
        {signals.length === 1 ? t('devices.irEdit.recentOne') : t('devices.irEdit.recentMany', { n: signals.length })}
      </p>
      <p className="text-[11px] text-warn mb-1.5">
        {t('devices.irEdit.bindHint')}
      </p>
      <div className="flex gap-1 flex-wrap">
        {signals.slice(0, 3).map((s) => (
          <button key={s.id} onClick={() => onDismissed(s.id)}
            className="text-[10px] px-2 py-0.5 rounded bg-warn-soft text-warn hover:bg-warn-soft">
            ✕ {s.id.slice(0, 8)}
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
    <div className="flex items-center gap-2 py-1">
      <span className="flex-1 min-w-0 text-xs text-ink-2">
        <span className="font-medium capitalize">{seq.name.replace(/_/g, ' ')}</span>
        <span className="text-[10px] text-ink-mute ml-1">· {t('devices.irEdit.stepsLabel', { n: seq.steps.length })}</span>
      </span>
      <button onClick={run} disabled={running}
        className="text-xs text-accent hover:text-accent w-12 text-right disabled:opacity-50">
        {running ? '…' : t('devices.irEdit.run')}
      </button>
      <button onClick={() => onDeleted(seq.name)}
        className="text-ink-faint hover:text-err transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
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
    <div className="mb-3 p-2 rounded-lg border border-accent-soft bg-accent-soft/40 space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('devices.irEdit.macroNamePlaceholder')} dir="auto"
        className="w-full h-7 px-2 rounded-md text-xs border border-line bg-surface" />
      <div className="space-y-1">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="font-mono flex-1 text-ink-2 truncate">{i + 1}. {s.command}</span>
            <input type="number" value={s.delay_after_ms} min={0} max={10000} step={100}
              onChange={(e) => setSteps((arr) => arr.map((x, j) => j === i ? { ...x, delay_after_ms: Number(e.target.value) || 0 } : x))}
              className="w-16 h-6 px-1 rounded text-[10px] border border-line bg-surface text-right" />
            <span className="text-[10px] text-ink-mute">ms</span>
            <button onClick={() => setSteps((arr) => arr.filter((_, j) => j !== i))}
              className="text-ink-faint hover:text-err">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="relative">
        <button onClick={() => setPicker((v) => !v)}
          className="w-full h-7 rounded-md text-xs text-accent border border-dashed border-accent-soft hover:bg-accent-soft">
          {t('devices.irEdit.addStep')}
        </button>
        {picker && (
          <div className="absolute top-full left-0 right-0 z-10 mt-1 max-h-40 overflow-y-auto rounded-md border border-line bg-surface shadow-lg">
            {allCommands.length === 0 && <p className="px-2 py-1 text-[11px] text-ink-mute">{t('devices.irEdit.learnSomeFirst')}</p>}
            {allCommands.map((c) => (
              <button key={c.id} onClick={() => addStep(c.id)}
                className="block w-full px-2 py-1 text-left text-xs text-ink-2 hover:bg-surface-2">
                {c.label} <span className="text-[10px] text-ink-mute font-mono">{c.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-1">
        <button onClick={onCancel} className="px-2 h-7 text-[11px] text-ink-mute">{t('devices.irEdit.cancel')}</button>
        <button onClick={save} disabled={!name.trim() || !steps.length}
          className="px-3 h-7 text-[11px] rounded-md bg-accent text-on-accent disabled:opacity-40">
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
    try {
      await patchIrDevice(device.id, {
        name: form.name.trim(),
        device_type: form.device_type,
        room: form.room || null,
        brand: form.brand.trim() || null,
      })
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
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-2xl border border-line flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div>
            <h2 dir="auto" className="text-base font-semibold text-ink">{device.name}</h2>
            <p className="text-[10px] text-ink-mute">{t('devices.commandsLearned', { n: learnedSet.size })}</p>
          </div>
          <button onClick={onClose} className="text-ink-mute hover:text-ink-2 text-lg leading-none" aria-label={t('common.close')}>✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pb-3 shrink-0">
          {[
            { id: 'details', label: t('devices.irEdit.tabDetails') },
            { id: 'commands', label: t('devices.irEdit.tabCommands') },
            { id: 'macros', label: t('devices.irEdit.tabMacros') },
          ].map((tabDef) => (
            <button key={tabDef.id} onClick={() => setTab(tabDef.id)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                tab === tabDef.id ? 'bg-ink text-bg' : 'text-ink-mute hover:bg-surface-2'
              )}
            >{tabDef.label}{tabDef.id === 'macros' && sequences.length > 0 ? ` (${sequences.length})` : ''}</button>
          ))}
        </div>

        {/* Body */}
        <div className="px-5 pb-2 overflow-y-auto flex-1">
          {tab === 'details' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-ink-mute mb-1">{t('devices.irEdit.name')}</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} dir="auto" className={INPUT_CLS} />
              </div>
              <div>
                <label className="block text-xs text-ink-mute mb-1">{t('devices.irEdit.type')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {IR_DEVICE_TYPES.map((dt) => (
                    <button key={dt} onClick={() => setForm({ ...form, device_type: dt })}
                      className={cn('px-3 py-1 rounded-lg text-xs border transition-all capitalize',
                        form.device_type === dt ? 'border-accent bg-accent/15 text-accent' : 'border-line text-ink-mute hover:bg-line'
                      )}
                    >{dt}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-ink-mute mb-1">{t('devices.irEdit.room')}</label>
                <select value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} className={INPUT_CLS}>
                  <option value="">{t('devices.irEdit.noRoom')}</option>
                  {rooms.map((r) => <option key={r.id ?? r.name} value={r.id ?? r.area_id ?? r.name}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-mute mb-1">{t('devices.irEdit.brand')}</label>
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
              <p className="text-[11px] text-ink-mute mb-2">
                {t('devices.irEdit.commandsHelp')}
              </p>
              {groups.length === 0 && <p className="text-xs text-ink-mute py-4">{t('devices.irEdit.loadingCatalog')}</p>}
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
                className="w-full mt-2 h-8 rounded-lg text-xs text-accent border border-dashed border-accent-soft hover:bg-accent-soft">
                {t('devices.irEdit.addCustom')}
              </button>
            </div>
          )}

          {tab === 'macros' && (
            <div>
              <p className="text-[11px] text-ink-mute mb-2">
                {t('devices.irEdit.macrosHelp')}
              </p>
              {sequences.length === 0 && !buildingSeq && (
                <p className="text-xs text-ink-mute py-2">{t('devices.irEdit.noMacros')}</p>
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
                  className="w-full mt-2 h-8 rounded-lg text-xs text-accent border border-dashed border-accent-soft hover:bg-accent-soft">
                  {t('devices.irEdit.newMacro')}
                </button>
              )}
            </div>
          )}
        </div>

        {error && <p className="px-5 pb-1 text-xs text-err">{error}</p>}

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-line shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink-mute hover:text-ink-2 transition-colors">{t('common.close')}</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-ink text-bg disabled:opacity-50 transition-opacity"
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
// Each entry: { cmd, icon, label }  — only shown when command is learned.
const IR_QUICK_BUTTONS = {
  tv: [
    { cmd: 'power',       icon: '⏻', label: 'Power' },
    { cmd: 'volume_up',   icon: '🔊', label: 'Vol+' },
    { cmd: 'volume_down', icon: '🔉', label: 'Vol−' },
    { cmd: 'mute',        icon: '🔇', label: 'Mute' },
  ],
  soundbar: [
    { cmd: 'power',       icon: '⏻', label: 'Power' },
    { cmd: 'volume_up',   icon: '🔊', label: 'Vol+' },
    { cmd: 'volume_down', icon: '🔉', label: 'Vol−' },
    { cmd: 'mute',        icon: '🔇', label: 'Mute' },
  ],
  projector: [
    { cmd: 'power',       icon: '⏻', label: 'Power' },
  ],
  fan: [
    { cmd: 'power',        icon: '⏻', label: 'Power' },
    { cmd: 'speed_low',    icon: '〜', label: 'Low' },
    { cmd: 'speed_medium', icon: '≈', label: 'Med' },
    { cmd: 'speed_high',   icon: '≋', label: 'High' },
  ],
  ac: [
    { cmd: 'power',     icon: '⏻', label: 'Power' },
    { cmd: 'mode_cool', icon: '❄', label: 'Cool' },
    { cmd: 'mode_heat', icon: '🔥', label: 'Heat' },
    { cmd: 'mode_fan',  icon: '💨', label: 'Fan' },
  ],
}
const IR_DEFAULT_QUICK = [{ cmd: 'power', icon: '⏻', label: 'Power' }]

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
    <div className="mt-2.5 pt-2.5 border-t border-line flex gap-1.5 flex-wrap">
      {buttons.map(({ cmd, icon, label }) => {
        const localized = labelKey(label)
        return (
          <button
            key={cmd}
            onClick={() => onCommand(device.id, cmd)}
            title={localized}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-2 text-ink-2 hover:bg-line transition-colors text-xs font-medium"
          >
            <span className="text-[11px]">{icon}</span>
            <span className="text-[10px]">{localized}</span>
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
  const assumedState = device.assumed_state && device.assumed_state !== 'unknown'
    ? device.assumed_state : null
  const stateOptions = IR_STATE_OPTIONS[device.device_type ?? device.type] || IR_STATE_OPTIONS.default
  // AC state — populated by protocol decoders when a physical-remote packet
  // is recognized (currently Mitsubishi, Daikin, Gree-vanilla). Tadiran
  // packets decode but state-bit mapping isn't implemented yet, so this
  // stays empty for Tadiran until the bit-position pass lands.
  const isAc = (device.device_type ?? device.type) === 'ac'
  const acMemory = isAc ? (device.ac_memory || {}) : null
  const acFacts = []
  if (acMemory?.temp != null) acFacts.push(`${acMemory.temp}°C`)
  if (acMemory?.mode) acFacts.push(String(acMemory.mode).toLowerCase())
  if (acMemory?.fan) acFacts.push(`fan ${String(acMemory.fan).toLowerCase()}`)

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-accent" />
        </div>
        <div>
          <p dir="auto" className="text-sm font-medium text-ink leading-tight">{device.name}</p>
          {room && <p dir="auto" className="text-xs text-ink-mute mt-0.5 capitalize">{room}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-ink-mute">{t('devices.commandsCount', { learned: learnedCount, total: totalCount })}</span>
            {/* Interactive assumed-state chip — for AC, the state line also
                surfaces decoded temp/mode/fan from physical-remote packets. */}
            <div className="relative">
              <button
                onClick={() => setShowStatePicker((v) => !v)}
                title={t('devices.irAssumedTooltipPlain')}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors',
                  assumedState === 'on' || (assumedState && assumedState !== 'off')
                    ? 'bg-ok-soft border-ok-soft text-ok'
                    : assumedState === 'off'
                    ? 'bg-surface-2 border-line text-ink-mute'
                    : 'bg-surface-2/50 border-dashed border-line text-ink-mute'
                )}
              >
                <span>{assumedState ?? t('common.unknown')}</span>
                {acFacts.length > 0 && (
                  <span className="opacity-80">· {acFacts.join(' · ')}</span>
                )}
                <span className="text-[9px] opacity-60 ml-0.5">{t('devices.assumedSuffix')} ▾</span>
              </button>
              <AnimatePresence>
                {showStatePicker && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.1 }}
                    className="absolute bottom-full left-0 mb-1 z-50 bg-surface rounded-xl shadow-xl border border-line overflow-hidden min-w-[100px]"
                  >
                    <p className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-ink-mute">{t('devices.setAssumedState')}</p>
                    {stateOptions.map((s) => (
                      <button
                        key={s}
                        onClick={() => { onStateChange(device.id, s); setShowStatePicker(false) }}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 transition-colors capitalize',
                          assumedState === s ? 'text-accent font-semibold' : 'text-ink-2'
                        )}
                      >
                        {assumedState === s && <span className="text-accent text-[10px]">✓</span>}
                        {s}
                      </button>
                    ))}
                    <div className="border-t border-line mt-1 pt-1 pb-1">
                      <button
                        onClick={() => { onStateChange(device.id, 'unknown'); setShowStatePicker(false) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-ink-mute hover:bg-surface-2 transition-colors"
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
      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        <button
          onClick={() => onEdit(device)}
          className="text-ink-faint hover:text-accent transition-colors"
          title={t('devices.editIrDevice')}
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(device.id)}
          className="text-ink-faint hover:text-err transition-colors"
          title={t('devices.removeIrDevice')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      </div>
      <IRQuickControls device={device} onCommand={onCommand} />
    </Card>
  )
}

// Status-based filter chips — always visible regardless of device inventory.
// Labels are resolved at render time via useT() in the page component so
// they react to the active language. The icons stay outside translation.
function buildStatusFilters(t) {
  return [
    { id: 'all',           label: t('devices.filterAll') },
    { id: 'unassigned',    label: `📦 ${t('devices.filterUnassigned')}` },
    { id: 'noroom',        label: `🏠 ${t('devices.filterNoRoom')}` },
    { id: 'offline',       label: `🔴 ${t('devices.filterOffline')}` },
    { id: 'active',        label: `🟢 ${t('devices.filterActive')}` },
    { id: 'connected',     label: `🔗 ${t('devices.filterConnected')}` },
    { id: 'ir',            label: `📡 ${t('devices.filterIr')}` },
    { id: 'smart_sensors', label: `✨ ${t('devices.filterSmartSensors')}` },
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
      transition={{ duration: 0.15 }}
    >
      <Card
        className="p-4 transition-all duration-200"
        style={{
          background: `color-mix(in srgb, var(--accent) 5%, var(--surface))`,
          border: `0.5px solid color-mix(in srgb, var(--accent) 22%, var(--line))`,
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `color-mix(in srgb, var(--accent) 18%, var(--surface))`,
            color: 'var(--accent)',
            flexShrink: 0,
          }}>
            <Sparkles size={18} strokeWidth={2.2} />
          </div>
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              className="p-1 rounded-lg text-ink-mute hover:text-ink-2 hover:bg-line transition-colors"
              aria-label={t('common.more')}
            >
              <MoreVertical size={14} />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.12 }}
                  style={{ position: 'absolute', top: '100%', insetInlineEnd: 0, marginTop: 4, zIndex: 50, minWidth: 200 }}
                  className="bg-surface rounded-xl shadow-2xl border border-line overflow-hidden"
                >
                  <button
                    onClick={() => { setSourcesOpen(true); setMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-ink-2 hover:bg-surface-2 text-start"
                  >
                    <Eye size={12} /> {t('devices.smartSensor.viewSources')}
                  </button>
                  {/* Delete — removes the fused HA template helper AND clears
                      Ziggy's KV record so it doesn't reappear on reload. Only
                      offered when we hold the entry_id (older KV records without
                      one can't be targeted). */}
                  {entryId && (
                    <button
                      onClick={() => { setConfirmOpen(true); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-err hover:bg-surface-2 text-start"
                    >
                      <Trash2 size={12} /> {t('devices.smartSensor.delete')}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <p dir="auto" className="text-sm font-medium text-ink leading-tight mb-0.5 truncate">
          {entityDisplayName(entity)}
        </p>

        <p dir="auto" className="text-[10.5px] text-ink-mute mb-2 leading-snug">
          {t('devices.smartSensor.subtitle', { n: sources.length })}
          {roomLabel && (
            <> · <span className="capitalize">{roomLabel}</span></>
          )}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 600,
            background: isUnavailable
              ? 'var(--surface-2)'
              : isOccupied
                ? `color-mix(in srgb, var(--ok) 16%, var(--surface))`
                : 'var(--surface-2)',
            color: isUnavailable
              ? 'var(--ink-faint)'
              : isOccupied ? 'var(--ok)' : 'var(--ink-mute)',
            border: `0.5px solid ${isOccupied && !isUnavailable
              ? `color-mix(in srgb, var(--ok) 35%, var(--line))`
              : 'var(--line)'}`,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
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
              transition={{ duration: 0.18 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{
                marginTop: 10, paddingTop: 10,
                borderTop: '0.5px solid var(--line)',
              }}>
                <p className="text-[9.5px] uppercase tracking-wider text-ink-mute font-semibold mb-1.5">
                  {t('devices.smartSensor.sourcesTitle')}
                </p>
                {sourceLabels.length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {sourceLabels.map((label, i) => (
                      <li key={i} dir="auto" style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 11, color: 'var(--ink-2)',
                      }}>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                        <span className="truncate">{label}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-ink-faint">
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
        <p dir="auto" className="text-sm text-ink-2 leading-relaxed mb-4">
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
      {/* Room header — matches design's RoomBlock header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px 10px' }}>
        {photo && (
          <div style={{ width: 32, height: 32, borderRadius: 9, overflow: 'hidden', background: 'var(--surface-2)', flexShrink: 0 }}>
            <img src={photo} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}
        <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.005em' }}>{label}</span>
            {count != null && <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginInlineStart: 6 }}>{count === 1 ? t('devices.deviceCountOne') : t('devices.deviceCountMany', { n: count })}</span>}
          </div>
          <span style={{ color: 'var(--ink-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        </button>
        {onRoomClick && (
          <button onClick={onRoomClick} style={{ padding: '5px 10px', borderRadius: 8, background: 'transparent', border: '0.5px solid var(--line)', fontSize: 10, fontWeight: 500, color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}>
            {t('devices.openRoom')}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        )}
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} style={{ overflow: 'hidden' }}>
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
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '6px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 500, cursor: 'pointer', background: `color-mix(in srgb, var(--info) 10%, var(--surface))`, color: 'var(--info)', border: `0.5px solid color-mix(in srgb, var(--info) 30%, var(--line))`, fontFamily: 'inherit' }}
      >
        <span>{t('devices.assignToRoom')}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.12s' }}><path d="M6 9l6 6 6-6"/></svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.12 }}
            style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4, zIndex: 50, background: 'var(--surface)', borderRadius: 11, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '0.5px solid var(--line)', overflow: 'hidden' }}
          >
            <div style={{ padding: '4px 0', maxHeight: 192, overflowY: 'auto' }}>
              <button onClick={() => { onAssign(entityId, null); setOpen(false) }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', borderBottom: '0.5px solid var(--line)', cursor: 'pointer', textAlign: 'start', fontSize: 12, color: 'var(--ink-faint)', fontFamily: 'inherit' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <Home size={11} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                {t('devices.noRoom')}
              </button>
              {rooms.map(r => (
                <button key={r.id} onClick={() => { onAssign(entityId, r.id); setOpen(false) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start', fontSize: 12, color: 'var(--ink-2)', fontFamily: 'inherit' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--info)', flexShrink: 0 }} />
                  <span dir="auto">{r.name}</span>
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
      const menuW = 192  // w-48
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
        className="p-1 rounded-lg text-ink-mute hover:text-ink-2 hover:bg-line transition-colors"
      >
        <MoreVertical size={14} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, zIndex: 9999 }}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="w-48 bg-surface rounded-xl shadow-2xl border border-line overflow-hidden"
          >
            <div className="py-1">
              {currentRoom && (
                <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-ok shrink-0" />
                  <span className="text-[11px] text-ink-mute" dir="auto">
                    <span className="font-semibold text-ink-2">{currentRoom.name}</span>
                  </span>
                </div>
              )}
              <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                {t('devices.assignToRoom')}
              </p>
              <button
                onClick={() => { onAssign(entity.entity_id, null); setOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 transition-colors',
                  !currentRoom ? 'text-accent font-medium' : 'text-ink-mute'
                )}
              >
                <Home size={12} /> {t('devices.noRoom')}
              </button>
              {rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { onAssign(entity.entity_id, r.id); setOpen(false) }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 transition-colors',
                    currentRoom?.id === r.id
                      ? 'text-accent font-semibold'
                      : 'text-ink-2'
                  )}
                >
                  <span className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    currentRoom?.id === r.id ? 'bg-accent' : 'bg-line'
                  )} />
                  <span dir="auto">{r.name}</span>
                  {currentRoom?.id === r.id && <span className="ml-auto text-[10px] text-accent">✓</span>}
                </button>
              ))}
              <div className="border-t border-line mt-1 pt-1">
                <button
                  onClick={() => {
                    isHidden ? onUnhide(entity.entity_id) : onHide(entity.entity_id)
                    setOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-ink-mute hover:bg-surface-2 transition-colors"
                >
                  {isHidden
                    ? <><Eye size={12} /> {t('devices.showDevice')}</>
                    : <><EyeOff size={12} /> {t('devices.hideDevice')}</>
                  }
                </button>
                {extraItems.map((item, i) => (
                  <button key={i} onClick={() => { item.onClick(); setOpen(false) }}
                    className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 transition-colors', item.className || 'text-ink-2')}
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
      <p className="text-xs text-ink-mute mb-4 -mt-1 leading-relaxed">
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
      const menuW = 208 // w-52
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
        className="p-1 rounded-lg text-ink-mute hover:text-ink-2 hover:bg-line transition-colors"
      >
        <MoreVertical size={14} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, zIndex: 9999 }}
            initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }} transition={{ duration: 0.12 }}
            className="w-52 bg-surface rounded-xl shadow-2xl border border-line overflow-hidden"
          >
            <div className="py-1">
              {currentRoom && (
                <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-ok shrink-0" />
                  <span className="text-[11px] text-ink-mute" dir="auto">
                    <span className="font-semibold text-ink-2">{currentRoom.name}</span>
                  </span>
                </div>
              )}
              <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">{t('devices.assignToRoom')}</p>
              <button onClick={() => { onAssign(null); setOpen(false) }}
                className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2', !currentRoom ? 'text-accent font-medium' : 'text-ink-mute')}
              >
                <Home size={12} /> {t('devices.noRoom')}
              </button>
              {rooms.map((r) => (
                <button key={r.id} onClick={() => { onAssign(r.id); setOpen(false) }}
                  className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2', currentRoom?.id === r.id ? 'text-accent font-semibold' : 'text-ink-2')}
                >
                  <span className={cn('w-2 h-2 rounded-full shrink-0', currentRoom?.id === r.id ? 'bg-accent' : 'bg-line')} />
                  <span dir="auto">{r.name}</span>
                  {currentRoom?.id === r.id && <span className="ml-auto text-[10px] text-accent">✓</span>}
                </button>
              ))}
              <div className="border-t border-line mt-1 pt-1">
                <button onClick={() => { onEdit(); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-ink-2 hover:bg-surface-2"
                >
                  <Pencil size={12} /> {t('devices.editIrDevice')}
                </button>
                {irDevice?.ha_entity_id ? (
                  <button onClick={() => { onUnlinkFromWifi?.(); setOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-accent hover:bg-surface-2"
                  >
                    ⬡ {t('devices.unlinkFromWifi')}
                  </button>
                ) : (
                  <button onClick={() => { onLinkToWifi?.(); setOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-accent hover:bg-surface-2"
                  >
                    ⬡ {t('devices.linkToWifi')}
                  </button>
                )}
                <button onClick={() => { onDelete(); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-err hover:bg-surface-2"
                >
                  <Trash2 size={12} /> {t('common.remove')}
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

  return (
    <motion.div
      ref={ref} layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: isHidden ? 0.45 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.15 }}
    >
      <Card className={cn('p-4 transition-all duration-200', isActive && !isHidden && 'shadow-card-hover')}>
        {/* ── Card header ── */}
        <div className="flex items-start justify-between mb-3">
          <div style={{
            width: 40, height: 40, borderRadius: 12, fontSize: 21,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
            background: isActive ? 'var(--ink)' : 'var(--surface-2)',
            color: isActive ? 'var(--bg)' : 'var(--ink)',
          }}>
            {/* Always use the kind-derived emoji. The non-IR branch used to
                read `domainIcon(entity.domain, ...)` which only knew the raw
                HA domain — a Switcher Touch boiler (`switch.switcher_touch_*`)
                showed the generic switch icon, while the detail page showed
                🔥 via getKind. Routing both through getKind+kindMeta keeps
                vendor heuristics (Switcher boilers, future overrides) in
                one place and the icon consistent across views. */}
            <span style={{ fontSize: 21, lineHeight: 1 }} aria-hidden="true">{entity.icon || kindMeta(getKind(entity)).icon}</span>
            {(isIr || linkedIr) && (
              <span style={{ position: 'absolute', bottom: -3, right: -3, background: 'var(--accent)', color: '#fff', fontSize: 6, fontWeight: 700, padding: '1px 4px', borderRadius: 3, lineHeight: 1.2 }}>IR</span>
            )}
            {!isIr && !linkedIr && ziggyStatus && STATUS_DOT[ziggyStatus] && (
              <span className={cn('absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2', STATUS_DOT[ziggyStatus])} style={{ borderColor: 'var(--surface)' }} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Navigate to full device detail page — same for HA and IR.
                DeviceDetail handles `ir.<id>` entity_ids via its isIrTarget branch. */}
            <button
              onClick={() => navigate(`/devices/${encodeURIComponent(entity.entity_id)}`)}
              className="p-1 rounded-lg text-ink-faint hover:text-ink-mute hover:bg-surface-2 transition-colors"
              title={t('devices.deviceDetailsTooltip')}
            >
              <ChevronRight size={14} className="icon-flip-rtl" />
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
                  { label: t('devices.editIrRemote'), icon: <Pencil size={12} />, onClick: () => onEditIr(linkedIr) },
                  { label: t('devices.unlinkIr'), icon: <span className="text-[11px]">⬡</span>, onClick: () => onUnlinkIr(linkedIr.id), className: 'text-accent' },
                ]}
              />
            ) : (
              <DeviceMenu entity={entity} rooms={rooms} onHide={onHide} onUnhide={onUnhide} isHidden={isHidden} onAssign={onAssign} />
            )}
          </div>
        </div>

        {/* ── Name ── */}
        <p dir="auto" className="text-sm font-medium text-ink leading-tight mb-0.5 truncate">
          {entityDisplayName(entity)}
        </p>

        {/* ── State ── */}
        {isIr ? (
          // Standalone IR: assumed state chip with picker, plus a "Show controls"
          // affordance for controllable kinds (AC, TV, fan, etc.) — same as the
          // HA branch below.
          // State row: chip on the left, AC temp stepper in the middle (for
          // IR ACs), "Show controls" link on the right. `space-between`
          // auto-spaces the three elements; `flex-wrap` lets the stepper
          // drop to a second line on the narrowest cards rather than
          // smushing the chip / show-controls. The dropdown popover is now
          // fixed-positioned so it can never be clipped regardless of where
          // the chip ends up on the row.
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', rowGap: 4 }}>
            <AssumedStatePicker
              irDevice={irDevice}
              assumedState={assumedState}
              irConfidence={irConfidence}
              isStale={isStale}
              ageHours={ageHours}
              irStateOptions={irStateOptions}
              onIrStateChange={onIrStateChange}
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
            {kindMeta(getKind(entity)).controllable && (
              <button
                onClick={() => setControlsExpanded(v => !v)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--accent)', fontSize: 10.5, fontWeight: 600,
                  fontFamily: 'inherit', padding: '2px 4px', flexShrink: 0,
                }}
              >
                {controlsExpanded ? t('devices.hideControls') : t('devices.showControls')}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: controlsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            )}
          </div>
        ) : showStatusBadge ? (
          <p className="text-xs font-medium text-err">{statusBadgeLabel}</p>
        ) : (() => {
          // Read-only kinds (sensors, motion, door, etc.) collapse primary +
          // secondary onto one line so the tile is just name + reading.
          // Controllable kinds put the state and "Show controls" affordance
          // on the same row so the tile is no taller than a sensor tile.
          const isControllable = kindMeta(getKind(entity)).controllable
          const showsExpander  = !isHidden && isControllable && entity.state !== 'unavailable'
          const colorClass = cn(
            'text-xs font-medium',
            isHidden ? 'text-ink-faint' :
            entity.state === 'unavailable' ? 'text-ink-faint' :
            isActive ? 'text-ok' : 'text-ink-faint',
          )
          return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <p className={cn(colorClass, 'truncate min-w-0 flex-1')}>
                {stateLabel}
                {!isControllable && stateSecondary && (
                  <span className="text-ink-faint font-normal ml-1">· {stateSecondary}</span>
                )}
              </p>
              {showsExpander && (
                <button
                  onClick={() => setControlsExpanded(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--accent)', fontSize: 10.5, fontWeight: 600,
                    fontFamily: 'inherit', padding: '2px 4px', flexShrink: 0,
                  }}
                >
                  {controlsExpanded ? t('devices.hideControls') : t('devices.showControls')}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: controlsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
              )}
            </div>
          )
        })()}
        {!isIr && stateSecondary && !isHidden && kindMeta(getKind(entity)).controllable && (
          <p className="text-xs text-ink-faint mt-0.5">{stateSecondary}</p>
        )}
        {isIr && irDevice?.last_command_sent_at && (
          <p className="text-[10px] text-ink-faint mt-0.5 truncate">
            {t('devices.last')}: {irDevice.last_command_sent?.replace(/_/g, ' ')} · {_fmtAgo(irDevice.last_command_sent_at)}
          </p>
        )}

        {/* Expanded control surface — animated height + fade so opening
            and closing doesn't snap the list around. Hidden / sensor /
            unavailable devices never reach this branch. */}
        {!isHidden && kindMeta(getKind(entity)).controllable && entity.state !== 'unavailable' && (
          <AnimatePresence initial={false}>
            {controlsExpanded && (
              <motion.div
                key="controls"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ marginTop: 10, paddingTop: 12, borderTop: '0.5px solid var(--line)' }}>
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
      else if (domain === 'offline') matchDomain = e.state === 'unavailable' || e.state === 'unknown'
      else if (domain === 'connected') matchDomain = e.state !== 'unavailable' && e.state !== 'unknown'
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
    try {
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
      await fetchAll()
      addToast(roomId ? t('devices.assigned') : t('devices.removedFromRoom'), 'success')
    } catch (e) { addToast(e.message || t('common.failed'), 'error') }
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
  const [blasters, setBlasters] = useState([])
  const [blastersOpen, setBlastersOpen] = useState(false)  // collapsed by default
  const loadBlasters = () => listIrBlasters().then(b => setBlasters(Array.isArray(b) ? b : [])).catch(() => {})
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
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('devices.eyebrow')}</p>
          <h1 className="z-display" style={{ fontSize: 26, margin: 0 }}>{t('devices.title')}</h1>
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            {t('devices.subtitleActive', { active: activeCount, total: getTotalControllable(), totalEntities: entities.length })}
            {hiddenCount > 0 && ` · ${t('devices.subtitleHidden', { n: hiddenCount })}`}
            {unassigned.length > 0 && <span style={{ color: 'var(--warn)', marginInlineStart: 4 }}>· {t('devices.subtitleUnassigned', { n: unassigned.length })}</span>}
            {noRoomEntities.length > 0 && <span style={{ color: 'var(--ink-faint)', marginInlineStart: 4 }}>· {t('devices.subtitleNoRoom', { n: noRoomEntities.length })}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {hiddenCount > 0 && (
            <button onClick={toggleShowHidden} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
              background: showHidden ? 'var(--ink)' : 'var(--surface)',
              color: showHidden ? 'var(--bg)' : 'var(--ink-mute)',
              border: showHidden ? 'none' : '0.5px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
              {showHidden ? t('devices.showingHidden') : t('devices.showHidden')}
            </button>
          )}
          {unassignedSignalCount > 0 && (
            <button
              onClick={() => setShowUnassignedSignals(true)}
              title={t('devices.unassignedSignalsTooltip')}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                background: `color-mix(in srgb, var(--accent) 12%, var(--surface))`,
                color: 'var(--accent)',
                border: `0.5px solid color-mix(in srgb, var(--accent) 30%, var(--line))`,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <Radio size={12} />
              {t('devices.unknownSignals', { n: unassignedSignalCount })}
            </button>
          )}
          <button onClick={() => setShowPairing(true)} className="z-btn-primary" style={{ padding: '8px 14px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Plus size={13} /> {t('devices.pairDevice')}
          </button>
        </div>
      </div>

      {/* Unassigned banner */}
      {unassigned.length > 0 && domain !== 'unassigned' && domain !== 'noroom' && (
        <motion.button initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          onClick={() => setDomain('unassigned')}
          style={{
            width: '100%', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderRadius: 11, textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit',
            background: `color-mix(in srgb, var(--warn) 8%, var(--surface))`, border: '0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))',
          }}
        >
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              {unassigned.length === 1 ? t('devices.unassignedBannerOne', { n: unassigned.length }) : t('devices.unassignedBannerMany', { n: unassigned.length })}
            </p>
            <p style={{ fontSize: 11, color: 'var(--warn)', marginTop: 2 }}>{t('devices.unassignedBannerHint')}</p>
          </div>
          <span style={{ fontSize: 12, color: 'var(--warn)', fontWeight: 500 }}>{t('devices.review')} ›</span>
        </motion.button>
      )}

      {/* Attention banner — each row is now actionable. Tap the row to open
          the device page (which has the ghost UI for full cleanup), or tap
          the trash icon for one-shot removal from Ziggy's registry. */}
      {attentionDevices.length > 0 && domain !== 'attention' && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          style={{ marginBottom: 14, borderRadius: 11, background: `color-mix(in srgb, var(--accent) 8%, var(--surface))`, border: '0.5px solid color-mix(in srgb, var(--accent) 30%, var(--line))', overflow: 'hidden' }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--line)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              {attentionDevices.length === 1 ? t('devices.attentionTitleOne', { n: attentionDevices.length }) : t('devices.attentionTitleMany', { n: attentionDevices.length })}
            </p>
            <p style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>{t('devices.attentionSubtitle')}</p>
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
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 14px', borderBottom: '0.5px solid var(--line)',
                    cursor: eid ? 'pointer' : 'default',
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.status === 'lost' ? 'var(--accent)' : 'var(--line-2)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p dir="auto" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{translateNamePhrase(d.display_name || eid || d.device_type, lang)}</p>
                    <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }} dir="auto">{d.roomName ? `${translateNamePhrase(d.roomName, lang)} · ` : ''}{getStatusLabel(t, d.status) || d.status}</p>
                  </div>
                  {eid && (
                    <button
                      onClick={handleRemove}
                      disabled={busy}
                      title={t('devices.removeFromZiggy')}
                      style={{
                        padding: 6, borderRadius: 8, background: 'transparent', border: 'none',
                        cursor: busy ? 'default' : 'pointer', color: 'var(--err)',
                        display: 'flex', alignItems: 'center', flexShrink: 0,
                      }}
                    >
                      <Trash2 size={14} />
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
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <span style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('devices.searchPlaceholderShort')} dir="auto" className="z-input" style={{ paddingInlineStart: 34 }} />
        </div>
      )}

      {/* View mode + filter chips */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 20 }} className="scrollbar-thin">
        {/* View mode toggle */}
        {[{ id: 'room', label: 'By room' }, { id: 'type', label: 'By type' }].map(v => (
          <button key={v.id} onClick={() => setViewMode(v.id)} style={{
            padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
            background: viewMode === v.id ? 'var(--ink)' : 'var(--surface)',
            color: viewMode === v.id ? 'var(--bg)' : 'var(--ink-mute)',
            border: viewMode === v.id ? 'none' : '0.5px solid var(--line)',
          }}>{v.label}</button>
        ))}
        <div style={{ width: 1, background: 'var(--line)', flexShrink: 0, margin: '0 2px' }} />
        {DOMAIN_FILTER.map(f => (
          <button key={f.id} onClick={() => { setDomain(f.id); if (f.id !== 'all') setViewMode('type') }} style={{
            padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
            background: domain === f.id && viewMode === 'type'
              ? (f.id === 'unassigned' ? 'var(--warn)' : 'var(--ink)')
              : f.id === 'unassigned' && unassigned.length > 0
              ? `color-mix(in srgb, var(--warn) 8%, var(--surface))`
              : 'var(--surface)',
            color: domain === f.id && viewMode === 'type'
              ? (f.id === 'unassigned' ? '#fff' : 'var(--bg)')
              : f.id === 'unassigned' && unassigned.length > 0 ? 'var(--warn)' : 'var(--ink-mute)',
            border: (domain === f.id && viewMode === 'type') ? 'none' : f.id === 'unassigned' && unassigned.length > 0 ? `0.5px solid color-mix(in srgb, var(--warn) 40%, var(--line))` : '0.5px solid var(--line)',
          }}>
            {f.label}
            {f.id === 'unassigned' && unassigned.length > 0 && (
              <span style={{ marginInlineStart: 4, background: 'var(--warn)', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 999, fontWeight: 700 }}>{unassigned.length}</span>
            )}
            {f.id === 'noroom' && noRoomEntities.length > 0 && (
              <span style={{ marginInlineStart: 4, background: 'var(--ink-faint)', color: 'var(--bg)', fontSize: 9, padding: '1px 5px', borderRadius: 999, fontWeight: 700 }}>{noRoomEntities.length}</span>
            )}
          </button>
        ))}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
            {blasters.map(b => {
              const host = b.ip || b.last_seen_ip || ''
              const color = b.status === 'online' ? 'var(--ok)' : b.status === 'stale' ? 'var(--warn)' : 'var(--err)'
              return (
                <div
                  key={b.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 11,
                    background: 'var(--surface)', border: '0.5px solid var(--line)' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</p>
                    {host && <p style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{host}</p>}
                  </div>
                  <Zap size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                </div>
              )
            })}
          </div>
        </CollapsibleGroup>
      )}

      {/* Unassigned section info */}
      {domain === 'unassigned' && (
        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 11, background: `color-mix(in srgb, var(--warn) 8%, var(--surface))`, border: `0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))` }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{t('devices.unassignedTitle')}</p>
          <p style={{ fontSize: 11, color: 'var(--warn)' }}>{t('devices.unassignedHint')}</p>
        </div>
      )}
      {domain === 'noroom' && (
        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{t('devices.noRoomTitle')}</p>
          <p style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{t('devices.noRoomHint')}</p>
        </div>
      )}

      {/* Loading skeleton — only when we have nothing to show. Once entities
          are populated, keep the existing list visible during a re-fetch
          (stale-while-revalidate) so back-navigation never goes blank just
          because the TTL expired. */}
      {loading && entities.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1,2,3,4,5,6].map(i => <div key={i} style={{ height: 60, borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Empty state — only when truly empty (not just refreshing).
          In `all` mode the Smart Sensors group lives outside `filtered`, so
          we skip the empty banner when at least one smart sensor exists. */}
      {!loading && filtered.length === 0 && !(domain === 'all' && smartSensorEntries.length > 0) && (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--ink-faint)' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
            {domain === 'unassigned' ? 'All devices are assigned to rooms'
              : domain === 'noroom' ? 'No devices without a room'
              : domain === 'smart_sensors' ? t('devices.smartSensor.empty')
              : 'No devices found'}
          </p>
        </div>
      )}

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
        const roomGroups = ziggyRooms.map(room => ({
          room,
          items: (room.devices || [])
            .map(resolveDevice)
            .filter(e => e && entitySet.has(e.entity_id)),
        })).filter(g => g.items.length > 0)
        // Use the same unassigned set as the filter chip so counts are consistent.
        // unassigned = getUnassigned() = non-IR entities in DEVICE_DOMAINS not in any HA area.
        const unroomedItems = unassigned.filter(e => entitySet.has(e.entity_id))

        const noRoomItems = noRoomEntities.filter(e => entitySet.has(e.entity_id))

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
              <CollapsibleGroup label="No Room" count={noRoomItems.length} open={!collapsedGroups.has('__noroom__')} onToggle={() => toggleGroup('__noroom__')}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
                  <AnimatePresence mode="popLayout">
                    {noRoomItems.map(entity => <DeviceCard key={entity.entity_id} {...deviceCardProps(entity)} />)}
                  </AnimatePresence>
                </div>
              </CollapsibleGroup>
            )}
            {unroomedItems.length > 0 && (
              <CollapsibleGroup label="Unassigned" count={unroomedItems.length} open={!collapsedGroups.has('__unassigned__')} onToggle={() => toggleGroup('__unassigned__')}>
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
