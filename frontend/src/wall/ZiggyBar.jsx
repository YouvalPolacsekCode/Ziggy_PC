// Talk to Ziggy — fixed furniture, not a module you can move away.
//
// This is the one control on the wall that has to be in the same place every
// time. Somebody walks up mid-sentence; hunting for a card that moved last
// week defeats the point. So it sits under the rooms rail on a wide panel and
// as a bar along the bottom on a narrow one, and the board can't reposition
// it — same reasoning as the rooms rail itself.
//
// Press and hold to speak, which is the whole interaction on a wall: no
// keyboard to summon, no field to focus. Typing still exists behind the
// keyboard button for anything long, awkward to say out loud, or said while
// someone is asleep in the next room.
//
// VOICE AVAILABILITY. Holding needs a microphone, and a browser only hands one
// over in a secure context. Opened as http://<hub-ip> the wall is NOT secure,
// so `navigator.mediaDevices` is undefined and no permission prompt exists to
// grant — nothing the user can do from here fixes it. Rather than a button
// that silently fails, the bar detects it up front and becomes tap-to-type
// with the reason stated. In the native app (https://localhost) and over a
// real HTTPS hub, holding works normally.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { sendChat, sendVoiceTranscribe } from '../lib/api'
import { useT } from '../lib/i18n'

/** Shorter than this and it's a mis-tap, not speech. */
const MIN_BLOB_BYTES = 1500
/** How long a reply stays on the bar before it returns to its resting hint. */
const REPLY_MS = 8000

/** Can this device actually record? Decided once — it cannot change per press. */
function micAvailable() {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'
}

export const ZiggyBar = memo(function ZiggyBar({ ctx }) {
  const t = useT()
  const [state, setState] = useState('idle')   // idle | listening | thinking
  const [reply, setReply] = useState(null)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')

  const recorderRef = useRef(null)
  const chunksRef   = useRef([])
  const heldRef     = useRef(false)
  const replyTimer  = useRef(null)
  const canTalk     = useRef(micAvailable()).current

  useEffect(() => () => {
    clearTimeout(replyTimer.current)
    try { recorderRef.current?.stream?.getTracks?.().forEach((tr) => tr.stop()) } catch { /* gone */ }
  }, [])

  const showReply = useCallback((msg) => {
    setReply(msg)
    ctx.toast?.(msg)
    clearTimeout(replyTimer.current)
    // The answer lives on until the next person walks up, then clears — a
    // wall shouldn't show one household member's question to the next.
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

  // ── hold to talk ──────────────────────────────────────────────────────────

  const startHold = useCallback(async () => {
    if (!canTalk || state !== 'idle') return
    heldRef.current = true
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      heldRef.current = false
      ctx.toast?.(t('wall.ziggy.micDenied'), 'err')
      return
    }
    // Released while the permission prompt was still up — don't start a
    // recording nobody is making.
    if (!heldRef.current) { stream.getTracks().forEach((tr) => tr.stop()); return }

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
  }, [canTalk, state, ctx, t, ask])

  const endHold = useCallback(() => {
    heldRef.current = false
    const mr = recorderRef.current
    if (mr && mr.state !== 'inactive') mr.stop()
  }, [])

  // Explaining WHY there's no microphone takes a sentence, and the bar has one
  // short line. So the line says what to do and the reason rides along once,
  // in the toast, the first time someone reaches for voice and doesn't get it.
  const explainedRef = useRef(false)
  const onPrimary = useCallback(() => {
    if (canTalk) return
    // Without a mic the whole bar is the way into typing, so the gesture
    // people try first still does something useful.
    setTyping(true)
    if (!explainedRef.current) {
      explainedRef.current = true
      ctx.toast?.(t('wall.ziggy.micWhy'))
    }
  }, [canTalk, ctx, t])

  const label =
    state === 'listening' ? t('wall.ziggy.listening')
    : state === 'thinking' ? t('wall.ziggy.thinking')
    : reply || t('wall.ziggy.title')

  const hint = canTalk ? t('wall.ziggy.hold') : t('wall.ziggy.micBlocked')

  return (
    <>
      <div className={`zw-ziggybar is-${state}`}>
        <button
          className="zw-ziggybar-talk"
          aria-label={canTalk ? t('wall.ziggy.hold') : t('wall.ziggy.type')}
          onPointerDown={canTalk ? startHold : undefined}
          onPointerUp={canTalk ? endHold : undefined}
          onPointerLeave={canTalk ? endHold : undefined}
          onPointerCancel={canTalk ? endHold : undefined}
          onClick={onPrimary}
          // A hold that the browser decides is a text selection or a scroll
          // cancels the recording halfway through the sentence.
          style={{ touchAction: 'none' }}
        >
          <span className={`zw-orb${state !== 'idle' ? ' is-busy' : ''}`} />
          <span className="zw-ziggybar-text">
            <span className="zw-ziggybar-title">{label}</span>
            <span className="zw-ziggybar-hint">{hint}</span>
          </span>
        </button>
        <button
          className="zw-ziggybar-kbd"
          aria-label={t('wall.ziggy.type')}
          onClick={() => setTyping(true)}
        >⌨</button>
      </div>

      {typing && (
        <div className="zw-scrim" onClick={() => setTyping(false)}>
          <div className="zw-expand zw-ziggy-sheet" onClick={(e) => e.stopPropagation()}>
            <button className="zw-expand-close" onClick={() => setTyping(false)} aria-label={t('common.close')}>✕</button>
            <div className="zw-card-head"><span className="zw-eyebrow">{t('wall.ziggy.title')}</span></div>
            <input
              className="zw-ziggy-input"
              autoFocus
              value={text}
              placeholder={t('wall.ziggy.placeholder')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const q = text
                setText(''); setTyping(false); ask(q)
              }}
            />
            <button
              className="zw-scene"
              onClick={() => { const q = text; setText(''); setTyping(false); ask(q) }}
            >{t('wall.ziggy.send')}</button>
          </div>
        </div>
      )}
    </>
  )
})

export default ZiggyBar
