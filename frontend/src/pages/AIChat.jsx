import { useRef, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { sendChat, sendVoiceTranscribe, sendDirectIntent, speakTtsStream } from '../lib/api'
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
        dir="auto"
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
          // Bubble text aligns with the bubble's bidi direction (which `dir="auto"`
          // resolves from the message content — Hebrew → rtl, English → ltr,
          // mixed → first strong character wins). Timestamp goes on the
          // trailing edge of the bubble using the logical `end` keyword so it
          // mirrors automatically.
          textAlign: 'start',
          unicodeBidi: 'plaintext',
        }}
      >
        <p style={{ margin: 0, color: isError ? 'var(--err)' : undefined }}>{msg.text}</p>
        <p style={{ fontSize: 10, marginTop: 4, opacity: 0.4, textAlign: 'end' }}>
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
// Live-dictation bubble — same shape as a sent user bubble, but ephemeral.
// Shows the SR interim transcript while the user holds the mic and
// disappears the moment the recording stops (the parent promotes the
// text to a real Message). A subtle pulsing dot indicates "still
// listening, words coming" so an empty bubble doesn't look broken.
function LiveUserBubble({ text }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        gap: 4, maxWidth: '88%', alignSelf: 'flex-end',
      }}
    >
      <div
        dir="auto"
        style={{
          padding: '10px 14px', borderRadius: 18, borderEndEndRadius: 4,
          background: 'var(--ink)', color: 'var(--bg)',
          fontSize: 14.5, lineHeight: 1.45,
          textAlign: 'start', unicodeBidi: 'plaintext',
          minWidth: 36,
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        {text
          ? <span style={{ opacity: 0.92 }}>{text}</span>
          : <motion.span
              style={{ width: 6, height: 6, borderRadius: '50%',
                       background: 'var(--bg)', display: 'inline-block' }}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.9, repeat: Infinity }}
            />}
      </div>
    </motion.div>
  )
}

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
  // Live transcript while the user holds the mic. Rendered as a pending
  // user chat bubble that fills word-by-word — NOT into the typed-text
  // input field, because (a) typing and dictating shouldn't fight over
  // the same surface, (b) seeing your words land in the conversation
  // matches the "I'm being heard" mental model of iOS Messages dictation.
  const [liveTranscript, setLiveTranscript] = useState('')

  const mediaRef       = useRef(null)
  const chunksRef      = useRef([])
  // SpeechRecognition handle — paired with MediaRecorder in startRecording,
  // stopped in onstop. Stored in a ref because nothing renders from it.
  const speechRef      = useRef(null)
  const scrollRef      = useRef(null)
  const inputRef       = useRef(null)
  const sentPrefillRef = useRef(false)
  const containerRef   = useRef(null)
  // Source of truth for "the user is currently holding the mic button".
  // Set on pointerdown, cleared on pointerup/cancel. Used to abort if
  // getUserMedia resolves after the user has already released.
  const intentRef      = useRef(false)
  // Currently-playing TTS reply, if any. We pause + revoke its object URL
  // when a new hold-to-talk starts so we never overlap audio.
  const ttsAudioRef    = useRef(null)

  useEffect(() => { fetchQuickAsks() }, [])
  useEffect(() => { fetchVoiceStatus() }, [])

  // Mic pipeline warm-up. The first getUserMedia call after page load
  // takes 500ms-1s on Capacitor WebView and mobile browsers — initialising
  // the audio capture stack from cold. That cold-start is what makes
  // press-to-record feel laggy and pushes the system mic indicator's
  // appearance to ~a second after the hold. Subsequent getUserMedia calls
  // are <100ms.
  //
  // Doing a fire-and-forget acquire + immediate release here on mount
  // warms that pipeline so the first real PTT hold feels instant. We
  // ONLY warm when permission is already granted — never request perms
  // proactively, since that'd surface a permission prompt the user
  // didn't ask for.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return
    let cancelled = false
    ;(async () => {
      try {
        if (navigator.permissions?.query) {
          const p = await navigator.permissions.query({ name: 'microphone' })
          if (p.state !== 'granted') return
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        // Hold for one frame so the audio stack actually initialises,
        // then release. Subsequent getUserMedia stays fast.
        await new Promise(r => requestAnimationFrame(r))
        stream.getTracks().forEach(t => t.stop())
      } catch {
        // Warm-up is best-effort — if it fails (denied, browser quirk,
        // navigator.permissions not implemented), the first real hold
        // just pays the cold-start cost like before.
      }
    })()
    return () => { cancelled = true }
  }, [])

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
      stopLivePreview()
      stopTtsPlayback()
    }
  }, [])

  // Hold-to-talk dictation via the browser's SpeechRecognition API.
  // When supported, SR is the PRIMARY path — words land in the chat input
  // field live as the user speaks, like Apple/Google dictation. The user
  // sees what they're saying as they say it, and release sends. No
  // "Listening… release to send" pill, because there's nothing to wait
  // for: the text is already on screen.
  //
  // SR.continuous=true + interimResults=true so we keep getting interims
  // across pauses; SR auto-ends on long silence and we restart while the
  // user is still holding (intentRef stays true).
  //
  // MediaRecorder runs in parallel as a backup. If SR delivered nothing
  // by release (unsupported browser, error, or just no result), we send
  // the audio blob to Whisper instead. Worst case is the previous flow,
  // best case is sub-second feedback.
  //
  // sttRef holds the accumulated final transcript chunks; interimRef
  // holds the not-yet-final partial. Together they form the running
  // input value while the user is dictating.
  const sttRef         = useRef('')   // accumulated FINAL transcripts so far
  const interimRef     = useRef('')   // current INTERIM (not yet final)
  const srStartedRef   = useRef(false)
  const composeBuffer  = () => (sttRef.current + ' ' + interimRef.current).trim()

  const startLivePreview = () => {
    const SR = typeof window !== 'undefined'
      && (window.SpeechRecognition || window.webkitSpeechRecognition)
    if (!SR) return false
    // SR doesn't auto-detect. Pick the most likely spoken language by
    // checking the UI lang (user-picked) AND the OS lang
    // (navigator.language). Common case: Israeli user, OS in Hebrew,
    // Ziggy UI in English — they speak Hebrew, so we use he-IL.
    const osHebrew = typeof navigator !== 'undefined'
      && (navigator.language || '').toLowerCase().startsWith('he')
    const srLang = (lang === 'he' || osHebrew) ? 'he-IL' : 'en-US'
    sttRef.current = ''
    interimRef.current = ''
    const mkRec = () => {
      const rec = new SR()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = srLang
      rec.onresult = (e) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          const piece = r[0]?.transcript || ''
          if (r.isFinal) {
            sttRef.current = (sttRef.current + ' ' + piece).trim()
          } else {
            interim += piece
          }
        }
        interimRef.current = interim
        // Mirror the running transcript into the live-bubble state — the
        // chat renders it as a pending user message that fills word-by-word
        // until release. Input field stays untouched so the user can still
        // type something else AND the mic button doesn't swap to Send
        // mid-hold (which happens when input has text).
        setLiveTranscript(composeBuffer())
      }
      rec.onerror = (e) => {
        // 'no-speech' fires on silence and is harmless. Everything else
        // (not-allowed, audio-capture, network, aborted) logs so we can
        // diagnose if dictation never lights up on a given device.
        if (e?.error && e.error !== 'no-speech') {
          // eslint-disable-next-line no-console
          console.warn('[SR] error', e.error)
        }
      }
      rec.onend = () => {
        // SR auto-ends after ~3–5 s of silence on Chrome even with
        // continuous=true. While the user is still holding, restart so
        // dictation keeps flowing across pauses. stopLivePreview() clears
        // speechRef so this no-ops on explicit stop.
        if (intentRef.current && speechRef.current === rec) {
          try {
            const next = mkRec()
            speechRef.current = next
            next.start()
          } catch {}
        }
      }
      return rec
    }
    try {
      const rec = mkRec()
      speechRef.current = rec
      rec.start()
      srStartedRef.current = true
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[SR] start failed', e?.message || e)
      speechRef.current = null
      srStartedRef.current = false
      return false
    }
  }
  const stopLivePreview = () => {
    const rec = speechRef.current
    speechRef.current = null
    if (!rec) return
    try { rec.stop() } catch {}
  }

  // Stop any in-flight TTS reply and release its object URL. Safe to call
  // multiple times; safe to call when nothing is playing.
  const stopTtsPlayback = () => {
    const a = ttsAudioRef.current
    if (!a) return
    try { a.pause() } catch {}
    try { URL.revokeObjectURL(a.src) } catch {}
    a.src = ''
    ttsAudioRef.current = null
  }

  // Render `text` server-side in `lang`, then play it through the device's
  // own audio out. Two paths:
  //   - MediaSource streaming (Chrome/Edge/Firefox): chunks pipe in and
  //     playback starts on the first one, ~200ms vs ~1500ms for the
  //     fetch-blob path. This is what closes the "text visible long
  //     before audio" gap.
  //   - Blob fallback (Safari, anywhere MSE 'audio/mpeg' isn't supported):
  //     same shape as before — wait for full response, then play.
  // Either way the 'speaking' orb tracks real audio events so it stops
  // the moment playback actually ends, not on a guessed timer. TTS
  // failure never breaks chat: short visual blip and we move on.
  const playTtsReply = async (text, lang) => {
    if (!text) return
    stopTtsPlayback()
    const langKey = lang === 'he' ? 'he' : 'en'
    const supportsMSE = typeof MediaSource !== 'undefined'
      && typeof MediaSource.isTypeSupported === 'function'
      && MediaSource.isTypeSupported('audio/mpeg')

    const audio = new Audio()
    ttsAudioRef.current = audio
    const onDone = () => {
      if (ttsAudioRef.current === audio) {
        stopTtsPlayback()
        setOrbState(prev => prev === 'speaking' ? 'idle' : prev)
      }
    }
    audio.onended = onDone
    audio.onerror = onDone

    try {
      const res = await speakTtsStream({ text, lang: langKey })

      if (supportsMSE && res.body) {
        const mediaSource = new MediaSource()
        audio.src = URL.createObjectURL(mediaSource)
        mediaSource.addEventListener('sourceopen', () => {
          let sb
          try {
            sb = mediaSource.addSourceBuffer('audio/mpeg')
          } catch (e) {
            // Some browsers report isTypeSupported true but reject the
            // sourceBuffer creation — fall back to blob mid-flight.
            // eslint-disable-next-line no-console
            console.warn('[TTS] MSE sourceBuffer failed, falling back', e?.message)
            res.blob().then((blob) => {
              if (ttsAudioRef.current !== audio) return
              try { URL.revokeObjectURL(audio.src) } catch {}
              audio.src = URL.createObjectURL(blob)
              audio.play().catch(() => {})
            })
            return
          }
          const reader = res.body.getReader()
          const pump = async () => {
            try {
              const { done, value } = await reader.read()
              if (done) {
                if (mediaSource.readyState === 'open') mediaSource.endOfStream()
                return
              }
              sb.appendBuffer(value)
            } catch {
              if (mediaSource.readyState === 'open') {
                try { mediaSource.endOfStream() } catch {}
              }
            }
          }
          sb.addEventListener('updateend', pump)
          pump()
        }, { once: true })
      } else {
        // Blob fallback — older browsers / Safari without audio/mpeg MSE
        const blob = await res.blob()
        audio.src = URL.createObjectURL(blob)
      }
      setOrbState('speaking')
      await audio.play()
    } catch {
      // Network / render failure. Don't break chat — visual blip.
      if (audio.src) try { URL.revokeObjectURL(audio.src) } catch {}
      if (ttsAudioRef.current === audio) ttsAudioRef.current = null
      setOrbState('speaking')
      setTimeout(() => setOrbState(prev => prev === 'speaking' ? 'idle' : prev), 1500)
    }
  }

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

  // ── Hold-to-talk recording ──
  //
  // Two paths, picked at press time based on whether SR can run alone:
  //
  //   - DESKTOP (Chrome, Edge, Safari ≥14.5): MediaRecorder + SR run in
  //     parallel. Mic stream is shared, no contention. SR delivers
  //     interim results word-by-word for the live bubble. Whisper backs
  //     it up if SR returns nothing on release.
  //
  //   - MOBILE (Android Chrome / Capacitor WebView / mobile Safari): the
  //     second getUserMedia for MediaRecorder steals SR's mic, which
  //     silently kills interim delivery — user sees the pulsing dot for
  //     the whole hold and then the full sentence on release (Whisper
  //     fallback). To avoid this we run SR-only on mobile and skip
  //     MediaRecorder entirely. Mirrors the 880c864 architecture that
  //     used to feel "alive" on phone PWAs before the security-hardening
  //     checkpoint re-added MediaRecorder for the Whisper fallback.
  //
  // Race safety: `intentRef` is the single source of truth for "finger
  // still down." Released-before-mic-resolved aborts cleanly on both
  // paths.

  const isMobileDevice = () => {
    if (typeof navigator === 'undefined') return false
    const ua = (navigator.userAgent || '').toLowerCase()
    return /android|iphone|ipad|ipod|capacitor/i.test(ua)
  }

  const startRecording = async () => {
    if (intentRef.current) return  // already holding
    intentRef.current = true
    // Cut off any TTS playback the moment the user starts a new turn —
    // overlapping the assistant's last reply with their next utterance
    // feels off and confuses Whisper.
    stopTtsPlayback()
    // Live transcript renders in a pending chat bubble — input stays as
    // whatever the user had typed (if anything) so dictation doesn't
    // clobber it.
    setLiveTranscript('')
    sttRef.current = ''
    interimRef.current = ''
    srStartedRef.current = false
    setRecording(true); setOrbState('listening')
    // Start SR first. On mobile we'll stop here and not touch the mic
    // again — that's what gives SR the clean stream it needs to deliver
    // interims word-by-word.
    const srStarted = startLivePreview()
    const SR = typeof window !== 'undefined'
      && (window.SpeechRecognition || window.webkitSpeechRecognition)

    if (isMobileDevice() && srStarted) {
      // Mobile SR-only path. Haptic now (SR is already capturing); no
      // MediaRecorder, no shared stream, no contention.
      try { navigator.vibrate?.(8) } catch {}
      mediaRef.current = null
      chunksRef.current = []
      return
    }

    // Desktop path OR SR-unavailable mobile fallback: run MediaRecorder
    // for the Whisper safety net.
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      intentRef.current = false
      stopLivePreview()
      setRecording(false); setOrbState('idle')
      addToast(t('chat.micDenied'), 'error')
      return
    }

    // User released before the permission prompt / hardware came back. Abort.
    if (!intentRef.current) {
      stream.getTracks().forEach(t => t.stop())
      stopLivePreview()
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
      // Stop SR right after recording stops so we capture any final result
      // that was still in flight, then move on to send.
      stopLivePreview()
      setRecording(false)

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      // Misfire guard: too-quick taps. Empirically anything under ~1.5 KB of
      // webm/opus is well under ~150 ms of audio — almost certainly a
      // mis-tap. Drop both blob and any partial SR text.
      if (blob.size < 1500) {
        setLiveTranscript('')
        setOrbState('idle')
        return
      }

      // SR primary path: if dictation gave us text, use it directly and
      // skip Whisper entirely. Saves ~1–2 s + a Whisper API call. The
      // text is already on screen in the live bubble, so the user has
      // already seen what they said.
      const dictated = composeBuffer()
      let transcription = ''
      let detectedLang = 'en'
      if (srStartedRef.current && dictated) {
        transcription = dictated
        // SR locale is the strongest hint for the reply lang here.
        detectedLang = (speechRef.current?.lang || '').startsWith('he')
          ? 'he'
          : ((lang === 'he') ? 'he' : 'en')
      } else {
        // Fallback: SR unavailable or returned nothing. Send the audio
        // through Whisper like the old flow.
        setOrbState('transcribing')
        try {
          const tr = await sendVoiceTranscribe(blob)
          transcription = (tr?.transcription || '').trim()
          if (tr?.lang === 'he' || tr?.lang === 'en') detectedLang = tr.lang
        } catch (e) {
          addToast(e?.message || t('chat.transcribeFailed'), 'error')
          setOrbState('idle')
          setLiveTranscript('')
          return
        }
      }
      if (!transcription) { setOrbState('idle'); setLiveTranscript(''); return }

      // History = previous messages only. Backend appends transcription as
      // the final user turn (matches the text-input handleSend flow).
      const historyForApi = messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
      }))
      // Promote the live transcript bubble to a real persisted user
      // message and clear the live-bubble state.
      setLiveTranscript('')
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
        // Voice in → voice out. Use the language Whisper detected on the
        // user's utterance, not the UI locale — answers should match the
        // question's language even if the user types Hebrew in an English
        // UI or vice versa.
        playTtsReply(res.reply || '', detectedLang)
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
    // Haptic fires AFTER the recorder actually starts (not on pointerdown)
    // so the buzz signals "you are now being recorded" — matches the
    // moment the system mic indicator lights up, instead of feeling like
    // a buzz-then-wait-then-record sequence. Android PWA / Capacitor
    // only; iOS Safari ignores silently, no fallback needed.
    try { navigator.vibrate?.(8) } catch {}
  }

  const stopRecording = () => {
    if (!intentRef.current) return
    intentRef.current = false
    const mr = mediaRef.current
    if (mr && mr.state === 'recording') {
      try { mr.stop() } catch {}
      // onstop will clear `recording` and route through transcription.
      return
    }
    // No MediaRecorder — either user released before getUserMedia resolved,
    // OR we're on the mobile SR-only path. Distinguish via srStartedRef:
    // if SR is running, drain it and ship whatever it gave us; otherwise
    // just reset UI.
    if (srStartedRef.current) {
      finishSrOnlyRecording()
    } else {
      stopLivePreview()
      setLiveTranscript('')
      setRecording(false); setOrbState('idle')
    }
  }

  // Mobile SR-only release path. SR keeps delivering results briefly after
  // stop(), so we give it a short grace window before promoting whatever
  // we got to a real message. Empty result = misfire; nothing posted.
  const finishSrOnlyRecording = async () => {
    setRecording(false)
    setOrbState('transcribing')
    // Tell SR to stop and let pending finals trickle in.
    stopLivePreview()
    await new Promise(r => setTimeout(r, 250))
    const dictated = composeBuffer()
    if (!dictated) {
      setLiveTranscript('')
      setOrbState('idle')
      return
    }
    const detectedLang = (speechRef.current?.lang || '').startsWith('he')
      ? 'he'
      : (lang === 'he' ? 'he' : 'en')
    const historyForApi = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }))
    setLiveTranscript('')
    addMessage('user', dictated)
    setThinking(true); setOrbState('thinking')
    try {
      const res = await sendChat(dictated, historyForApi)
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
      playTtsReply(res.reply || '', detectedLang)
    } catch (e) {
      const msg = e?.message && !e.message.startsWith('HTTP') ? e.message : t('chat.somethingWrongShort')
      addMessage('assistant', msg, false)
      setOrbState('idle')
    } finally {
      setThinking(false)
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

          {/* Top status pill: shows during listening AND post-release stages.
              The dictation itself lives in the LiveUserBubble in the chat;
              this pill is just the steady "what stage am I in" indicator
              (Listening → Transcribing → Thinking → Speaking). */}
          {(listening || busy) && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 999,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              fontSize: 11, color: 'var(--ink-mute)',
              maxWidth: '70vw',
            }}>
              {listening && <VoiceWave active size={14} />}
              <span
                style={{ fontFamily: '"IBM Plex Mono", monospace',
                         overflow: 'hidden', textOverflow: 'ellipsis',
                         whiteSpace: 'nowrap', minWidth: 0 }}
                dir="auto"
              >
                {listening ? t('chat.listening')
                  : transcribing ? t('chat.transcribing')
                  : orbState === 'thinking' ? t('chat.thinking')
                  : t('chat.speaking')}
              </span>
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
      {(hasMessages || recording) && (
        <div
          className="scrollbar-thin"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {messages.map(msg => <Message key={msg.id} msg={msg} />)}
          {/* Pending live-dictation bubble: rendered as a normal user
              bubble that fills word-by-word while the mic is held. On
              release we promote it to a real persisted message and clear
              this state. Empty during the brief delay before SR delivers
              its first interim result — show a single bouncing dot then
              so the user sees acknowledgement of the hold. */}
          {recording && <LiveUserBubble text={liveTranscript} />}
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
              {qa.icon && <span style={{ marginInlineEnd: 4 }}>{qa.icon}</span>}
              <span dir="auto">{translateNamePhrase(qa.label, lang)}</span>
            </div>
          ))}
          {!quickAsks.length && [t('chat.suggestGoodnight'), t('chat.suggestMovie'), t('chat.suggestWhoHome')].map(s => (
            <div key={s} onClick={() => handleSend(s)} style={{ padding: '6px 12px', borderRadius: 999, flexShrink: 0, cursor: 'pointer', background: 'var(--surface)', border: '0.5px solid var(--line)', fontSize: 11, color: 'var(--ink-2)', fontWeight: 500 }}>{s}</div>
          ))}
        </div>
      )}

      {/* Hold-to-talk banner removed in favor of:
          - the LiveUserBubble in the chat which shows actual dictation
          - the small "Listening…" chip in the header status area
          The red "release to send" banner duplicated both and felt loud. */}

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
          {/* Mic button has two modes: PTT (no input text) or Send (input
              has text). Dictation now lands in the LiveUserBubble in the
              chat, not the input — so the input stays empty during the
              hold and the button stays in PTT mode naturally. */}
          {(() => { const ptt = !input.trim(); return (
          <motion.button
            type="button"
            onClick={ptt ? undefined : () => handleSend()}
            onPointerDown={ptt ? handleMicPointerDown : undefined}
            onPointerUp={ptt ? handleMicPointerEnd : undefined}
            onPointerCancel={ptt ? handleMicPointerEnd : undefined}
            onContextMenu={ptt ? (e) => e.preventDefault() : undefined}
            aria-label={ptt ? (recording ? t('chat.releaseToSendAria') : t('chat.holdToSpeak')) : t('chat.sendMessage')}
            title={ptt ? t('chat.holdToSpeakTitle') : t('chat.sendTitle')}
            whileTap={ptt ? undefined : { scale: 0.9 }}
            style={{
              position: 'relative', zIndex: 1,
              width: 44, height: 44, borderRadius: '50%',
              background: ptt
                ? (recording
                    ? 'color-mix(in srgb, var(--accent) 80%, var(--ink))'
                    : 'var(--accent)')
                : 'var(--ink)',
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
            {recording ? (
              <VoiceWave active size={18} />
            ) : input.trim() ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
            )}
          </motion.button>
          )})()}
        </div>
      </div>
    </div>
  )
}
