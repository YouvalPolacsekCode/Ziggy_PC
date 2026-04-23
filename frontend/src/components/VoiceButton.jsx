import { useState, useRef } from 'react'

export function VoiceButton({ thinking, setThinking }) {
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])

  async function toggle() {
    if (recording) { mediaRef.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        setRecording(false)
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const form = new FormData()
        form.append('file', blob, 'recording.webm')
        setThinking(true)
        try { await fetch('/api/voice', { method: 'POST', body: form }) }
        catch (e) { console.error(e) }
        finally { setThinking(false) }
      }
      mr.start()
      setRecording(true)
    } catch (e) { console.error('Mic denied', e) }
  }

  const active = recording || thinking
  const color = recording ? 'var(--red)' : thinking ? 'var(--purple)' : 'var(--purple)'

  return (
    <button
      onClick={toggle}
      title={recording ? 'Stop recording' : 'Hold to speak'}
      style={{
        position: 'relative',
        width: 42, height: 42, borderRadius: '50%',
        background: active ? color : 'var(--bg-3)',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        color: active ? '#fff' : 'var(--text-2)',
        fontSize: 16,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        transition: 'all .2s',
        boxShadow: recording ? `0 0 0 0 ${color}` : 'none',
      }}
    >
      {/* Pulse ring */}
      {recording && (
        <span style={{
          position: 'absolute', inset: -1, borderRadius: '50%',
          border: `2px solid ${color}`,
          animation: 'pulse-ring 1.2s ease-out infinite',
          pointerEvents: 'none',
        }} />
      )}
      {thinking && !recording ? '◌' : recording ? '⏹' : '🎤'}
    </button>
  )
}
