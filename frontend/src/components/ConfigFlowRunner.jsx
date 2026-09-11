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

export default function ConfigFlowRunner({ flowId, title, onDone, onCancel, onGone }) {
  const t = useT()
  const [step, setStep]   = useState(null)   // reshaped envelope
  const [input, setInput] = useState({})
  const [busy, setBusy]   = useState(true)
  const [error, setError] = useState(null)
  // Set when HA has dropped the discovery flow (device consumed/offline). This
  // is NOT a retryable error — retrying a dead flow id just 404s again — so it
  // renders its own screen whose only action is a fresh scan.
  const [gone, setGone]   = useState(null)
  const pollRef = useRef(null)

  const apply = (env) => {
    setBusy(false)
    if (!env) { setError(t('wizard.configFlow.failed')); return }
    if (env.status === 'gone')    { setGone(t('wizard.configFlow.gone')); return }
    if (env.status === 'timeout') { setError(t('wizard.configFlow.timeout')); return }
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
  //
  // Guarded to fire exactly once per flow id. Without this guard React StrictMode
  // (and any rapid remount) double-invokes the effect, firing a SECOND empty
  // submit that races/clobbers the first — for a one-shot HA discovery flow that
  // consumes it and yields the "upstream issues" dead-end.
  const initedFlow = useRef(null)
  useEffect(() => {
    if (initedFlow.current === flowId) return
    initedFlow.current = flowId
    setStep(null); setInput({}); setError(null); setGone(null)
    send({})
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [flowId])

  // Progress (e.g. "accept on your TV"): poll until it advances.
  useEffect(() => {
    if (step?.status !== 'progress') { if (pollRef.current) clearInterval(pollRef.current); return }
    pollRef.current = setInterval(() => { configFlowStep(flowId, {}).then(apply).catch(() => {}) }, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [step?.status, flowId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => { try { await configFlowCancel(flowId) } catch {} onCancel?.() }

  const box = { display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center', padding: '12px 4px' }
  // One inverted primary per screen; everything else is a hairline secondary.
  const btnCls = (primary) => (primary ? 'z-btn-primary z-button' : 'z-btn-secondary z-button')
  const btn = () => ({ cursor: busy ? 'wait' : 'pointer' })
  const statusDisc = (tone) => ({
    width: 56, height: 56, borderRadius: '50%',
    background: `color-mix(in srgb, var(--${tone}) 12%, var(--surface))`, color: `var(--${tone})`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  })

  if (gone) {
    return (
      <div style={box}>
        <div style={statusDisc('warn')} aria-hidden><X size={28} strokeWidth={1.75} /></div>
        <div className="z-body">{gone}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => (onGone ? onGone() : onCancel?.())} className={btnCls(true)} style={btn()}>{t('wizard.configFlow.rescan')}</button>
          <button onClick={cancel} className={btnCls(false)} style={btn()}>{t('wizard.configFlow.cancel')}</button>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={box}>
        <div style={statusDisc('err')} aria-hidden><X size={28} strokeWidth={1.75} /></div>
        <div className="z-body" role="alert">{error}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => send({})} className={btnCls(true)} style={btn()}>{t('wizard.configFlow.retry')}</button>
          <button onClick={cancel} className={btnCls(false)} style={btn()}>{t('wizard.configFlow.cancel')}</button>
        </div>
      </div>
    )
  }

  if (!step || busy && !step) {
    return <div style={box}><Loader2 size={24} className="z-spin" style={{ color: 'var(--ink-mute)' }} /><div className="z-subhead">{t('wizard.configFlow.configuring')}</div></div>
  }

  if (step.status === 'done') {
    return (
      <div style={box}>
        <div style={statusDisc('ok')} aria-hidden><Check size={28} strokeWidth={2} /></div>
        <div className="z-title">{t('wizard.configFlow.added', { name: title || step.title || '' })}</div>
        <button onClick={() => onDone?.(step)} className={btnCls(true)} style={btn()}>{t('wizard.configFlow.done')}</button>
      </div>
    )
  }

  if (step.status === 'aborted') {
    return (
      <div style={box}>
        <div className="z-body">{t('wizard.configFlow.couldntAdd', { reason: step.reason || '' })}</div>
        <button onClick={cancel} className={btnCls(false)} style={btn()}>{t('wizard.configFlow.cancel')}</button>
      </div>
    )
  }

  if (step.status === 'progress') {
    return (
      <div style={box}>
        <Loader2 size={24} className="z-spin" style={{ color: 'var(--ink-mute)' }} />
        <div className="z-body">{t('wizard.configFlow.confirmOnDevice', { name: title || '' })}</div>
        <button onClick={cancel} className={btnCls(false)} style={btn()}>{t('wizard.configFlow.cancel')}</button>
      </div>
    )
  }

  // form (default) — render the fields HA asked for.
  const fields = step.fields || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="z-title">{title || t('wizard.configFlow.setup')}</div>
      {fields.map((f) => {
        const val = input[f.name] ?? f.default ?? ''
        const set = (v) => setInput((s) => ({ ...s, [f.name]: v }))
        const label = f.label || f.name
        if (f.type === 'boolean') {
          return (
            <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, fontSize: 17, lineHeight: '22px', color: 'var(--ink)' }}>
              <input type="checkbox" checked={!!input[f.name]} onChange={(e) => set(e.target.checked)} style={{ width: 20, height: 20 }} /> {label}
            </label>
          )
        }
        if (Array.isArray(f.options) && f.options.length) {
          return (
            <div key={f.name}>
              <label style={{ display: 'block', fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{label}</label>
              <select value={val} onChange={(e) => set(e.target.value)} className="z-input"
                style={{ height: 44, padding: '0 16px' }}>
                <option value="" />
                {f.options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o.value ?? o}</option>)}
              </select>
            </div>
          )
        }
        return (
          <div key={f.name}>
            <label style={{ display: 'block', fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{label}</label>
            <input type={/pass|token|pin/i.test(f.name) ? 'password' : 'text'} value={val}
              onChange={(e) => set(e.target.value)} dir="auto" className="z-input"
              style={{ height: 44, padding: '0 16px', boxSizing: 'border-box' }} />
          </div>
        )
      })}
      {step.errors?.base && <div role="alert" style={{ fontSize: 15, lineHeight: '20px', color: 'var(--err-text)' }}>{step.errors.base}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <button onClick={() => send(input)} disabled={busy} className={btnCls(true)} style={btn()}>
          {fields.length === 0 ? t('wizard.configFlow.confirm') : t('wizard.configFlow.submit')} {!busy && <Send size={18} strokeWidth={1.75} aria-hidden />}
        </button>
        <button onClick={cancel} className={btnCls(false)} style={btn()}>{t('wizard.configFlow.cancel')}</button>
      </div>
    </div>
  )
}
