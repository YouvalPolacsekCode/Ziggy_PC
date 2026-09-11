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
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
        <input
          type="checkbox"
          checked={Boolean(value ?? field.default ?? false)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 20, height: 20 }}
        />
        <span style={{ fontSize: 17, lineHeight: '22px', color: 'var(--ink)' }}>{field.label}</span>
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
        className="z-input z-mono"
      />
    )
  }
  if (field.kind === 'select') {
    return (
      <select
        value={value ?? field.default ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="z-input"
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
      className="z-input"
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
        <XCircle size={32} strokeWidth={1.75} style={{ color: 'var(--err)', margin: '0 auto 12px' }} aria-hidden />
        {isTrace ? (
          <pre className="z-code" style={{
            color: 'var(--ink)', fontSize: 13, lineHeight: '18px',
            marginBottom: 16, textAlign: 'start',
            background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)', padding: 12,
            maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap',
          }}>
            {error}
          </pre>
        ) : (
          <p role="alert" className="z-body" style={{ marginBottom: 16, textAlign: 'start' }}>
            {error}
          </p>
        )}
        {diagnostic && recovery === 'ha_restart_failed' && (
          <div style={{
            background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)', padding: 12,
            marginBottom: 16, textAlign: 'start',
          }}>
            <p className="z-footnote" style={{ marginBottom: 8 }}>
              {t('wizard.switcher.portCheck')}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', marginBottom: 12 }}>
              {(diagnostic.ports || []).map((p) => (
                <>
                  <span key={`l-${p.port}`} className="z-code" style={{ fontSize: 13 }}>
                    UDP {p.port}
                  </span>
                  <span key={`r-${p.port}`} style={{
                    fontSize: 13, lineHeight: '18px',
                    color: p.free ? 'var(--ok-text)' : 'var(--err-text)',
                  }}>
                    {p.free
                      ? t('wizard.switcher.portFree')
                      : t('wizard.switcher.portBlocked', { error: p.error || t('wizard.switcher.inUse') })}
                  </span>
                </>
              ))}
            </div>
            {(diagnostic.busy_ports || []).length === 0 && (diagnostic.free_ports || []).length > 0 && (
              <p className="z-footnote" style={{ marginBottom: 8 }}>
                {t('wizard.switcher.allPortsFreeHint')}
              </p>
            )}
            {(diagnostic.busy_ports || []).length > 0 && (
              <p className="z-footnote" style={{ marginBottom: 8 }}>
                {t('wizard.switcher.somePortsBlocked')}
              </p>
            )}
            <pre className="z-code" style={{
              fontSize: 13, lineHeight: '18px',
              background: 'var(--surface)', padding: 8, borderRadius: 'var(--r-chip)',
              margin: 0, overflowX: 'auto',
            }}>
              {`sudo lsof -nP -iUDP:20002 -iUDP:10002 -iUDP:20003 -iUDP:10003
# or:
sudo ss -ulnp 'sport = :20002 or sport = :10002 or sport = :20003 or sport = :10003'`}
            </pre>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={onCancel} className="z-btn-secondary z-button">
            {t('wizard.close')}
          </button>
          <button onClick={retry} className={recovery === 'ha_restart' ? 'z-btn-secondary z-button' : 'z-btn-primary z-button'}>{t('wizard.retry')}</button>
          {recovery === 'ha_restart' && (
            <button onClick={recoverHaRestart} className="z-btn-primary z-button">
              {t('wizard.switcher.restartHa')}
            </button>
          )}
        </div>
        {recovery === 'ha_restart' && (
          <p className="z-footnote" style={{ marginTop: 12 }}>
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
      <div style={{ padding: 16 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
          color: 'var(--ink)',
        }}>
          <KeyRound size={24} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-2)' }} />
          <h3 className="z-title" style={{ margin: 0 }}>{t('wizard.switcher.needsAccount')}</h3>
        </div>

        <div style={{
          background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)', padding: 16, marginBottom: 16,
        }}>
          <p className="z-subhead" style={{ margin: 0 }}>
            {t('wizard.switcher.needsAccountBody')}
          </p>
          <ol className="z-subhead" style={{ margin: '8px 0 0', paddingInlineStart: 20, lineHeight: '24px' }}>
            <li>{t('wizard.switcher.step1')}</li>
            <li>{t('wizard.switcher.step2')}</li>
            <li>{t('wizard.switcher.step3')}</li>
            <li>{t('wizard.switcher.step4')}</li>
          </ol>
          <a
            href="https://www.home-assistant.io/integrations/switcher_kis/"
            target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44,
              fontSize: 15, lineHeight: '20px', fontWeight: 500, color: 'var(--ink)', marginTop: 4, textDecoration: 'underline' }}
          >
            {t('wizard.switcher.openInstructions')} <ExternalLink size={16} strokeWidth={1.75} aria-hidden />
          </a>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)' }}>{t('wizard.switcher.accountEmail')}</span>
            <input
              type="email"
              value={acctEmail}
              onChange={(e) => setAcctEmail(e.target.value)}
              placeholder={t('wizard.switcher.emailPh')}
              autoComplete="email"
              dir="ltr"
              className="z-input"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)' }}>{t('wizard.switcher.token')}</span>
            <textarea
              value={acctToken}
              onChange={(e) => setAcctToken(e.target.value)}
              placeholder={t('wizard.switcher.tokenPh')}
              rows={3}
              spellCheck={false}
              dir="ltr"
              className="z-input z-code"
              style={{ fontSize: 15, resize: 'vertical' }}
            />
          </div>
        </div>

        {acctErr && (
          <p role="alert" style={{ marginTop: 12, fontSize: 15, lineHeight: '20px', color: 'var(--err-text)' }}>{acctErr}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            onClick={cancel}
            className="z-btn-secondary z-button"
          >
            {t('wizard.cancel')}
          </button>
          <button
            onClick={connectAccount}
            disabled={busy}
            className="z-btn-primary z-button"
          >
            {busy ? <Loader2 size={18} className="z-spin" aria-hidden /> : null}
            {t('wizard.switcher.verifyContinue')}
          </button>
        </div>
      </div>
    )
  }

  if (!step || busy) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Loader2 size={28} className="z-spin" aria-hidden style={{ margin: '0 auto 12px', color: 'var(--ink-mute)' }} />
        <p className="z-subhead">
          {busy && step ? t('wizard.switcher.working') : t('wizard.switcher.lookingNearby')}
        </p>
      </div>
    )
  }

  if (step.status === 'progress') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Loader2 size={28} className="z-spin" aria-hidden style={{ margin: '0 auto 12px', color: 'var(--ink-mute)' }} />
        <p className="z-subhead">
          {step.progress_action || t('wizard.switcher.working')}
        </p>
      </div>
    )
  }

  if (step.status === 'done') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <CheckCircle2 size={32} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ok)', margin: '0 auto 12px' }} />
        <h3 className="z-title" style={{ marginBottom: 8 }}>{step.title || t('wizard.switcher.deviceAdded')}</h3>
        <p className="z-body" style={{ color: 'var(--ink-mute)', marginBottom: 16 }}>
          {t('wizard.switcher.doneBody')}
        </p>
        <button onClick={onDone} className="z-btn-primary z-button">{t('wizard.switcher.done')}</button>
      </div>
    )
  }

  if (step.status === 'aborted') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <XCircle size={32} strokeWidth={1.75} aria-hidden style={{ color: 'var(--warn)', margin: '0 auto 12px' }} />
        <p className="z-body" style={{ marginBottom: 16 }}>
          {t('wizard.switcher.cancelled', { reason: step.reason || t('wizard.switcher.reasonUnknown') })}
        </p>
        <button onClick={onCancel} className="z-btn-secondary z-button">{t('wizard.close')}</button>
      </div>
    )
  }

  if (step.status === 'menu') {
    return (
      <div style={{ padding: 16 }}>
        <h3 className="z-title" style={{ marginBottom: 16 }}>{t('wizard.switcher.choose')}</h3>
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
                className="z-btn-secondary z-button"
                style={{ width: '100%', minHeight: 56 }}
              >
                {label}
              </button>
            )
          })}
        </div>
        <button onClick={cancel} className="z-btn-secondary z-button" style={{ marginTop: 16, color: 'var(--ink-mute)' }}>
          {t('wizard.cancel')}
        </button>
      </div>
    )
  }

  // Default: form
  const fields = step.fields || []
  return (
    <div style={{ padding: 16 }}>
      <h3 className="z-title" style={{ marginBottom: 4 }}>
        {fields.length === 0 ? t('wizard.switcher.confirm') : t('wizard.switcher.setupDevice')}
      </h3>
      {step.description_placeholders?.name && (
        <p className="z-subhead" style={{ marginBottom: 12 }}>
          {step.description_placeholders.name}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {fields.map((f) => (
          <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600, color: 'var(--ink)' }}>
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
        <p role="alert" style={{ fontSize: 15, lineHeight: '20px', color: 'var(--err-text)', marginBottom: 12 }}>
          {Object.values(step.errors).join(' · ')}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={cancel} className="z-btn-secondary z-button">
          {t('wizard.cancel')}
        </button>
        <button onClick={submit} disabled={busy} className="z-btn-primary z-button">
          {fields.length === 0 ? t('wizard.switcher.continue') : t('wizard.switcher.submit')} {!busy && <Send size={18} strokeWidth={1.75} aria-hidden />}
        </button>
      </div>
    </div>
  )
}

