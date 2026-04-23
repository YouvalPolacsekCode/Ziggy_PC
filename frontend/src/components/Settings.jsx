import { useState, useEffect, useRef } from 'react'
import { useApi, patchVoiceSettings } from '../hooks/useApi'
import { addToast } from '../App'

function Row({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--border-dim)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: 'var(--text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 42, height: 24, borderRadius: 12,
      background: value ? 'var(--purple)' : 'var(--bg-3)',
      border: `1px solid ${value ? 'var(--purple)' : 'var(--border)'}`,
      position: 'relative', cursor: 'pointer', transition: 'all .2s', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 3, left: value ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left .2s',
      }} />
    </div>
  )
}

function MetricBar({ label, value }) {
  const pct = typeof value === 'number' ? value : parseFloat(value) || 0
  const color = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--yellow)' : 'var(--green)'
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border-dim)', borderRadius: 'var(--radius-sm)', padding: '10px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{value != null ? `${value}%` : '—'}</span>
      </div>
      {value != null && (
        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .4s, background .4s' }} />
        </div>
      )}
    </div>
  )
}

export function Settings() {
  const { data: voiceData, loading: voiceLoading } = useApi('/api/settings/voice')
  const { data: alertsData } = useApi('/api/settings/alerts')
  const [status, setStatus] = useState(null)
  const [voice, setVoice] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const refreshTimer = useRef(null)

  useEffect(() => { if (voiceData) setVoice(voiceData) }, [voiceData])

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/status')
      if (res.ok) setStatus(await res.json())
    } catch { /* backend may be offline */ }
  }

  // Load status on mount and auto-refresh every 30s
  useEffect(() => {
    loadStatus()
    refreshTimer.current = setInterval(loadStatus, 30000)
    return () => clearInterval(refreshTimer.current)
  }, [])

  async function save() {
    setSaving(true)
    try {
      await patchVoiceSettings(voice)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      addToast('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const cfg = status?.config || {}
  const sys = status?.system || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Settings</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Voice, system, and connection settings</div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={loadStatus} style={{
          background: 'var(--bg-3)', border: '1px solid var(--border)',
          color: 'var(--text-2)', padding: '6px 14px', borderRadius: 'var(--radius-sm)',
          cursor: 'pointer', fontSize: 12,
        }}>↻ Refresh</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>

        {/* System status */}
        <div style={{ padding: '16px 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>System</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
          <MetricBar label="CPU" value={sys.cpu_percent} />
          <MetricBar label="RAM" value={sys.ram_percent} />
          <MetricBar label="Disk" value={sys.disk_percent} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
          {[
            ['HA URL', cfg.ha_url || '—'],
            ['Wake word', cfg.wakeword_model || '—'],
            ['WS Clients', status?.ws_clients ?? '—'],
            ['Auto-refresh', 'Every 30s'],
          ].map(([k, v]) => (
            <div key={k} style={{ background: 'var(--bg-2)', border: '1px solid var(--border-dim)', borderRadius: 'var(--radius-sm)', padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', wordBreak: 'break-all' }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Voice settings */}
        {!voiceLoading && (
          <>
            <div style={{ padding: '16px 0 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Voice</div>

            <Row label="Wake word enabled" hint="Listen for the wake word to activate">
              <Toggle value={!!voice.wakeword_enabled} onChange={v => setVoice(p => ({ ...p, wakeword_enabled: v }))} />
            </Row>

            <Row label="Wake word model" hint="ONNX model name">
              <input value={voice.wakeword_model || ''} onChange={e => setVoice(p => ({ ...p, wakeword_model: e.target.value }))}
                style={{ width: 180, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '6px 10px', fontSize: 13, outline: 'none', fontFamily: 'var(--font)' }} />
            </Row>

            <Row label="Wake word threshold" hint={`Detection sensitivity (${voice.wakeword_threshold ?? 0.65})`}>
              <input type="range" min="0.3" max="0.95" step="0.05"
                value={voice.wakeword_threshold ?? 0.65}
                onChange={e => setVoice(p => ({ ...p, wakeword_threshold: parseFloat(e.target.value) }))}
                style={{ width: 140, accentColor: 'var(--purple)' }}
              />
            </Row>

            <Row label="Active listen timeout" hint="Seconds before returning to wake word mode">
              <input type="number" min="10" max="300"
                value={voice.active_timeout_s ?? 90}
                onChange={e => setVoice(p => ({ ...p, active_timeout_s: parseInt(e.target.value) }))}
                style={{ width: 80, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '6px 10px', fontSize: 13, outline: 'none', fontFamily: 'var(--font)', textAlign: 'center' }} />
            </Row>

            <div style={{ padding: '16px 0' }}>
              <button onClick={save} disabled={saving} style={{
                background: saved ? 'var(--green)' : 'linear-gradient(135deg, var(--purple), var(--indigo))',
                color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                padding: '9px 24px', cursor: saving ? 'not-allowed' : 'pointer',
                fontWeight: 600, fontSize: 14, opacity: saving ? .6 : 1, transition: 'background .3s',
              }}>
                {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </>
        )}

        {/* Sensor Alerts */}
        {alertsData && (
          <>
            <div style={{ padding: '16px 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Sensor Alerts</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {Object.entries(alertsData).map(([key, val]) => (
                <div key={key} style={{
                  background: 'var(--bg-2)', border: '1px solid var(--border-dim)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{key}</div>
                    {typeof val === 'object' && val !== null && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                        {JSON.stringify(val)}
                      </div>
                    )}
                  </div>
                  {typeof val === 'boolean' && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                      background: val ? '#22c55e22' : '#ef444422',
                      color: val ? 'var(--green)' : 'var(--red)',
                      border: `1px solid ${val ? '#22c55e44' : '#ef444444'}`,
                    }}>{val ? 'active' : 'inactive'}</span>
                  )}
                  {typeof val === 'string' && (
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{val}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
