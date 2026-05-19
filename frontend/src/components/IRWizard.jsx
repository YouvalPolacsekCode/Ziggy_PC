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
import { discoverIrBlasters, createIrDevice, irLearn, irSend, getRooms } from '../lib/api'
import { cn } from '../lib/utils'

const DEVICE_TYPES = [
  { id: 'tv',        label: 'TV',        Icon: Radio },
  { id: 'ac',        label: 'AC',        Icon: Thermometer },
  { id: 'fan',       label: 'Fan',       Icon: Wind },
  { id: 'soundbar',  label: 'Soundbar',  Icon: Volume2 },
  { id: 'projector', label: 'Projector', Icon: MonitorPlay },
  { id: 'custom',    label: 'Custom',    Icon: Zap },
]

const DEFAULT_COMMANDS_BY_TYPE = {
  tv:        ['power', 'volume_up', 'volume_down', 'mute', 'hdmi_1', 'hdmi_2', 'channel_up', 'channel_down', 'nav_up', 'nav_down', 'nav_ok', 'back', 'home'],
  ac:        ['power', 'mode_cool', 'mode_heat', 'mode_fan', 'fan_low', 'fan_medium', 'fan_high', 'swing_on', 'swing_off'],
  fan:       ['power', 'speed_low', 'speed_medium', 'speed_high', 'oscillate'],
  soundbar:  ['power', 'volume_up', 'volume_down', 'mute', 'input_hdmi', 'input_optical', 'input_bluetooth'],
  projector: ['power', 'volume_up', 'volume_down', 'hdmi_1', 'hdmi_2', 'nav_ok', 'back', 'home'],
  custom:    ['power'],
}

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
// Single command row
// ---------------------------------------------------------------------------

function CommandRow({ cmd, deviceId, onRemove, onChange }) {
  const [status, setStatus]   = useState('idle')  // idle | learning | learned | error
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef(null)

  const startLearning = async () => {
    if (!deviceId || !cmd) return
    setStatus('learning')
    setCountdown(LEARN_DURATION)

    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(timerRef.current); return 0 }
        return c - 1
      })
    }, 1000)

    try {
      await irLearn(deviceId, cmd)
      setStatus('learned')
    } catch {
      setStatus('error')
    } finally {
      clearInterval(timerRef.current)
      setCountdown(0)
    }
  }

  const testCommand = async () => {
    if (!deviceId || !cmd) return
    try {
      await irSend(deviceId, cmd)
      // If test succeeds and we were in error/idle, mark as learned
      if (status !== 'learned') setStatus('learned')
    } catch { /* best-effort */ }
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

      <Input
        value={cmd}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-xs h-7 px-2"
        placeholder="command_name"
      />

      {status === 'learning' ? (
        <span className="text-xs text-yellow-500 w-14 text-center font-mono">
          {countdown}s…
        </span>
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
        disabled={!deviceId || !cmd || status === 'learning'}
        className="text-xs w-10"
        title="Test — fires the command. If HA already has this code, it works without re-learning."
      >
        Test
      </Button>

      <button onClick={onRemove} className="text-zinc-300 dark:text-zinc-600 hover:text-red-400 transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Learn commands
// ---------------------------------------------------------------------------

function StepLearnCommands({ commands, onChange, deviceId }) {
  const addCommand = () => onChange([...commands, ''])

  const removeCommand = (i) => onChange(commands.filter((_, idx) => idx !== i))

  const updateCommand = (i, val) => {
    const next = [...commands]
    next[i] = val
    onChange(next)
  }

  return (
    <div>
      <p className="text-xs text-zinc-500 mb-3">
        If your blaster already learned these commands in HA, click <strong className="text-zinc-700 dark:text-zinc-300">Test</strong> — it fires the command live. If it works, it auto-marks as learned.
        To teach a new code, click <strong className="text-zinc-700 dark:text-zinc-300">Learn</strong> and press the button on your physical remote within 20 seconds.
      </p>

      <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
        {commands.map((cmd, i) => (
          <CommandRow
            key={i}
            cmd={cmd}
            deviceId={deviceId}
            onRemove={() => removeCommand(i)}
            onChange={(val) => updateCommand(i, val)}
          />
        ))}
      </div>

      <button
        onClick={addCommand}
        className="mt-3 flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add command
      </button>
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
  const [commands, setCommands]       = useState([])
  const [savedDeviceId, setSavedDeviceId] = useState(null)
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState(null)

  // Pre-populate default commands when entering step 3
  useEffect(() => {
    if (step === 3) {
      setCommands(DEFAULT_COMMANDS_BY_TYPE[details.device_type] || ['power'])
    }
  }, [step])  // only on step change, not device_type change (user may have edited)

  const deviceNamespace = details.name
    ? details.name.toLowerCase().replace(/\s+/g, '_')
    : 'ir_device'

  const canNext = () => {
    if (step === 1) return !!blaster
    if (step === 2) return details.name.trim() && details.device_type
    return true
  }

  const handleNext = async () => {
    // Step 2 → 3: create the device so we have an ID for learn/send calls
    if (step === 2) {
      setSaving(true)
      setSaveError(null)
      try {
        const commandMap = {}
        ;(DEFAULT_COMMANDS_BY_TYPE[details.device_type] || ['power']).forEach((c) => { commandMap[c] = c })
        const payload = {
          name: details.name.trim(),
          device_type: details.device_type,
          room: details.room.trim() || null,
          brand: details.brand.trim() || null,
          blaster_entity_id: `direct_${blaster.blaster_host}`,
          blaster_host: blaster.blaster_host,
          ha_device_namespace: deviceNamespace,
          commands: commandMap,
        }
        const created = await createIrDevice(payload)
        setSavedDeviceId(created.device?.id ?? created.id)
        setStep(3)
      } catch (e) {
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
              commands={commands}
              onChange={setCommands}
              deviceId={savedDeviceId}
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
