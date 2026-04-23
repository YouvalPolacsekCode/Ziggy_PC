import { useEffect, useRef, useState } from 'react'
import { postIntent } from '../hooks/useApi'
import { VoiceButton } from './VoiceButton'

function Message({ m }) {
  const isError = m.ok === false
  return (
    <div className="fade-in" style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: '14px 16px',
      borderRadius: 'var(--radius)',
      background: 'var(--bg-2)',
      border: `1px solid ${isError ? '#ef444430' : 'var(--border-dim)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--text-3)',
        }}>{m.source || 'ziggy'}</span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 'auto' }}>
          {new Date(m.ts).toLocaleTimeString()}
        </span>
      </div>
      {m.input && (
        <div style={{ color: 'var(--text-2)', fontSize: 13 }}>
          <span style={{ color: 'var(--purple)', marginRight: 6 }}>›</span>{m.input}
        </div>
      )}
      <div style={{ color: 'var(--text)', lineHeight: 1.6 }}>{m.reply}</div>
    </div>
  )
}

function ThinkingDot() {
  return (
    <div style={{ display: 'flex', gap: 5, padding: '14px 16px' }}>
      {[0, .2, .4].map(d => (
        <div key={d} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--purple)',
          animation: `thinking 1.2s ${d}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  )
}

export function Console({ messages }) {
  const bottomRef = useRef(null)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  async function submit() {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    setThinking(true)
    await postIntent(text)
    setThinking(false)
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Message list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60, lineHeight: 2 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
            <div style={{ fontSize: 15, color: 'var(--text-2)' }}>Ziggy is ready</div>
            <div style={{ fontSize: 12 }}>Ask anything or use the quick actions below</div>
          </div>
        )}
        {messages.map(m => <Message key={m.ts} m={m} />)}
        {thinking && <ThinkingDot />}
        <div ref={bottomRef} style={{ height: 20 }} />
      </div>

      {/* Quick pills */}
      <div style={{ padding: '10px 20px', display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border-dim)' }}>
        {['lights off', 'room summary', 'my tasks', 'internet speed', 'who is home'].map(q => (
          <button key={q} onClick={() => { setThinking(true); postIntent(q).then(() => setThinking(false)) }} style={{
            background: 'var(--bg-3)', border: '1px solid var(--border)',
            color: 'var(--text-2)', padding: '4px 12px', borderRadius: 20,
            fontSize: 12, cursor: 'pointer', transition: 'all .15s',
          }}
          onMouseEnter={e => { e.target.style.borderColor = 'var(--purple)'; e.target.style.color = 'var(--purple)' }}
          onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-2)' }}
          >{q}</button>
        ))}
      </div>

      {/* Input bar */}
      <div style={{
        display: 'flex', gap: 10, padding: '12px 20px',
        borderTop: '1px solid var(--border-dim)', background: 'var(--bg-1)',
      }}>
        <VoiceButton thinking={thinking} setThinking={setThinking} />
        <input
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
          placeholder="Ask Ziggy anything…"
          autoFocus
          style={{
            flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', color: 'var(--text)', padding: '10px 14px',
            fontSize: 14, outline: 'none', fontFamily: 'var(--font)',
            transition: 'border-color .15s',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--purple)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
        <button
          onClick={submit}
          disabled={thinking || !input.trim()}
          style={{
            background: thinking || !input.trim() ? 'var(--bg-3)' : 'linear-gradient(135deg, var(--purple), var(--indigo))',
            color: thinking || !input.trim() ? 'var(--text-3)' : '#fff',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '0 20px', fontWeight: 600,
            cursor: thinking || !input.trim() ? 'not-allowed' : 'pointer',
            transition: 'all .15s', whiteSpace: 'nowrap',
          }}
        >Send</button>
      </div>
    </div>
  )
}
