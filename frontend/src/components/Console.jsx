import { useEffect, useRef, useState } from 'react'
import { postIntent } from '../hooks/useApi'
import { VoiceOrb } from './VoiceOrb'
import { addToast } from '../App'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function Message({ m }) {
  const isZiggy = !m.input
  const ago = Math.floor((Date.now() - m.ts) / 1000)
  const timeLabel = ago < 5 ? 'now' : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`

  return (
    <div className="fade-up" style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      alignSelf: isZiggy ? 'flex-start' : 'flex-end',
      maxWidth: '82%',
    }}>
      {m.input && (
        <div style={{
          background: 'linear-gradient(135deg, var(--purple), var(--indigo))',
          color: '#fff',
          padding: '10px 16px',
          borderRadius: '18px 18px 4px 18px',
          fontSize: 14,
          lineHeight: 1.5,
          boxShadow: '0 4px 20px var(--glow-purple)',
        }}>{m.input}</div>
      )}
      {m.reply && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-dim)',
          color: 'var(--text)',
          padding: '10px 16px',
          borderRadius: '4px 18px 18px 18px',
          fontSize: 14,
          lineHeight: 1.6,
        }}>{m.reply}</div>
      )}
      <span style={{ fontSize: 10, color: 'var(--text-3)', alignSelf: isZiggy ? 'flex-start' : 'flex-end', paddingLeft: 4 }}>
        {m.source || 'ziggy'} · {timeLabel}
      </span>
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div style={{
      display: 'flex', gap: 5, padding: '12px 16px',
      background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
      borderRadius: '4px 18px 18px 18px',
      alignSelf: 'flex-start',
    }}>
      {[0, .18, .36].map(d => (
        <div key={d} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--purple-3)',
          animation: `thinking 1.1s ${d}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  )
}

const QUICK = ['lights off', 'room summary', 'my tasks', 'internet speed', 'who is home']

export function Console({ messages }) {
  const bottomRef = useRef(null)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const showChat = messages.length > 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  async function submit(text) {
    const t = (text ?? input).trim()
    if (!t || thinking) return
    if (!text) setInput('')
    setThinking(true)
    try {
      const res = await postIntent(t)
      if (res?.ok === false) addToast(res.reply || 'Command failed')
    } catch {
      addToast('Could not reach Ziggy')
    } finally {
      setThinking(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '20px 20px 12px', flexShrink: 0 }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 2 }}>{greeting()},</p>
        <h1 style={{ fontSize: 26, fontWeight: 800, background: 'linear-gradient(90deg, var(--text), var(--purple-3))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Youval
        </h1>
      </div>

      {/* Chat or Orb */}
      {showChat ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m, i) => <Message key={`${m.ts}-${i}`} m={m} />)}
          {thinking && <ThinkingBubble />}
          <div ref={bottomRef} style={{ height: 8 }} />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32, padding: '0 20px' }}>
          <VoiceOrb thinking={thinking} setThinking={setThinking} size={130} />

          {/* Quick actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 340 }}>
            {QUICK.map(q => (
              <button key={q} onClick={() => submit(q)} style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
                padding: '7px 16px', borderRadius: 20,
                fontSize: 12, cursor: 'pointer', transition: 'all .15s',
              }}
              onMouseEnter={e => { e.target.style.borderColor = 'var(--purple)'; e.target.style.color = 'var(--purple-3)' }}
              onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-2)' }}
              >{q}</button>
            ))}
          </div>
        </div>
      )}

      {/* Compact voice + input when chat is active */}
      {showChat && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-dim)', background: 'var(--bg-1)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <VoiceOrb thinking={thinking} setThinking={setThinking} size={44} />
          <input
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}
            placeholder="Ask Ziggy…"
            autoFocus
            style={{
              flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border)',
              borderRadius: 24, color: 'var(--text)', padding: '10px 16px',
              fontSize: 14, outline: 'none', fontFamily: 'var(--font)',
              transition: 'border-color .15s',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--purple)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
          <button
            onClick={() => submit()}
            disabled={thinking || !input.trim()}
            style={{
              width: 44, height: 44, borderRadius: '50%', border: 'none', flexShrink: 0,
              background: thinking || !input.trim() ? 'var(--bg-3)' : 'linear-gradient(135deg, var(--purple), var(--indigo))',
              color: thinking || !input.trim() ? 'var(--text-3)' : '#fff',
              cursor: thinking || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s',
              boxShadow: thinking || !input.trim() ? 'none' : '0 4px 14px var(--glow-purple)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      )}

      {/* Text input on home screen */}
      {!showChat && (
        <div style={{ padding: '12px 20px 8px', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 28, padding: '4px 6px 4px 18px' }}>
            <input
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}
              placeholder="What can I help you with?"
              style={{
                flex: 1, background: 'none', border: 'none',
                color: 'var(--text)', fontSize: 14, outline: 'none', fontFamily: 'var(--font)',
              }}
            />
            <button
              onClick={() => submit()}
              disabled={thinking || !input.trim()}
              style={{
                width: 38, height: 38, borderRadius: '50%', border: 'none', flexShrink: 0,
                background: input.trim() ? 'linear-gradient(135deg, var(--purple), var(--indigo))' : 'var(--bg-3)',
                color: input.trim() ? '#fff' : 'var(--text-3)',
                cursor: input.trim() ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .15s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
