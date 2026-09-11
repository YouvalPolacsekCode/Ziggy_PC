/**
 * IRDeviceSelect — action builder for ir_command steps in Automations/Routines.
 * Lets the user pick an IR device, then a command or sequence from that device.
 * Redesigned in Ziggy token style — same logic, new visual.
 */
import { useEffect, useState } from 'react'
import { getIrDevices } from '../lib/api'
import { useT } from '../lib/i18n'

const selectStyle = {
  width: '100%', height: 44, padding: '0 16px',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 'var(--r-ctl)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 15,
  outline: 'none', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.4)' d='M0 0h10L5 6z'/></svg>")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center', paddingRight: 36,
}

export default function IRDeviceSelect({ value, onChange }) {
  const t = useT()
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

  if (loading) return <p className="z-subhead" style={{ padding: '8px 0' }}>{t('irDeviceSelect.loading')}</p>
  if (!devices.length) return (
    <p className="z-subhead" style={{ padding: '8px 0' }}>{t('irDeviceSelect.noneConfigured')}</p>
  )

  const modeOptions = [
    { id: 'command',     label: t('irDeviceSelect.command') },
    ...(sequences.length ? [{ id: 'sequence', label: t('irDeviceSelect.sequence') }] : []),
    ...(isAC ? [{ id: 'temperature', label: t('irDeviceSelect.temperature') }] : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
      {/* Device picker */}
      <select style={selectStyle} value={value?.ir_device_id || ''} onChange={e => handleDeviceChange(e.target.value)}>
        <option value="">{t('irDeviceSelect.selectIrDevice')}</option>
        {devices.map(d => (
          <option key={d.id} value={d.id}>{d.name}{d.room ? ` (${d.room.replace(/_/g, ' ')})` : ''}</option>
        ))}
      </select>

      {selectedDevice && (
        <>
          {/* Mode tabs */}
          {modeOptions.length > 1 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                    key={id} onClick={switchTo} type="button"
                    aria-pressed={active}
                    className="z-button"
                    style={{
                      minHeight: 36, padding: '8px 16px', borderRadius: 999, fontSize: 13, fontFamily: 'inherit',
                      fontWeight: active ? 600 : 500, cursor: 'pointer',
                      background: active ? 'var(--surface-2)' : 'var(--surface)',
                      color: active ? 'var(--ink)' : 'var(--ink-mute)',
                      border: `0.5px solid ${active ? 'var(--line-2)' : 'var(--line)'}`,
                      transition: 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
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
              <option value="">{t('irDeviceSelect.selectCommand')}</option>
              {(learned.length > 0 ? learned : Object.keys(selectedDevice.commands || {})).map(c => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}{!learned.includes(c) ? t('irDeviceSelect.notLearnedSuffix') : ''}</option>
              ))}
            </select>
          )}

          {/* Sequence picker */}
          {value?.ir_sequence !== undefined && sequences.length > 0 && (
            <select style={selectStyle} value={value?.ir_sequence || ''} onChange={e => set({ ir_sequence: e.target.value, ir_command: '' })}>
              <option value="">{t('irDeviceSelect.selectSequence')}</option>
              {sequences.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          )}

          {/* AC temperature */}
          {isAC && value?.ir_temperature != null && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number" min={16} max={30}
                value={value?.ir_temperature ?? 22}
                onChange={e => set({ ir_temperature: parseInt(e.target.value) })}
                className="z-mono"
                style={{ ...selectStyle, width: 96, paddingRight: 16, backgroundImage: 'none' }}
                placeholder="22"
              />
              <select style={selectStyle} value={value?.ir_mode || ''} onChange={e => set({ ir_mode: e.target.value || undefined })}>
                <option value="">{t('irDeviceSelect.modeOptional')}</option>
                {['cool', 'heat', 'fan', 'auto', 'dry'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  )
}
