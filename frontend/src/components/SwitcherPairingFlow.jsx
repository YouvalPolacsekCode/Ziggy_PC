import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Send, KeyRound, ExternalLink } from 'lucide-react'
import {
  switcherPairingStart, switcherPairingStep, switcherPairingCancel,
  switcherPairingRecover, switcherAccountStatus, switcherAccountConnect,
} from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * Native Ziggy pairing UI for Switcher devices.
 *
 * Drives HA's `switcher_kis` config flow through Ziggy's own screens — the
 * user never sees Home Assistant. Each step HA returns is rendered as a
 * Ziggy form / progress / done screen; user input is shipped back to HA
 * step-by-step until create_entry.
 */

function MiniField({ field, value, onChange }) {
  const t = useT()
  const placeholder = field.label

  if (field.kind === 'boolean') {
    return (
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={Boolean(value ?? field.default ?? false)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span style={{ fontSize: 13 }}>{field.label}</span>
      </label>
    )
  }
  if (field.kind === 'number') {
    return (
      <input
        type="number"
        min={field.min} max={field.max}
        value={value ?? field.default ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        style={{
          padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--ink)', fontSize: 14, width: '100%',
        }}
      />
    )
  }
  if (field.kind === 'select') {
    return (
      <select
        value={value ?? field.default ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--ink)', fontSize: 14, width: '100%',
        }}
      >
        <option value="">{t('wizard.switcher.selectDots')}</option>
        {(field.options || []).map((opt) => {
          const v = typeof opt === 'object' ? (opt.value ?? opt.label) : opt
          const l = typeof opt === 'object' ? (opt.label ?? opt.value) : opt
          return <option key={v} value={v}>{l}</option>
        })}
      </select>
    )
  }
  return (
    <input
      type="text"
      value={value ?? field.default ?? ''}
      placeholder={placeholder}
      dir="auto"
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)',
        background: 'var(--surface)', color: 'var(--ink)', fontSize: 14, width: '100%',
      }}
    />
  )
}

export default function SwitcherPairingFlow({ onDone, onCancel }) {
  const t = useT()
  const [step, setStep] = useState(null)        // current step descriptor from backend
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recovery, setRecovery] = useState(null)  // 'ha_restart' | 'ha_restart_failed' | null
  const [diagnostic, setDiagnostic] = useState(null)
  const [input, setInput] = useState({})
  // Credentials prompt is inline mid-flow — only when HA's current step is
  // the account-credentials form AND we don't have them cached. Most Switcher
  // products (Touch, V2/V4, Mini, Breeze, Power Plug) never trigger this.
  const [acctEmail, setAcctEmail] = useState('')
  const [acctToken, setAcctToken] = useState('')
  const [acctErr, setAcctErr] = useState('')

  // Drive pairing straight away — HA's flow decides whether credentials are
  // needed for the discovered device. If it asks, we render the connect
  // screen inline (see render below).
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    switcherPairingStart()
      .then((s) => {
        if (cancelled) return
        if (s?.ok === false) {
          setError(s.error || t('wizard.switcher.couldNotStart'))
          setRecovery(s.recovery || null)
          setDiagnostic(s.diagnostic || null)
        } else {
          setStep(s)
        }
        setBusy(false)
      })
      .catch((e) => { if (!cancelled) { setError(e?.message || t('wizard.switcher.couldNotStart')); setBusy(false) } })
    return () => { cancelled = true }
  }, [])

  // Submit credentials when HA's current step is the account form.
  async function connectAccount() {
    setAcctErr('')
    if (!acctEmail.trim() || !acctToken.trim()) {
      setAcctErr(t('wizard.switcher.emailTokenRequired'))
      return
    }
    setBusy(true)
    try {
      // 1. Validate + cache for future pairings (so we never see this screen
      //    again for the same Switcher account).
      await switcherAccountConnect(acctEmail.trim(), acctToken.trim())
      // 2. Submit the credentials to HA's current flow step so this pairing
      //    finishes. We send the field names HA expects (handled server-side
      //    by mapping cached creds onto the actual field schema).
      if (!step?.flow_id) {
        setAcctErr(t('wizard.switcher.lostTrack'))
        setBusy(false)
        return
      }
      // Pick the right field names from the schema HA returned.
      const fields = step.fields || []
      const userField = fields.find(f => ['username', 'email'].includes(f.name))?.name || 'username'
      const tokenField = fields.find(f => ['token', 'device_token', 'user_token'].includes(f.name))?.name || 'token'
      const payload = {
        [userField]: acctEmail.trim(),
        [tokenField]: acctToken.trim(),
      }
      const next = await switcherPairingStep(step.flow_id, payload)
      setStep(next)
      setAcctEmail(''); setAcctToken('')
    } catch (e) {
      setAcctErr(e?.message || t('wizard.switcher.couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  // Auto-advance progress steps every 2.5s.
  useEffect(() => {
    if (step?.status !== 'progress' || !step.flow_id) return
    const intervalId = setInterval(async () => {
      try {
        const next = await switcherPairingStep(step.flow_id, {})
        setStep(next)
      } catch {}
    }, 2500)
    return () => clearInterval(intervalId)
  }, [step?.status, step?.flow_id])

  async function submit() {
    if (!step?.flow_id) return
    setBusy(true)
    setError('')
    try {
      const next = await switcherPairingStep(step.flow_id, input)
      setStep(next)
      setInput({})
    } catch (e) {
      setError(e?.message || t('wizard.switcher.stepFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (step?.flow_id) {
      try { await switcherPairingCancel(step.flow_id) } catch {}
    }
    onCancel && onCancel()
  }

  if (error) {
    async function retry() {
      setError(''); setRecovery(null); setDiagnostic(null); setStep(null); setBusy(true)
      try {
        const s = await switcherPairingStart()
        if (s?.ok === false) {
          setError(s.error || t('wizard.switcher.couldNotStart'))
          setRecovery(s.recovery || null)
          setDiagnostic(s.diagnostic || null)
        } else {
          setStep(s)
        }
      } catch (e) {
        setError(e?.message || t('wizard.switcher.couldNotStart'))
      } finally {
        setBusy(false)
      }
    }
    async function recoverHaRestart() {
      setError(''); setRecovery(null); setDiagnostic(null); setStep(null); setBusy(true)
      try {
        const s = await switcherPairingRecover()
        if (s?.ok === false) {
          setError(s.error || t('wizard.switcher.recoveryFailed'))
          setRecovery(s.recovery || null)
          setDiagnostic(s.diagnostic || null)
        } else {
          setStep(s)
        }
      } catch (e) {
        setError(e?.message || t('wizard.switcher.recoveryFailed'))
      } finally {
        setBusy(false)
      }
    }
    // Detect a multi-line traceback excerpt so we render it in mono / preserve newlines.
    const isTrace = /\n/.test(error) || /Traceback|File "/.test(error)
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <XCircle size={36} style={{ color: 'var(--err)', margin: '0 auto 10px' }} />
        {isTrace ? (
          <pre style={{
            color: 'var(--ink)', fontSize: 11, lineHeight: 1.4,
            marginBottom: 14, textAlign: 'left',
            background: 'var(--surface-2)', borderRadius: 10, padding: 10,
            maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap',
            fontFamily: 'IBM Plex Mono, monospace',
          }}>
            {error}
          </pre>
        ) : (
          <p style={{ color: 'var(--ink)', fontSize: 13, lineHeight: 1.5, marginBottom: 14, textAlign: 'left' }}>
            {error}
          </p>
        )}
        {diagnostic && recovery === 'ha_restart_failed' && (
          <div style={{
            background: 'var(--surface-2)', borderRadius: 10, padding: 12,
            marginBottom: 14, textAlign: 'left',
          }}>
            <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 8 }}>
              {t('wizard.switcher.portCheck')}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', marginBottom: 10 }}>
              {(diagnostic.ports || []).map((p) => (
                <>
                  <span key={`l-${p.port}`} style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 }}>
                    UDP {p.port}
                  </span>
                  <span key={`r-${p.port}`} style={{
                    fontSize: 11,
                    color: p.free ? 'var(--ok)' : 'var(--err)',
                  }}>
                    {p.free
                      ? t('wizard.switcher.portFree')
                      : t('wizard.switcher.portBlocked', { error: p.error || t('wizard.switcher.inUse') })}
                  </span>
                </>
              ))}
            </div>
            {(diagnostic.busy_ports || []).length === 0 && (diagnostic.free_ports || []).length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 8, lineHeight: 1.5 }}>
                {t('wizard.switcher.allPortsFreeHint')}
              </p>
            )}
            {(diagnostic.busy_ports || []).length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 8, lineHeight: 1.5 }}>
                {t('wizard.switcher.somePortsBlocked')}
              </p>
            )}
            <pre style={{
              fontSize: 11, fontFamily: 'IBM Plex Mono, monospace',
              background: 'var(--surface)', padding: 8, borderRadius: 6,
              margin: 0, overflowX: 'auto',
            }}>
              {`sudo lsof -nP -iUDP:20002 -iUDP:10002 -iUDP:20003 -iUDP:10003
# or:
sudo ss -ulnp 'sport = :20002 or sport = :10002 or sport = :20003 or sport = :10003'`}
            </pre>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={onCancel} style={{ ...btnStyle(), background: 'transparent', color: 'var(--ink-mute)' }}>
            {t('wizard.close')}
          </button>
          <button onClick={retry} style={{ ...btnStyle(), background: 'var(--surface-2)', color: 'var(--ink)' }}>{t('wizard.retry')}</button>
          {recovery === 'ha_restart' && (
            <button onClick={recoverHaRestart} style={btnStyle()}>
              {t('wizard.switcher.restartHa')}
            </button>
          )}
        </div>
        {recovery === 'ha_restart' && (
          <p style={{ marginTop: 10, fontSize: 10.5, color: 'var(--ink-faint)' }}>
            {t('wizard.switcher.restartHaWarn')}
          </p>
        )}
      </div>
    )
  }

  // ── Inline credentials prompt — only when HA's current step actually
  //    asks for them AND we don't have them cached. Most Switcher products
  //    never reach this branch.
  const needsAccount = step?.status === 'form' && step?.needs_account && !step?.account_connected
  if (needsAccount) {
    return (
      <div style={{ padding: 18 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
          color: 'var(--ink)',
        }}>
          <KeyRound size={18} />
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t('wizard.switcher.needsAccount')}</h3>
        </div>

        <div style={{
          background: 'var(--surface-2)', borderRadius: 12, padding: 12, marginBottom: 14,
        }}>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.55, margin: 0 }}>
            {t('wizard.switcher.needsAccountBody')}
          </p>
          <ol style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
            <li>{t('wizard.switcher.step1')}</li>
            <li>{t('wizard.switcher.step2')}</li>
            <li>{t('wizard.switcher.step3')}</li>
            <li>{t('wizard.switcher.step4')}</li>
          </ol>
          <a
            href="https://www.home-assistant.io/integrations/switcher_kis/"
            target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, color: 'var(--accent)', marginTop: 8, textDecoration: 'none' }}
          >
            {t('wizard.switcher.openInstructions')} <ExternalLink size={11} />
          </a>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{t('wizard.switcher.accountEmail')}</span>
            <input
              type="email"
              value={acctEmail}
              onChange={(e) => setAcctEmail(e.target.value)}
              placeholder={t('wizard.switcher.emailPh')}
              autoComplete="email"
              dir="auto"
              style={{
                padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--surface)', color: 'var(--ink)', fontSize: 14,
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{t('wizard.switcher.token')}</span>
            <textarea
              value={acctToken}
              onChange={(e) => setAcctToken(e.target.value)}
              placeholder={t('wizard.switcher.tokenPh')}
              rows={3}
              spellCheck={false}
              dir="auto"
              style={{
                padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--surface)', color: 'var(--ink)', fontSize: 13,
                fontFamily: 'IBM Plex Mono, monospace', resize: 'vertical',
              }}
            />
          </div>
        </div>

        {acctErr && (
          <p style={{ marginTop: 10, fontSize: 12, color: 'var(--err)' }}>{acctErr}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button
            onClick={cancel}
            style={{ ...btnStyle(), background: 'transparent', color: 'var(--ink-mute)' }}
          >
            {t('wizard.cancel')}
          </button>
          <button
            onClick={connectAccount}
            disabled={busy}
            style={btnStyle()}
          >
            {busy ? <Loader2 size={13} className="animate-spin" style={{ marginRight: 6, verticalAlign: 'middle' }} /> : null}
            {t('wizard.switcher.verifyContinue')}
          </button>
        </div>
      </div>
    )
  }

  if (!step || busy) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Loader2 size={28} className="animate-spin" style={{ margin: '0 auto 10px', color: 'var(--accent)' }} />
        <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
          {busy && step ? t('wizard.switcher.working') : t('wizard.switcher.lookingNearby')}
        </p>
      </div>
    )
  }

  if (step.status === 'progress') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Loader2 size={28} className="animate-spin" style={{ margin: '0 auto 10px', color: 'var(--accent)' }} />
        <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
          {step.progress_action || t('wizard.switcher.working')}
        </p>
      </div>
    )
  }

  if (step.status === 'done') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <CheckCircle2 size={36} style={{ color: 'var(--ok)', margin: '0 auto 10px' }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{step.title || t('wizard.switcher.deviceAdded')}</h3>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 14 }}>
          {t('wizard.switcher.doneBody')}
        </p>
        <button onClick={onDone} style={btnStyle()}>{t('wizard.switcher.done')}</button>
      </div>
    )
  }

  if (step.status === 'aborted') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <XCircle size={32} style={{ color: 'var(--warn)', margin: '0 auto 10px' }} />
        <p style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 12 }}>
          {t('wizard.switcher.cancelled', { reason: step.reason || t('wizard.switcher.reasonUnknown') })}
        </p>
        <button onClick={onCancel} style={btnStyle()}>{t('wizard.close')}</button>
      </div>
    )
  }

  if (step.status === 'menu') {
    return (
      <div style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>{t('wizard.switcher.choose')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {step.options.map((opt) => {
            const id = typeof opt === 'object' ? (opt.value ?? opt.label) : opt
            const label = typeof opt === 'object' ? (opt.label ?? opt.value) : opt
            return (
              <button
                key={id}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const next = await switcherPairingStep(step.flow_id, { next_step_id: id })
                    setStep(next)
                  } catch (e) {
                    setError(e?.message || t('wizard.switcher.stepFailed'))
                  } finally {
                    setBusy(false)
                  }
                }}
                style={{ ...btnStyle(), background: 'var(--surface-2)', color: 'var(--ink)' }}
              >
                {label}
              </button>
            )
          })}
        </div>
        <button onClick={cancel} style={{ ...btnStyle(), background: 'transparent', color: 'var(--ink-mute)', marginTop: 14 }}>
          {t('wizard.cancel')}
        </button>
      </div>
    )
  }

  // Default: form
  const fields = step.fields || []
  return (
    <div style={{ padding: 18 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
        {fields.length === 0 ? t('wizard.switcher.confirm') : t('wizard.switcher.setupDevice')}
      </h3>
      {step.description_placeholders?.name && (
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 12 }}>
          {step.description_placeholders.name}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {fields.map((f) => (
          <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
              {f.label}{f.required ? ' *' : ''}
            </span>
            <MiniField
              field={f}
              value={input[f.name]}
              onChange={(v) => setInput((cur) => ({ ...cur, [f.name]: v }))}
            />
          </div>
        ))}
      </div>
      {Object.keys(step.errors || {}).length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--err)', marginBottom: 10 }}>
          {Object.values(step.errors).join(' · ')}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={cancel} style={{ ...btnStyle(), background: 'transparent', color: 'var(--ink-mute)' }}>
          {t('wizard.cancel')}
        </button>
        <button onClick={submit} disabled={busy} style={btnStyle()}>
          {fields.length === 0 ? t('wizard.switcher.continue') : t('wizard.switcher.submit')} {!busy && <Send size={12} style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
        </button>
      </div>
    </div>
  )
}

function btnStyle() {
  return {
    padding: '8px 16px', borderRadius: 10, border: 'none',
    background: 'var(--accent)', color: 'white', fontSize: 13,
    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }
}
