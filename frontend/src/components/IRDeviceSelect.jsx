/**
 * IRDeviceSelect — action builder for ir_command steps in Automations/Routines.
 * Lets the user pick an IR device, then a command or sequence from that device.
 * Redesigned in Ziggy token style — same logic, new visual.
 */
import { useEffect, useState } from 'react'
import { getIrDevices } from '../lib/api'

const selectStyle = {
  width: '100%', height: 38, padding: '0 12px',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 9, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
  outline: 'none', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.4)' d='M0 0h10L5 6z'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 28,
}

export default function IRDeviceSelect({ value, onChange }) {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getIrDevices().then(setDevices).catch(() => setDevices([])).finally(() => setLoading(false))
  }, [])

  const selectedDevice = devices.find(d => d.id === value?.ir_device_id) || null
  const learned        = selectedDevice ? (selectedDevice.learned_commands || []) : []
  const sequences      = selectedDevice ? Object.keys(selectedDevice.sequences || {}) : []
  const isAC           = selectedDevice?.type === 'ac'

  const set = (patch) => onChange({ ...(value || {}), ...patch })

  const handleDeviceChange = (id) => {
    const dev = devices.find(d => d.id === id)
    set({ ir_device_id: id, ir_device_name: dev?.name || '', ir_command: '', ir_sequence: '', ir_temperature: undefined, ir_mode: undefined })
  }

  if (loading) return <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '6px 0' }}>Loading IR devices…</p>
  if (!devices.length) return (
    <p style={{ fontSize: 12, color: 'var(--ink-mute)', padding: '6px 0' }}>No IR devices configured. Add one in Devices.</p>
  )

  const modeOptions = [
    { id: 'command',     label: 'Command' },
    ...(sequences.length ? [{ id: 'sequence', label: 'Sequence' }] : []),
    ...(isAC ? [{ id: 'temperature', label: 'Temperature' }] : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
      {/* Device picker */}
      <select style={selectStyle} value={value?.ir_device_id || ''} onChange={e => handleDeviceChange(e.target.value)}>
        <option value="">— select IR device —</option>
        {devices.map(d => (
          <option key={d.id} value={d.id}>{d.name}{d.room ? ` (${d.room.replace(/_/g, ' ')})` : ''}</option>
        ))}
      </select>

      {selectedDevice && (
        <>
          {/* Mode tabs */}
          {modeOptions.length > 1 && (
            <div style={{ display: 'flex', gap: 4 }}>
              {modeOptions.map(({ id, label }) => {
                const active =
                  id === 'sequence'    ? !!value?.ir_sequence :
                  id === 'temperature' ? value?.ir_temperature != null :
                  !value?.ir_sequence && value?.ir_temperature == null
                const switchTo = () => {
                  if (id === 'sequence')    set({ ir_command: '', ir_sequence: '', ir_temperature: undefined, ir_mode: undefined })
                  else if (id === 'temperature') set({ ir_command: '', ir_sequence: undefined, ir_temperature: 22, ir_mode: undefined })
                  else set({ ir_command: '', ir_sequence: undefined, ir_temperature: undefined, ir_mode: undefined })
                }
                return (
                  <button
                    key={id} onClick={switchTo}
                    style={{
                      padding: '4px 10px', borderRadius: 7, fontSize: 11.5, fontFamily: 'inherit',
                      fontWeight: 500, cursor: 'pointer',
                      background: active ? `color-mix(in srgb, var(--accent) 10%, var(--surface))` : 'var(--surface)',
                      color: active ? 'var(--accent)' : 'var(--ink-mute)',
                      border: active ? '0.5px solid var(--accent)' : '0.5px solid var(--line)',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          {/* Command picker */}
          {!value?.ir_sequence && value?.ir_temperature == null && (
            <select style={selectStyle} value={value?.ir_command || ''} onChange={e => set({ ir_command: e.target.value, ir_sequence: undefined })}>
              <option value="">— select command —</option>
              {(learned.length > 0 ? learned : Object.keys(selectedDevice.commands || {})).map(c => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}{!learned.includes(c) ? ' (not learned)' : ''}</option>
              ))}
            </select>
          )}

          {/* Sequence picker */}
          {value?.ir_sequence !== undefined && sequences.length > 0 && (
            <select style={selectStyle} value={value?.ir_sequence || ''} onChange={e => set({ ir_sequence: e.target.value, ir_command: '' })}>
              <option value="">— select sequence —</option>
              {sequences.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          )}

          {/* AC temperature */}
          {isAC && value?.ir_temperature != null && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="number" min={16} max={30}
                value={value?.ir_temperature ?? 22}
                onChange={e => set({ ir_temperature: parseInt(e.target.value) })}
                style={{ ...selectStyle, width: 90, paddingRight: 12, backgroundImage: 'none' }}
                placeholder="22"
              />
              <select style={selectStyle} value={value?.ir_mode || ''} onChange={e => set({ ir_mode: e.target.value || undefined })}>
                <option value="">— mode (optional) —</option>
                {['cool', 'heat', 'fan', 'auto', 'dry'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  )
}
