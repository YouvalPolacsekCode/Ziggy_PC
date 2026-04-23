import { useState, useEffect } from 'react'
import { useApi, patchVoiceSettings } from '../hooks/useApi'

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

export function Settings() {
  const { data: status } = useApi('/api/status')
  const { data: voiceData, loading } = useApi('/api/settings/voice')
  const [voice, setVoice] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (voiceData) setVoice(voiceData) }, [voiceData])

  async function save() {
    setSaving(true)
    await patchVoiceSettings(voice)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const cfg = status?.config || {}
  const sys = status?.system || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-dim)' }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>Settings</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Voice, system, and connection settings</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>

        {/* System status */}
        <div style={{ padding: '16px 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>System</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
          {[
            ['CPU', sys.cpu_percent != null ? `${sys.cpu_percent}%` : '—'],
            ['RAM', sys.ram_percent != null ? `${sys.ram_percent}%` : '—'],
            ['Disk', sys.disk_percent != null ? `${sys.disk_percent}%` : '—'],
            ['HA URL', cfg.ha_url || '—'],
            ['Wake word', cfg.wakeword_model || '—'],
            ['WS Clients', status?.ws_clients ?? '—'],
          ].map(([k, v]) => (
            <div key={k} style={{ background: 'var(--bg-2)', border: '1px solid var(--border-dim)', borderRadius: 'var(--radius-sm)', padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Voice settings */}
        {!loading && (
          <>
            <div style={{ padding: '16px 0 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Voice</div>

            <Row label="Wake word enabled" hint="Listen for 'Hey Mycroft' to activate">
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
                background: 'linear-gradient(135deg, var(--purple), var(--indigo))',
                color: '#fff', border: 'none', borderRadius: 'var(--radius)',
                padding: '9px 24px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
                opacity: saving ? .6 : 1,
              }}>
                {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
