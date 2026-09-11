import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { useT } from '../../lib/i18n'
import { applyAutomationBundle, deleteAutomationBundle } from '../../lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// BundlePreviewCard — Ziggy Pro Mode bundle review surface (D4)
//
// Rendered inline in the AIChat conversation when the assistant message
// carries `data.kind === "automation_bundle_preview"`. Shows the proposed
// occupancy sensors, modes, automations, and voice intents the LLM
// designed, with a single Accept / Discard footer. There is intentionally
// NO per-artifact toggle or edit modal in v1 — that's a future iteration.
// Accept All or Discard only.
//
// All user-facing strings route through i18n. HA jargon (entity_id,
// service, blueprint internals) stays buried inside the JSON; the user
// sees plain prose only — per the project-wide rule that HA is never
// visible. Language is read from `bundle.language` so a Hebrew bundle
// renders RTL even if the UI happens to be in English (or vice versa).
//
// Props:
//   bundle     — the full bundle dict from the backend (see D3 spec)
//   onAccept   — invoked with the apply result on success ({ok, created, errors})
//   onDiscard  — invoked when the user dismisses without applying
// ─────────────────────────────────────────────────────────────────────────────

const STATUS = {
  IDLE:     'idle',     // initial card; Accept / Discard available
  APPLYING: 'applying', // POST in flight; buttons disabled + spinner
  SUCCESS:  'success',  // fully applied; Undo / Done available (undo-last-accept)
  RESULTS:  'results',  // partial-failure view; per-artifact pass/fail + Undo
  UNDONE:   'undone',   // bundle swept via Undo; Dismiss available
}

// Trigger → one-line natural-language summary. Covers the common
// shapes the designer emits; falls back to a generic "when conditions
// are met" for anything we don't recognize so the card never shows
// raw HA jargon. Israeli defaults: 5-min motion windows.
function triggerSummary(trigger, lang, t) {
  if (!trigger || typeof trigger !== 'object') return t('automations.proCard.triggerGeneric')
  const type = trigger.type

  // State with for_minutes / for / for_seconds — "when motion stops for 5 minutes"
  if (type === 'state') {
    const to = trigger.to ?? trigger.state ?? trigger.value
    const forMin = trigger.for_minutes
      || (trigger.for_seconds ? Math.round(trigger.for_seconds / 60) : null)
      || (typeof trigger.for === 'string' && /^(\d+):(\d+):(\d+)$/.test(trigger.for)
            ? (() => { const [, h, m] = trigger.for.match(/^(\d+):(\d+):(\d+)$/); return parseInt(h, 10) * 60 + parseInt(m, 10) })()
            : null)
    const motiony = /occupied|motion|presence/i.test(trigger.entity_id || '')
    if (motiony && (to === 'off' || to === false)) {
      const mins = forMin ?? 5  // Israeli default: 5-min motion window
      return t('automations.proCard.trigStateMotionOffFor', { n: mins })
    }
    if (motiony && (to === 'on' || to === true)) {
      return t('automations.proCard.trigStateMotionOn')
    }
    if (to !== undefined && to !== null) {
      return forMin
        ? t('automations.proCard.trigStateChangeToFor', { value: String(to), n: forMin })
        : t('automations.proCard.trigStateChangeTo', { value: String(to) })
    }
    return t('automations.proCard.trigStateChange')
  }

  // Time-of-day — "every day at 23:00"
  if (type === 'time') {
    const at = trigger.at || trigger.time || ''
    if (at) return t('automations.proCard.trigTimeAt', { time: at })
    return t('automations.proCard.trigTimeGeneric')
  }

  // time_pattern — "every 15 minutes"
  if (type === 'time_pattern') {
    const m = trigger.minutes || trigger.trigger_minutes
    const h = trigger.hours   || trigger.trigger_hours
    if (m) {
      const n = String(m).replace(/^\//, '')
      return t('automations.proCard.trigEveryMinutes', { n })
    }
    if (h) {
      const n = String(h).replace(/^\//, '')
      return t('automations.proCard.trigEveryHours', { n })
    }
    return t('automations.proCard.trigPeriodic')
  }

  // Sun-based — "at sunrise" / "at sunset"
  if (type === 'sun' || type === 'sunrise' || type === 'sunset') {
    const evt = trigger.event || (type === 'sunrise' ? 'sunrise' : type === 'sunset' ? 'sunset' : null)
    if (evt === 'sunrise') return t('automations.proCard.trigSunrise')
    if (evt === 'sunset')  return t('automations.proCard.trigSunset')
    return t('automations.proCard.trigSun')
  }

  // numeric_state — "when temperature rises above 25°"
  if (type === 'numeric_state') {
    const above = trigger.above ?? trigger.greater_than
    const below = trigger.below ?? trigger.less_than
    if (above !== undefined) return t('automations.proCard.trigNumAbove', { value: String(above) })
    if (below !== undefined) return t('automations.proCard.trigNumBelow', { value: String(below) })
    return t('automations.proCard.trigNumChange')
  }

  return t('automations.proCard.triggerGeneric')
}

// Section heading with a count chip — only rendered when the section
// has items. Mirrors the AutomationViewModal eyebrow style.
function SectionHeader({ label, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <p className="z-eyebrow" style={{ margin: 0 }}>{label}</p>
      <span style={{
        fontSize: 10, padding: '1px 7px', borderRadius: 999,
        background: 'var(--bg-2)', color: 'var(--ink-faint)',
        fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600,
      }}>{count}</span>
    </div>
  )
}

// Single occupancy-sensor row — friendly room label + small source-count chip
function OccupancyRow({ sensor, t }) {
  const room = sensor.friendly_name || sensor.room || ''
  const sources = (sensor.sensors || []).length
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10, padding: '8px 12px', borderRadius: 10,
      border: '0.5px solid var(--line)', background: 'var(--surface)',
    }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 500 }} dir="auto">
        {room}
      </span>
      <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
        {sources === 1
          ? t('automations.proCard.occupancySourceOne')
          : t('automations.proCard.occupancySourceMany', { n: sources })}
      </span>
    </div>
  )
}

// Single KV-state row — namespace.key + default
function ModeRow({ kv }) {
  const label = `${kv.namespace}.${kv.key}`
  const def = kv.default === true ? 'on' : kv.default === false ? 'off' : String(kv.default ?? '—')
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10, padding: '8px 12px', borderRadius: 10,
      border: '0.5px solid var(--line)', background: 'var(--surface)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--ink)', fontFamily: '"IBM Plex Mono", monospace' }}>
        {label}
      </span>
      <span style={{
        fontSize: 10, padding: '1px 7px', borderRadius: 999,
        background: 'var(--bg-2)', color: 'var(--ink-mute)',
        fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600,
      }}>
        {def}
      </span>
    </div>
  )
}

// Single automation row — name + source pill + mode badge + trigger summary
function AutomationRow({ auto, lang, t }) {
  const src = auto.source === 'blueprint' ? 'template' : 'custom'
  const srcLabel = src === 'template'
    ? t('automations.proCard.sourceTemplate')
    : t('automations.proCard.sourceCustom')
  const mode = auto.mode || 'single'
  const modeKey = 'automations.proCard.mode' + mode.charAt(0).toUpperCase() + mode.slice(1)
  const modeLabel = t(modeKey)
  // i18n falls back to the raw key when missing; show the bare mode in that case.
  const safeModeLabel = (modeLabel === modeKey) ? mode : modeLabel
  const summary = triggerSummary(auto.trigger, lang, t)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '10px 12px', borderRadius: 10,
      border: '0.5px solid var(--line)', background: 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0 }} dir="auto">
          {auto.name}
        </span>
        <span style={{
          fontSize: 9.5, padding: '1.5px 7px', borderRadius: 999, fontWeight: 600,
          background: src === 'template'
            ? 'color-mix(in srgb, var(--info) 12%, transparent)'
            : 'color-mix(in srgb, var(--accent) 12%, transparent)',
          color: src === 'template' ? 'var(--info)' : 'var(--accent)',
          fontFamily: '"IBM Plex Mono", monospace', letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>{srcLabel}</span>
        <span style={{
          fontSize: 9.5, padding: '1.5px 7px', borderRadius: 999, fontWeight: 600,
          background: 'var(--bg-2)', color: 'var(--ink-mute)',
          fontFamily: '"IBM Plex Mono", monospace', letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>{safeModeLabel}</span>
      </div>
      <p style={{
        fontSize: 11.5, color: 'var(--ink-mute)', margin: 0, lineHeight: 1.4,
      }} dir="auto">
        {summary}
      </p>
    </div>
  )
}

// Voice intent row — phrase plus a small "manual setup needed" footnote.
// Voice intents aren't apply-supported in v1 (bundle_executor.py:141-146),
// so we surface that honestly here rather than letting the user think
// the phrase will register itself.
function VoiceIntentRow({ vi, t }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      padding: '8px 12px', borderRadius: 10,
      border: '0.5px dashed var(--line)', background: 'var(--bg-2)',
    }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 500 }} dir="auto">
        “{vi.phrase}”
      </span>
      <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontStyle: 'italic' }} dir="auto">
        {t('automations.proCard.voiceIntentManualNote')}
      </span>
    </div>
  )
}

// Per-artifact result row inside the post-apply RESULTS view. Distinguishes
// created (green check) from errors (red dot + first-line of error text).
function ResultRow({ kind, label, error }) {
  const isErr = !!error
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 12px', borderRadius: 10,
      border: '0.5px solid var(--line)',
      background: isErr
        ? 'color-mix(in srgb, var(--err) 6%, var(--surface))'
        : 'color-mix(in srgb, var(--ok) 6%, var(--surface))',
    }}>
      <span style={{
        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isErr ? 'var(--err)' : 'var(--ok)', color: '#fff', marginTop: 1,
      }}>
        {isErr ? (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        ) : (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: 0, fontFamily: '"IBM Plex Mono", monospace', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {kind}
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--ink)', margin: '2px 0 0', fontWeight: isErr ? 500 : 400 }} dir="auto">
          {label}
        </p>
        {isErr && (
          <p style={{ fontSize: 11, color: 'var(--err)', margin: '3px 0 0' }} dir="auto">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

export default function BundlePreviewCard({ bundle, onAccept, onDiscard }) {
  const t = useT()
  const lang = bundle?.language === 'he' ? 'he' : 'en'
  const dir  = lang === 'he' ? 'rtl' : 'ltr'

  const [status, setStatus] = useState(STATUS.IDLE)
  const [applyResult, setApplyResult] = useState(null)
  const [topError, setTopError] = useState(null)
  const [undoing, setUndoing] = useState(false)
  // Per-artifact edits keyed by `${kind}:${idx}`. Each value is a partial
  // override: { included?: bool, name?: str, timeout?: int }. Absent → the
  // artifact ships as designed. This backs the per-artifact edit controls
  // (rename / change timeout / toggle include) so the user can accept a
  // subset ("2 of these 3") or tweak names without re-prompting.
  const [edits, setEdits] = useState({})
  // Cooldown ref: card just appeared in the chat after the user pressed Enter
  // on their message. Browsers can deliver a stray Enter keystroke onto the
  // freshly-rendered Accept button if focus shifted. Ignore Accept calls in
  // the first 400 ms — enough to absorb the racing keystroke without being
  // noticeable to a real click.
  const mountedAt = useRef(performance.now())

  if (!bundle || typeof bundle !== 'object') return null

  const artifacts = bundle.artifacts || {}
  const occupancy   = artifacts.occupancy_sensors || []
  const modes       = artifacts.kv_state          || []
  const automations = artifacts.automations       || []
  const voices      = artifacts.voice_intents     || []
  const decline     = bundle.decline || null

  // ── Per-artifact edit helpers ──────────────────────────────────────────
  const editKey = (kind, idx) => `${kind}:${idx}`
  const getEdit = (kind, idx) => edits[editKey(kind, idx)] || {}
  const setEdit = (kind, idx, patch) =>
    setEdits((e) => ({ ...e, [editKey(kind, idx)]: { ...getEdit(kind, idx), ...patch } }))
  const isIncluded = (kind, idx) => getEdit(kind, idx).included !== false  // default in

  // Editing is only offered in the initial preview — once applying/resolved
  // the artifacts are (being) created and edits no longer make sense.
  const editable = status === STATUS.IDLE

  // A trigger carries an editable "timeout" (a for-duration) when it's a state
  // trigger that already expresses minutes/seconds — e.g. "no motion for 5 min".
  const triggerTimeoutMinutes = (trigger) => {
    if (!trigger || trigger.type !== 'state') return null
    if (typeof trigger.for_minutes === 'number') return trigger.for_minutes
    if (typeof trigger.for_seconds === 'number') return Math.round(trigger.for_seconds / 60)
    return null
  }

  // How many artifacts are currently included (gates the Accept button).
  const includedCount =
    occupancy.filter((_, i) => isIncluded('occupancy_sensor', i)).length +
    modes.filter((_, i) => isIncluded('kv_state', i)).length +
    automations.filter((_, i) => isIncluded('automation', i)).length +
    voices.filter((_, i) => isIncluded('voice_intent', i)).length

  // Build the bundle to actually apply: drop excluded artifacts and fold in
  // rename / timeout overrides. Pure — never mutates the original bundle.
  const buildEditedBundle = () => {
    const pick = (arr, kind, apply) =>
      arr.map((item, i) => ({ item, i }))
         .filter(({ i }) => isIncluded(kind, i))
         .map(({ item, i }) => apply(item, getEdit(kind, i)))

    const editedArtifacts = {
      occupancy_sensors: pick(occupancy, 'occupancy_sensor', (s, e) => ({
        ...s,
        ...(e.name ? { friendly_name: e.name } : {}),
        ...(typeof e.timeout === 'number' ? { delay_off_seconds: e.timeout } : {}),
      })),
      kv_state: pick(modes, 'kv_state', (m) => ({ ...m })),
      automations: pick(automations, 'automation', (a, e) => {
        const next = { ...a, ...(e.name ? { name: e.name } : {}) }
        if (typeof e.timeout === 'number' && next.trigger && next.trigger.type === 'state') {
          next.trigger = { ...next.trigger, for_minutes: e.timeout }
          // Drop a competing for_seconds so the two can't disagree.
          delete next.trigger.for_seconds
        }
        return next
      }),
      voice_intents: pick(voices, 'voice_intent', (v, e) => ({
        ...v, ...(e.name ? { phrase: e.name } : {}),
      })),
    }
    return { ...bundle, artifacts: editedArtifacts }
  }

  const handleAccept = async () => {
    // Race guard — see mountedAt ref above
    if (performance.now() - mountedAt.current < 400) return
    if (includedCount === 0) return  // nothing selected — Accept is disabled anyway
    setStatus(STATUS.APPLYING)
    setTopError(null)
    try {
      const result = await applyAutomationBundle(buildEditedBundle())
      // Backend returns 200 even on partial failure so we render results inline.
      const errors  = result?.errors  || []
      // Keep the full result (carries bundle_id) so Undo can sweep the bundle.
      setApplyResult(result)
      if (result?.ok && errors.length === 0) {
        // Full success — hold the card in a SUCCESS state offering Undo, rather
        // than collapsing immediately. This is the undo-last-accept story:
        // the user can reverse the whole bundle right after accepting it.
        setStatus(STATUS.SUCCESS)
        return
      }
      // Partial or full failure — flip to results view so user sees per-artifact outcome.
      setStatus(STATUS.RESULTS)
    } catch (e) {
      // Network / 5xx / unknown — keep the card; show the error on the footer.
      setTopError(e?.userMessage || e?.message || t('automations.proCard.applyFailed'))
      setStatus(STATUS.IDLE)
    }
  }

  // Undo-last-accept — sweep every artifact the bundle created. bundle_id comes
  // from the apply result (authoritative) or falls back to the preview bundle.
  const handleUndo = async () => {
    const bundleId = applyResult?.bundle_id || bundle?.bundle_id
    if (!bundleId || undoing) return
    setUndoing(true)
    setTopError(null)
    try {
      await deleteAutomationBundle(bundleId)
      setStatus(STATUS.UNDONE)
    } catch (e) {
      setTopError(e?.userMessage || e?.message || t('automations.proCard.undoFailed'))
    } finally {
      setUndoing(false)
    }
  }

  const handleDiscard = () => {
    onDiscard?.()
  }

  const applying = status === STATUS.APPLYING
  const showingSuccess = status === STATUS.SUCCESS && applyResult
  const showingResults = status === STATUS.RESULTS && applyResult
  const showingUndone  = status === STATUS.UNDONE
  // Whether an Undo action is offered (anything got created and isn't already undone).
  const canUndo = (applyResult?.created?.length || 0) > 0 && !showingUndone

  // Resolve a per-kind label for the results view. Falls back to the raw
  // kind string when no translation exists, so a new artifact kind from
  // the backend never crashes the card.
  const kindLabel = (k) => {
    const key = `automations.proCard.artifactKind.${k}`
    const label = t(key)
    return (label === key) ? k : label
  }

  // Per-artifact edit strip. Called as a function (NOT rendered as a
  // <Component>) so its inputs keep focus across keystrokes — a nested
  // component defined in render would remount on every change.
  const artifactControls = ({ kind, idx, currentName, showRename,
                              showTimeout, currentTimeout, timeoutUnitKey }) => {
    const included = isIncluded(kind, idx)
    const e = getEdit(kind, idx)
    const pill = (on) => ({
      fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
      border: `0.5px solid ${on ? 'color-mix(in srgb, var(--ok) 35%, var(--line))' : 'var(--line)'}`,
      background: on ? 'color-mix(in srgb, var(--ok) 12%, var(--surface))' : 'var(--bg-2)',
      color: on ? 'var(--ok)' : 'var(--ink-mute)', cursor: 'pointer',
    })
    const field = {
      fontSize: 11.5, padding: '3px 8px', borderRadius: 8,
      border: '0.5px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)',
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <button type="button" style={pill(included)}
                onClick={() => setEdit(kind, idx, { included: !included })}>
          {included ? `✓ ${t('automations.proCard.included')}` : t('automations.proCard.excluded')}
        </button>
        {included && showRename && (
          <input
            dir="auto" style={{ ...field, flex: 1, minWidth: 120 }}
            value={e.name ?? currentName ?? ''}
            placeholder={t('automations.proCard.renamePh')}
            onChange={(ev) => setEdit(kind, idx, { name: ev.target.value })}
          />
        )}
        {included && showTimeout && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-mute)' }}>
            {t('automations.proCard.timeoutLabel')}
            <input
              type="number" min="0" style={{ ...field, width: 64 }}
              value={e.timeout ?? currentTimeout ?? ''}
              onChange={(ev) => {
                const v = ev.target.value
                setEdit(kind, idx, { timeout: v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0) })
              }}
            />
            <span>{t(timeoutUnitKey)}</span>
          </label>
        )}
      </div>
    )
  }

  return (
    <motion.div
      dir={dir}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: 14, borderRadius: 14,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        boxShadow: 'var(--shadow-sm)',
        // textAlign honors the bundle's own direction so EN bundles in an
        // HE UI still read left-aligned, and vice versa.
        textAlign: 'start',
      }}
    >
      {/* Eyebrow + header */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 4 }}>
          {t('automations.proCard.eyebrow')}
        </p>
        <h3 style={{
          fontSize: 17, fontWeight: 700, color: 'var(--ink)',
          margin: 0, lineHeight: 1.25, letterSpacing: '-0.01em',
        }} dir="auto">
          {bundle.name || t('automations.proCard.untitledBundle')}
        </h3>
        {bundle.rationale && (
          <p style={{
            fontSize: 12.5, color: 'var(--ink-mute)', margin: '6px 0 0',
            fontStyle: 'italic', lineHeight: 1.4,
          }} dir="auto">
            {bundle.rationale}
          </p>
        )}
      </div>

      {/* Decline / partial-fulfillment note */}
      {decline && (
        <div style={{
          display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 10,
          background: 'color-mix(in srgb, var(--warn) 10%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--warn) 35%, var(--line))',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="z-eyebrow" style={{ margin: 0, color: 'var(--warn)' }}>
              {t('automations.proCard.noteLabel')}
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--ink)', margin: '3px 0 0', lineHeight: 1.4 }} dir="auto">
              {decline}
            </p>
          </div>
        </div>
      )}

      {/* UNDONE VIEW — the bundle was swept via Undo */}
      {showingUndone ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          padding: '18px 12px', textAlign: 'center',
        }}>
          <span style={{
            width: 32, height: 32, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-2)', color: 'var(--ink-mute)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
          </span>
          <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, fontWeight: 500 }} dir="auto">
            {t('automations.proCard.undone')}
          </p>
        </div>
      ) : /* RESULTS / SUCCESS VIEW — per-artifact created + any errors */
      (showingResults || showingSuccess) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {applyResult.created.length > 0 && (
            <div>
              <SectionHeader
                label={t('automations.proCard.createdLabel')}
                count={applyResult.created.length}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {applyResult.created.map((c, i) => (
                  <ResultRow
                    key={`ok-${i}`}
                    kind={kindLabel(c.kind)}
                    label={c.name
                      || c.room
                      || (c.namespace && c.key ? `${c.namespace}.${c.key}` : '')
                      || '—'}
                  />
                ))}
              </div>
            </div>
          )}
          {applyResult.errors.length > 0 && (
            <div>
              <SectionHeader
                label={t('automations.proCard.errorsLabel')}
                count={applyResult.errors.length}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {applyResult.errors.map((e, i) => (
                  <ResultRow
                    key={`err-${i}`}
                    kind={kindLabel(e.kind)}
                    label={e.name || e.phrase || e.room || '—'}
                    error={e.error || t('automations.proCard.unknownError')}
                  />
                ))}
              </div>
            </div>
          )}
          {/* Summary line */}
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, textAlign: 'center' }}>
            {applyResult.errors.length === 0
              ? t('automations.proCard.allCreated', { n: applyResult.created.length })
              : applyResult.created.length === 0
                ? t('automations.proCard.noneCreated')
                : t('automations.proCard.partialSuccess', {
                    ok: applyResult.created.length,
                    fail: applyResult.errors.length,
                  })}
          </p>
        </div>
      ) : (
        // PREVIEW VIEW — what the LLM proposed
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {occupancy.length > 0 && (
            <div>
              <SectionHeader
                label={t('automations.proCard.sectionOccupancy')}
                count={occupancy.length}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {occupancy.map((s, i) => {
                  const e = getEdit('occupancy_sensor', i)
                  const eff = { ...s, ...(e.name ? { friendly_name: e.name } : {}) }
                  return (
                    <div key={i} style={{ opacity: isIncluded('occupancy_sensor', i) ? 1 : 0.45 }}>
                      <OccupancyRow sensor={eff} t={t} />
                      {editable && artifactControls({
                        kind: 'occupancy_sensor', idx: i,
                        currentName: s.friendly_name || s.room || '',
                        showRename: true, showTimeout: true,
                        currentTimeout: 30, timeoutUnitKey: 'automations.proCard.timeoutSec',
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {modes.length > 0 && (
            <div>
              <SectionHeader
                label={t('automations.proCard.sectionModes')}
                count={modes.length}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {modes.map((kv, i) => (
                  <div key={i} style={{ opacity: isIncluded('kv_state', i) ? 1 : 0.45 }}>
                    <ModeRow kv={kv} />
                    {/* Modes are technical flags — toggle include only, no rename. */}
                    {editable && artifactControls({ kind: 'kv_state', idx: i, showRename: false, showTimeout: false })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {automations.length > 0 && (
            <div>
              <SectionHeader
                label={t('automations.proCard.sectionAutomations')}
                count={automations.length}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {automations.map((a, i) => {
                  const e = getEdit('automation', i)
                  const baseTimeout = triggerTimeoutMinutes(a.trigger)
                  const eff = { ...a, ...(e.name ? { name: e.name } : {}) }
                  if (typeof e.timeout === 'number' && eff.trigger && eff.trigger.type === 'state') {
                    eff.trigger = { ...eff.trigger, for_minutes: e.timeout }
                  }
                  return (
                    <div key={i} style={{ opacity: isIncluded('automation', i) ? 1 : 0.45 }}>
                      <AutomationRow auto={eff} lang={lang} t={t} />
                      {editable && artifactControls({
                        kind: 'automation', idx: i,
                        currentName: a.name || '',
                        showRename: true,
                        showTimeout: baseTimeout !== null,
                        currentTimeout: baseTimeout ?? undefined,
                        timeoutUnitKey: 'automations.proCard.timeoutMin',
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {voices.length > 0 && (
            <div>
              <SectionHeader
                label={t('automations.proCard.sectionVoice')}
                count={voices.length}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {voices.map((vi, i) => {
                  const e = getEdit('voice_intent', i)
                  const eff = { ...vi, ...(e.name ? { phrase: e.name } : {}) }
                  return (
                    <div key={i} style={{ opacity: isIncluded('voice_intent', i) ? 1 : 0.45 }}>
                      <VoiceIntentRow vi={eff} t={t} />
                      {editable && artifactControls({
                        kind: 'voice_intent', idx: i,
                        currentName: vi.phrase || '',
                        showRename: true, showTimeout: false,
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top-of-footer error (from a failed POST that left the card intact) */}
      {topError && (
        <p style={{
          fontSize: 12, color: 'var(--err)', margin: 0, padding: '6px 10px',
          borderRadius: 8, background: 'color-mix(in srgb, var(--err) 8%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--err) 30%, var(--line))',
        }} dir="auto">
          {topError}
        </p>
      )}

      {/* Footer buttons — Accept (primary) + Discard (secondary).
          In RESULTS view, swap Accept for a Done button that calls onAccept
          with the partial result so the parent collapses the card.
          The card root carries `dir`, so flex children visually mirror
          (Accept on the LEFT in RTL, matching native iOS/Android RTL apps). */}
      <div style={{
        display: 'flex', gap: 8, paddingTop: 4,
        borderTop: '0.5px solid var(--line)', marginTop: 2,
      }}>
        {showingUndone ? (
          // Bundle swept — single dismiss that clears the card from the chat.
          <button
            type="button"
            onClick={handleDiscard}
            className="z-btn-primary"
            style={{ flex: 1 }}
          >
            {t('automations.proCard.done')}
          </button>
        ) : (showingResults || showingSuccess) ? (
          // Resolved (full or partial). Offer Undo when anything was created,
          // plus Done to collapse the card into a chat confirmation.
          <>
            {canUndo && (
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoing}
                className="z-btn-secondary"
                style={{
                  flex: 1, opacity: undoing ? 0.85 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  cursor: undoing ? 'progress' : 'pointer',
                }}
              >
                {undoing && (
                  <motion.span
                    style={{
                      width: 12, height: 12, borderRadius: '50%',
                      border: '1.5px solid currentColor',
                      borderTopColor: 'transparent', display: 'inline-block',
                    }}
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                  />
                )}
                {undoing ? t('automations.proCard.undoing') : t('automations.proCard.undo')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onAccept?.(applyResult)}
              disabled={undoing}
              className="z-btn-primary"
              style={{ flex: 1, opacity: undoing ? 0.55 : 1 }}
            >
              {t('automations.proCard.done')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={applying}
              className="z-btn-secondary"
              style={{ flex: 1, opacity: applying ? 0.55 : 1 }}
            >
              {t('automations.proCard.discard')}
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={applying || includedCount === 0}
              className="z-btn-primary"
              style={{
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: (applying || includedCount === 0) ? 0.5 : 1,
                cursor: applying ? 'progress' : (includedCount === 0 ? 'not-allowed' : 'pointer'),
              }}
            >
              {applying && (
                <motion.span
                  style={{
                    width: 12, height: 12, borderRadius: '50%',
                    border: '1.5px solid currentColor',
                    borderTopColor: 'transparent', display: 'inline-block',
                  }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                />
              )}
              {applying
                ? t('automations.proCard.creating')
                : includedCount === 0
                  ? t('automations.proCard.accept')
                  /* Reflect the subset when the user has excluded artifacts, so
                     "Accept" clearly applies to only what's still selected. */
                  : includedCount < (occupancy.length + modes.length + automations.length + voices.length)
                    ? t('automations.proCard.acceptN', { n: includedCount })
                    : t('automations.proCard.accept')}
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}
