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
} from '../lib/api'
import { cn } from '../lib/utils'
import logger from '../lib/logger'

const DEVICE_TYPES = [
  { id: 'tv',        label: 'TV',        Icon: Radio },
  { id: 'ac',        label: 'AC',        Icon: Thermometer },
  { id: 'fan',       label: 'Fan',       Icon: Wind },
  { id: 'soundbar',  label: 'Soundbar',  Icon: Volume2 },
  { id: 'receiver',  label: 'Receiver',  Icon: Volume2 },
  { id: 'projector', label: 'Projector', Icon: MonitorPlay },
  { id: 'custom',    label: 'Custom',    Icon: Zap },
]

const LEARN_DURATION = 20  // seconds

// ---------------------------------------------------------------------------

function StepIndicator({ step, total }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors duration-300',
            i < step ? 'bg-violet-500' : i === step - 1 ? 'bg-violet-400' : 'bg-white/10',
          )}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Select blaster
// ---------------------------------------------------------------------------

function StepSelectBlaster({ selected, onSelect }) {
  const [discovered, setDiscovered]   = useState([])
  const [discovering, setDiscovering] = useState(false)
  const [manualIp, setManualIp]       = useState('')
  const [manualError, setManualError] = useState('')

  const runDiscover = () => {
    setDiscovering(true)
    discoverIrBlasters()
      .then(setDiscovered)
      .catch(() => {})
      .finally(() => setDiscovering(false))
  }

  useEffect(() => { runDiscover() }, [])

  const selectDirect = (host, label) =>
    onSelect({ blaster_host: host, entity_id: null, label: label || host })

  const handleManualIp = () => {
    const ip = manualIp.trim()
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      setManualError('Enter a valid IP address, e.g. 192.168.1.45')
      return
    }
    setManualError('')
    selectDirect(ip, `Broadlink at ${ip}`)
  }

  return (
    <div className="space-y-4">

      {/* Auto-discover results */}
      {discovering ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning network…
        </div>
      ) : discovered.length > 0 ? (
        <div className="space-y-2">
          {discovered.map((d) => {
            const isSelected = selected?.blaster_host === d.host
            return (
              <button
                key={d.host}
                onClick={() => selectDirect(d.host, d.name || d.type)}
                className={cn(
                  'w-full text-left p-3 rounded-xl border transition-all',
                  isSelected
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700',
                )}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{d.name || d.type}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 font-medium">IR receive</span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">{d.host}</p>
              </button>
            )
          })}
          <button onClick={runDiscover} className="text-xs text-zinc-400 hover:text-zinc-500">Scan again</button>
        </div>
      ) : null}

      {/* Manual IP — always visible, primary path when discovery fails */}
      <div>
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
          {discovered.length > 0 ? 'Or enter IP manually' : 'Enter your Broadlink IP address'}
        </p>
        <p className="text-[11px] text-zinc-400 mb-2">
          Find it in your router's device list, or in HA → Settings → Integrations → Broadlink → Configure.
        </p>
        <div className="flex gap-2">
          <input
            value={manualIp}
            onChange={(e) => { setManualIp(e.target.value); setManualError('') }}
            onKeyDown={(e) => e.key === 'Enter' && handleManualIp()}
            placeholder="192.168.1.x"
            className={cn(
              'flex-1 h-9 px-3 rounded-xl text-sm border font-mono',
              'bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100',
              manualError
                ? 'border-red-400'
                : selected?.blaster_host === manualIp.trim() && manualIp.trim()
                ? 'border-violet-500'
                : 'border-zinc-200 dark:border-zinc-700',
              'focus:outline-none focus:ring-2 focus:ring-violet-500/40',
            )}
          />
          <button
            onClick={handleManualIp}
            disabled={!manualIp.trim()}
            className="px-3 h-9 rounded-xl text-xs font-medium bg-violet-500 text-white disabled:opacity-40 hover:bg-violet-600 transition-colors"
          >
            Use this IP
          </button>
        </div>
        {manualError && <p className="text-xs text-red-400 mt-1">{manualError}</p>}
        {selected?.blaster_host && !selected?.entity_id && (
          <p className="text-xs text-violet-500 mt-1.5">
            Selected: {selected.blaster_host} — IR receive enabled
          </p>
        )}
      </div>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Device details
// ---------------------------------------------------------------------------

function StepDeviceDetails({ details, onChange }) {
  const [rooms, setRooms] = useState([])

  useEffect(() => {
    getRooms().then((r) => setRooms(Array.isArray(r) ? r : r.areas ?? r.rooms ?? [])).catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Device name *</label>
        <Input
          value={details.name}
          onChange={(e) => onChange({ ...details, name: e.target.value })}
          placeholder="Living Room TV"
        />
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1.5">Device type *</label>
        <div className="grid grid-cols-3 gap-2">
          {DEVICE_TYPES.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => onChange({ ...details, device_type: id })}
              className={cn(
                'flex flex-col items-center gap-1 py-2 px-3 rounded-lg border text-xs transition-all',
                details.device_type === id
                  ? 'border-violet-500 bg-violet-500/15 text-violet-600 dark:text-violet-300'
                  : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700',
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Room</label>
        <select
          value={details.room}
          onChange={(e) => onChange({ ...details, room: e.target.value })}
          className={cn(
            'w-full h-10 px-3 rounded-xl text-sm border',
            'bg-zinc-50 dark:bg-zinc-800',
            'text-zinc-900 dark:text-zinc-100',
            'border-zinc-200 dark:border-zinc-700',
            'focus:outline-none focus:ring-2 focus:ring-violet-500/50',
          )}
        >
          <option value="">— select room —</option>
          {rooms.map((r) => (
            <option key={r.id ?? r.area_id ?? r.name} value={r.id ?? r.area_id ?? r.name}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Brand (optional)</label>
        <Input
          value={details.brand}
          onChange={(e) => onChange({ ...details, brand: e.target.value })}
          placeholder="Samsung, LG, Daikin…"
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
    <div className="flex items-center gap-2 py-1.5">
      <div className={cn(
        'w-2 h-2 rounded-full shrink-0',
        status === 'learned' ? 'bg-green-400' :
        status === 'error'   ? 'bg-red-400' :
        status === 'learning'? 'bg-yellow-400 animate-pulse' :
                               'bg-zinc-300 dark:bg-zinc-600',
      )} />

      <span className="flex-1 min-w-0 text-xs text-zinc-700 dark:text-zinc-300">
        <span className="font-medium">{cmd.label}</span>
        {cmd.id !== cmd.label && (
          <span className="text-[10px] text-zinc-400 ml-1 font-mono">· {cmd.id}</span>
        )}
      </span>

      {recentSignal && status !== 'learned' && status !== 'learning' && (
        <button onClick={bindRecent}
          className="text-[10px] text-violet-400 hover:text-violet-600 whitespace-nowrap"
          title="Bind the IR signal we just captured">
          ⚡ bind
        </button>
      )}

      {status === 'learning' ? (
        <span className="text-xs text-yellow-500 w-14 text-center font-mono">{countdown}s…</span>
      ) : (
        <Button
          size="xs"
          variant={status === 'learned' ? 'ghost' : 'secondary'}
          onClick={startLearning}
          className="w-14 text-xs"
          title="Learn a new code from your remote"
        >
          {status === 'learned' ? <Check className="w-3 h-3 text-green-400" /> : 'Learn'}
        </Button>
      )}

      <Button
        size="xs"
        variant="ghost"
        onClick={testCommand}
        disabled={!deviceId || status === 'learning' || status !== 'learned'}
        className="text-xs w-10"
        title="Fire the command. Useful for verifying."
      >
        Test
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
    return <p className="text-xs text-zinc-400 py-4">Loading commands…</p>
  }

  const groups = catalog.groups || []

  return (
    <div>
      <p className="text-xs text-zinc-500 mb-3">
        Core commands are listed first. Tap <strong className="text-zinc-700 dark:text-zinc-300">Learn</strong> then press the button on your physical remote within 20 seconds — or press the button first and tap <strong className="text-zinc-700 dark:text-zinc-300">⚡ bind</strong>. Optional buttons (sleep, eco, etc.) live behind each group's expand link.
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
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{g.label}</span>
                {extras.length > 0 && (
                  <button onClick={() => toggleGroup(g.id)}
                    className="text-[10px] text-violet-400 hover:text-violet-600">
                    {isOpen ? `Hide optional (${extras.length})` : `+ ${extras.length} optional${learnedExtras.length ? ` · ${learnedExtras.length} learned` : ''}`}
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
          <p className="text-xs text-zinc-400 py-2">No commands available for this device type.</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Done
// ---------------------------------------------------------------------------

function StepDone({ deviceName }) {
  return (
    <div className="flex flex-col items-center py-8 gap-4">
      <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center">
        <Check className="w-7 h-7 text-green-400" />
      </div>
      <p className="text-zinc-900 dark:text-zinc-100 font-medium">{deviceName} is ready!</p>
      <p className="text-sm text-zinc-500 text-center">
        You can now control it with voice commands or from the Devices page.
        Add more commands any time by editing the device.
      </p>
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-200 dark:border-violet-800">
        <Wifi className="w-4 h-4 text-violet-500 shrink-0" />
        <p className="text-xs text-violet-700 dark:text-violet-300">
          Physical remote detection is active. Ziggy will update device state when someone uses the original remote.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 4

export default function IRWizard({ onClose, onCreated }) {
  const [step, setStep]               = useState(1)
  const [blaster, setBlaster]         = useState(null)
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
        setSaveError(e.message || 'Failed to create device.')
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

  const titles = [
    'Select IR Blaster',
    'Device Details',
    'Learn Commands',
    'All Done',
  ]

  return (
    <Modal open fullScreen onClose={onClose} title={titles[step - 1]}>
      <StepIndicator step={step} total={TOTAL_STEPS} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.18 }}
        >
          {step === 1 && (
            <StepSelectBlaster selected={blaster} onSelect={setBlaster} />
          )}
          {step === 2 && (
            <StepDeviceDetails details={details} onChange={setDetails} />
          )}
          {step === 3 && (
            <StepLearnCommands
              deviceType={details.device_type}
              deviceId={savedDeviceId}
              learnedSet={learnedSet}
              onLearnedChange={markLearned}
            />
          )}
          {step === 4 && <StepDone deviceName={details.name} />}
        </motion.div>
      </AnimatePresence>

      {saveError && <p className="mt-3 text-xs text-red-400">{saveError}</p>}

      <div className="flex items-center justify-between mt-6">
        {step > 1 && step < 4 ? (
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
        ) : <div />}

        {step < 4 ? (
          <Button
            size="sm"
            onClick={handleNext}
            disabled={!canNext() || saving}
            className="gap-1"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              <>
                {step === 2 ? 'Save & Continue' : 'Next'}
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </Button>
        ) : (
          <Button size="sm" onClick={onClose}>Close</Button>
        )}
      </div>
    </Modal>
  )
}
