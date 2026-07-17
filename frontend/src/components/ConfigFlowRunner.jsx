// ConfigFlowRunner — drive ANY discovered HA config flow (smart TV, Chromecast,
// WiFi plug, …) to completion as native Ziggy screens. Never shows HA.
//
// Generic by design: it renders whatever step HA returns (auto-confirm, a form,
// or a "confirm on the device" progress prompt) using the reshaped envelope from
// /api/pairing/config-flow/{flow_id}/step. No per-integration code.
import { useState, useEffect, useRef } from 'react'
import { Loader2, Check, X, Send } from 'lucide-react'
import { configFlowStep, configFlowCancel } from '../lib/api'
import { useT } from '../lib/i18n'

export default function ConfigFlowRunner({ flowId, title, onDone, onCancel }) {
  const t = useT()
  const [step, setStep]   = useState(null)   // reshaped envelope
  const [input, setInput] = useState({})
  const [busy, setBusy]   = useState(true)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  const apply = (env) => {
    setBusy(false)
    if (!env) { setError(t('wizard.configFlow.failed')); return }
    if (env.status === 'aborted') { setStep(env); return }
    if (env.ok === false) { setError(env.detail || env.error || t('wizard.configFlow.failed')); return }
    setError(null)
    setStep(env)
    if (env.status === 'done') onDone?.(env)
  }

  const send = async (userInput) => {
    setBusy(true); setError(null)
    try { apply(await configFlowStep(flowId, userInput || {})) }
    catch (e) { setBusy(false); setError(e.message || t('wizard.configFlow.failed')) }
  }

  // Auto-configure on open: empty submit. Simple devices finish here; ones that
  // need input come back as a form; ones that need on-device confirmation come
  // back as a progress step.
  useEffect(() => { send({}) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [flowId])

  // Progress (e.g. "accept on your TV"): poll until it advances.
  useEffect(() => {
    if (step?.status !== 'progress') { if (pollRef.current) clearInterval(pollRef.current); return }
    pollRef.current = setInterval(() => { configFlowStep(flowId, {}).then(apply).catch(() => {}) }, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [step?.status, flowId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => { try { await configFlowCancel(flowId) } catch {} onCancel?.() }

  const box = { display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center', padding: '12px 4px' }
  const btn = (primary) => ({
    padding: '12px 16px', borderRadius: 10, border: primary ? 'none' : '1px solid var(--line)',
    background: primary ? 'var(--accent)' : 'transparent', color: primary ? 'white' : 'var(--ink-mute)',
    fontWeight: 600, fontSize: 14, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
  })

  if (error) {
    return (
      <div style={box}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--err-soft, #fee)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={22} className="text-err" /></div>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{error}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => send({})} style={btn(true)}>{t('wizard.configFlow.retry')}</button>
          <button onClick={cancel} style={btn(false)}>{t('wizard.configFlow.cancel')}</button>
        </div>
      </div>
    )
  }

  if (!step || busy && !step) {
    return <div style={box}><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} /><div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{t('wizard.configFlow.configuring')}</div></div>
  }

  if (step.status === 'done') {
    return (
      <div style={box}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--ok-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={24} className="text-ok" /></div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{t('wizard.configFlow.added', { name: title || step.title || '' })}</div>
        <button onClick={() => onDone?.(step)} style={btn(true)}>{t('wizard.configFlow.done')}</button>
      </div>
    )
  }

  if (step.status === 'aborted') {
    return (
      <div style={box}>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{t('wizard.configFlow.couldntAdd', { reason: step.reason || '' })}</div>
        <button onClick={cancel} style={btn(false)}>{t('wizard.configFlow.cancel')}</button>
      </div>
    )
  }

  if (step.status === 'progress') {
    return (
      <div style={box}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{t('wizard.configFlow.confirmOnDevice', { name: title || '' })}</div>
        <button onClick={cancel} style={btn(false)}>{t('wizard.configFlow.cancel')}</button>
      </div>
    )
  }

  // form (default) — render the fields HA asked for.
  const fields = step.fields || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{title || t('wizard.configFlow.setup')}</div>
      {fields.map((f) => {
        const val = input[f.name] ?? f.default ?? ''
        const set = (v) => setInput((s) => ({ ...s, [f.name]: v }))
        const label = f.label || f.name
        if (f.type === 'boolean') {
          return (
            <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
              <input type="checkbox" checked={!!input[f.name]} onChange={(e) => set(e.target.checked)} /> {label}
            </label>
          )
        }
        if (Array.isArray(f.options) && f.options.length) {
          return (
            <div key={f.name}>
              <label style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{label}</label>
              <select value={val} onChange={(e) => set(e.target.value)}
                style={{ width: '100%', height: 40, padding: '0 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}>
                <option value="" />
                {f.options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o.value ?? o}</option>)}
              </select>
            </div>
          )
        }
        return (
          <div key={f.name}>
            <label style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{label}</label>
            <input type={/pass|token|pin/i.test(f.name) ? 'password' : 'text'} value={val}
              onChange={(e) => set(e.target.value)} dir="auto"
              style={{ width: '100%', height: 40, padding: '0 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', boxSizing: 'border-box' }} />
          </div>
        )
      })}
      {step.errors?.base && <div style={{ fontSize: 12, color: 'var(--err)' }}>{step.errors.base}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={() => send(input)} disabled={busy} style={btn(true)}>
          {fields.length === 0 ? t('wizard.configFlow.confirm') : t('wizard.configFlow.submit')} {!busy && <Send size={12} style={{ marginInlineStart: 6, verticalAlign: 'middle' }} />}
        </button>
        <button onClick={cancel} style={btn(false)}>{t('wizard.configFlow.cancel')}</button>
      </div>
    </div>
  )
}
