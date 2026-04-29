/**
 * IRDeviceSelect — action builder for ir_command steps in Automations/Routines.
 * Lets the user pick an IR device, then a command or sequence from that device.
 */
import { useEffect, useState } from 'react'
import { Tv2, Thermometer, Wind, Volume2, MonitorPlay, Zap } from 'lucide-react'
import { getIrDevices } from '../lib/api'
import { cn } from '../lib/utils'

const TYPE_ICONS = {
  tv:        Tv2,
  ac:        Thermometer,
  fan:       Wind,
  soundbar:  Volume2,
  projector: MonitorPlay,
  custom:    Zap,
}

const SELECT_CLS = [
  'w-full h-9 px-3 rounded-lg text-sm border',
  'border-zinc-200 dark:border-zinc-700',
  'bg-zinc-50 dark:bg-zinc-800',
  'text-zinc-900 dark:text-zinc-100',
  'focus:outline-none focus:ring-2 focus:ring-violet-500/50',
].join(' ')

export default function IRDeviceSelect({ value, onChange }) {
  // value shape: { ir_device_id, ir_device_name, ir_command, ir_sequence, ir_temperature, ir_mode }
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getIrDevices()
      .then(setDevices)
      .catch(() => setDevices([]))
      .finally(() => setLoading(false))
  }, [])

  const selectedDevice = devices.find((d) => d.id === value?.ir_device_id) || null
  const learned = selectedDevice ? (selectedDevice.learned_commands || []) : []
  const sequences = selectedDevice ? Object.keys(selectedDevice.sequences || {}) : []
  const isAC = selectedDevice?.type === 'ac'

  const set = (patch) => onChange({ ...(value || {}), ...patch })

  const handleDeviceChange = (id) => {
    const dev = devices.find((d) => d.id === id)
    set({
      ir_device_id: id,
      ir_device_name: dev?.name || '',
      ir_command: '',
      ir_sequence: '',
      ir_temperature: undefined,
      ir_mode: undefined,
    })
  }

  if (loading) return <p className="text-xs text-zinc-400 py-2">Loading IR devices…</p>
  if (!devices.length) return (
    <p className="text-xs text-zinc-500 py-2">No IR devices configured. Add one in Devices.</p>
  )

  return (
    <div className="space-y-2 mt-1">
      {/* Device picker */}
      <select className={SELECT_CLS} value={value?.ir_device_id || ''} onChange={(e) => handleDeviceChange(e.target.value)}>
        <option value="">— select IR device —</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>{d.name} {d.room ? `(${d.room.replace(/_/g, ' ')})` : ''}</option>
        ))}
      </select>

      {selectedDevice && (
        <>
          {/* Action mode tabs — each sets the mode by clearing the other fields */}
          {(sequences.length > 0 || isAC) && (
            <div className="flex gap-1">
              {[
                { id: 'command', label: 'Command' },
                ...(sequences.length ? [{ id: 'sequence', label: 'Sequence' }] : []),
                ...(isAC ? [{ id: 'temperature', label: 'Temperature' }] : []),
              ].map(({ id, label }) => {
                const active =
                  id === 'sequence'    ? !!value?.ir_sequence :
                  id === 'temperature' ? value?.ir_temperature != null :
                  !value?.ir_sequence && value?.ir_temperature == null
                const switchTo = () => {
                  if (id === 'sequence')    set({ ir_command: '', ir_sequence: '', ir_temperature: undefined, ir_mode: undefined })
                  else if (id === 'temperature') set({ ir_command: '', ir_sequence: undefined, ir_temperature: 22, ir_mode: undefined })
                  else                      set({ ir_command: '', ir_sequence: undefined, ir_temperature: undefined, ir_mode: undefined })
                }
                return (
                  <button key={id} onClick={switchTo}
                    className={cn('px-2.5 py-1 rounded-lg text-xs transition-colors',
                      active ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border border-violet-500/40' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    )}
                  >{label}</button>
                )
              })}
            </div>
          )}

          {/* Command picker */}
          {!value?.ir_sequence && value?.ir_temperature == null && (
            <select className={SELECT_CLS} value={value?.ir_command || ''} onChange={(e) => set({ ir_command: e.target.value, ir_sequence: undefined })}>
              <option value="">— select command —</option>
              {(learned.length > 0 ? learned : Object.keys(selectedDevice.commands || {})).map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}{!learned.includes(c) ? ' (not learned)' : ''}</option>
              ))}
            </select>
          )}

          {/* Sequence picker */}
          {value?.ir_sequence !== undefined && sequences.length > 0 && (
            <select className={SELECT_CLS} value={value?.ir_sequence || ''} onChange={(e) => set({ ir_sequence: e.target.value, ir_command: '' })}>
              <option value="">— select sequence —</option>
              {sequences.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          )}

          {/* AC temperature */}
          {isAC && value?.ir_temperature != null && (
            <div className="flex gap-2">
              <input
                type="number" min={16} max={30}
                value={value?.ir_temperature ?? 22}
                onChange={(e) => set({ ir_temperature: parseInt(e.target.value) })}
                className={cn(SELECT_CLS, 'w-24')}
                placeholder="22"
              />
              <select className={SELECT_CLS} value={value?.ir_mode || ''} onChange={(e) => set({ ir_mode: e.target.value || undefined })}>
                <option value="">— mode (optional) —</option>
                {['cool', 'heat', 'fan', 'auto', 'dry'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  )
}
