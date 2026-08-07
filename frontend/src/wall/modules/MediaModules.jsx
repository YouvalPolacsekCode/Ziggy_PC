// Camera + media-player modules.
//
// Both are capability-gated: a wall tablet in a hallway showing a live nursery
// feed to anyone who walks past is a privacy decision, not a default. Cameras
// are off in the default policy and PIN-gated when enabled.

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { deviceFacts } from '../../lib/devices'
import { useT, useTranslatedName } from '../../lib/i18n'
import { getCameras, cameraSnapshotUrl, callHaService } from '../../lib/api'

// ─── Camera ─────────────────────────────────────────────────────────────────
// Periodic snapshots rather than a live stream: a wall tablet holding an open
// RTSP/HLS connection for weeks is the single fastest way to cook its battery
// and leak memory. A refreshing still is what this surface actually needs.

export const CameraModule = memo(function CameraModule({ mod, ctx }) {
  const t = useT()
  const [cameras, setCameras] = useState([])
  const [tick, setTick] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let dead = false
    getCameras()
      .then((r) => { if (!dead) setCameras(r?.cameras || r || []) })
      .catch(() => {})
    return () => { dead = true }
  }, [])

  // Cache-bust every 10s. Slow enough to be gentle on the hub, fast enough
  // that "who's at the door" is answered by looking up, not by tapping.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000)
    return () => clearInterval(id)
  }, [])

  const cam = useMemo(() => {
    const list = Array.isArray(cameras) ? cameras : []
    return list.find((c) => (c.entity_id || c.id) === mod.config?.entity_id) || list[0]
  }, [cameras, mod.config?.entity_id])

  const entityId = cam?.entity_id || cam?.id

  if (!entityId) {
    return (
      <>
        <div className="zw-card-head"><span className="zw-eyebrow">{t('wall.mod.cameras')}</span></div>
        <div className="zw-card"><div className="zw-empty">—</div></div>
      </>
    )
  }

  return (
    <>
      <div className="zw-card-head">
        <span className="zw-eyebrow">{cam.name || t('wall.mod.cameras')}</span>
      </div>
      <div className="zw-card" style={{ position: 'relative' }}>
        {failed
          ? <div className="zw-empty" style={{ margin: 'auto' }}>{t('wall.dev.offline')}</div>
          : (
            <img
              src={`${cameraSnapshotUrl(entityId)}?t=${tick}`}
              alt={cam.name || entityId}
              onError={() => setFailed(true)}
              onLoad={() => setFailed(false)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
      </div>
    </>
  )
})

// ─── Media player ───────────────────────────────────────────────────────────

export const MediaModule = memo(function MediaModule({ mod, ctx }) {
  const t = useT()
  const entities = useDeviceStore((s) => s.entities)

  const facts = useMemo(() => {
    const players = entities.filter((e) => (e.domain || e.entity_id?.split('.')[0]) === 'media_player')
    const chosen = players.find((e) => e.entity_id === mod.config?.entity_id)
      // Default to whatever is actually playing — on a wall you want the thing
      // making noise right now, not alphabetical order.
      || players.find((e) => e.state === 'playing')
      || players[0]
    return chosen ? deviceFacts(chosen) : null
  }, [entities, mod.config?.entity_id])

  // Hooks must run unconditionally, so this sits above the early return.
  const playerName = useTranslatedName(facts?.name || '')

  const cmd = useCallback((service) => ctx.guard('media', async () => {
    try { await callHaService('media_player', service, { entity_id: facts.id }) }
    catch (e) { ctx.toast?.(e?.userMessage || t('wall.err.command'), 'err') }
  }), [facts, ctx, t])

  if (!facts) {
    return (
      <>
        <div className="zw-card-head"><span className="zw-eyebrow">{t('wall.mod.media')}</span></div>
        <div className="zw-card"><div className="zw-empty">—</div></div>
      </>
    )
  }

  const title = facts.entity?.media_title || playerName
  const sub   = facts.entity?.media_artist || facts.stateLabel
  const playing = facts.state === 'playing'

  return (
    <>
      <div className="zw-card-head"><span className="zw-eyebrow">{playerName}</span></div>
      <div className="zw-card">
        <div className="zw-card-body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 16, gap: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 'clamp(13px,1.2vw,16px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sub}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
            <button className="zw-step" onClick={() => cmd('media_previous_track')}>‹</button>
            <button className="zw-step" onClick={() => cmd(playing ? 'media_pause' : 'media_play')}>
              {playing ? '⏸' : '▶'}
            </button>
            <button className="zw-step" onClick={() => cmd('media_next_track')}>›</button>
          </div>
        </div>
      </div>
    </>
  )
})
