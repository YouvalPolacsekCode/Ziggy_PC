import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, RefreshCw, CameraOff } from 'lucide-react'
import { useCameraStore, cameraSnapshotUrl, cameraStreamUrl } from '../stores/cameraStore'
import { useT, t as i18nT } from '../lib/i18n'
import { T_ENTER, T_STATE } from '../lib/motion'

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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={T_ENTER}
      style={{
        borderRadius: 'var(--r-card)',
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
              transition: 'opacity var(--dur-state) var(--ease-standard)',
            }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
            color: 'var(--ink-mute)', fontSize: 13, lineHeight: '20px',
          }}>
            <CameraOff size={28} strokeWidth={1.75} aria-hidden style={{ color: 'var(--ink-faint)' }} />
            <span>{i18nT('cameras.noFeed')}</span>
          </div>
        )}

        {/* Overlay buttons */}
        {loaded && (
          <button
            onClick={e => { e.stopPropagation(); onExpand(camera) }}
            style={{
              position: 'absolute', top: 8, insetInlineEnd: 8,
              width: 40, height: 40, borderRadius: 'var(--r-ctl)',
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
            }}
            title={i18nT('cameras.goLive')}
            aria-label={i18nT('cameras.goLive')}
          >
            <Maximize2 size={20} strokeWidth={1.75} />
          </button>
        )}

        {/* Motion badge */}
        {lastMotion && (
          <div className="z-mono" style={{
            position: 'absolute', bottom: 8, insetInlineStart: 8,
            padding: '2px 8px', borderRadius: 999,
            background: 'var(--err)', color: 'var(--on-accent)',
            fontSize: 11, lineHeight: '13px', fontWeight: 500,
          }}>
            {i18nT('cameras.motionAt', { time: timeAgo(lastMotion.timestamp) })}
          </div>
        )}
      </div>

      {/* Caption */}
      <div style={{ padding: '8px 8px 8px 16px', minHeight: 48, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {camera.name}
          </p>
          <p className="z-footnote z-mono" style={{ marginTop: 2 }}>
            {camera.state}
          </p>
        </div>
        <button
          onClick={() => { setTick(t => t + 1); setLoaded(false); setError(false) }}
          className="z-icon-btn"
          style={{ background: 'transparent', border: 'none' }}
          title={i18nT('common.refresh')}
          aria-label={i18nT('common.refresh')}
        >
          <RefreshCw size={20} strokeWidth={1.75} />
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
        transition={T_STATE}
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
              borderRadius: 'var(--r-card)',
              display: 'block',
              background: 'rgba(0,0,0,0.6)',
              minHeight: 240,
            }}
          />

          {/* Overlay */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
            borderRadius: 'var(--r-card) var(--r-card) 0 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ color: '#fff', fontSize: 15, lineHeight: '22px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{camera.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, lineHeight: '13px', fontWeight: 500, flexShrink: 0 }}>
                <span className="z-dot" style={{ background: 'var(--err)' }} />
                {i18nT('cameras.liveBadge')}
              </span>
            </div>
            <button
              onClick={onClose}
              aria-label={i18nT('common.close')}
              style={{ width: 40, height: 40, borderRadius: 'var(--r-ctl)', background: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <X size={20} strokeWidth={1.75} />
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
      <p className="z-subhead" style={{ padding: '12px 0' }}>
        {i18nT('cameras.noMotion')}
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {events.slice(0, 50).map((ev, i) => (
        <div
          key={`${ev.entity_id}-${ev.timestamp}-${i}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            minHeight: 40, padding: '8px 0',
            borderBottom: i < Math.min(events.length, 50) - 1 ? '0.5px solid var(--line)' : 'none',
          }}
        >
          <span className="z-dot" style={{ flexShrink: 0, background: ev.type === 'camera' ? 'var(--info)' : 'var(--err)' }} />
          <span style={{ flex: 1, fontSize: 13, lineHeight: '20px', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ev.name || friendlyName(ev.entity_id)}
          </span>
          <span className="z-footnote z-mono" style={{ flexShrink: 0 }}>
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
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>

      {/* Header */}
      <div className="z-page-head">
        <div>
          <p className="z-eyebrow">{i18nT('cameras.overview')}</p>
          <h1 className="z-display">{i18nT('cameras.security')}</h1>
        </div>
        {cameras.length > 0 && (
          <span className="z-footnote z-mono" style={{ marginTop: 8, flexShrink: 0 }}>
            {i18nT(cameras.length === 1 ? 'cameras.countOne' : 'cameras.count', { n: cameras.length })}
          </span>
        )}
      </div>

      {/* Loading — skeleton only on cold start; cached cameras stay visible */}
      {loading && cameras.length === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '0.5px solid var(--line)', aspectRatio: '16/9' }} />
          ))}
        </div>
      )}

      {/* No cameras */}
      {!loading && cameras.length === 0 && (
        <div className="z-card" style={{ padding: 32, textAlign: 'center', marginBottom: 24 }}>
          <p className="z-body" style={{ fontWeight: 600, marginBottom: 8 }}>{i18nT('cameras.notFound')}</p>
          <p className="z-subhead">
            {i18nT('cameras.notFoundHelp1')} <code className="z-code">camera.*</code> {i18nT('cameras.notFoundHelp2')}
          </p>
        </div>
      )}

      {/* Camera grid */}
      {cameras.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
            marginBottom: 24,
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
      <div className="z-card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <p className="z-eyebrow">{i18nT('cameras.motionLog24h')}</p>
          <span className="z-footnote z-mono">
            {i18nT(motionEvents.length === 1 ? 'cameras.event' : 'cameras.events', { n: motionEvents.length })}
          </span>
        </div>
        <MotionLog events={motionEvents} />
      </div>

      {/* Live stream modal */}
      {liveCamera && <LiveModal camera={liveCamera} onClose={handleClose} />}
    </div>
  )
}
