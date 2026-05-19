import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Radio, CheckCircle2, XCircle, RefreshCw, ChevronDown,
  Waves, Wifi, Tv2, Sparkles, ExternalLink, RotateCcw, Zap, Home,
} from 'lucide-react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import {
  zhaPermit, getHaDevices, renameHaDevice, assignDeviceToArea,
  zwaveInclude, zwaveStop, matterCommission, getConfigFlows,
} from '../lib/api'
import { useDeviceStore } from '../stores/deviceStore'
import { cn } from '../lib/utils'

const ZIGBEE_DURATION = 60
const ZWAVE_DURATION  = 120

const PROTOCOLS = [
  {
    id: 'zigbee',
    label: 'Zigbee',
    Icon: Radio,
    description: 'IKEA, Aqara, Sonoff, Philips Hue, most sensors & bulbs',
  },
  {
    id: 'zwave',
    label: 'Z-Wave',
    Icon: Waves,
    description: 'Fibaro, Aeotec, Yale locks, Zooz, Leviton switches',
  },
  {
    id: 'matter',
    label: 'Matter',
    Icon: Sparkles,
    description: 'Eve, Nanoleaf, newer IKEA & Philips, Apple Home compatible',
  },
  {
    id: 'ir_device',
    label: 'IR Device',
    Icon: Zap,
    description: 'TV, AC, fan, soundbar — controlled by IR blaster (Broadlink RM)',
    immediate: true,  // handled instantly by parent — no HA pairing flow
  },
  {
    id: 'broadlink',
    label: 'IR Blaster (Broadlink)',
    Icon: Tv2,
    description: 'RM4 Mini / Pro infrastructure — add the blaster hardware to HA first',
  },
  {
    id: 'wifi',
    label: 'Wi-Fi',
    Icon: Wifi,
    description: 'Shelly, Tuya, TP-Link Kasa, ESPHome, Govee, Meross',
  },
]

const STEPS = [
  { id: 'idle',    label: 'Ready'   },
  { id: 'pairing', label: 'Pairing' },
  { id: 'found',   label: 'Configure' },
]

// ── Sub-components ──────────────────────────────────────────────────────────

function StepDots({ current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS.map((s, i) => {
        const idx = STEPS.findIndex((x) => x.id === current)
        const done   = i < idx
        const active = s.id === current
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div className={cn(
              'flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold transition-all duration-300',
              done   ? 'bg-emerald-500 text-white' :
              active ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' :
                       'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
            )}>
              {done ? <CheckCircle2 size={12} /> : i + 1}
            </div>
            <span className={cn(
              'text-xs font-medium',
              active ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'
            )}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={cn(
                'w-8 h-px transition-colors duration-300',
                done ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-700'
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function CountdownRing({ value, max }) {
  const r    = 52
  const circ = 2 * Math.PI * r
  const pct  = value / max
  return (
    <svg width="128" height="128" viewBox="0 0 128 128" className="rotate-[-90deg]">
      <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor"
        strokeWidth="6" className="text-zinc-100 dark:text-zinc-800" />
      <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor"
        strokeWidth="6" strokeLinecap="round" className="text-violet-500 transition-all duration-1000"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} />
    </svg>
  )
}

function RoomPicker({ rooms, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = rooms.find((r) => r.id === value)

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full h-10 rounded-xl px-3 text-sm text-left flex items-center justify-between',
          'bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700',
          'text-zinc-900 dark:text-zinc-100 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500'
        )}
      >
        <span className={selected || value === null ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'}>
          {value === null ? 'No room' : selected ? selected.name : 'Select a room…'}
        </span>
        <ChevronDown size={14} className={cn('text-zinc-400 transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full left-0 right-0 mt-1 z-50 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden max-h-44 overflow-y-auto"
          >
            <button
              onClick={() => { onChange(null); setOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition-colors border-b border-zinc-100 dark:border-zinc-800',
                'hover:bg-zinc-50 dark:hover:bg-zinc-800',
                value === null && 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
              )}
            >
              <Home size={13} className="shrink-0 text-zinc-400" /> No room
            </button>
            {rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => { onChange(r.id); setOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition-colors',
                  'hover:bg-zinc-50 dark:hover:bg-zinc-800',
                  value === r.id && 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                )}
              >
                {r.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function PairingWizard({ open, onClose, onAddIrDevice }) {
  const { rooms, fetchAll } = useDeviceStore()

  const [step,        setStep]        = useState('select')
  const [protocol,    setProtocol]    = useState(null)
  const [countdown,   setCountdown]   = useState(ZIGBEE_DURATION)
  const [errorMsg,    setErrorMsg]    = useState('')
  const [foundDevice, setFoundDevice] = useState(null)
  const [deviceName,  setDeviceName]  = useState('')
  const [roomId,      setRoomId]      = useState('')
  const [saving,      setSaving]      = useState(false)
  const [matterCode,  setMatterCode]  = useState('')
  const [configFlows, setConfigFlows] = useState([])
  const [haUrl,       setHaUrl]       = useState('')
  const [flowsLoading, setFlowsLoading] = useState(false)

  const snapshotRef = useRef(new Set())
  const timerRef    = useRef(null)
  const pollRef     = useRef(null)

  const stopTimers = () => {
    clearInterval(timerRef.current)
    clearInterval(pollRef.current)
  }

  useEffect(() => {
    if (!open) {
      stopTimers()
      setStep('select')
      setProtocol(null)
      setCountdown(ZIGBEE_DURATION)
      setFoundDevice(null)
      setDeviceName('')
      setRoomId('')
      setErrorMsg('')
      setMatterCode('')
      setConfigFlows([])
      setHaUrl('')
    }
  }, [open])

  // ── Snapshot device registry before pairing starts ──
  const snapshotDevices = async () => {
    try {
      const res = await getHaDevices()
      snapshotRef.current = new Set((res.devices || []).map((d) => d.id))
    } catch {
      snapshotRef.current = new Set()
    }
  }

  // ── Poll device registry for new entries ──
  const startDevicePoller = () => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await getHaDevices()
        const newDevice = (res.devices || []).find((d) => !snapshotRef.current.has(d.id))
        if (newDevice) {
          stopTimers()
          setFoundDevice(newDevice)
          setDeviceName(newDevice.name || '')
          setStep('found')
        }
      } catch {}
    }, 3000)
  }

  // ── Countdown timer (Zigbee / Z-Wave) ──
  const startCountdown = (duration, onExpire) => {
    setCountdown(duration)
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          stopTimers()
          onExpire()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  // ── Protocol-specific start handlers ──

  const startZigbee = async () => {
    await snapshotDevices()
    try {
      const res = await zhaPermit(ZIGBEE_DURATION)
      if (!res.ok) {
        setErrorMsg(res.error || 'Failed to start pairing mode')
        setStep('error')
        return
      }
    } catch (e) {
      setErrorMsg(e.message || 'Could not reach Home Assistant')
      setStep('error')
      return
    }
    setStep('pairing')
    startCountdown(ZIGBEE_DURATION, () => setStep('timeout'))
    startDevicePoller()
  }

  const startZwave = async () => {
    await snapshotDevices()
    try {
      const res = await zwaveInclude()
      if (!res.ok) {
        setErrorMsg(res.error || 'Failed to start Z-Wave inclusion')
        setStep('error')
        return
      }
    } catch (e) {
      setErrorMsg(e.message || 'Could not reach Home Assistant')
      setStep('error')
      return
    }
    setStep('pairing')
    startCountdown(ZWAVE_DURATION, async () => {
      await zwaveStop().catch(() => {})
      setStep('timeout')
    })
    startDevicePoller()
  }

  const startMatter = async () => {
    if (!matterCode.trim()) return
    await snapshotDevices()
    setStep('pairing')
    try {
      const res = await matterCommission(matterCode.trim())
      if (!res.ok) {
        setErrorMsg(res.error || 'Matter commissioning failed')
        setStep('error')
        return
      }
    } catch (e) {
      setErrorMsg(e.message || 'Could not reach Home Assistant')
      setStep('error')
      return
    }
    // Matter commissioning succeeded — poll for the device to appear
    startDevicePoller()
    // Give it a 5-minute window then timeout
    timerRef.current = setTimeout(() => {
      stopTimers()
      setStep('timeout')
    }, 300_000)
  }

  const startWifiScan = async (proto) => {
    await snapshotDevices()
    setFlowsLoading(true)
    setStep('pairing')
    try {
      const res = await getConfigFlows(proto)
      setConfigFlows(res.flows || [])
      setHaUrl(res.ha_url || '')
    } catch (e) {
      setConfigFlows([])
    } finally {
      setFlowsLoading(false)
    }
    startDevicePoller()
  }

  const handleStart = () => {
    if (protocol === 'zigbee')              startZigbee()
    else if (protocol === 'zwave')          startZwave()
    else if (protocol === 'matter')         startMatter()
    else if (protocol === 'broadlink')      startWifiScan('broadlink')
    else if (protocol === 'wifi')           startWifiScan('wifi')
    else if (protocol === 'ir_device') {
      // Hand off to IRWizard in the parent — close this modal first
      onClose()
      onAddIrDevice?.()
    }
  }

  const handleCancel = async () => {
    stopTimers()
    if (protocol === 'zwave') await zwaveStop().catch(() => {})
    setStep('idle')
  }

  const handleRefreshFlows = async () => {
    setFlowsLoading(true)
    try {
      const res = await getConfigFlows(protocol)
      setConfigFlows(res.flows || [])
      setHaUrl(res.ha_url || '')
    } catch {
      setConfigFlows([])
    } finally {
      setFlowsLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (deviceName && deviceName !== foundDevice.name) {
        await renameHaDevice(foundDevice.id, deviceName)
      }
      if (roomId) {
        await assignDeviceToArea(foundDevice.id, roomId)
      } else if (roomId === null) {
        // Explicit "No room" — call with null so the registry promotes UNCLAIMED → CONNECTED
        await assignDeviceToArea(foundDevice.id, null)
      }
      await fetchAll()
      onClose()
    } catch (e) {
      setErrorMsg(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const allRooms = rooms.map((r) => ({ id: r.id, name: r.name }))
  const currentProto = PROTOCOLS.find((p) => p.id === protocol)
  const pairDuration = protocol === 'zwave' ? ZWAVE_DURATION : ZIGBEE_DURATION

  return (
    <Modal open={open} fullScreen onClose={onClose} title="Pair new device">
      {['idle', 'pairing', 'found'].includes(step) && <StepDots current={step} />}

      <AnimatePresence mode="wait">

        {/* ── Protocol selection ────────────────────────────── */}
        {step === 'select' && (
          <motion.div
            key="select"
            initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-2"
          >
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              What type of device are you adding?
            </p>
            {PROTOCOLS.map(({ id, label, Icon, description }) => (
              <button
                key={id}
                onClick={() => { setProtocol(id); setStep('idle') }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all',
                  'border border-zinc-200 dark:border-zinc-700',
                  'hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20',
                  'focus:outline-none focus:ring-2 focus:ring-violet-500'
                )}
              >
                <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-violet-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{label}</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{description}</p>
                </div>
              </button>
            ))}
          </motion.div>
        )}

        {/* ── Ready ────────────────────────────────────────── */}
        {step === 'idle' && currentProto && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col items-center text-center gap-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center">
              <currentProto.Icon size={28} className="text-violet-500" />
            </div>

            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                Add a {currentProto.label} device
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {protocol === 'zigbee' && 'Opens a 60-second pairing window on your Zigbee network.'}
                {protocol === 'zwave'  && 'Puts your Z-Wave network into inclusion mode for 2 minutes.'}
                {protocol === 'matter' && 'Enter the setup code from the device label or its companion app.'}
                {protocol === 'ir_device'  && 'Configure your IR device — name it, select the blaster, and teach it the remote codes.'}
              {protocol === 'broadlink' && 'Make sure your Broadlink device is powered on and connected to Wi-Fi. Home Assistant auto-discovers it.'}
                {protocol === 'wifi'  && 'Make sure the device is powered on and connected to your network. Home Assistant will discover it via mDNS.'}
              </p>
            </div>

            {/* Matter code input — shown in the idle step */}
            {protocol === 'matter' && (
              <Input
                label="Setup code"
                value={matterCode}
                onChange={(e) => setMatterCode(e.target.value)}
                placeholder="e.g. MT:Y.K90SO5 or 1234-5678"
                className="w-full"
              />
            )}

            {/* Instructions for non-Matter protocols */}
            {protocol !== 'matter' && (
              <div className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 text-left space-y-2">
                {protocol === 'zigbee' && [
                  '1. Click "Start pairing" below',
                  '2. Put your device in pairing mode (hold reset button until LED blinks)',
                  '3. Wait — Ziggy will detect it automatically',
                ].map((t) => <p key={t} className="text-xs text-zinc-600 dark:text-zinc-400">{t}</p>)}

                {protocol === 'zwave' && [
                  '1. Click "Start pairing" below',
                  '2. Press the inclusion button on your Z-Wave device',
                  '3. Wait — Ziggy will detect it automatically',
                ].map((t) => <p key={t} className="text-xs text-zinc-600 dark:text-zinc-400">{t}</p>)}

                {protocol === 'ir_device' && [
                  '1. Click "Set up IR device" below',
                  '2. Name the device and choose your blaster',
                  '3. Point your remote at the blaster and teach each button',
                ].map((t) => <p key={t} className="text-xs text-zinc-600 dark:text-zinc-400">{t}</p>)}

              {protocol === 'broadlink' && [
                  '1. Power on your Broadlink device',
                  '2. Connect it to your Wi-Fi using the Broadlink app',
                  '3. Click "Scan" — Ziggy will show devices HA has discovered',
                ].map((t) => <p key={t} className="text-xs text-zinc-600 dark:text-zinc-400">{t}</p>)}

                {protocol === 'wifi' && [
                  '1. Power on your device and connect it to your Wi-Fi',
                  '2. Click "Scan" — Ziggy will show devices HA has discovered',
                  '3. Complete the setup and Ziggy will detect when it\'s added',
                ].map((t) => <p key={t} className="text-xs text-zinc-600 dark:text-zinc-400">{t}</p>)}
              </div>
            )}

            <div className="flex gap-2 w-full">
              <Button variant="secondary" onClick={() => setStep('select')} className="flex-none px-4">
                Back
              </Button>
              <Button
                onClick={handleStart}
                disabled={protocol === 'matter' && !matterCode.trim()}
                className="flex-1"
              >
                {protocol === 'matter'                  ? 'Commission'        :
                 protocol === 'ir_device'               ? 'Set up IR device'  :
                 protocol === 'broadlink' || protocol === 'wifi' ? 'Scan'     :
                 'Start pairing'}
              </Button>
            </div>

            <p className="text-[10px] text-zinc-400">
              {protocol === 'zigbee'    && 'Requires ZHA integration in Home Assistant'}
              {protocol === 'zwave'     && 'Requires Z-Wave JS integration in Home Assistant'}
              {protocol === 'matter'    && 'Requires Matter integration in Home Assistant'}
              {protocol === 'broadlink' && 'Requires Broadlink integration in Home Assistant'}
              {protocol === 'wifi'      && 'Device must be on the same network as Home Assistant'}
            </p>
          </motion.div>
        )}

        {/* ── Pairing active ───────────────────────────────── */}
        {step === 'pairing' && (
          <motion.div
            key="pairing"
            initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col items-center text-center gap-5"
          >
            {/* Zigbee / Z-Wave: countdown ring */}
            {(protocol === 'zigbee' || protocol === 'zwave') && (
              <div className="relative flex items-center justify-center w-32 h-32">
                <motion.div
                  animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0.1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-0 rounded-full bg-violet-400/20 pointer-events-none"
                />
                <CountdownRing value={countdown} max={pairDuration} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {countdown}
                  </span>
                  <span className="text-[10px] text-zinc-400">sec</span>
                </div>
              </div>
            )}

            {/* Matter: spinner */}
            {protocol === 'matter' && (
              <div className="relative flex items-center justify-center w-24 h-24">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  className="w-16 h-16 rounded-full border-4 border-zinc-100 dark:border-zinc-800 border-t-violet-500"
                />
                <Sparkles size={20} className="absolute text-violet-500" />
              </div>
            )}

            {/* Broadlink / Wi-Fi: discovered flows list */}
            {(protocol === 'broadlink' || protocol === 'wifi') && (
              <div className="w-full">
                {flowsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-8 h-8 rounded-full border-2 border-zinc-200 dark:border-zinc-700 border-t-violet-500"
                    />
                  </div>
                ) : configFlows.length > 0 ? (
                  <div className="space-y-2 text-left">
                    <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                      {configFlows.length} device{configFlows.length > 1 ? 's' : ''} discovered by Home Assistant:
                    </p>
                    {configFlows.map((flow) => (
                      <div
                        key={flow.flow_id}
                        className="flex items-center justify-between gap-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                      >
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {flow.title}
                          </p>
                          <p className="text-xs text-zinc-400 capitalize">{flow.handler}</p>
                        </div>
                        {haUrl && (
                          <a
                            href={`${haUrl}/config/integrations`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-violet-500 hover:text-violet-600 shrink-0"
                          >
                            Configure <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    ))}
                    <p className="text-xs text-zinc-400 mt-2">
                      Complete setup in Home Assistant — Ziggy will detect the device automatically once added.
                    </p>
                  </div>
                ) : (
                  <div className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 text-left space-y-2">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      No devices discovered yet
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Make sure your device is powered on and connected to the same network as Home Assistant, then click Refresh.
                    </p>
                    <button
                      onClick={handleRefreshFlows}
                      className="flex items-center gap-1.5 text-xs text-violet-500 hover:text-violet-600 mt-1"
                    >
                      <RotateCcw size={12} /> Refresh
                    </button>
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                {protocol === 'matter'               ? 'Commissioning…'      :
                 protocol === 'broadlink' || protocol === 'wifi' ? 'Waiting for device…' :
                 'Pairing mode active'}
              </p>
              {(protocol === 'zigbee' || protocol === 'zwave') && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {protocol === 'zigbee'
                    ? 'Put your device in pairing mode — plug it in or hold its reset button until it blinks.'
                    : 'Press the inclusion button on your Z-Wave device now.'}
                </p>
              )}
              {protocol === 'matter' && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Home Assistant is commissioning your device. This may take up to a minute.
                </p>
              )}
            </div>

            {(protocol === 'zigbee' || protocol === 'zwave') && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <motion.div
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="w-2 h-2 rounded-full bg-violet-500"
                />
                Scanning for devices…
              </div>
            )}

            <button
              onClick={handleCancel}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        )}

        {/* ── Device found — configure ─────────────────────── */}
        {step === 'found' && foundDevice && (
          <motion.div
            key="found"
            initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-4"
          >
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Device found!</p>
                {(foundDevice.manufacturer || foundDevice.model) && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-500 truncate">
                    {[foundDevice.manufacturer, foundDevice.model].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>

            <Input
              label="Device name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. Living Room IR Blaster"
            />

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Assign to room <span className="text-zinc-400 font-normal">(optional)</span>
              </label>
              <RoomPicker rooms={allRooms} value={roomId} onChange={setRoomId} />
            </div>

            {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? 'Saving…' : 'Save device'}
            </Button>
          </motion.div>
        )}

        {/* ── Timeout ──────────────────────────────────────── */}
        {step === 'timeout' && (
          <motion.div
            key="timeout"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center text-center gap-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <RefreshCw size={26} className="text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">No device detected</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                The pairing window expired without finding a new device. Make sure your device is in pairing mode and try again.
              </p>
            </div>
            <div className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-left space-y-1.5">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Tips:</p>
              {protocol === 'matter' ? [
                'Check that the setup code was entered correctly',
                'Make sure the device is in commissioning mode (usually a button hold)',
                'Ensure the Matter integration is configured in HA',
              ] : protocol === 'zwave' ? [
                'Press the inclusion button on the device within the 2-minute window',
                'Stay within range of your Z-Wave controller',
                'Some devices require a factory reset before inclusion',
              ] : [
                'Hold the reset button until the LED blinks rapidly',
                'Some devices need to be powered on during pairing',
                'Stay within range of your coordinator',
              ].map((t) => (
                <p key={t} className="text-xs text-zinc-500 dark:text-zinc-400">· {t}</p>
              ))}
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="secondary" onClick={onClose} className="flex-1">Close</Button>
              <Button onClick={() => setStep('idle')} className="flex-1">Try again</Button>
            </div>
          </motion.div>
        )}

        {/* ── Error ────────────────────────────────────────── */}
        {step === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center text-center gap-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
              <XCircle size={26} className="text-red-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                Could not start pairing
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{errorMsg}</p>
            </div>
            <div className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-left">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Make sure the{' '}
                <strong className="text-zinc-700 dark:text-zinc-300">
                  {protocol === 'zigbee'    ? 'ZHA' :
                   protocol === 'zwave'     ? 'Z-Wave JS' :
                   protocol === 'matter'    ? 'Matter' :
                   protocol === 'broadlink' ? 'Broadlink' : 'required'}
                </strong>{' '}
                integration is installed and running in Home Assistant (Settings → Integrations).
              </p>
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="secondary" onClick={onClose} className="flex-1">Close</Button>
              <Button onClick={() => setStep('idle')} className="flex-1">Try again</Button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </Modal>
  )
}
