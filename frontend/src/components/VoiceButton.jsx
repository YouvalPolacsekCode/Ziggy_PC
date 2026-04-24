import { useState, useRef } from 'react'
import { addToast } from '../App'

export function VoiceButton({ thinking, setThinking }) {
  const [recording, setRecording] = useState(false)
  const [micError, setMicError] = useState(false)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])

  const state = recording ? 'recording' : thinking ? 'processing' : 'idle'
  const bgColor = { idle: 'var(--bg-3)', recording: 'var(--red)', processing: 'var(--purple)' }[state]
  const borderColor = { idle: 'var(--border)', recording: 'var(--red)', processing: 'var(--purple)' }[state]
  const icon = { idle: '🎤', recording: '⏹', processing: '◌' }[state]

  async function toggle() {
    if (thinking && !recording) return
    if (recording) { mediaRef.current?.stop(); return }

    setMicError(false)
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
          if (!res.ok) addToast('Voice processing failed')
        } catch {
          addToast('Could not send voice — check connection')
        } finally {
          setThinking(false)
        }
      }
      mr.start()
      setRecording(true)
    } catch {
      setMicError(true)
      addToast('Microphone access denied — check browser permissions')
    }
  }

  return (
    <button
      onClick={toggle}
      title={
        micError ? 'Microphone access denied' :
        recording ? 'Stop recording' :
        thinking ? 'Processing…' :
        'Click to speak'
      }
      style={{
        position: 'relative',
        width: 42, height: 42, borderRadius: '50%',
        background: micError ? '#ef444422' : bgColor,
        border: `1px solid ${micError ? 'var(--red)' : borderColor}`,
        color: state !== 'idle' ? '#fff' : micError ? 'var(--red)' : 'var(--text-2)',
        fontSize: 16,
        cursor: thinking && !recording ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        transition: 'all .2s',
      }}
    >
      {recording && (
        <span style={{
          position: 'absolute', inset: -1, borderRadius: '50%',
          border: `2px solid var(--red)`,
          animation: 'pulse-ring 1.2s ease-out infinite',
          pointerEvents: 'none',
        }} />
      )}
      {micError ? '⚠' : icon}
    </button>
  )
}
