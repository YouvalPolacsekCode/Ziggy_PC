import { useRef, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { sendChat, sendVoiceTranscribe, sendDirectIntent } from '../lib/api'
import logger from '../lib/logger'
import { useQuickAskStore } from '../stores/quickAskStore'
import { useUIStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import { useVoiceStore } from '../stores/voiceStore'
import { useDeviceStore } from '../stores/deviceStore'
import { useAutomationStore } from '../stores/automationStore'
import { formatTime, isHebrew } from '../lib/utils'
import { useT, useLang, translateNamePhrase } from '../lib/i18n'

// Hold-to-talk uses MediaRecorder exclusively. The Web Speech API was
// previously the "fast path" but its auto-end behavior (even with
// continuous: true) made the press/release contract non-deterministic in some
// browsers. MediaRecorder records strictly until WE call .stop(), which is the
// behavior the product needs. The backend transcribes via /api/voice (Whisper).

// ── Voice wave ────────────────────────────────────────────────────────────────
function VoiceWave({ active, size = 22 }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, opacity: active ? 1 : 0, transition: 'opacity 0.3s' }}>
      {[0, 1, 2, 3, 4].map(i => (
        <span
          key={i}
          className="z-wave-bar"
          style={{
            height: size * 0.55,
            animation: active ? `waveBar ${0.7 + i * 0.06}s ease-in-out ${i * 0.07}s infinite alternate` : 'none',
          }}
        />
      ))}
    </div>
  )
}

// ── Pattern detected card ─────────────────────────────────────────────────────
function PatternCard({ msg, onSaveRoutine }) {
  const t = useT()
  const [saved, setSaved] = useState(false)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      style={{ maxWidth: '92%', alignSelf: 'flex-start' }}
    >
      <div style={{
        padding: 14, borderRadius: 14,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6"/></svg>
          <span className="z-mono" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: '0.12em', fontWeight: 600 }}>{t('chat.patternDetected')}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 10, lineHeight: 1.45 }}>
          {msg.text} {t('chat.saveRoutinePrompt', { name: msg.patternLabel })}
        </div>
        {!saved ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setSaved(true)}
              style={{ padding: '7px 14px', borderRadius: 10, background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t('chat.saveRoutine')}
            </button>
            <button
              style={{ padding: '7px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--ink-mute)', border: '0.5px solid var(--line)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t('dashboard.notNow')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ok)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>
            {t('chat.routineSaved')}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Message bubble (Chat-A) ───────────────────────────────────────────────────
function Message({ msg }) {
  const t = useT()
  const isUser  = msg.role === 'user'
  const isError = !isUser && msg.ok === false
  const rtl     = isHebrew(msg.text)

  // Pattern card
  if (msg.isPattern) return <PatternCard msg={msg} />
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: 4,
        maxWidth: '88%',
        alignSelf: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      {!isUser && (
        <p className="z-eyebrow" style={{ marginBottom: 2 }}>{t('chat.ziggy')}</p>
      )}
      <div
        dir={rtl ? 'rtl' : 'ltr'}
        style={{
          padding: '10px 14px',
          borderRadius: 18,
          borderEndStartRadius: !isUser ? 4 : 18,
          borderEndEndRadius:    isUser ? 4 : 18,
          background:  isUser ? 'var(--ink)'    : 'var(--surface)',
          color:       isUser ? 'var(--bg)'     : 'var(--ink)',
          border:      isError
            ? '0.5px solid color-mix(in srgb, var(--err) 60%, var(--line))'
            : isUser ? 'none' : '0.5px solid var(--line)',
          fontSize: 14.5, lineHeight: 1.45,
          textAlign: rtl ? 'right' : 'left',
        }}
      >
        <p style={{ margin: 0, color: isError ? 'var(--err)' : undefined }}>{msg.text}</p>
        <p style={{ fontSize: 10, marginTop: 4, opacity: 0.4, textAlign: rtl ? 'left' : 'right' }}>
          {formatTime(msg.ts)}
        </p>
      </div>

      {/* Action chips — green check bubbles per design */}
      {msg.actions && msg.actions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxWidth: '88%' }}>
          {msg.actions.map((a, i) => (
            <div key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 999,
              background: 'color-mix(in srgb, var(--ok) 10%, var(--surface))',
              border: '0.5px solid color-mix(in srgb, var(--ok) 35%, var(--line))',
              fontSize: 11, color: 'var(--ink-2)',
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>
              {a}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

// ── Thinking bubble ───────────────────────────────────────────────────────────
function ThinkingBubble() {
  const t = useT()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, alignSelf: 'flex-start' }}>
      <p className="z-eyebrow" style={{ marginBottom: 2 }}>{t('chat.ziggy')}</p>
      <div style={{
        padding: '10px 14px', borderRadius: 18, borderEndStartRadius: 4,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        display: 'flex', gap: 5, alignItems: 'center',
      }}>
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink-mute)', display: 'block' }}
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }}
          />
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AIChat() {
  const t = useT()
  const lang = useLang()
  const location  = useLocation()
  const navigate  = useNavigate()
  const { addToast }                              = useUIStore()
  const { messages, addMessage, clearMessages }   = useChatStore()
  const { items: quickAsks, fetch: fetchQuickAsks } = useQuickAskStore()
  // Awareness counters for the header strip — same pattern as the TV-remote
  // page's "HDMI 2 · Apple TV" contextual cue: tells you what Ziggy can act on
  // before you ask. Read from caches; no fetches added on this surface.
  // Length-only selectors keep this page out of the re-render fanout on
  // every entity/room/routine update.
  const knownDevices  = useDeviceStore(s => s.entities.length)
  const knownRooms    = useDeviceStore(s => s.ziggyRooms.length)
  const knownRoutines = useAutomationStore(s => (s.routines || []).length)
  const {
    micEnabled,
    wakewordEnabled,
    wakeInitFailed,
    fetchStatus: fetchVoiceStatus,
    setMicEnabled,
  } = useVoiceStore()

  const [input,     setInput]     = useState('')
  const [orbState,  setOrbState]  = useState('idle')
  const [thinking,  setThinking]  = useState(false)
  const [recording, setRecording] = useState(false)

  const mediaRef       = useRef(null)
  const chunksRef      = useRef([])
  const scrollRef      = useRef(null)
  const inputRef       = useRef(null)
  const sentPrefillRef = useRef(false)
  const containerRef   = useRef(null)
  // Source of truth for "the user is currently holding the mic button".
  // Set on pointerdown, cleared on pointerup/cancel. Used to abort if
  // getUserMedia resolves after the user has already released.
  const intentRef      = useRef(false)

  useEffect(() => { fetchQuickAsks() }, [])
  useEffect(() => { fetchVoiceStatus() }, [])

  const onToggleMic = async () => {
    try {
      await setMicEnabled(!micEnabled)
    } catch (e) {
      addToast(e?.message || t('chat.failedWake'), 'error')
    }
  }

  // Release any open mic resources if the user navigates away mid-recording.
  // Without this, MediaRecorder + its MediaStreamTracks linger until GC,
  // leaving the browser mic indicator on.
  useEffect(() => {
    return () => {
      intentRef.current = false
      try { mediaRef.current?.stop() } catch {}
      try { mediaRef.current?.stream?.getTracks?.().forEach(t => t.stop()) } catch {}
      mediaRef.current = null
    }
  }, [])

  // Pin the chat container to an exact pixel height at all times.
  //
  // Pure CSS dvh + calc() handles modern Chrome/Edge fine, but we still need
  // JS for two cases:
  //   1) iOS Safari does not currently honor `interactive-widget=resizes-content`
  //      — when the keyboard opens, only the *visual* viewport shrinks (vv.height),
  //      while the *layout* viewport (and dvh) stays full-height. Without JS the
  //      composer ends up behind the keyboard.
  //   2) Older Android Chrome PWAs ship stale dvh values after a keyboard close
  //      animation finishes.
  //
  // We read the shell-geometry tokens (--nav-h, --safe-top, --safe-bottom)
  // from CSS so this stays in lockstep with index.css / BottomNav.jsx — no
  // duplicated magic numbers like the old hardcoded `64` / `4rem`.
  useEffect(() => {
    // Resolve a CSS length variable to pixels. Falls back to 0 if the var
    // isn't defined (very old browser).
    const cssPx = (name) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      if (!v) return 0
      // Most of these are already pixels (e.g. "60px"). env() values resolve
      // to px in computed style. parseFloat handles both.
      return parseFloat(v) || 0
    }
    const setSize = () => {
      if (!containerRef.current) return
      const vv = window.visualViewport
      const viewH = vv ? vv.height : window.innerHeight
      const isMobile = window.innerWidth < 768
      // 0.8 heuristic: any drop > 20% from window.innerHeight is almost
      // certainly the keyboard. Tabs/URL-bar animation is < 15%.
      const keyboardOpen = vv ? vv.height < window.innerHeight * 0.8 : false
      const navH = isMobile && !keyboardOpen
        ? cssPx('--nav-h') + Math.max(cssPx('--safe-bottom'), 8)
        : 0
      const safeTop = cssPx('--safe-top')
      containerRef.current.style.height = `${viewH - navH - safeTop}px`
    }
    setSize()
    window.addEventListener('resize', setSize)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setSize)
      window.visualViewport.addEventListener('scroll', setSize)
    }
    return () => {
      window.removeEventListener('resize', setSize)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', setSize)
        window.visualViewport.removeEventListener('scroll', setSize)
      }
    }
  }, [])

  useEffect(() => {
    if (sentPrefillRef.current) return
    const { quickAsk, prefill } = location.state || {}
    if (quickAsk) {
      sentPrefillRef.current = true
      handleDirectQuickAsk(quickAsk)
      navigate(location.pathname, { replace: true, state: {} })
    } else if (prefill) {
      sentPrefillRef.current = true
      handleSend(prefill)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const handleSend = async (text) => {
    const t = (text || input).trim()
    if (!t) return
    const fromInput = !text
    // History = previous messages only. The backend appends req.text as the final user turn.
    const historyForApi = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }))
    logger.action('chat_send', {
      length: t.length,
      from: fromInput ? 'input' : 'suggestion',
      history_turns: historyForApi.length,
    })
    addMessage('user', t)
    // Defer clearing the input until sendChat() succeeds so a network blip
    // doesn't make the user re-type a long question.
    setThinking(true); setOrbState('thinking')
    try {
      const res = await sendChat(t, historyForApi)
      if (fromInput) setInput('')
      // Build action chip labels from the response
      const actions = res.actions?.map(a => {
        if (typeof a === 'string') return a
        if (a.entity && a.service) return `${a.entity.split('.')[1]?.replace(/_/g, ' ')} → ${a.service.replace(/_/g, ' ')}`
        if (a.label) return a.label
        return String(a)
      }) || []
      addMessage('assistant', res.reply || '…', res.ok !== false, { actions })
      // Pattern suggestion card
      if (res.pattern_suggestion) {
        addMessage('pattern', res.pattern_suggestion.message || t('chat.patternDetectedFallback'), true, {
          patternLabel: res.pattern_suggestion.suggested_name || t('chat.routineFallback'),
          isPattern: true,
        })
      }
      setOrbState('speaking')
      // Don't clobber a fresh 'listening' state if the user starts another
      // hold-to-talk before this 2.5 s timer fires.
      setTimeout(() => setOrbState(prev => prev === 'speaking' ? 'idle' : prev), 2500)
    } catch (e) {
      const msg = e?.message && !e.message.startsWith('HTTP')
        ? e.message
        : t('chat.somethingWrong')
      addMessage('assistant', msg, false)
      setOrbState('idle')
    } finally { setThinking(false) }
  }

  const handleDirectQuickAsk = async (qa) => {
    addMessage('user', `${qa.icon ? qa.icon + ' ' : ''}${qa.label}`)
    setThinking(true); setOrbState('thinking')
    try {
      const res = await sendDirectIntent(qa.intent, qa.params)
      const actions = res.actions?.map(a => typeof a === 'string' ? a : (a.label || String(a))) || []
      addMessage('assistant', res.reply || '…', res.ok !== false, { actions })
      setOrbState('speaking')
      // Don't clobber a fresh 'listening' state if the user starts another
      // hold-to-talk before this 2.5 s timer fires.
      setTimeout(() => setOrbState(prev => prev === 'speaking' ? 'idle' : prev), 2500)
    } catch (e) {
      const msg = e?.message && !e.message.startsWith('HTTP')
        ? e.message
        : t('chat.somethingWrong')
      addMessage('assistant', msg, false)
      setOrbState('idle')
    } finally { setThinking(false) }
  }

  // ── Hold-to-talk recording (MediaRecorder only) ──
  //
  // Contract: recording starts on pointerdown and ends on pointerup/cancel.
  // Nothing else stops it — no silence detection, no engine watchdog, no
  // network fallback path. This is what makes the press/release feel
  // deterministic to the user.
  //
  // Race safety: getUserMedia is async (browser permission prompt can take
  // many seconds the first time). `intentRef` is the source of truth for
  // "the user's finger is still down." If they release before the stream
  // resolves, we release the tracks and never start MediaRecorder.

  const startRecording = async () => {
    if (intentRef.current) return  // already holding
    intentRef.current = true
    setRecording(true); setOrbState('listening')

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      intentRef.current = false
      setRecording(false); setOrbState('idle')
      addToast(t('chat.micDenied'), 'error')
      return
    }

    // User released before the permission prompt / hardware came back. Abort.
    if (!intentRef.current) {
      stream.getTracks().forEach(t => t.stop())
      setRecording(false); setOrbState('idle')
      return
    }

    const mr = new MediaRecorder(stream)
    mediaRef.current = mr
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      mediaRef.current = null
      setRecording(false)

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      // Misfire guard: too-quick taps. Empirically anything under ~1.5 KB of
      // webm/opus is well under ~150 ms of audio — almost certainly a
      // mis-tap and the backend would just return an empty transcript
      // (and burn a Whisper API call). Silently drop.
      if (blob.size < 1500) { setOrbState('idle'); return }

      // Two phases, so the user's words land on screen the moment Whisper
      // returns — *before* the chat-reply pipeline runs:
      //   Phase 1: /api/voice/transcribe → addMessage('user', transcript)
      //   Phase 2: sendChat(transcript)   → addMessage('assistant', reply)
      // Restores the old "release → I see what I said" feel that the
      // client-side SR path used to give us.
      setOrbState('transcribing')
      let transcription = ''
      try {
        const tr = await sendVoiceTranscribe(blob)
        transcription = (tr?.transcription || '').trim()
      } catch (e) {
        addToast(e?.message || t('chat.transcribeFailed'), 'error')
        setOrbState('idle')
        return
      }
      if (!transcription) { setOrbState('idle'); return }

      // History = previous messages only. Backend appends transcription as
      // the final user turn (matches the text-input handleSend flow).
      const historyForApi = messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
      }))
      addMessage('user', transcription)

      setThinking(true); setOrbState('thinking')
      try {
        const res = await sendChat(transcription, historyForApi)
        const actions = res.actions?.map(a => {
          if (typeof a === 'string') return a
          if (a.entity && a.service) return `${a.entity.split('.')[1]?.replace(/_/g, ' ')} → ${a.service.replace(/_/g, ' ')}`
          if (a.label) return a.label
          return String(a)
        }) || []
        addMessage('assistant', res.reply || '…', res.ok !== false, { actions })
        if (res.pattern_suggestion) {
          addMessage('pattern', res.pattern_suggestion.message || t('chat.patternDetectedFallback'), true, {
            patternLabel: res.pattern_suggestion.suggested_name || t('chat.routineFallback'),
            isPattern: true,
          })
        }
        setOrbState('speaking')
        setTimeout(() => setOrbState(prev => prev === 'speaking' ? 'idle' : prev), 2500)
      } catch (e) {
        const msg = e?.message && !e.message.startsWith('HTTP') ? e.message : t('chat.somethingWrongShort')
        addMessage('assistant', msg, false)
        setOrbState('idle')
      } finally {
        setThinking(false)
      }
    }
    // 100 ms timeslice → ondataavailable fires steadily so the final blob
    // has all chunks even if stop() fires very quickly after start().
    mr.start(100)
  }

  const stopRecording = () => {
    if (!intentRef.current) return
    intentRef.current = false
    const mr = mediaRef.current
    if (mr && mr.state === 'recording') {
      try { mr.stop() } catch {}
      // onstop will clear `recording` and route through transcription.
    } else {
      // No MR active yet — user released while getUserMedia was still
      // resolving. Reset UI here since onstop will never fire.
      setRecording(false); setOrbState('idle')
    }
  }

  // Pointer handlers. Capture so up follows the finger off the button;
  // cancel covers system gesture interruptions.
  const handleMicPointerDown = (e) => {
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    startRecording()
  }
  const handleMicPointerEnd = (e) => {
    try { e.currentTarget?.releasePointerCapture?.(e.pointerId) } catch {}
    stopRecording()
  }

  // Window-level fail-safe: if the in-button pointerup never fires (rare
  // mobile browser bugs, page swipe, etc.), a window-level pointerup still
  // stops the recording. capture-phase so we win even if something else
  // stops propagation.
  useEffect(() => {
    if (!recording) return
    const onAnyEnd = () => stopRecording()
    window.addEventListener('pointerup', onAnyEnd, { capture: true })
    window.addEventListener('pointercancel', onAnyEnd, { capture: true })
    // Tab/app backgrounded → stop. macOS/iOS will pause MR otherwise.
    const onVisChange = () => { if (document.hidden) stopRecording() }
    document.addEventListener('visibilitychange', onVisChange)
    return () => {
      window.removeEventListener('pointerup', onAnyEnd, { capture: true })
      window.removeEventListener('pointercancel', onAnyEnd, { capture: true })
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [recording])

  const hasMessages = messages.length > 0
  const listening    = orbState === 'listening'
  const transcribing = orbState === 'transcribing'
  const speaking     = orbState === 'speaking'
  const busy         = transcribing || orbState === 'thinking' || speaking

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex', flexDirection: 'column',
        // Pre-JS fallback: dvh minus the nav row + bottom safe-area floor.
        // The useEffect above immediately overrides this with the exact pixel
        // value, but this avoids a single-frame "too tall" flash before hydration.
        height: 'calc(var(--vh) - var(--nav-h) - max(var(--safe-bottom), 8px))',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      {/* ── Header bar ── */}
      <div style={{
        padding: '14px 20px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '0.5px solid var(--line)',
        flexShrink: 0,
      }}>
        <div>
          <p className="z-eyebrow">{t('chat.eyebrow')}</p>
          <h1 className="z-display" style={{ fontSize: 20, margin: '2px 0 0' }}>{t('chat.headerTitle')}</h1>
          {knownDevices > 0 && (
            <p className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 3 }}>
              {knownDevices === 1 ? t('chat.knowsDevicesOne', { n: knownDevices }) : t('chat.knowsDevicesMany', { n: knownDevices })}
              {' · '}
              {knownRooms === 1 ? t('chat.roomsOne', { n: knownRooms }) : t('chat.roomsMany', { n: knownRooms })}
              {knownRoutines > 0 ? ` · ${knownRoutines === 1 ? t('chat.routinesOne', { n: knownRoutines }) : t('chat.routinesMany', { n: knownRoutines })}` : ''}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Wake-word master toggle — controls the backend always-on listener,
              NOT the hold-to-talk mic on this page. Hidden when wake-word is
              not configured/working; in that case only push-to-talk is in play. */}
          {wakewordEnabled && !wakeInitFailed && micEnabled !== null && (
            <button
              onClick={onToggleMic}
              title={micEnabled
                ? t('chat.wakeOnTitle')
                : t('chat.wakeOffTitle')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 999,
                background: micEnabled
                  ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))'
                  : 'var(--surface)',
                border: micEnabled
                  ? '0.5px solid color-mix(in srgb, var(--accent) 45%, var(--line))'
                  : '0.5px solid var(--line)',
                fontSize: 11,
                color: micEnabled ? 'var(--accent)' : 'var(--ink-mute)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: micEnabled ? 'var(--accent)' : 'var(--ink-faint)',
              }} />
              {micEnabled ? t('chat.wakeOn') : t('chat.muted')}
            </button>
          )}

          {/* Hold-to-talk status — only while actively recording/processing */}
          {(listening || busy) && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 999,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              fontSize: 11, color: 'var(--ink-mute)',
            }}>
              {listening && <><VoiceWave active size={14} /><span>{t('chat.listening')}</span></>}
              {busy && !listening && (
                <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                  {transcribing ? t('chat.transcribing') : orbState === 'thinking' ? t('chat.thinking') : t('chat.speaking')}
                </span>
              )}
            </span>
          )}
          {hasMessages && (
            <button
              onClick={clearMessages}
              style={{
                background: 'transparent', border: '0.5px solid var(--line)',
                borderRadius: 8, padding: '5px 10px',
                fontSize: 11, color: 'var(--ink-mute)', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('chat.newChat')}
            </button>
          )}
        </div>
      </div>

      {/* ── Empty state ── */}
      <AnimatePresence>
        {!hasMessages && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', gap: 24 }}
          >
            {/* Identity strip — replaces the redundant middle mic. The composer
                below already has a mic; one prominent voice affordance is enough.
                A subtle sparkle + friendly prompt sets the stage without
                competing with the suggestion chips that follow. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'color-mix(in srgb, var(--accent) 12%, var(--tile-base))',
                border: '0.5px solid color-mix(in srgb, var(--accent) 28%, var(--line))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'color-mix(in srgb, var(--accent) 80%, var(--ink))',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6"/>
                </svg>
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', margin: 0, letterSpacing: '-0.01em' }}>
                {listening ? t('chat.listening') : t('chat.whatCanIDo')}
              </p>
              <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: 0, textAlign: 'center', maxWidth: 280 }}>
                {t('chat.tryOneBelow')}
              </p>
            </div>

            {/* Quick ask chips */}
            {quickAsks.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 420 }}>
                {quickAsks.slice(0, 6).map(qa => (
                  <button
                    key={qa.id}
                    onClick={() => handleDirectQuickAsk(qa)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 14px', borderRadius: 999, flexShrink: 0,
                      background: 'var(--surface)', border: '0.5px solid var(--line)',
                      fontSize: 12, fontWeight: 500, color: 'var(--ink-2)',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {qa.icon && <span style={{ fontSize: 14 }}>{qa.icon}</span>}
                    <span dir="auto">{translateNamePhrase(qa.label, lang)}</span>
                  </button>
                ))}
              </div>
            )}
            {!quickAsks.length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 380 }}>
                {[t('chat.suggestGoodnight'), t('chat.suggestMovie'), t('chat.suggestWhoHome'), t('chat.suggestMorning')].map(s => (
                  <button key={s} onClick={() => handleSend(s)} style={{
                    padding: '7px 14px', borderRadius: 999,
                    background: 'var(--surface)', border: '0.5px solid var(--line)',
                    fontSize: 12, color: 'var(--ink-2)', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                  }}>{s}</button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Messages ── */}
      {hasMessages && (
        <div
          className="scrollbar-thin"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {messages.map(msg => <Message key={msg.id} msg={msg} />)}
          {thinking && <ThinkingBubble />}
          <div ref={scrollRef} />
        </div>
      )}

      {/* Suggestion chips above input (when has messages) */}
      {hasMessages && quickAsks.length > 0 && (
        <div style={{ padding: '8px 16px 0', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }} className="scrollbar-thin">
          {quickAsks.slice(0, 4).map(qa => (
            <div key={qa.id} onClick={() => handleDirectQuickAsk(qa)} style={{
              padding: '6px 12px', borderRadius: 999, flexShrink: 0, cursor: 'pointer',
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              fontSize: 11, color: 'var(--ink-2)', fontWeight: 500,
            }}>
              {qa.icon && <span style={{ marginRight: 4 }}>{qa.icon}</span>}
              <span dir="auto">{translateNamePhrase(qa.label, lang)}</span>
            </div>
          ))}
          {!quickAsks.length && [t('chat.suggestGoodnight'), t('chat.suggestMovie'), t('chat.suggestWhoHome')].map(s => (
            <div key={s} onClick={() => handleSend(s)} style={{ padding: '6px 12px', borderRadius: 999, flexShrink: 0, cursor: 'pointer', background: 'var(--surface)', border: '0.5px solid var(--line)', fontSize: 11, color: 'var(--ink-2)', fontWeight: 500 }}>{s}</div>
          ))}
        </div>
      )}

      {/* ── Hold-to-talk banner — only visible while recording ── */}
      <AnimatePresence>
        {recording && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '8px 16px',
              borderTop: '0.5px solid color-mix(in srgb, var(--accent) 35%, var(--line))',
              background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
              color: 'var(--accent)',
              fontSize: 12, fontWeight: 500, letterSpacing: '0.01em',
            }}
            aria-live="polite"
          >
            <VoiceWave active size={14} />
            <span>{t('chat.releaseToSend')}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Composer ── */}
      <div style={{
        padding: '10px 16px 18px',
        borderTop: recording ? 'none' : '0.5px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--surface)', border: '0.5px solid var(--line)',
          borderRadius: 22, padding: '12px 16px',
        }}>
          {/* Sparkle icon */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6"/>
          </svg>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={t('chat.composerPlaceholder')}
            dir={isHebrew(input) ? 'rtl' : 'ltr'}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Send (when there's text) / hold-to-talk mic (when empty).
            Wrapper carries the pulsing ring overlay while held so the button
            itself stays a clean 44px hit target. */}
        <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
          {recording && (
            <motion.span
              aria-hidden="true"
              initial={{ scale: 1, opacity: 0.55 }}
              animate={{ scale: 1.55, opacity: 0 }}
              transition={{ duration: 1.2, ease: 'easeOut', repeat: Infinity }}
              style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: 'color-mix(in srgb, var(--accent) 35%, transparent)',
                pointerEvents: 'none',
              }}
            />
          )}
          <motion.button
            type="button"
            onClick={input.trim() ? () => handleSend() : undefined}
            onPointerDown={!input.trim() ? handleMicPointerDown : undefined}
            onPointerUp={!input.trim() ? handleMicPointerEnd : undefined}
            onPointerCancel={!input.trim() ? handleMicPointerEnd : undefined}
            onContextMenu={!input.trim() ? (e) => e.preventDefault() : undefined}
            aria-label={input.trim() ? t('chat.sendMessage') : (recording ? t('chat.releaseToSendAria') : t('chat.holdToSpeak'))}
            title={input.trim() ? t('chat.sendTitle') : t('chat.holdToSpeakTitle')}
            whileTap={input.trim() ? { scale: 0.9 } : undefined}
            style={{
              position: 'relative', zIndex: 1,
              width: 44, height: 44, borderRadius: '50%',
              background: input.trim()
                ? 'var(--ink)'
                : recording
                  ? 'color-mix(in srgb, var(--accent) 80%, var(--ink))'
                  : 'var(--accent)',
              color: '#fff',
              border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              boxShadow: recording
                ? '0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent), var(--shadow-md)'
                : 'var(--shadow-md)',
              transform: recording ? 'scale(1.06)' : 'scale(1)',
              transition: 'transform 0.12s ease, box-shadow 0.15s ease, background 0.15s ease',
            }}
          >
            {input.trim() ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            ) : recording ? (
              <VoiceWave active size={18} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
            )}
          </motion.button>
        </div>
      </div>
    </div>
  )
}
