import { useRef, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { sendChat, sendVoice, sendDirectIntent } from '../lib/api'
import { useQuickAskStore } from '../stores/quickAskStore'
import { useUIStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import { formatTime } from '../lib/utils'

const HEBREW_RE = /[֐-׿]/
const isHebrew  = (text) => HEBREW_RE.test(text)

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

// ── Message bubble (Chat-A) ───────────────────────────────────────────────────
function Message({ msg }) {
  const isUser  = msg.role === 'user'
  const isError = !isUser && msg.ok === false
  const rtl     = isHebrew(msg.text)
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
            ? '0.5px solid color-mix(in srgb, #e05050 60%, var(--line))'
            : isUser ? 'none' : '0.5px solid var(--line)',
          fontSize: 14.5, lineHeight: 1.45,
          textAlign: rtl ? 'right' : 'left',
        }}
      >
        <p style={{ margin: 0, color: isError ? '#c94040' : undefined }}>{msg.text}</p>
        <p style={{ fontSize: 10, marginTop: 4, opacity: 0.4, textAlign: rtl ? 'left' : 'right' }}>
          {formatTime(msg.ts)}
        </p>
      </div>

      {/* What Ziggy did — mono ops strip */}
      {msg.actions && msg.actions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 6 }}>
          {msg.actions.map((a, i) => (
            <span key={i} style={{ fontSize: 10, color: 'var(--ok)', fontFamily: '"IBM Plex Mono", monospace', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>↳</span> {a}
            </span>
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

  const [input,         setInput]         = useState('')
  const [orbState,      setOrbState]      = useState('idle')
  const [thinking,      setThinking]      = useState(false)
  const [recording,     setRecording]     = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)

  const mediaRef          = useRef(null)
  const chunksRef         = useRef([])
  const scrollRef         = useRef(null)
  const inputRef          = useRef(null)
  const sentPrefillRef    = useRef(false)

  useEffect(() => { fetchQuickAsks() }, [])

  // iOS keyboard awareness via visualViewport API.
  // When the soft keyboard slides up it reduces visualViewport.height without
  // changing window.innerHeight, so we compute the gap and push the composer up.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop
      setKeyboardInset(Math.max(0, inset))
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
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
      addMessage('assistant', res.reply || '…', res.ok !== false)
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
      addMessage('assistant', res.reply || '…', res.ok !== false)
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

  const startRecording = async () => {
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

  const stopRecording = () => { mediaRef.current?.stop(); setRecording(false); setOrbState('thinking') }
  const handleMicClick = () => { if (recording) stopRecording(); else if (orbState === 'idle') startRecording() }

  const hasMessages = messages.length > 0
  const listening   = orbState === 'listening'
  const speaking    = orbState === 'speaking'
  const busy        = orbState === 'thinking' || speaking

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100dvh - 4rem)',
      background: 'var(--bg)',
      overflow: 'hidden',
    }}
    className="md:h-screen"
    >
      {/* ── Header bar ── */}
      <div style={{
        padding: '14px 20px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '0.5px solid var(--line)',
      }}>
        <div>
          <p className="z-eyebrow">Ziggy AI</p>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: '2px 0 0', color: 'var(--ink)' }}>
            Chat
          </h1>
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
                onClick={handleMicClick}
                style={{
                  width: 72, height: 72, borderRadius: '50%',
                  background: listening ? 'color-mix(in srgb, var(--accent) 15%, var(--surface))' : 'var(--ink)',
                  color: listening ? 'var(--accent)' : 'var(--bg)',
                  border: listening ? '1.5px solid var(--accent)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: listening ? '0 0 0 8px color-mix(in srgb, var(--accent) 12%, transparent)' : '0 6px 20px -6px rgba(0,0,0,0.3)',
                  transition: 'all 0.2s',
                }}
              >
                {listening
                  ? <VoiceWave active size={28} />
                  : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
                }
              </button>
              <p style={{ fontSize: 13, color: 'var(--ink-mute)', textAlign: 'center' }}>
                {listening ? 'Tap to stop' : 'Tap to speak, or type below'}
              </p>
            </div>

            {/* Quick ask chips */}
            {quickAsks.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 400 }}>
                {quickAsks.map(qa => (
                  <button
                    key={qa.id}
                    onClick={() => handleDirectQuickAsk(qa)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '7px 12px', borderRadius: 999,
                      background: 'var(--surface)', border: '0.5px solid var(--line)',
                      fontSize: 12, fontWeight: 500, color: 'var(--ink-2)',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {qa.icon && <span>{qa.icon}</span>}
                    {qa.label}
                  </button>
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
          style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {messages.map(msg => <Message key={msg.id} msg={msg} />)}
          {thinking && <ThinkingBubble />}
          <div ref={scrollRef} />
        </div>
      )}

      {/* ── Composer ── */}
      <div style={{
        padding: `10px 16px ${keyboardInset > 0 ? keyboardInset + 10 : 14}px`,
        borderTop: '0.5px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 8,
        transition: 'padding-bottom 0.1s ease',
      }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface)', border: '0.5px solid var(--line)',
          borderRadius: 999, padding: '9px 14px',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 12h2"/></svg>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask Ziggy…"
            dir={isHebrew(input) ? 'rtl' : 'ltr'}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 14, color: 'var(--ink)',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Send / mic */}
        <motion.button
          onClick={input.trim() ? () => handleSend() : handleMicClick}
          whileTap={{ scale: 0.9 }}
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: input.trim() ? 'var(--ink)' : (listening ? 'var(--accent)' : 'var(--surface)'),
            color: input.trim() ? 'var(--bg)' : (listening ? '#fff' : 'var(--ink-2)'),
            border: input.trim() || listening ? 'none' : '0.5px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          {input.trim() ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          ) : listening ? (
            <VoiceWave active size={18} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
          )}
        </motion.button>
      </div>
    </div>
  )
}
