/**
 * TVRemote — one unified TV/media remote that works for:
 *   - Pure IR devices (learned codeset, no HA entity)
 *   - Pure HA media_player (network/Cast/etc., no IR)
 *   - Hybrid (HA media_player with linked IR codeset — common for smart TVs
 *     where HA exposes app/source list but power & HDMI need IR)
 *
 * Every capability is gated on `facts.capabilities` so unsupported buttons
 * simply don't appear. There is no IR-vs-HA conditional rendering — the
 * abstraction lives in `sendDeviceCommand`.
 */

import { useState, useEffect, useRef } from 'react'
import {
  Power, Volume2, VolumeX, ChevronLeft, ChevronRight,
  ChevronUp, ChevronDown, Home, Menu, Tv2, ListVideo, Hash,
} from 'lucide-react'
import { deviceFacts, sendDeviceCommand } from '../../../lib/devices'
import { useUIStore } from '../../../stores/uiStore'

export function TVRemote({ entity }) {
  const addToast = useUIStore((s) => s.addToast)
  const facts = deviceFacts(entity)
  const caps  = facts.capabilities
  const [channelInput, setChannelInput] = useState('')

  const fire = async (cmd, params) => {
    try { await sendDeviceCommand(entity, cmd, params) }
    catch (e) { addToast(e.message || 'Command failed', 'error') }
  }

  const sources = facts.sourceList?.length
    ? facts.sourceList
    : facts.isIr || facts.linkedIr
      ? extractIrSources(facts.linkedIr)
      : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Now-playing card */}
      <NowPlayingCard facts={facts} />

      {/* Power / Mute / Source row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <BigButton label="Power" onClick={() => fire('toggle')} tone="err" disabled={!caps.has('power')}>
          <Power size={18} strokeWidth={2} />
        </BigButton>
        <BigButton label={facts.muted ? 'Unmute' : 'Mute'} onClick={() => fire('mute_toggle', { muted: !facts.muted })} disabled={!caps.has('mute')}>
          {facts.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </BigButton>
        <BigButton label="Source" onClick={() => fire('next_source')} disabled={!sources.length && !caps.has('sources')}>
          <ListVideo size={18} />
        </BigButton>
      </div>

      {/* D-pad — always rendered, replaces the play/pause/skip transport
          row entirely. Individual buttons grey out when the device doesn't
          expose the navigation command (HA media_player without IR). */}
      <DPad fire={fire} caps={caps} />

      {/* Back / Home / Menu — always rendered, greyed out when unsupported. */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <PillBtn onClick={() => fire('back')} disabled={!caps.has('back')}><ChevronLeft size={13} /> Back</PillBtn>
        <PillBtn onClick={() => fire('home')} disabled={!caps.has('home')}><Home size={13} /> Home</PillBtn>
        <PillBtn onClick={() => fire('menu')} disabled={!caps.has('menu')}><Menu size={13} /> Menu</PillBtn>
      </div>

      {/* Volume / Channel — always step spinners. Vol uses HA volume_up /
          volume_down when available, falls back to IR step. Channel is
          IR-only; greys out for pure HA media_players. */}
      <VolChSpinners facts={facts} fire={fire} caps={caps} />

      {/* Sources / inputs */}
      {(sources?.length > 0) && (
        <div>
          <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>Source</span>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }} className="scrollbar-thin">
            {sources.map((s) => {
              const isSrcStr = typeof s === 'string'
              const label = isSrcStr ? s : s.label
              const cmd   = isSrcStr ? s : s.cmd
              const active = facts.source === label
              return (
                <button
                  key={cmd}
                  onClick={() => fire('set_source', { source: cmd })}
                  style={{
                    padding: '8px 12px', borderRadius: 10, flexShrink: 0,
                    background: active ? 'var(--ink)' : 'var(--surface)',
                    color: active ? 'var(--bg)' : 'var(--ink-2)',
                    border: '0.5px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
                    fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                    textTransform: 'capitalize',
                  }}
                >{label.replace?.(/_/g, ' ') ?? label}</button>
              )
            })}
          </div>
        </div>
      )}

      {/* Sound mode */}
      {caps.has('sound_mode') && facts.soundModeList?.length > 0 && (
        <ChipRow label="Sound" items={facts.soundModeList} current={facts.soundMode} onPick={(m) => fire('set_sound_mode', { mode: m })} />
      )}

      {/* Numpad → channel entry */}
      {caps.has('numpad') && (
        <ChannelEntry value={channelInput} onChange={setChannelInput} onSubmit={(n) => fire('send_channel', { channel: n })} />
      )}

      {/* Shuffle / repeat */}
      {(caps.has('shuffle') || caps.has('repeat')) && (
        <div style={{ display: 'flex', gap: 8 }}>
          {caps.has('shuffle') && (
            <PillBtn onClick={() => fire('set_shuffle', { shuffle: !facts.shuffle })} active={facts.shuffle}>Shuffle</PillBtn>
          )}
          {caps.has('repeat') && (
            <PillBtn onClick={() => fire('set_repeat', { repeat: facts.repeat === 'off' ? 'all' : 'off' })} active={facts.repeat && facts.repeat !== 'off'}>
              Repeat
            </PillBtn>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Building blocks ────────────────────────────────────────────────────────

function NowPlayingCard({ facts }) {
  const title = facts.mediaTitle || facts.source || facts.name
  const subtitle = facts.mediaArtist || (facts.isOn ? facts.stateLabel : 'Off')
  return (
    <div className="z-card" style={{
      padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, borderRadius: 14,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9, background: 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)',
      }}>
        <Tv2 size={20} strokeWidth={1.6} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
          {subtitle}{facts.isIr ? ' · IR' : facts.linkedIr ? ' · IR + WiFi' : ''}
        </div>
      </div>
      <span className={facts.isOn ? 'z-dot z-dot-on' : 'z-dot'} style={facts.isOn ? {} : { background: 'var(--ink-ghost)' }} />
    </div>
  )
}

function BigButton({ children, label, onClick, tone, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="z-card"
      style={{
        padding: '14px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
        background: 'var(--surface)', borderRadius: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        color: tone === 'err' ? 'var(--err)' : 'var(--ink-2)',
        fontFamily: 'inherit',
      }}
    >
      {children}
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--ink-2)' }}>{label}</span>
    </button>
  )
}


function VolChSpinners({ facts, fire, caps }) {
  // Vol value: prefer the real HA-reported volume when present, else local
  // optimistic counter. Ch is local-only (no canonical attribute).
  const haVol  = facts.volume
  const volTouched = useRef(false)
  const [volLocal, setVolLocal] = useState(haVol ?? 24)
  const [chLocal, setChLocal]   = useState(1)
  useEffect(() => {
    if (haVol == null) return
    if (!volTouched.current) setVolLocal(haVol)
  }, [haVol])

  // Always render both spinners in a 2-col grid (design layout). Either
  // greys out when the device doesn't expose the underlying command.
  const volEnabled = caps.has('volume') || caps.has('volume_step')
  const chEnabled  = caps.has('channel_step')

  const bumpVol = (dir) => {
    volTouched.current = true
    setVolLocal(v => Math.max(0, Math.min(100, v + dir)))
    fire(dir > 0 ? 'volume_up' : 'volume_down')
  }
  const bumpCh = (dir) => {
    setChLocal(v => Math.max(1, v + dir))
    fire(dir > 0 ? 'channel_up' : 'channel_down')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <Spinner label="Vol" value={volEnabled ? volLocal : null} disabled={!volEnabled}
        onUp={() => bumpVol(+1)} onDown={() => bumpVol(-1)} />
      <Spinner label="Ch" value={chEnabled ? chLocal : null} disabled={!chEnabled}
        onUp={() => bumpCh(+1)} onDown={() => bumpCh(-1)} />
    </div>
  )
}

function DPad({ fire, caps }) {
  const dpadEnabled = caps.has('dpad')
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div className="z-card" style={{
        width: 200, height: 200, borderRadius: '50%',
        position: 'relative', background: 'var(--surface)',
      }}>
        {/* Centered OK — big black puck dominating the dial, design-matched */}
        <button
          onClick={() => fire('nav_ok')}
          disabled={!dpadEnabled}
          style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 108, height: 108, borderRadius: '50%',
            background: 'var(--ink)', color: 'var(--bg)', border: 'none',
            fontSize: 16, fontWeight: 700, letterSpacing: '0.02em',
            boxShadow: dpadEnabled ? 'var(--shadow-md)' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: dpadEnabled ? 'pointer' : 'not-allowed',
            opacity: dpadEnabled ? 1 : 0.28,
          }}
        >OK</button>
        {/* Chevrons at the four cardinal edges, between the OK puck and the white rim */}
        {[
          { dir: 'up',    cmd: 'nav_up',    style: { top: 12, left: '50%', transform: 'translateX(-50%)' }, Icon: ChevronUp },
          { dir: 'down',  cmd: 'nav_down',  style: { bottom: 12, left: '50%', transform: 'translateX(-50%)' }, Icon: ChevronDown },
          { dir: 'left',  cmd: 'nav_left',  style: { left: 12, top: '50%', transform: 'translateY(-50%)' }, Icon: ChevronLeft },
          { dir: 'right', cmd: 'nav_right', style: { right: 12, top: '50%', transform: 'translateY(-50%)' }, Icon: ChevronRight },
        ].map(({ dir, cmd, style, Icon }) => (
          <button
            key={dir} onClick={() => fire(cmd)} aria-label={dir} disabled={!dpadEnabled}
            style={{
              position: 'absolute', background: 'none', border: 'none',
              color: 'var(--ink-mute)', padding: 6, lineHeight: 0,
              cursor: dpadEnabled ? 'pointer' : 'not-allowed',
              opacity: dpadEnabled ? 1 : 0.3,
              ...style,
            }}
          ><Icon size={20} strokeWidth={2} /></button>
        ))}
      </div>
    </div>
  )
}

function PillBtn({ children, onClick, active, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 14px', borderRadius: 10,
      background: active ? 'var(--ink)' : 'var(--surface)',
      color: active ? 'var(--bg)' : 'var(--ink-2)',
      border: '0.5px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
      fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.35 : 1,
    }}>{children}</button>
  )
}

function Spinner({ label, value, onUp, onDown, disabled }) {
  return (
    <div className="z-card" style={{
      padding: '14px 0', borderRadius: 16, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 110,
      opacity: disabled ? 0.4 : 1,
    }}>
      <button onClick={onUp} disabled={disabled} style={spinnerBtn(disabled)} aria-label={`${label} up`}>
        <ChevronUp size={18} strokeWidth={2} />
      </button>
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
        {label}{value != null ? ` ${value}` : ''}
      </span>
      <button onClick={onDown} disabled={disabled} style={spinnerBtn(disabled)} aria-label={`${label} down`}>
        <ChevronDown size={18} strokeWidth={2} />
      </button>
    </div>
  )
}
function spinnerBtn(disabled) {
  return {
    background: 'none', border: 'none', color: 'var(--ink-2)', padding: 4,
    cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex',
  }
}

function ChipRow({ label, items, current, onPick }) {
  return (
    <div>
      <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {items.map((m) => (
          <button key={m} onClick={() => onPick(m)} style={{
            padding: '7px 12px', borderRadius: 9, fontSize: 11.5, fontWeight: 500,
            background: current === m ? 'var(--ink)' : 'var(--surface-2)',
            color:      current === m ? 'var(--bg)'  : 'var(--ink-2)',
            border: '0.5px solid ' + (current === m ? 'var(--ink)' : 'var(--line)'),
            cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
          }}>{m.replace(/_/g, ' ')}</button>
        ))}
      </div>
    </div>
  )
}

function ChannelEntry({ value, onChange, onSubmit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '0.5px solid var(--line)' }}>
      <Hash size={14} style={{ color: 'var(--ink-faint)' }} />
      <span className="z-eyebrow" style={{ flexShrink: 0 }}>Channel</span>
      <input
        type="number" min={0} max={9999} value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
        onKeyDown={(e) => e.key === 'Enter' && value && onSubmit(parseInt(value, 10))}
        placeholder="12" className="z-input"
        style={{ height: 36, padding: '0 12px', flex: 1, fontSize: 13 }}
      />
      <button onClick={() => value && onSubmit(parseInt(value, 10))}
        className="z-btn-primary" style={{ padding: '0 16px', height: 36, borderRadius: 10, flexShrink: 0 }}>Go</button>
    </div>
  )
}

// Extract source command list from a linked IR device's learned commands.
// Surfaces HDMI inputs and named input commands as picker entries.
function extractIrSources(ir) {
  if (!ir) return []
  const learned = new Set(ir.learned_commands || [])
  const result = []
  for (const c of learned) {
    if (c.startsWith('hdmi_') || c.startsWith('source_') || c === 'input') {
      result.push({ label: c.replace(/^source_/, '').replace(/_/g, ' '), cmd: c })
    }
  }
  return result
}

export default TVRemote
