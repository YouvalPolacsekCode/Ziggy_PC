// Talk to Ziggy — fixed furniture, not a module you can move away.
//
// This is the one control on the wall that has to be in the same place every
// time. Somebody walks up mid-sentence; hunting for a card that moved last week
// defeats the point. So the board can't reposition it — same reasoning as the
// rooms rail itself.
//
// Two shapes, because a wide panel and a portrait one want different things:
//
//   inline    a mic and a text field at the foot of the rooms rail. There is
//             room for both, so both are visible.
//   floating  a round mic in the corner. Portrait has no spare column and the
//             board is already tall; a full-width bar there costs a strip of
//             the screen for something that is idle 99% of the time. Tapping
//             it grows a field out of it, so typing is still one tap and still
//             a real field — not a modal on top of the dashboard.
//
// Hold the mic to speak; tap for the keyboard. One control, two gestures, and
// no small button to aim at on a wall you're standing in front of.
//
// VOICE AVAILABILITY. Holding needs a microphone, and a browser only hands one
// over in a secure context. Opened as http://<hub-ip> the wall is NOT secure,
// so `navigator.mediaDevices` is undefined and there is no permission prompt to
// grant — nothing the user can do from the panel fixes it. Rather than a dead
// mic, the button is not offered at all there and the field takes the space,
// with the reason stated once. In the native app (https://localhost) and over
// a real HTTPS hub, holding works normally.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { sendChat, sendVoiceTranscribe } from '../lib/api'
import { useT } from '../lib/i18n'

/** Shorter than this and it's a mis-tap, not speech. */
const MIN_BLOB_BYTES = 1500
/** How long a reply stays on the bar before it returns to its resting hint. */
const REPLY_MS = 8000
/** Past this a press is speech, not a tap for the keyboard. */
const HOLD_MS = 260

/** Can this device actually record? Decided once — it cannot change per press. */
function micAvailable() {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'
}

export const ZiggyBar = memo(function ZiggyBar({ ctx, variant = 'inline' }) {
  const t = useT()
  const [state, setState] = useState('idle')   // idle | listening | thinking
  const [reply, setReply] = useState(null)
  const [text, setText] = useState('')
  // Floating only: the field is grown from the mic rather than always present.
  const [open, setOpen] = useState(false)

  const recorderRef = useRef(null)
  const chunksRef   = useRef([])
  const holdTimer   = useRef(null)
  const spokeRef    = useRef(false)     // this press became a recording
  const replyTimer  = useRef(null)
  const inputRef    = useRef(null)
  const explainedRef = useRef(false)
  const canTalk     = useRef(micAvailable()).current

  useEffect(() => () => {
    clearTimeout(replyTimer.current)
    clearTimeout(holdTimer.current)
    try { recorderRef.current?.stream?.getTracks?.().forEach((tr) => tr.stop()) } catch { /* gone */ }
  }, [])

  const showReply = useCallback((msg) => {
    setReply(msg)
    ctx.toast?.(msg)
    clearTimeout(replyTimer.current)
    // The answer clears itself — a wall shouldn't still be showing one person's
    // question to whoever walks up next.
    replyTimer.current = setTimeout(() => setReply(null), REPLY_MS)
  }, [ctx])

  const ask = useCallback(async (q) => {
    if (!q?.trim()) return
    setState('thinking')
    try {
      const res = await sendChat(q.trim(), [], 'wall')
      const msg = res?.message || res?.response || res?.reply
      if (msg) showReply(msg)
    } catch (e) {
      ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err')
    } finally {
      setState('idle')
    }
  }, [ctx, t, showReply])

  const submit = useCallback(() => {
    const q = text
    setText('')
    setOpen(false)
    ask(q)
  }, [text, ask])

  // ── the mic: hold to talk, tap for the keyboard ───────────────────────────

  const beginRecording = useCallback(async () => {
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      spokeRef.current = false
      ctx.toast?.(t('wall.ziggy.micDenied'), 'err')
      return
    }
    // Released while the permission prompt was up — don't start a recording
    // nobody is making.
    if (!spokeRef.current) { stream.getTracks().forEach((tr) => tr.stop()); return }

    const mr = new MediaRecorder(stream)
    recorderRef.current = mr
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop())
      recorderRef.current = null
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      if (blob.size < MIN_BLOB_BYTES) { setState('idle'); return }
      setState('thinking')
      try {
        const { transcription } = await sendVoiceTranscribe(blob)
        if (!transcription?.trim()) { setState('idle'); return }
        await ask(transcription)
      } catch (e) {
        ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err')
        setState('idle')
      }
    }
    mr.start()
    setState('listening')
  }, [ctx, t, ask])

  const onMicDown = useCallback(() => {
    if (!canTalk || state !== 'idle') return
    spokeRef.current = false
    holdTimer.current = setTimeout(() => {
      spokeRef.current = true
      try { navigator.vibrate?.(12) } catch { /* unsupported */ }
      beginRecording()
    }, HOLD_MS)
  }, [canTalk, state, beginRecording])

  const onMicUp = useCallback(() => {
    clearTimeout(holdTimer.current)
    const mr = recorderRef.current
    if (mr && mr.state !== 'inactive') mr.stop()
    spokeRef.current = false
  }, [])

  // A press too short to be speech means "give me the keyboard".
  const onMicClick = useCallback(() => {
    if (spokeRef.current || state === 'listening') return
    if (!canTalk && !explainedRef.current) {
      explainedRef.current = true
      ctx.toast?.(t('wall.ziggy.micWhy'))
    }
    if (variant === 'floating') setOpen(true)
    inputRef.current?.focus()
  }, [state, canTalk, variant, ctx, t])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  // ── shared pieces ─────────────────────────────────────────────────────────

  const status =
    state === 'listening' ? t('wall.ziggy.listening')
    : state === 'thinking' ? t('wall.ziggy.thinking')
    : reply || (canTalk ? t('wall.ziggy.hold') : t('wall.ziggy.micBlocked'))

  const mic = canTalk ? (
    <button
      className={`zw-mic is-${state}`}
      aria-label={t('wall.ziggy.hold')}
      onPointerDown={onMicDown}
      onPointerUp={onMicUp}
      onPointerLeave={onMicUp}
      onPointerCancel={onMicUp}
      onClick={onMicClick}
      // A hold the browser decides is a scroll or a text selection cancels the
      // recording halfway through the sentence.
      style={{ touchAction: 'none' }}
    >
      <span className="zw-orb" />
    </button>
  ) : (
    <button className="zw-mic is-muted" aria-label={t('wall.ziggy.type')} onClick={onMicClick}>⌨</button>
  )

  const field = (
    <div className="zw-ziggybar-input">
      <input
        ref={inputRef}
        className="zw-ziggy-input"
        value={text}
        placeholder={t('wall.ziggy.placeholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        onBlur={() => { if (variant === 'floating' && !text) setOpen(false) }}
      />
      {text.trim() && (
        <button className="zw-ziggybar-send" onClick={submit} aria-label={t('wall.ziggy.send')}>→</button>
      )}
    </div>
  )

  if (variant === 'floating') {
    return (
      <div className={`zw-ziggyfloat is-${state}${open ? ' is-open' : ''}`}>
        {/* Only speak up when there IS something to say — an idle hint floating
            over the board would just be clutter. */}
        {(state !== 'idle' || reply) && <div className="zw-ziggyfloat-status">{status}</div>}
        <div className="zw-ziggyfloat-pill">
          {open && field}
          {mic}
        </div>
      </div>
    )
  }

  return (
    <div className={`zw-ziggybar is-${state}`}>
      {/* Always rendered, even when empty: the bar must not change height when
          an answer arrives and shove the rooms list up the panel. */}
      <div className="zw-ziggybar-status">{status}</div>
      <div className="zw-ziggybar-row">
        {mic}
        {field}
      </div>
    </div>
  )
})

export default ZiggyBar
