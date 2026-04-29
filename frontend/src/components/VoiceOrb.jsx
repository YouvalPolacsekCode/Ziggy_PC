import { useState, useRef } from 'react'
import { addToast } from '../App'

const VAD_SILENCE_THRESHOLD = 8     // RMS below this = silence
const VAD_SILENCE_MS = 1800          // stop after 1.8s of silence
const VAD_MIN_RECORDING_MS = 1000    // don't stop during first 1s

export function VoiceOrb({ thinking, setThinking, size = 120 }) {
  const [recording, setRecording] = useState(false)
  const [micError, setMicError] = useState(false)
  const [vadActive, setVadActive] = useState(false)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const audioCtxRef = useRef(null)

  const state = recording ? 'recording' : thinking ? 'thinking' : 'idle'

  const orbStyle = {
    idle: {
      background: 'radial-gradient(circle at 35% 35%, #9d5cf6, #4f46e5 60%, #1a1a35)',
      animation: 'orb-pulse 3s ease-in-out infinite, float 4s ease-in-out infinite',
    },
    recording: {
      background: 'radial-gradient(circle at 35% 35%, #f87171, #ef4444 60%, #2a0f0f)',
      animation: 'orb-active 1s ease-in-out infinite',
    },
    thinking: {
      background: 'radial-gradient(circle at 35% 35%, #67e8f9, #06b6d4 60%, #0a1a2a)',
      animation: 'orb-thinking 1.4s ease-in-out infinite',
    },
  }[state]

  async function toggle() {
    if (thinking && !recording) return
    if (recording) { mediaRef.current?.stop(); return }

    setMicError(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRef.current = mr
      chunksRef.current = []

      // VAD setup
      let vadCancelled = false
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      audioCtx.createMediaStreamSource(stream).connect(analyser)
      const freqData = new Uint8Array(analyser.frequencyBinCount)
      let silenceStart = null
      const recordingStart = Date.now()

      function checkVAD() {
        if (vadCancelled) return
        analyser.getByteFrequencyData(freqData)
        const rms = Math.sqrt(freqData.reduce((s, v) => s + v * v, 0) / freqData.length)
        const elapsed = Date.now() - recordingStart
        if (elapsed >= VAD_MIN_RECORDING_MS) {
          if (rms < VAD_SILENCE_THRESHOLD) {
            if (!silenceStart) silenceStart = Date.now()
            else if (Date.now() - silenceStart >= VAD_SILENCE_MS) {
              vadCancelled = true
              mr.stop()
              return
            }
          } else {
            silenceStart = null
          }
        }
        requestAnimationFrame(checkVAD)
      }

      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        vadCancelled = true
        setThinking(true)
        setRecording(false)
        setVadActive(false)
        audioCtx.close().catch(() => {})
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const form = new FormData()
        form.append('file', blob, 'recording.webm')
        try {
          const res = await fetch('/api/voice', { method: 'POST', body: form })
          if (!res.ok) addToast('Voice processing failed')
        } catch {
          addToast('Could not send voice — check connection')
        } finally {
          setThinking(false)
        }
      }
      mr.start()
      setRecording(true)
      setVadActive(true)
      checkVAD()
    } catch {
      setMicError(true)
      addToast('Microphone access denied')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Outer glow rings */}
        {state !== 'idle' && [1, 2].map(i => (
          <div key={i} style={{
            position: 'absolute',
            width: size + i * 30,
            height: size + i * 30,
            borderRadius: '50%',
            border: `1px solid ${state === 'recording' ? '#ef444440' : '#06b6d440'}`,
            animation: `pulse-ring ${1 + i * 0.4}s ${i * 0.3}s ease-out infinite`,
            pointerEvents: 'none',
          }} />
        ))}

        {/* Orb button */}
        <button
          onClick={toggle}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            border: 'none',
            cursor: thinking && !recording ? 'wait' : 'pointer',
            position: 'relative',
            transition: 'transform .15s',
            ...orbStyle,
          }}
          onMouseDown={e => e.currentTarget.style.transform = 'scale(.95)'}
          onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          {/* Mic icon */}
          <svg
            width={size * 0.32} height={size * 0.32}
            viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,0.9)" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
          >
            {state === 'recording' ? (
              <rect x="6" y="6" width="12" height="12" rx="2"/>
            ) : state === 'thinking' ? (
              <>
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </>
            ) : (
              <>
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Status label */}
      <p style={{
        fontSize: 13,
        color: state === 'recording' ? '#f87171' : state === 'thinking' ? '#67e8f9' : 'var(--text-3)',
        letterSpacing: '.04em',
        transition: 'color .3s',
        minHeight: 20,
      }}>
        {micError ? 'Microphone denied'
          : state === 'recording' ? 'Listening… (stops on silence)'
          : state === 'thinking' ? 'Processing…'
          : 'Tap to speak'}
      </p>
    </div>
  )
}
