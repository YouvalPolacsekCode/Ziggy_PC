import { useState, useEffect, useRef, useCallback } from 'react'
import { postIntent } from '../hooks/useApi'
import { addToast } from '../App'

/* ─── CSS injected once ─── */
const STYLE = `
@keyframes orb-idle {
  0%,100% { transform: scale(1);    opacity: 0.15; }
  50%      { transform: scale(1.08); opacity: 0.25; }
}
@keyframes orb-listen {
  0%,100% { transform: scale(1);    opacity: 0.4; }
  50%      { transform: scale(1.18); opacity: 0.7; }
}
@keyframes orb-think {
  0%   { transform: scale(1)    rotate(0deg);   opacity: 0.5; }
  50%  { transform: scale(1.12) rotate(180deg); opacity: 0.9; }
  100% { transform: scale(1)    rotate(360deg); opacity: 0.5; }
}
@keyframes orb-speak {
  0%,100% { transform: scaleY(1);    opacity: 0.6; }
  25%      { transform: scaleY(1.22); opacity: 1;   }
  75%      { transform: scaleY(0.88); opacity: 0.8; }
}
@keyframes ring-expand {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(2.2); opacity: 0;   }
}
@keyframes orbit {
  from { transform: rotate(0deg)   translateX(var(--r)) rotate(0deg); }
  to   { transform: rotate(360deg) translateX(var(--r)) rotate(-360deg); }
}
@keyframes star-twinkle {
  0%,100% { opacity: 0.2; }
  50%      { opacity: 0.8; }
}
@keyframes error-flash {
  0%,100% { opacity: 1; }
  50%      { opacity: 0.2; }
}
`

function injectStyle() {
  if (document.getElementById('visualizer-style')) return
  const el = document.createElement('style')
  el.id = 'visualizer-style'
  el.textContent = STYLE
  document.head.appendChild(el)
}

/* ─── Star field (generated once) ─── */
const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: Math.random() * 2 + 0.5,
  delay: Math.random() * 4,
  dur: 2 + Math.random() * 3,
}))

/* ─── Orbital dots ─── */
const DOTS = [
  { size: 5, r: 90,  dur: 3.2, color: 'var(--purple)' },
  { size: 4, r: 110, dur: 5.1, color: 'var(--indigo)' },
  { size: 3, r: 130, dur: 7.4, color: 'var(--teal)'   },
  { size: 4, r: 150, dur: 4.8, color: 'var(--purple)' },
  { size: 3, r: 170, dur: 9.0, color: 'var(--indigo)' },
]

/* ─── Ring configs per state ─── */
const RINGS = {
  idle:       [{ r: 80,  opacity: 0.15, dur: 3 }, { r: 100, opacity: 0.08, dur: 3.6 }],
  listening:  [{ r: 80,  opacity: 0.5,  dur: .8 }, { r: 110, opacity: 0.3,  dur: 1.2 }, { r: 140, opacity: 0.15, dur: 1.6 }],
  processing: [{ r: 80,  opacity: 0.4,  dur: .6 }, { r: 110, opacity: 0.25, dur: .9  }, { r: 140, opacity: 0.15, dur: 1.2 }, { r: 170, opacity: 0.08, dur: 1.5 }],
  speaking:   [{ r: 80,  opacity: 0.6,  dur: .4 }, { r: 120, opacity: 0.4,  dur: .7  }, { r: 160, opacity: 0.25, dur: 1.0 }],
  error:      [{ r: 80,  opacity: 0.8,  dur: .3 }],
  offline:    [{ r: 80,  opacity: 0.08, dur: 5  }],
}

const STATE_COLOR = {
  idle:       { core: '#8b5cf6', glow: '#8b5cf660' },
  listening:  { core: '#14b8a6', glow: '#14b8a680' },
  processing: { core: '#a78bfa', glow: '#a78bfa80' },
  speaking:   { core: '#e0e0ff', glow: '#c4b5fd80' },
  error:      { core: '#ef4444', glow: '#ef444460' },
  offline:    { core: '#3a3a4a', glow: '#00000000' },
}

const STATE_LABEL = {
  idle:       'Standby',
  listening:  'Listening…',
  processing: 'Processing…',
  speaking:   'Responding…',
  error:      'Error',
  offline:    'Offline',
}

export function Visualizer({ messages, connected }) {
  const [vizState, setVizState] = useState('idle')
  const [recording, setRecording] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [lastMsg, setLastMsg] = useState('')
  const [errorFlash, setErrorFlash] = useState(false)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const speakTimer = useRef(null)
  const prevMsgCount = useRef(0)

  injectStyle()

  // Derive state
  useEffect(() => {
    if (!connected) { setVizState('offline'); return }
    if (errorFlash)  { setVizState('error'); return }
    if (recording)   { setVizState('listening'); return }
    if (thinking)    { setVizState('processing'); return }
    setVizState('idle')
  }, [connected, recording, thinking, errorFlash])

  // Detect new WS message → briefly switch to "speaking"
  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      prevMsgCount.current = messages.length
      const last = messages[messages.length - 1]
      if (last?.reply) {
        setLastMsg(last.reply)
        setVizState('speaking')
        clearTimeout(speakTimer.current)
        speakTimer.current = setTimeout(() => setVizState('idle'), Math.min(last.reply.length * 60, 6000))
      }
    }
  }, [messages])

  const handleOrb = useCallback(async () => {
    if (!connected) return
    if (recording) { mediaRef.current?.stop(); return }
    if (thinking) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        setThinking(true)
        setRecording(false)
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const form = new FormData()
        form.append('file', blob, 'recording.webm')
        try {
          const res = await fetch('/api/voice', { method: 'POST', body: form })
          if (!res.ok) { setErrorFlash(true); setTimeout(() => setErrorFlash(false), 1500) }
        } catch {
          addToast('Voice send failed')
          setErrorFlash(true)
          setTimeout(() => setErrorFlash(false), 1500)
        } finally {
          setThinking(false)
        }
      }
      mr.start()
      setRecording(true)
    } catch {
      addToast('Microphone access denied')
      setErrorFlash(true)
      setTimeout(() => setErrorFlash(false), 1500)
    }
  }, [connected, recording, thinking])

  const { core, glow } = STATE_COLOR[vizState]
  const rings = RINGS[vizState] || RINGS.idle
  const showOrbits = ['processing', 'speaking'].includes(vizState)

  const orbAnimation =
    vizState === 'idle'       ? 'orb-idle 3s ease-in-out infinite' :
    vizState === 'listening'  ? 'orb-listen 0.8s ease-in-out infinite' :
    vizState === 'processing' ? 'orb-think 2s linear infinite' :
    vizState === 'speaking'   ? 'orb-speak 0.5s ease-in-out infinite' :
    vizState === 'error'      ? 'error-flash 0.3s ease-in-out 5' :
    'none'

  return (
    <div style={{
      height: '100%', background: '#07080e',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden', userSelect: 'none',
    }}>

      {/* Star field */}
      {STARS.map(s => (
        <div key={s.id} style={{
          position: 'absolute',
          left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size,
          borderRadius: '50%',
          background: '#fff',
          animation: `star-twinkle ${s.dur}s ${s.delay}s ease-in-out infinite`,
          pointerEvents: 'none',
        }} />
      ))}

      {/* Expanding rings */}
      <div style={{ position: 'relative', width: 340, height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {rings.map((ring, i) => (
          <div key={`${vizState}-${i}`} style={{
            position: 'absolute',
            width: ring.r * 2, height: ring.r * 2,
            borderRadius: '50%',
            border: `1.5px solid ${core}`,
            opacity: ring.opacity,
            animation: `ring-expand ${ring.dur}s ${i * ring.dur / rings.length}s ease-out infinite`,
            pointerEvents: 'none',
          }} />
        ))}

        {/* Orbital dots */}
        {showOrbits && DOTS.map((dot, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              '--r': `${dot.r}px`,
              width: dot.size, height: dot.size,
              borderRadius: '50%',
              background: dot.color,
              boxShadow: `0 0 8px ${dot.color}`,
              animation: `orbit ${dot.dur}s linear infinite`,
              animationDelay: `${-i * 0.6}s`,
            }} />
          </div>
        ))}

        {/* Core orb — clickable to toggle voice */}
        <div
          onClick={handleOrb}
          title={recording ? 'Stop' : 'Click to speak'}
          style={{
            position: 'relative',
            width: 120, height: 120,
            borderRadius: '50%',
            background: `radial-gradient(circle at 38% 38%, ${core}cc, ${core}44 60%, transparent)`,
            boxShadow: `0 0 40px ${glow}, 0 0 80px ${glow}88, inset 0 0 30px ${core}22`,
            cursor: connected ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: orbAnimation,
            transition: 'box-shadow .4s, background .4s',
          }}
        >
          {/* Inner glare */}
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: `radial-gradient(circle at 38% 38%, ${core}88, transparent)`,
            opacity: 0.6,
          }} />
        </div>
      </div>

      {/* State label */}
      <div style={{
        marginTop: 32,
        fontSize: 13, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
        color: core, transition: 'color .4s',
      }}>
        {STATE_LABEL[vizState]}
      </div>

      {/* Last message preview */}
      {lastMsg && (
        <div style={{
          marginTop: 12, maxWidth: 420, textAlign: 'center',
          fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6,
          opacity: vizState === 'speaking' ? 1 : 0.4,
          transition: 'opacity .6s',
          padding: '0 24px',
        }}>
          {lastMsg.length > 120 ? lastMsg.slice(0, 120) + '…' : lastMsg}
        </div>
      )}

      {/* HUD corner — connection status */}
      <div style={{
        position: 'absolute', bottom: 20, right: 24,
        fontSize: 11, color: connected ? 'var(--green)' : 'var(--red)',
        display: 'flex', alignItems: 'center', gap: 6, opacity: 0.7,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: connected ? 'var(--green)' : 'var(--red)',
          boxShadow: connected ? '0 0 6px var(--green)' : 'none',
        }} />
        {connected ? 'LIVE' : 'OFFLINE'}
      </div>

      {/* HUD corner — voice hint */}
      {connected && !recording && !thinking && (
        <div style={{
          position: 'absolute', bottom: 20, left: 24,
          fontSize: 11, color: 'var(--text-3)', opacity: 0.5,
        }}>
          Click orb to speak
        </div>
      )}
    </div>
  )
}
