import { useRef, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { sendChat, sendVoice, sendDirectIntent } from '../lib/api'
import { useQuickAskStore } from '../stores/quickAskStore'
import { useUIStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import { formatTime, isHebrew } from '../lib/utils'

// Detect Web Speech API support at module level — evaluated once, not per render.
const SR = (typeof window !== 'undefined')
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null

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
          <span className="z-mono" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: '0.12em', fontWeight: 600 }}>PATTERN DETECTED</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 10, lineHeight: 1.45 }}>
          {msg.text} Save as a routine called <strong>"{msg.patternLabel}"</strong>?
        </div>
        {!saved ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setSaved(true)}
              style={{ padding: '7px 14px', borderRadius: 10, background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Save routine
            </button>
            <button
              style={{ padding: '7px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--ink-mute)', border: '0.5px solid var(--line)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Not now
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ok)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>
            Routine saved!
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Message bubble (Chat-A) ───────────────────────────────────────────────────
function Message({ msg }) {
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
        <p className="z-eyebrow" style={{ marginBottom: 2 }}>Ziggy</p>
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, alignSelf: 'flex-start' }}>
      <p className="z-eyebrow" style={{ marginBottom: 2 }}>Ziggy</p>
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
  const location  = useLocation()
  const navigate  = useNavigate()
  const { addToast }                              = useUIStore()
  const { messages, addMessage, clearMessages }   = useChatStore()
  const { items: quickAsks, fetch: fetchQuickAsks } = useQuickAskStore()

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
  const recognitionRef = useRef(null)   // Web Speech API instance

  useEffect(() => { fetchQuickAsks() }, [])

  // Release any open mic/speech-recognition resources if the user navigates away
  // mid-recording. Without this, MediaRecorder + its MediaStreamTracks linger
  // until GC, leaving the browser mic indicator on.
  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop() } catch {}
      try { mediaRef.current?.stop() } catch {}
      try { mediaRef.current?.stream?.getTracks?.().forEach(t => t.stop()) } catch {}
      recognitionRef.current = null
      mediaRef.current = null
    }
  }, [])

  // Pin the chat container to an exact pixel height at all times.
  // Relying on calc(100dvh - 4rem) alone can leave the composer floating when dvh
  // updates asynchronously (e.g. after keyboard closes on Android) or is slightly
  // wrong. JS always wins and guarantees the container fills exactly the visible area
  // minus the bottom nav. On iOS, vv.height shrinks when the keyboard opens while
  // window.innerHeight stays fixed — that's how we detect "keyboard open" and stop
  // subtracting nav height (the nav is hidden behind the keyboard in that state).
  useEffect(() => {
    const setSize = () => {
      if (!containerRef.current) return
      const vv = window.visualViewport
      const viewH = vv ? vv.height : window.innerHeight
      const isMobile = window.innerWidth < 768
      const keyboardOpen = vv ? vv.height < window.innerHeight * 0.8 : false
      const navH = isMobile && !keyboardOpen ? 64 : 0
      containerRef.current.style.height = `${viewH - navH}px`
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
    setInput('')
    // History = previous messages only. The backend appends req.text as the final user turn.
    const historyForApi = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }))
    addMessage('user', t)
    setThinking(true); setOrbState('thinking')
    try {
      const res = await sendChat(t, historyForApi)
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
        addMessage('pattern', res.pattern_suggestion.message || 'Pattern detected', true, {
          patternLabel: res.pattern_suggestion.suggested_name || 'Routine',
          isPattern: true,
        })
      }
      setOrbState('speaking')
      setTimeout(() => setOrbState('idle'), 2500)
    } catch (e) {
      const msg = e?.message && !e.message.startsWith('HTTP')
        ? e.message
        : 'Something went wrong. Please try again.'
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
      setTimeout(() => setOrbState('idle'), 2500)
    } catch (e) {
      const msg = e?.message && !e.message.startsWith('HTTP')
        ? e.message
        : 'Something went wrong. Please try again.'
      addMessage('assistant', msg, false)
      setOrbState('idle')
    } finally { setThinking(false) }
  }

  // ── Web Speech fast path (Chrome/Edge — returns text in ~0.3-0.5s, no upload) ──
  const _startSpeechRecognition = () => {
    const rec = new SR()
    // he-IL handles both Hebrew and mixed Hebrew/English commands well.
    // Falls back to English when Hebrew isn't detected.
    rec.lang = 'he-IL'
    rec.continuous = false
    rec.interimResults = false
    recognitionRef.current = rec

    rec.onresult = (event) => {
      const transcript = (event.results[0][0].transcript || '').trim()
      if (!transcript) { setRecording(false); setOrbState('idle'); return }
      // Route through the text chat pipeline — faster and avoids audio upload.
      const historyForApi = messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))
      addMessage('user', transcript)
      setThinking(true); setOrbState('thinking')
      sendChat(transcript, historyForApi)
        .then((res) => {
          addMessage('assistant', res.reply || '…', res.ok !== false)
          setOrbState('speaking'); setTimeout(() => setOrbState('idle'), 2500)
        })
        .catch((e) => {
          const msg = e?.message && !e.message.startsWith('HTTP') ? e.message : 'Something went wrong.'
          addMessage('assistant', msg, false); setOrbState('idle')
        })
        .finally(() => { setThinking(false) })
    }

    rec.onerror = (event) => {
      recognitionRef.current = null
      if (event.error === 'no-speech') { setRecording(false); setOrbState('idle'); return }
      // Any other error (not-allowed, audio-capture, network) → fall back to MediaRecorder.
      console.warn('[Voice] Web Speech error:', event.error, '— falling back to upload')
      _startMediaRecorder()
    }

    rec.onend = () => {
      recognitionRef.current = null
      // onresult may not have fired (empty speech) — reset state if still listening.
      setRecording((prev) => { if (prev) setOrbState('idle'); return false })
    }

    rec.start()
    setRecording(true); setOrbState('listening')
  }

  // ── MediaRecorder fallback (all browsers — uploads audio to Whisper API ~1-4s) ──
  const _startMediaRecorder = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRef.current = mr; chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        try {
          setThinking(true); setOrbState('thinking')
          const res = await sendVoice(blob)
          if (res.transcription) addMessage('user', res.transcription)
          if (res.reply) { addMessage('assistant', res.reply, res.ok !== false); setOrbState('speaking'); setTimeout(() => setOrbState('idle'), 2500) }
          else setOrbState('idle')
        } catch (e) { addToast(e?.message || 'Voice processing failed', 'error'); setOrbState('idle') }
        finally { setThinking(false) }
      }
      mr.start(); setRecording(true); setOrbState('listening')
    } catch { addToast('Microphone access denied', 'error') }
  }

  const startRecording = async () => {
    if (SR) _startSpeechRecognition()
    else await _startMediaRecorder()
  }

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop() // triggers rec.onresult then rec.onend
    } else {
      mediaRef.current?.stop()
    }
    setRecording(false); setOrbState('thinking')
  }

  const handleMicPointerDown = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId) // keep tracking even if finger slides off
    if (orbState === 'idle') startRecording()
  }
  const handleMicPointerUp = () => { if (recording) stopRecording() }

  const hasMessages = messages.length > 0
  const listening   = orbState === 'listening'
  const speaking    = orbState === 'speaking'
  const busy        = orbState === 'thinking' || speaking

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex', flexDirection: 'column',
        height: 'calc(100dvh - 4rem)',
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
          <p className="z-eyebrow">Ziggy AI</p>
          <h1 className="z-display" style={{ fontSize: 20, margin: '2px 0 0' }}>Chat</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Voice status indicator */}
          {(listening || busy) && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 999,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              fontSize: 11, color: 'var(--ink-mute)',
            }}>
              {listening && <><VoiceWave active size={14} /><span>Listening…</span></>}
              {busy && !listening && <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{orbState === 'thinking' ? 'Thinking…' : 'Speaking…'}</span>}
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
              New chat
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
            {/* Mic + wave */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <button
                onPointerDown={handleMicPointerDown}
                onPointerUp={handleMicPointerUp}
                style={{
                  width: 72, height: 72, borderRadius: '50%',
                  background: listening ? 'color-mix(in srgb, var(--accent) 15%, var(--surface))' : 'var(--ink)',
                  color: listening ? 'var(--accent)' : 'var(--bg)',
                  border: listening ? '1.5px solid var(--accent)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', touchAction: 'none',
                  boxShadow: listening ? '0 0 0 8px color-mix(in srgb, var(--accent) 12%, transparent)' : '0 6px 20px -6px rgba(0,0,0,0.3)',
                  transition: 'all 0.2s',
                  userSelect: 'none',
                }}
              >
                {listening
                  ? <VoiceWave active size={28} />
                  : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
                }
              </button>
              <p style={{ fontSize: 13, color: 'var(--ink-mute)', textAlign: 'center' }}>
                {listening ? 'Release to send' : 'Hold to speak, or type below'}
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
                    {qa.label}
                  </button>
                ))}
              </div>
            )}
            {!quickAsks.length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 380 }}>
                {['Goodnight', 'Movie time', 'Who is home?', 'Good morning'].map(s => (
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
              {qa.label}
            </div>
          ))}
          {!quickAsks.length && ['Goodnight', 'Movie time', 'Who is home?'].map(s => (
            <div key={s} onClick={() => handleSend(s)} style={{ padding: '6px 12px', borderRadius: 999, flexShrink: 0, cursor: 'pointer', background: 'var(--surface)', border: '0.5px solid var(--line)', fontSize: 11, color: 'var(--ink-2)', fontWeight: 500 }}>{s}</div>
          ))}
        </div>
      )}

      {/* ── Composer ── */}
      <div style={{
        padding: '10px 16px 18px',
        borderTop: '0.5px solid var(--line)',
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
            placeholder={`Try: "open shades and start coffee"`}
            dir={isHebrew(input) ? 'rtl' : 'ltr'}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Send / mic */}
        <motion.button
          onClick={input.trim() ? () => handleSend() : undefined}
          onPointerDown={!input.trim() ? handleMicPointerDown : undefined}
          onPointerUp={!input.trim() ? handleMicPointerUp : undefined}
          whileTap={{ scale: 0.9 }}
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: input.trim() ? 'var(--ink)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
            touchAction: 'none', userSelect: 'none',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {input.trim() ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          ) : listening ? (
            <VoiceWave active size={18} />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
          )}
        </motion.button>
      </div>
    </div>
  )
}
