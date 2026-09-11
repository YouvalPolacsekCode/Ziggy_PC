/**
 * MediaTransportRemote — focused player UI for streamer-style devices.
 *
 * Why this exists
 * ---------------
 * TVRemote is structured around a physical-remote metaphor: power, d-pad,
 * back/home/menu, source picker. That's right for a TV (you're navigating
 * a real OS). It's wrong for a Cast / Chromecast / Fire TV stick / NVIDIA
 * Shield style device where:
 *   - There's no usable nav (HA media_player has none, no paired remote.*,
 *     no vendor adapter for the device's app shell).
 *   - The device is rich with media metadata (active title, art, position,
 *     duration, app branding).
 *   - What the user actually wants is media transport: pause that show,
 *     scrub forward, next episode, volume.
 *
 * Dispatcher: DeviceRemote.jsx routes a TV-kind entity to this component
 * when it looks like a "media app device" (has app_name, no big source
 * list, no vendor adapter). Devices that ARE proper TVs (LG webOS, full
 * source_list, etc.) stay on TVRemote and get the full remote scaffolding.
 */

import { useEffect, useRef, useState } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, Square, Power, Volume2, VolumeX,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Home, Menu,
} from 'lucide-react'
import { deviceFacts, sendDeviceCommand, commandAvailable } from '../../../lib/devices'
import { DeviceIcon } from '../../../lib/deviceIcons'
import { useUIStore } from '../../../stores/uiStore'
import { usePairedRemoteEntityId, makeFireSmart, navAvailable } from '../../../lib/remoteNav'
import { useT, t as i18nT } from '../../../lib/i18n'


function _fmtSec(s) {
  if (!Number.isFinite(s) || s < 0) return '–:––'
  const total = Math.floor(s)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const pad = (n) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}


// HA reports media_position as a snapshot taken at media_position_updated_at.
// Between WS pushes, the player keeps playing — so we extrapolate locally
// to keep the scrub bar ticking smoothly. Returns the inferred current
// position in seconds. Falls back to the raw snapshot when state isn't
// playing or any required field is missing.
function _livePosition(entity) {
  const attrs = entity?.attributes || entity || {}
  const pos = attrs.media_position
  const updatedAt = attrs.media_position_updated_at
  if (pos == null) return null
  if (entity?.state !== 'playing' || !updatedAt) return pos
  const updatedMs = new Date(updatedAt).getTime()
  if (!Number.isFinite(updatedMs)) return pos
  const elapsedMs = Date.now() - updatedMs
  return pos + Math.max(0, elapsedMs / 1000)
}


export function MediaTransportRemote({ entity }) {
  const addToast = useUIStore((s) => s.addToast)
  const facts = deviceFacts(entity)
  const attrs = entity?.attributes || entity || {}
  // Paired HA `remote.*` entity (Apple TV, Android TV, Fire TV, …). When
  // present, the OS-nav section (d-pad + back/home) lights up so users
  // can drive the app shell from Ziggy. Hidden entirely when no nav
  // backend exists (the no-paired-remote case for plain Chromecasts —
  // installing HA's androidtv_remote integration would create one).
  const pairedRemoteId = usePairedRemoteEntityId(entity)

  const fire = async (cmd, params) => {
    try { await sendDeviceCommand(entity, cmd, params) }
    catch (e) { addToast(e.message || i18nT('remote.commandFailed'), 'error') }
  }
  const fireSmart = makeFireSmart({ entity, fire, pairedRemoteId, addToast })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <NowPlayingHero entity={entity} attrs={attrs} facts={facts} />
      <ScrubBar entity={entity} attrs={attrs} fire={fire} />
      <TransportRow entity={entity} fire={fire} state={entity?.state} />
      <OsNavSection entity={entity} pairedRemoteId={pairedRemoteId} fireSmart={fireSmart} />
      <VolumeRow entity={entity} attrs={attrs} fire={fire} />
      <PowerPill entity={entity} facts={facts} fire={fire} />
    </div>
  )
}


// ─── OS-nav section ─────────────────────────────────────────────────────────
// Compact d-pad + back/home/menu pills. Sized smaller than TVRemote's
// 200×200 dial because the MediaTransport layout is already busy with the
// hero card and transport controls — a hero dial would dominate. Hidden
// entirely when no nav backend can fire anything (so plain Chromecasts
// don't show an inert puck).
function OsNavSection({ entity, pairedRemoteId, fireSmart }) {
  const okOk    = navAvailable(entity, pairedRemoteId, 'nav_ok')
  const upOk    = navAvailable(entity, pairedRemoteId, 'nav_up')
  const downOk  = navAvailable(entity, pairedRemoteId, 'nav_down')
  const leftOk  = navAvailable(entity, pairedRemoteId, 'nav_left')
  const rightOk = navAvailable(entity, pairedRemoteId, 'nav_right')
  const backOk  = navAvailable(entity, pairedRemoteId, 'back')
  const homeOk  = navAvailable(entity, pairedRemoteId, 'home')
  const menuOk  = navAvailable(entity, pairedRemoteId, 'menu')

  const dpadVisible = okOk || upOk || downOk || leftOk || rightOk
  const navVisible  = backOk || homeOk || menuOk
  if (!dpadVisible && !navVisible) return null

  return (
    <div className="z-card" style={{
      padding: 12, borderRadius: 16,
      display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center',
    }}>
      {dpadVisible && (
        <CompactDPad
          okOk={okOk} upOk={upOk} downOk={downOk} leftOk={leftOk} rightOk={rightOk}
          fireSmart={fireSmart}
        />
      )}
      {navVisible && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {backOk && <NavPill onClick={() => fireSmart('back')}><ChevronLeft size={18} strokeWidth={1.75} className="icon-flip-rtl" /> {i18nT('remote.back')}</NavPill>}
          {homeOk && <NavPill onClick={() => fireSmart('home')}><Home size={18} strokeWidth={1.75} /> {i18nT('remote.home')}</NavPill>}
          {menuOk && <NavPill onClick={() => fireSmart('menu')}><Menu size={18} strokeWidth={1.75} /> {i18nT('remote.menu')}</NavPill>}
        </div>
      )}
    </div>
  )
}


// Compact d-pad — 160px dial, 72px OK puck: the ring between them is exactly
// 44px, so each arrow is a full 44×44 target without overlapping the puck.
// Still smaller than TVRemote's 200px dial so it sits alongside the hero
// card + transport without dominating.
function CompactDPad({ okOk, upOk, downOk, leftOk, rightOk, fireSmart }) {
  const DIAL = 160
  const OK   = 72
  const ARROW = 44
  const ARROW_OFFSET = 0

  return (
    <div style={{
      width: DIAL, height: DIAL, borderRadius: '50%',
      position: 'relative',
      background: 'var(--surface-2)',
      border: '0.5px solid var(--line)',
    }}>
      <button
        onClick={() => okOk && fireSmart('nav_ok')}
        disabled={!okOk}
        aria-label={i18nT('remote.ok')}
        title={okOk ? '' : i18nT('remote.okNotAvailable')}
        style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: OK, height: OK, borderRadius: '50%',
          background: 'var(--ink)', color: 'var(--bg)', border: 'none',
          fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
          boxShadow: okOk ? 'var(--shadow-md)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: okOk ? 'pointer' : 'not-allowed',
          opacity: okOk ? 1 : 0.28, fontFamily: 'inherit',
        }}
      >{i18nT('remote.ok')}</button>
      {[
        { dir: 'up',    cmd: 'nav_up',    ok: upOk,    label: i18nT('remote.up'),    style: { top: ARROW_OFFSET, left: '50%', transform: 'translateX(-50%)' }, Icon: ChevronUp },
        { dir: 'down',  cmd: 'nav_down',  ok: downOk,  label: i18nT('remote.down'),  style: { bottom: ARROW_OFFSET, left: '50%', transform: 'translateX(-50%)' }, Icon: ChevronDown },
        { dir: 'left',  cmd: 'nav_left',  ok: leftOk,  label: i18nT('remote.left'),  style: { left: ARROW_OFFSET, top: '50%', transform: 'translateY(-50%)' }, Icon: ChevronLeft },
        { dir: 'right', cmd: 'nav_right', ok: rightOk, label: i18nT('remote.right'), style: { right: ARROW_OFFSET, top: '50%', transform: 'translateY(-50%)' }, Icon: ChevronRight },
      ].map(({ dir, cmd, ok, label, style, Icon }) => (
        <button
          key={dir} onClick={() => ok && fireSmart(cmd)} aria-label={label} disabled={!ok}
          title={ok ? '' : i18nT('remote.notAvailable', { name: label })}
          style={{
            position: 'absolute', background: 'none', border: 'none',
            width: ARROW, height: ARROW, borderRadius: '50%',
            color: 'var(--ink-mute)', padding: 0, lineHeight: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: ok ? 'pointer' : 'not-allowed',
            opacity: ok ? 1 : 0.3,
            ...style,
          }}
        ><Icon size={20} strokeWidth={1.75} /></button>
      ))}
    </div>
  )
}


function NavPill({ onClick, children }) {
  return (
    <button onClick={onClick} className="z-btn-secondary" style={{ padding: '0 16px', fontSize: 13 }}>
      {children}
    </button>
  )
}


// ─── Now-playing hero ───────────────────────────────────────────────────────
// Big card with the artwork, title, subtitle, and app badge. Falls back to a
// device-class icon when there's no art and no media playing — that way the
// card never reads as broken on an idle Cast device.

function NowPlayingHero({ entity, attrs, facts }) {
  const title    = attrs.media_title || facts.name || i18nT('remote.idle')
  const subtitle = attrs.media_artist
                || attrs.media_album_name
                || (facts.isOn ? facts.stateLabel : i18nT('common.off'))
  const app      = attrs.app_name
  // entity_picture is served by HA at /api/media_player_proxy/<eid>?token=…
  // It's a full path; we just point an <img> at it. Same-origin for tunneled
  // installs because HA serves the bytes through the same hostname.
  const art      = attrs.entity_picture || attrs.entity_picture_local || null

  return (
    <div className="z-card" style={{
      display: 'flex', flexDirection: 'column', gap: 16,
      padding: 12,
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        {/* Artwork or fallback — a plain surface-2 tile with the kind glyph,
            no tint: the artwork is the colour when there is any. */}
        <div style={{
          width: 76, height: 76, borderRadius: 'var(--r-ctl)',
          background: art ? 'var(--bg-2)' : 'var(--surface-2)',
          color: facts.isOn ? 'var(--ink)' : 'var(--ink-mute)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {art
            ? <img src={art} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <DeviceIcon kind={facts.kind} size={28} />}
        </div>

        {/* Title + subtitle + app badge */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {app && (
            <div className="z-caption" style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: 999,
              background: 'var(--surface-2)', color: 'var(--ink-mute)',
              marginBottom: 4,
            }}>{app}</div>
          )}
          <div dir="auto" style={{
            fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: '22px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{title}</div>
          {subtitle && (
            <div dir="auto" style={{
              fontSize: 13, color: 'var(--ink-mute)', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{subtitle}</div>
          )}
        </div>

        {/* On/off dot — same convention as the TVRemote's NowPlayingCard. */}
        <span className={facts.isOn ? 'z-dot z-dot-on' : 'z-dot'}
          style={facts.isOn ? {} : { background: 'var(--ink-faint)' }} />
      </div>
    </div>
  )
}


// ─── Scrub bar ──────────────────────────────────────────────────────────────
// Local-tick position so the bar moves between WS pushes (HA only reports
// `media_position` on transport events, not every second). Drag the slider
// to seek; release fires media_seek.

function ScrubBar({ entity, attrs, fire }) {
  const duration = Number(attrs.media_duration) || 0
  if (duration <= 0) return null

  const seekOk = commandAvailable(entity, 'media_seek') ||
                 (Number(attrs.supported_features) & 2) === 2   // SEEK bit
  const [draftPos, setDraftPos] = useState(null)        // user is scrubbing
  const [livePos, setLivePos]   = useState(() => _livePosition(entity) ?? 0)

  // Tick the live position once a second while playing so the bar moves.
  // Cheap: just one setState/sec, no network. We re-base off HA whenever
  // it pushes a new media_position_updated_at.
  useEffect(() => {
    if (entity?.state !== 'playing') {
      setLivePos(_livePosition(entity) ?? 0)
      return
    }
    const id = setInterval(() => setLivePos(_livePosition(entity) ?? 0), 1000)
    return () => clearInterval(id)
  }, [entity?.state, attrs.media_position, attrs.media_position_updated_at])

  const value = draftPos != null ? draftPos : livePos
  const pct   = duration > 0 ? Math.min(100, (value / duration) * 100) : 0

  const onSeek = (e) => {
    const v = Number(e.target.value)
    setDraftPos(v)
  }
  const commit = () => {
    if (draftPos == null) return
    if (seekOk) fire('media_seek', { position: draftPos })
    setDraftPos(null)
  }

  return (
    <div className="z-card" style={{ padding: 12 }}>
      <input
        type="range"
        min={0} max={duration} step={1}
        value={value}
        onChange={onSeek}
        onMouseUp={commit}
        onTouchEnd={commit}
        disabled={!seekOk}
        style={{
          width: '100%', height: 44, cursor: seekOk ? 'pointer' : 'not-allowed',
          accentColor: 'var(--ink)',
          opacity: seekOk ? 1 : 0.5,
        }}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 4,
        fontSize: 12, color: 'var(--ink-mute)',
        fontVariantNumeric: 'tabular-nums', }}>
        <span dir="ltr">{_fmtSec(value)}</span>
        <span dir="ltr">−{_fmtSec(Math.max(0, duration - value))}</span>
      </div>
      {!seekOk && (
        <div style={{ fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', marginTop: 4 }}>
          {i18nT('remote.seekNotSupported')}
        </div>
      )}
    </div>
  )
}


// ─── Transport row ──────────────────────────────────────────────────────────
// Big Prev / Play-Pause / Next. Stop on the side only when supported.

function TransportRow({ entity, fire, state }) {
  const playPauseOk = commandAvailable(entity, 'play_pause') ||
                      commandAvailable(entity, 'play') ||
                      commandAvailable(entity, 'pause')
  const prevOk = commandAvailable(entity, 'prev_track')
  const nextOk = commandAvailable(entity, 'next_track')
  const stopOk = commandAvailable(entity, 'stop')
  const isPlaying = state === 'playing'

  const btn = (children, label, onClick, ok, primary = false) => (
    <button
      onClick={() => ok && onClick()}
      disabled={!ok}
      aria-label={label}
      title={ok ? label : i18nT('remote.notSupported', { name: label })}
      style={{
        height: primary ? 64 : 52,
        width:  primary ? 64 : 52,
        borderRadius: '50%',
        background: primary ? 'var(--ink)' : 'var(--surface-2)',
        color: primary ? 'var(--bg)' : (ok ? 'var(--ink)' : 'var(--ink-faint)'),
        border: primary ? 'none' : '0.5px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: ok ? 'pointer' : 'not-allowed',
        opacity: ok ? 1 : 0.4,
        fontFamily: 'inherit',
        boxShadow: primary && ok ? 'var(--shadow-md)' : 'none',
        flexShrink: 0,
      }}
    >{children}</button>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      {btn(<SkipBack size={20} />, i18nT('remote.previousLabel'), () => fire('prev_track'), prevOk)}
      {btn(
        isPlaying ? <Pause size={26} /> : <Play size={26} style={{ marginLeft: 2 }} />,
        isPlaying ? i18nT('common.pause') : i18nT('common.play'),
        () => fire('play_pause'),
        playPauseOk,
        true,   // primary
      )}
      {btn(<SkipForward size={20} />, i18nT('remote.nextLabel'), () => fire('next_track'), nextOk)}
      {stopOk && btn(<Square size={16} />, i18nT('remote.stopLabel'), () => fire('stop'), stopOk)}
    </div>
  )
}


// ─── Volume row ─────────────────────────────────────────────────────────────
// Slider when set_volume is supported (most streamers), step buttons when
// only volume_up/down is, mute toggle alongside. Hides entirely if the
// player exposes neither.

function VolumeRow({ entity, attrs, fire }) {
  const setVolOk  = commandAvailable(entity, 'set_volume')
  const muteOk    = commandAvailable(entity, 'mute_toggle')
  const upOk      = commandAvailable(entity, 'volume_up')
  const downOk    = commandAvailable(entity, 'volume_down')
  if (!setVolOk && !upOk && !downOk && !muteOk) return null

  const haVol = Number(attrs.volume_level)
  const haVolPct = Number.isFinite(haVol) ? Math.round(haVol * 100) : null
  const isMuted = !!attrs.is_volume_muted

  // Optimistic local value while the slider is moving — HA's WS push lands
  // a moment after our service call, and showing a stale value mid-drag
  // makes the slider feel laggy.
  const touched = useRef(false)
  const [local, setLocal] = useState(haVolPct ?? 50)
  useEffect(() => {
    if (haVolPct == null) return
    if (!touched.current) setLocal(haVolPct)
  }, [haVolPct])

  const commit = (v) => {
    touched.current = true
    setLocal(v)
    if (setVolOk) fire('set_volume', { value: v })
  }
  const bumpStep = (dir) => {
    if (dir > 0 && upOk) fire('volume_up')
    if (dir < 0 && downOk) fire('volume_down')
  }

  return (
    <div className="z-card" style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 16px', minHeight: 48,
    }}>
      <button
        onClick={() => muteOk && fire('mute_toggle', { muted: !isMuted })}
        disabled={!muteOk}
        className="z-icon-btn"
        aria-pressed={isMuted}
        aria-label={isMuted ? i18nT('remote.unmute') : i18nT('remote.mute')}
        title={isMuted ? i18nT('remote.unmute') : i18nT('remote.mute')}
        style={{
          background: isMuted ? 'var(--ink)' : undefined,
          color: isMuted ? 'var(--bg)' : undefined,
          cursor: muteOk ? 'pointer' : 'not-allowed',
          opacity: muteOk ? 1 : 0.4,
        }}
      >{isMuted ? <VolumeX size={20} strokeWidth={1.75} /> : <Volume2 size={20} strokeWidth={1.75} />}</button>

      {setVolOk ? (
        <input
          type="range" min={0} max={100} step={1}
          value={local}
          onChange={(e) => setLocal(Number(e.target.value))}
          onMouseUp={(e) => commit(Number(e.currentTarget.value))}
          onTouchEnd={(e) => commit(Number(e.currentTarget.value))}
          aria-label={i18nT('remote.volumeHeading')}
          style={{ flex: 1, height: 44, accentColor: 'var(--ink)', cursor: 'pointer' }}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={() => bumpStep(-1)} disabled={!downOk}
            aria-label={i18nT('remote.volumeDown')}
            style={{ width: 64, height: 44, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)',
                     color: 'var(--ink-2)', border: '0.5px solid var(--line)', fontSize: 18,
                     cursor: downOk ? 'pointer' : 'not-allowed', opacity: downOk ? 1 : 0.4,
                     fontFamily: 'inherit' }}>−</button>
          <button onClick={() => bumpStep(+1)} disabled={!upOk}
            aria-label={i18nT('remote.volumeUp')}
            style={{ width: 64, height: 44, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)',
                     color: 'var(--ink-2)', border: '0.5px solid var(--line)', fontSize: 18,
                     cursor: upOk ? 'pointer' : 'not-allowed', opacity: upOk ? 1 : 0.4,
                     fontFamily: 'inherit' }}>+</button>
        </div>
      )}

      <span className="z-mono" style={{
        fontSize: 12, color: 'var(--ink-mute)', minWidth: 40, textAlign: 'end',
      }}>{setVolOk ? `${local}%` : (haVolPct != null ? `${haVolPct}%` : '')}</span>
    </div>
  )
}


// ─── Power pill — demoted from the TVRemote's BigButton ────────────────────
// A secondary capsule at the bottom of the layout: the play/pause puck is
// this remote's one inverted control. Hidden entirely when the device
// doesn't accept turn_on/turn_off (rare; most do).

function PowerPill({ entity, facts, fire }) {
  const powerOk = commandAvailable(entity, 'toggle')
  if (!powerOk) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <button
        onClick={() => fire('toggle')}
        className="z-btn-secondary"
        style={{ borderRadius: 999 }}
      >
        <Power size={18} strokeWidth={1.75} />
        {facts.isOn ? i18nT('remote.turnOff') : i18nT('remote.turnOn')}
      </button>
    </div>
  )
}


export default MediaTransportRemote
