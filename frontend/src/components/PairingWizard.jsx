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
import SwitcherPairingFlow from './SwitcherPairingFlow'
import { useDeviceStore } from '../stores/deviceStore'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import logger from '../lib/logger'

const ZIGBEE_DURATION = 60
const ZWAVE_DURATION  = 120

// Static protocol descriptors — labels/descriptions resolved via t() in the component.
const PROTOCOLS = [
  { id: 'zigbee',    Icon: Radio,    immediate: false },
  { id: 'zwave',     Icon: Waves,    immediate: false },
  { id: 'matter',    Icon: Sparkles, immediate: false },
  { id: 'ir_device', Icon: Zap,      immediate: true  },  // handled by parent — no HA pairing flow
  { id: 'broadlink', Icon: Tv2,      immediate: false },
  { id: 'wifi',      Icon: Wifi,     immediate: false },
  { id: 'switcher',  Icon: Home,     immediate: true  },  // dedicated native flow
]

const STEP_IDS = ['idle', 'pairing', 'found']

// ── Sub-components ──────────────────────────────────────────────────────────

function StepDots({ current }) {
  const t = useT()
  const labels = {
    idle:    t('wizard.pairing.stepReady'),
    pairing: t('wizard.pairing.stepPairing'),
    found:   t('wizard.pairing.stepFound'),
  }
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEP_IDS.map((id, i) => {
        const idx = STEP_IDS.indexOf(current)
        const done   = i < idx
        const active = id === current
        return (
          <div key={id} className="flex items-center gap-2">
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
              {labels[id]}
            </span>
            {i < STEP_IDS.length - 1 && (
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
  const t = useT()
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
          {value === null ? t('wizard.pairing.noRoom') : selected ? selected.name : t('wizard.pairing.selectRoom')}
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
              <Home size={13} className="shrink-0 text-zinc-400" /> {t('wizard.pairing.noRoom')}
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
  const t = useT()
  const { rooms, fetchAll } = useDeviceStore()

  // Resolved per-protocol metadata (labels, descriptions, instruction steps).
  const protoMeta = (id) => ({
    zigbee:    { label: t('wizard.pairing.protoZigbeeLabel'),    description: t('wizard.pairing.protoZigbeeDesc'),    integration: t('wizard.pairing.requiresZha') },
    zwave:     { label: t('wizard.pairing.protoZwaveLabel'),     description: t('wizard.pairing.protoZwaveDesc'),     integration: t('wizard.pairing.requiresZwave') },
    matter:    { label: t('wizard.pairing.protoMatterLabel'),    description: t('wizard.pairing.protoMatterDesc'),    integration: t('wizard.pairing.requiresMatter') },
    ir_device: { label: t('wizard.pairing.protoIrLabel'),        description: t('wizard.pairing.protoIrDesc'),        integration: '' },
    broadlink: { label: t('wizard.pairing.protoBroadlinkLabel'), description: t('wizard.pairing.protoBroadlinkDesc'), integration: t('wizard.pairing.requiresBroadlink') },
    wifi:      { label: t('wizard.pairing.protoWifiLabel'),      description: t('wizard.pairing.protoWifiDesc'),      integration: t('wizard.pairing.requiresNetwork') },
    switcher:  { label: t('wizard.pairing.protoSwitcherLabel'),  description: t('wizard.pairing.protoSwitcherDesc'),  integration: '' },
  }[id] || { label: id, description: '', integration: '' })

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
    logger.action('pairing_start', { protocol: 'zigbee', duration_s: ZIGBEE_DURATION })
    await snapshotDevices()
    try {
      const res = await zhaPermit(ZIGBEE_DURATION)
      if (!res.ok) {
        logger.error('pairing_permit_failed', new Error(res.error || 'permit failed'),
                     { protocol: 'zigbee' })
        setErrorMsg(res.error || t('wizard.pairing.permitFailed'))
        setStep('error')
        return
      }
    } catch (e) {
      logger.error('pairing_permit_failed', e, { protocol: 'zigbee' })
      setErrorMsg(e.message || t('wizard.pairing.couldNotReach'))
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
        setErrorMsg(res.error || t('wizard.pairing.zwaveIncludeFailed'))
        setStep('error')
        return
      }
    } catch (e) {
      setErrorMsg(e.message || t('wizard.pairing.couldNotReach'))
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
        setErrorMsg(res.error || t('wizard.pairing.matterFailed'))
        setStep('error')
        return
      }
    } catch (e) {
      setErrorMsg(e.message || t('wizard.pairing.couldNotReach'))
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
    else if (protocol === 'switcher') {
      // Switcher uses a dedicated multi-step native flow rendered below.
      setStep('switcher_flow')
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
      setErrorMsg(e.message || t('wizard.pairing.savingFailed'))
    } finally {
      setSaving(false)
    }
  }

  const allRooms = rooms.map((r) => ({ id: r.id, name: r.name }))
  const currentProto = PROTOCOLS.find((p) => p.id === protocol)
  const currentMeta = protocol ? protoMeta(protocol) : null
  const pairDuration = protocol === 'zwave' ? ZWAVE_DURATION : ZIGBEE_DURATION

  return (
    <Modal open={open} fullScreen onClose={onClose} title={t('wizard.pairing.modalTitle')}>
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
              {t('wizard.pairing.questionType')}
            </p>
            {PROTOCOLS.map(({ id, Icon }) => {
              const meta = protoMeta(id)
              return (
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
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{meta.label}</p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{meta.description}</p>
                  </div>
                </button>
              )
            })}
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
                {t('wizard.pairing.readyTitle', { label: currentMeta?.label || '' })}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {protocol === 'zigbee'    && t('wizard.pairing.zigbeeDesc')}
                {protocol === 'zwave'     && t('wizard.pairing.zwaveDesc')}
                {protocol === 'matter'    && t('wizard.pairing.matterDesc')}
                {protocol === 'ir_device' && t('wizard.pairing.irDesc')}
                {protocol === 'broadlink' && t('wizard.pairing.broadlinkDesc')}
                {protocol === 'wifi'      && t('wizard.pairing.wifiDesc')}
              </p>
            </div>

            {/* Matter code input — shown in the idle step */}
            {protocol === 'matter' && (
              <Input
                label={t('wizard.pairing.matterCodeLabel')}
                value={matterCode}
                onChange={(e) => setMatterCode(e.target.value)}
                placeholder={t('wizard.pairing.matterCodePh')}
                className="w-full"
              />
            )}

            {/* Instructions for non-Matter protocols */}
            {protocol !== 'matter' && (
              <div className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 text-left space-y-2">
                {protocol === 'zigbee' && [
                  t('wizard.pairing.zigbeeStep1'),
                  t('wizard.pairing.zigbeeStep2'),
                  t('wizard.pairing.zigbeeStep3'),
                ].map((line) => <p key={line} className="text-xs text-zinc-600 dark:text-zinc-400">{line}</p>)}

                {protocol === 'zwave' && [
                  t('wizard.pairing.zwaveStep1'),
                  t('wizard.pairing.zwaveStep2'),
                  t('wizard.pairing.zwaveStep3'),
                ].map((line) => <p key={line} className="text-xs text-zinc-600 dark:text-zinc-400">{line}</p>)}

                {protocol === 'ir_device' && [
                  t('wizard.pairing.irStep1'),
                  t('wizard.pairing.irStep2'),
                  t('wizard.pairing.irStep3'),
                ].map((line) => <p key={line} className="text-xs text-zinc-600 dark:text-zinc-400">{line}</p>)}

                {protocol === 'broadlink' && [
                  t('wizard.pairing.broadlinkStep1'),
                  t('wizard.pairing.broadlinkStep2'),
                  t('wizard.pairing.broadlinkStep3'),
                ].map((line) => <p key={line} className="text-xs text-zinc-600 dark:text-zinc-400">{line}</p>)}

                {protocol === 'wifi' && [
                  t('wizard.pairing.wifiStep1'),
                  t('wizard.pairing.wifiStep2'),
                  t('wizard.pairing.wifiStep3'),
                ].map((line) => <p key={line} className="text-xs text-zinc-600 dark:text-zinc-400">{line}</p>)}
              </div>
            )}

            <div className="flex gap-2 w-full">
              <Button variant="secondary" onClick={() => setStep('select')} className="flex-none px-4">
                {t('wizard.back')}
              </Button>
              <Button
                onClick={handleStart}
                disabled={protocol === 'matter' && !matterCode.trim()}
                className="flex-1"
              >
                {protocol === 'matter'                          ? t('wizard.pairing.startBtnCommission') :
                 protocol === 'ir_device'                       ? t('wizard.pairing.startBtnIr')         :
                 protocol === 'broadlink' || protocol === 'wifi'? t('wizard.pairing.startBtnScan')       :
                 t('wizard.pairing.startBtnStart')}
              </Button>
            </div>

            <p className="text-[10px] text-zinc-400">
              {currentMeta?.integration}
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
                  <span className="text-[10px] text-zinc-400">{t('wizard.pairing.sec')}</span>
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
                      {configFlows.length === 1
                        ? t('wizard.pairing.discoveredHaOne', { n: configFlows.length })
                        : t('wizard.pairing.discoveredHa', { n: configFlows.length })}
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
                            {t('wizard.pairing.configure')} <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    ))}
                    <p className="text-xs text-zinc-400 mt-2">
                      {t('wizard.pairing.completeInHa')}
                    </p>
                  </div>
                ) : (
                  <div className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 text-left space-y-2">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      {t('wizard.pairing.noneDiscovered')}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t('wizard.pairing.noneDiscoveredHint')}
                    </p>
                    <button
                      onClick={handleRefreshFlows}
                      className="flex items-center gap-1.5 text-xs text-violet-500 hover:text-violet-600 mt-1"
                    >
                      <RotateCcw size={12} /> {t('wizard.refresh')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                {protocol === 'matter'                          ? t('wizard.pairing.commissioning')      :
                 protocol === 'broadlink' || protocol === 'wifi'? t('wizard.pairing.waitingForDevice')  :
                 t('wizard.pairing.pairingActive')}
              </p>
              {(protocol === 'zigbee' || protocol === 'zwave') && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {protocol === 'zigbee'
                    ? t('wizard.pairing.zigbeeSubtext')
                    : t('wizard.pairing.zwaveSubtext')}
                </p>
              )}
              {protocol === 'matter' && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('wizard.pairing.matterSubtext')}
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
                {t('wizard.pairing.scanningForDevices')}
              </div>
            )}

            <button
              onClick={handleCancel}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {t('wizard.cancel')}
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
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{t('wizard.pairing.deviceFound')}</p>
                {(foundDevice.manufacturer || foundDevice.model) && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-500 truncate">
                    {[foundDevice.manufacturer, foundDevice.model].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>

            <Input
              label={t('wizard.pairing.deviceName')}
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder={t('wizard.pairing.deviceNamePh')}
            />

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('wizard.pairing.assignToRoomOpt')} <span className="text-zinc-400 font-normal">{t('wizard.pairing.optional')}</span>
              </label>
              <RoomPicker rooms={allRooms} value={roomId} onChange={setRoomId} />
            </div>

            {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? t('wizard.pairing.saving') : t('wizard.pairing.saveDevice')}
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
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('wizard.pairing.noDeviceDetected')}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {t('wizard.pairing.expiredHint')}
              </p>
            </div>
            <div className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-left space-y-1.5">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('wizard.pairing.tips')}</p>
              {(protocol === 'matter' ? [
                t('wizard.pairing.tipMatter1'),
                t('wizard.pairing.tipMatter2'),
                t('wizard.pairing.tipMatter3'),
              ] : protocol === 'zwave' ? [
                t('wizard.pairing.tipZwave1'),
                t('wizard.pairing.tipZwave2'),
                t('wizard.pairing.tipZwave3'),
              ] : [
                t('wizard.pairing.tipDefault1'),
                t('wizard.pairing.tipDefault2'),
                t('wizard.pairing.tipDefault3'),
              ]).map((line) => (
                <p key={line} className="text-xs text-zinc-500 dark:text-zinc-400">· {line}</p>
              ))}
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="secondary" onClick={onClose} className="flex-1">{t('wizard.close')}</Button>
              <Button onClick={() => setStep('idle')} className="flex-1">{t('wizard.pairing.tryAgain')}</Button>
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
                {t('wizard.pairing.couldNotStart')}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{errorMsg}</p>
            </div>
            <div className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 text-left">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t('wizard.pairing.errorHelp', {
                  name: protocol === 'zigbee'    ? 'ZHA' :
                        protocol === 'zwave'     ? 'Z-Wave JS' :
                        protocol === 'matter'    ? 'Matter' :
                        protocol === 'broadlink' ? 'Broadlink' : t('wizard.pairing.errorIntegrationDefault'),
                })}
              </p>
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="secondary" onClick={onClose} className="flex-1">{t('wizard.close')}</Button>
              <Button onClick={() => setStep('idle')} className="flex-1">{t('wizard.pairing.tryAgain')}</Button>
            </div>
          </motion.div>
        )}

        {/* ── Switcher native pairing flow ──────────────────── */}
        {step === 'switcher_flow' && (
          <motion.div
            key="switcher_flow"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <SwitcherPairingFlow
              onDone={async () => {
                await fetchAll()
                onClose()
              }}
              onCancel={() => setStep('idle')}
            />
          </motion.div>
        )}

      </AnimatePresence>
    </Modal>
  )
}
