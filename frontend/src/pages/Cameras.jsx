import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, RefreshCw } from 'lucide-react'
import { useCameraStore, cameraSnapshotUrl, cameraStreamUrl } from '../stores/cameraStore'

const SNAPSHOT_INTERVAL_MS = 10_000

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(isoStr).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function friendlyName(entityId) {
  return entityId.split('.')[1]?.replace(/_/g, ' ') ?? entityId
}

// ── Camera snapshot thumbnail with auto-refresh ───────────────────────────────

function CameraCard({ camera, onExpand, motionEvents }) {
  const [tick, setTick]     = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [error, setError]   = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      setTick(t => t + 1)
      setLoaded(false)
      setError(false)
    }, SNAPSHOT_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  const src = `${cameraSnapshotUrl(camera.entity_id)}?t=${tick}`
  const lastMotion = motionEvents.find(
    e => e.entity_id === camera.entity_id ||
         e.entity_id.includes(friendlyName(camera.entity_id).replace(/ /g, '_'))
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        borderRadius: 14,
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          position: 'relative',
          aspectRatio: '16 / 9',
          background: 'var(--bg-2)',
          cursor: 'pointer',
        }}
        onClick={() => onExpand(camera)}
      >
        {!error ? (
          <img
            key={tick}
            src={src}
            alt={camera.name}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover',
              display: 'block',
              opacity: loaded ? 1 : 0,
              transition: 'opacity 0.2s',
            }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 6,
            color: 'var(--ink-faint)', fontSize: 12,
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
            <span>No feed</span>
          </div>
        )}

        {/* Overlay buttons */}
        {loaded && (
          <button
            onClick={e => { e.stopPropagation(); onExpand(camera) }}
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 28, height: 28, borderRadius: 7,
              background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
            }}
            title="Go live"
          >
            <Maximize2 size={13} />
          </button>
        )}

        {/* Motion badge */}
        {lastMotion && (
          <div style={{
            position: 'absolute', bottom: 8, left: 8,
            padding: '2px 8px', borderRadius: 999,
            background: 'rgba(239,68,68,0.85)', color: '#fff',
            fontSize: 10, fontWeight: 600,
            fontFamily: '"IBM Plex Mono", monospace',
          }}>
            motion · {timeAgo(lastMotion.timestamp)}
          </div>
        )}
      </div>

      {/* Caption */}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {camera.name}
          </p>
          <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 1 }}>
            {camera.state}
          </p>
        </div>
        <button
          onClick={() => { setTick(t => t + 1); setLoaded(false); setError(false) }}
          style={{ padding: 5, borderRadius: 7, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', display: 'flex' }}
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>
    </motion.div>
  )
}

// ── Live stream modal ─────────────────────────────────────────────────────────

function LiveModal({ camera, onClose }) {
  const imgRef = useRef(null)

  // Disconnect the MJPEG stream when the modal closes to free the connection
  useEffect(() => {
    return () => {
      if (imgRef.current) imgRef.current.src = ''
    }
  }, [])

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.88)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}
        onClick={onClose}
      >
        <div
          style={{ position: 'relative', width: '90vw', maxWidth: 960 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Live MJPEG — browser holds connection open natively */}
          <img
            ref={imgRef}
            src={cameraStreamUrl(camera.entity_id)}
            alt={camera.name}
            style={{
              width: '100%',
              borderRadius: 14,
              display: 'block',
              background: '#111',
              minHeight: 240,
            }}
          />

          {/* Overlay */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
            borderRadius: '14px 14px 0 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{camera.name}</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: '"IBM Plex Mono", monospace' }}>LIVE</span>
            </div>
            <button
              onClick={onClose}
              style={{ padding: 6, borderRadius: 8, background: 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Motion event log ──────────────────────────────────────────────────────────

function MotionLog({ events }) {
  if (events.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '12px 0' }}>
        No motion events in the last 24 hours.
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {events.slice(0, 50).map((ev, i) => (
        <div
          key={`${ev.entity_id}-${ev.timestamp}-${i}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 0',
            borderBottom: i < Math.min(events.length, 50) - 1 ? '0.5px solid var(--line)' : 'none',
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: ev.type === 'camera' ? '#3b82f6' : '#ef4444',
          }} />
          <span style={{ flex: 1, fontSize: 12, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ev.name || friendlyName(ev.entity_id)}
          </span>
          <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', flexShrink: 0 }}>
            {timeAgo(ev.timestamp)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Cameras() {
  const navigate = useNavigate()
  const { cameras, motionEvents, fetchCameras, fetchMotionHistory } = useCameraStore()
  const [liveCamera, setLiveCamera] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchCameras(), fetchMotionHistory(24)]).finally(() => setLoading(false))
  }, [])

  const handleExpand = useCallback((camera) => setLiveCamera(camera), [])
  const handleClose  = useCallback(() => setLiveCamera(null), [])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(16px, 3vw, 36px)', paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 14, borderBottom: '0.5px solid var(--line)' }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 3 }}>Overview</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>Security</h1>
        </div>
        {cameras.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
            {cameras.length} camera{cameras.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 28 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)', aspectRatio: '16/9', opacity: 0.5 }} />
          ))}
        </div>
      )}

      {/* No cameras */}
      {!loading && cameras.length === 0 && (
        <div style={{
          padding: '48px 24px', borderRadius: 14, background: 'var(--surface)',
          border: '0.5px solid var(--line)', textAlign: 'center', marginBottom: 28,
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>No cameras found</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
            Add <code style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11 }}>camera.*</code> entities in Home Assistant, then add them to a Ziggy room.
          </p>
        </div>
      )}

      {/* Camera grid */}
      {!loading && cameras.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
            marginBottom: 28,
          }}
        >
          {cameras.map(cam => (
            <CameraCard
              key={cam.entity_id}
              camera={cam}
              onExpand={handleExpand}
              motionEvents={motionEvents}
            />
          ))}
        </div>
      )}

      {/* Motion log */}
      <div style={{ padding: '14px 16px', borderRadius: 13, background: 'var(--surface)', border: '0.5px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p className="z-eyebrow">Motion log · last 24h</p>
          <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
            {motionEvents.length} event{motionEvents.length !== 1 ? 's' : ''}
          </span>
        </div>
        <MotionLog events={motionEvents} />
      </div>

      {/* Live stream modal */}
      {liveCamera && <LiveModal camera={liveCamera} onClose={handleClose} />}
    </div>
  )
}
