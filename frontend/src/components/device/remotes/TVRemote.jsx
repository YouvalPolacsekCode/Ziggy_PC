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
  ChevronUp, ChevronDown, Home, Menu, Tv2, ListVideo, Hash, Zap,
} from 'lucide-react'
import { commandAvailable, deviceFacts, extrasForRemote, irLearned, sendDeviceCommand } from '../../../lib/devices'
import { bumpSourceUse, rankSources } from '../../../lib/sourceUsage'
import { findVendorAdapter, fireViaVendor, vendorSupports } from '../../../lib/mediaPlayerVendors'
import { callHaService } from '../../../lib/api'
import { usePairedRemoteEntityId, fireViaPairedRemote } from '../../../lib/remoteNav'
import { useT, t as i18nT } from '../../../lib/i18n'

// Commands rendered as first-class controls by TVRemote — excluded from
// the "Extras" row to avoid duplicates. Source/HDMI/sound chips are also
// consumed because they appear in dedicated rows when learned.
const TV_REMOTE_CONSUMES = new Set([
  'power', 'power_on', 'power_off',
  'volume_up', 'volume_down', 'mute',
  'channel_up', 'channel_down',
  'nav_up', 'nav_down', 'nav_left', 'nav_right', 'nav_ok', 'ok',
  'back', 'home', 'menu',
  'play', 'pause', 'play_pause', 'stop', 'next', 'previous', 'next_track', 'prev_track',
])
for (let i = 0; i <= 9; i++) TV_REMOTE_CONSUMES.add(`digit_${i}`)
TV_REMOTE_CONSUMES.add('digit_ok')
// Inputs / sources are surfaced via the source chip row.
for (let i = 1; i <= 5; i++) TV_REMOTE_CONSUMES.add(`hdmi_${i}`)
for (const s of ['source_tv', 'source_av', 'source_pc', 'input', 'input_hdmi',
  'input_optical', 'input_aux', 'input_bluetooth', 'input_tv', 'input_usb',
  'input_coax', 'input_tuner', 'input_phono', 'input_cd', 'input_streaming',
  'input_vga']) TV_REMOTE_CONSUMES.add(s)
import { useUIStore } from '../../../stores/uiStore'

export function TVRemote({ entity }) {
  const addToast = useUIStore((s) => s.addToast)
  const facts = deviceFacts(entity)
  const caps  = facts.capabilities
  const [view, setView] = useState('main')   // 'main' | 'numpad'
  // Paired HA remote.* entity (Apple TV, Android TV, Roku, LG webOS, …).
  // Lets nav buttons (back/home/menu/arrows) fire over WiFi when the
  // media_player domain doesn't expose them natively.
  const pairedRemoteId = usePairedRemoteEntityId(entity)

  const fire = async (cmd, params) => {
    try { await sendDeviceCommand(entity, cmd, params) }
    catch (e) { addToast(e.message || i18nT('remote.commandFailed'), 'error') }
  }

  // Numpad availability: enabled if any of (HA media_player digit service —
  // none today, IR codes learned, paired remote.send_command, vendor
  // adapter digit mapping) can fire 'digit_0'. We probe just one digit;
  // vendors that expose 0 expose them all in the same family.
  const numpadOk =
    commandAvailable(entity, 'digit_0') ||
    !!pairedRemoteId ||
    vendorSupports(entity, 'digit_0')

  // Unified dispatcher used by every nav-style button (NavRow, DPad,
  // NumPad). Same precedence as before: HA native → IR → paired remote.*
  // → vendor adapter.
  const fireSmart = (cmd) => {
    if (commandAvailable(entity, cmd)) return fire(cmd)
    if (pairedRemoteId)               return fireViaPairedRemote(pairedRemoteId, cmd, addToast)
    if (vendorSupports(entity, cmd))  return fireViaVendor(entity, cmd, callHaService).catch(e => addToast?.(e?.message || `${cmd} failed`, 'error'))
  }

  const sources = facts.sourceList?.length
    ? facts.sourceList
    : facts.isIr || facts.linkedIr
      ? extractIrSources(entity._irDevice || facts.linkedIr)
      : []

  // Discrete on/off — visible only when the user has explicitly learned
  // those codes. Toggle button still always works.
  const discreteOn  = irLearned(entity, 'power_on')
  const discreteOff = irLearned(entity, 'power_off')

  // Learned commands without dedicated UI — eco, sleep, settings, custom…
  const extras    = extrasForRemote(entity, TV_REMOTE_CONSUMES)

  // Numpad view — a dedicated alternative to the standard remote layout.
  // Now-Playing stays visible so the user keeps context. A "Back to
  // remote" pill at the bottom returns to the standard view (mirroring
  // the inline toggle pill in NavRow on the main view).
  if (view === 'numpad') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <NowPlayingCard facts={facts} />
        <NumPad fireSmart={fireSmart} />
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <PillBtn onClick={() => setView('main')}>
            <ChevronLeft size={18} strokeWidth={1.75} className="icon-flip-rtl" /> {i18nT('remote.backToRemote')}
          </PillBtn>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Now-playing card */}
      <NowPlayingCard facts={facts} />

      {/* Primary actions row. Grid auto-expands when the numpad toggle
          is in play — 3 BigButtons on devices without digit input, 4
          when it's available. Same square BigButton style for all so
          the numpad reads as a peer action, not an afterthought.
          `auto-fit` + minmax means the row collapses to 2×2 cleanly on
          narrow phone widths instead of squeezing the icons. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: numpadOk
          ? 'repeat(auto-fit, minmax(74px, 1fr))'
          : '1fr 1fr 1fr',
        gap: 8,
      }}>
        <BigButton label={i18nT('remote.power')} onClick={() => fire('toggle')} tone="err" disabled={!commandAvailable(entity, 'toggle')}>
          <Power size={20} strokeWidth={1.75} />
        </BigButton>
        <BigButton label={facts.muted ? i18nT('remote.unmute') : i18nT('remote.mute')} onClick={() => fire('mute_toggle', { muted: !facts.muted })} disabled={!commandAvailable(entity, 'mute_toggle')}>
          {facts.muted ? <VolumeX size={20} strokeWidth={1.75} /> : <Volume2 size={20} strokeWidth={1.75} />}
        </BigButton>
        <BigButton label={i18nT('remote.source')} onClick={() => fire('next_source')} disabled={!commandAvailable(entity, 'next_source') && !sources.length}>
          <ListVideo size={20} strokeWidth={1.75} />
        </BigButton>
        {numpadOk && (
          <BigButton label={i18nT('remote.numpad')} onClick={() => setView('numpad')}>
            <Hash size={20} strokeWidth={1.75} />
          </BigButton>
        )}
      </div>

      {/* Discrete Force On / Force Off — shown only when learned. Lets the
          user recover from drift in assumed_state by firing the raw code.
          The i18n strings carry a legacy ⚡ prefix; strip it and draw the
          bolt as a line icon instead. */}
      {(discreteOn || discreteOff) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {discreteOn && (
            <PillBtn onClick={() => fire('power_on')}><Zap size={18} strokeWidth={1.75} /> {stripBolt(i18nT('remote.forceOn'))}</PillBtn>
          )}
          {discreteOff && (
            <PillBtn onClick={() => fire('power_off')}><Zap size={18} strokeWidth={1.75} /> {stripBolt(i18nT('remote.forceOff'))}</PillBtn>
          )}
        </div>
      )}

      {/* D-pad — arrows enable when an IR code OR a paired remote.* entity
          can fire them. Pure-HA media_players with no paired remote hide
          the whole dial. */}
      <DPad entity={entity} fire={fire} pairedRemoteId={pairedRemoteId} addToast={addToast} />

      {/* Back / Home / Menu — same 4-path resolution as the D-pad.
          Numpad toggle lives in the top primary-actions row instead of
          here, where it reads as a peer of Power/Mute/Source rather
          than an extra nav verb. */}
      <NavRow
        entity={entity} fire={fire}
        pairedRemoteId={pairedRemoteId} addToast={addToast}
      />

      {/* Volume / Channel — step spinners. Per-direction disable. */}
      <VolChSpinners entity={entity} facts={facts} fire={fire} />

      {/* Sources / inputs — per-source disable for IR (HA always allowed).
          Streamer / Cast / Apple TV media_players can advertise *hundreds*
          of apps in source_list. Rendering every one on mount was a
          per-render block of work (button + commandAvailable call each)
          that made the page feel unresponsive on media_player.streamer
          and friends. Cap the first paint; the rest sit behind a toggle. */}
      <SourceRow sources={sources} facts={facts} entity={entity} fire={fire} />

      {/* Sound mode */}
      {caps.has('sound_mode') && facts.soundModeList?.length > 0 && (
        <ChipRow label={i18nT('remote.sound')} items={facts.soundModeList} current={facts.soundMode}
          isEnabled={(m) => commandAvailable(entity, 'set_sound_mode', { mode: m })}
          onPick={(m) => fire('set_sound_mode', { mode: m })} />
      )}

      {/* Numpad moved to a dedicated view — toggle via the corner icon at
          the top of the remote (renders only when digit input is
          supported by HA / IR / paired-remote / vendor adapter). */}

      {/* Shuffle / repeat */}
      {(caps.has('shuffle') || caps.has('repeat')) && (
        <div style={{ display: 'flex', gap: 8 }}>
          {caps.has('shuffle') && (
            <PillBtn onClick={() => fire('set_shuffle', { shuffle: !facts.shuffle })} active={facts.shuffle}>{i18nT('remote.shuffle')}</PillBtn>
          )}
          {caps.has('repeat') && (
            <PillBtn onClick={() => fire('set_repeat', { repeat: facts.repeat === 'off' ? 'all' : 'off' })} active={facts.repeat && facts.repeat !== 'off'}>
              {i18nT('remote.repeat')}
            </PillBtn>
          )}
        </div>
      )}

      {/* Extras — learned commands without dedicated UI (sleep, info,
          settings, color keys, sound modes, custom buttons…). */}
      {extras.length > 0 && (
        <div>
          <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{i18nT('remote.extras')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {extras.map((x) => (
              <button key={x.id} onClick={() => fire('ir_raw', { name: x.id })}
                className="z-chip" style={chipStyle()}
              >{x.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Macros (saved IR sequences) intentionally removed — the canonical
          starting step "power_on" maps to a TOGGLE IR code on most TVs,
          which turns an already-on TV OFF and then runs the rest of the
          sequence against a dark screen. State-aware skip + WiFi fallback
          weren't enough to make this reliable, so the surface is gone.
          Users who want one-tap app launches should use a Routine instead
          (those run through Ziggy's broader command router with real
          per-step error recovery). */}
    </div>
  )
}

// Streamer media_players advertise dozens of sources (HDMI inputs + every
// installed app). Showing them flat is unusable. Instead:
//   1. Re-order by per-device usage history (most-tapped first) so each
//      user's actual habits drive what's at hand. `sourceUsage` keeps a
//      localStorage tally bumped on every tap below.
//   2. Pin the currently-active source — the user has to be able to see
//      what's selected even when it's been touched less than other recents.
//   3. Show the top PINNED_LIMIT (default 6) up front. Collapse the long
//      tail behind "Show N more" so the remote stays one short row on
//      first paint.
//
// First-time users with no usage history get HA's native source_list
// ordering (which is the order HA reports — often the user's HA-configured
// priority or alphabetical).
function SourceRow({ sources, facts, entity, fire }) {
  const PINNED_LIMIT = 6
  const [showAll, setShowAll] = useState(false)

  if (!sources || sources.length === 0) return null

  const ranked = rankSources(sources, entity?.entity_id, facts.source)
  const overflowing = ranked.length > PINNED_LIMIT
  const visible = showAll ? ranked : ranked.slice(0, PINNED_LIMIT)
  const hiddenCount = ranked.length - PINNED_LIMIT

  const renderBtn = (s) => {
    const isSrcStr = typeof s === 'string'
    const label = isSrcStr ? s : s.label
    const cmd   = isSrcStr ? s : s.cmd
    const active = facts.source === label
    // Enable based on where this source row originated, not on the entity
    // type. Strings come from HA's source_list (route through select_source);
    // {cmd,label} objects come from the linked IR codeset (need a learned
    // IR code). Hybrid TVs hit both kinds in one list.
    const enabled = isSrcStr
      ? commandAvailable(entity, 'set_source', { source: cmd })
      : hasIrCmd(facts, cmd)
    return (
      <button
        key={cmd}
        onClick={() => {
          if (!enabled) return
          // Record the pick BEFORE firing so the next render's ranking
          // already reflects this interaction.
          if (entity?.entity_id && isSrcStr) bumpSourceUse(entity.entity_id, cmd)
          fire('set_source', { source: cmd })
        }}
        disabled={!enabled}
        aria-pressed={active}
        title={enabled ? '' : i18nT('remote.notLearned', { name: label })}
        className="z-chip"
        style={{ ...chipStyle({ active, enabled }), flexShrink: 0, textTransform: 'none' }}
      >{label.replace?.(/_/g, ' ') ?? label}</button>
    )
  }

  return (
    <div>
      <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>
        {overflowing ? i18nT('remote.sourceCount', { n: ranked.length }) : i18nT('remote.source')}
      </span>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, flexWrap: 'wrap' }} className="scrollbar-thin">
        {visible.map(renderBtn)}
        {overflowing && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="z-chip"
            style={{ ...chipStyle(), flexShrink: 0, color: 'var(--ink-mute)', border: '0.5px dashed var(--line)', textTransform: 'none' }}
          >{showAll ? i18nT('remote.showLess') : i18nT('remote.showMore', { n: hiddenCount })}</button>
        )}
      </div>
    </div>
  )
}


// ─── Building blocks ────────────────────────────────────────────────────────

// Legacy i18n values for Force On/Off start with a "⚡ " — the glyph is now a
// Lucide Zap next to the text, so drop it from the string.
function stripBolt(s) {
  return (s || '').replace(/^⚡\s*/, '')
}

// One chip style for source / sound / extras buttons: `.z-chip` type (13/500,
// capsule) stretched to a 44px target. Selected = surface-2 + ink text +
// 0.5px ink line — never inverted. The OK puck is this remote's one
// inverted control.
function chipStyle({ active = false, enabled = true } = {}) {
  return {
    minHeight: 44, padding: '0 16px', boxSizing: 'border-box',
    background: 'var(--surface-2)',
    color: active ? 'var(--ink)' : 'var(--ink-2)',
    border: '0.5px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
    fontWeight: active ? 600 : 500,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit', textTransform: 'capitalize',
    opacity: enabled ? 1 : 0.4,
    transition: 'border-color var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)',
  }
}

function NowPlayingCard({ facts }) {
  const title = facts.mediaTitle || facts.source || facts.name
  const subtitle = facts.mediaArtist || (facts.isOn ? facts.stateLabel : i18nT('common.off'))
  return (
    <div className="z-card" style={{
      padding: '8px 16px', minHeight: 56, display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)',
      }}>
        <Tv2 size={20} strokeWidth={1.75} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div dir="auto" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div dir="auto" style={{ fontSize: 15, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subtitle}{facts.isIr ? i18nT('remote.metaIr') : facts.linkedIr ? i18nT('remote.metaIrWifi') : ''}
        </div>
      </div>
      <span className={facts.isOn ? 'z-dot z-dot-on' : 'z-dot'} style={facts.isOn ? {} : { background: 'var(--ink-faint)' }} />
    </div>
  )
}

// Square action tile. The Power glyph is the one status-coloured icon on the
// remote (20px, so the raw --err token is allowed); labels stay ink.
function BigButton({ children, label, onClick, tone, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="z-card"
      style={{
        minHeight: 44, padding: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        background: 'var(--surface)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        color: tone === 'err' ? 'var(--err)' : 'var(--ink-2)',
        fontFamily: 'inherit',
        transition: 'background var(--dur-press) var(--ease-standard)',
      }}
    >
      {children}
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</span>
    </button>
  )
}


// Render only the spinners that have at least one direction available.
// If only volume works, take the full width — better than rendering an
// inert channel spinner the user can't actually use. If neither is
// available, render nothing.
function VolChSpinners({ entity, facts, fire }) {
  const haVol  = facts.volume
  const volTouched = useRef(false)
  const [volLocal, setVolLocal] = useState(haVol ?? 24)
  const [chLocal, setChLocal]   = useState(1)
  useEffect(() => {
    if (haVol == null) return
    if (!volTouched.current) setVolLocal(haVol)
  }, [haVol])

  const volUpOk    = commandAvailable(entity, 'volume_up')
  const volDownOk  = commandAvailable(entity, 'volume_down')
  const chUpOk     = commandAvailable(entity, 'channel_up')
  const chDownOk   = commandAvailable(entity, 'channel_down')
  const volShown   = volUpOk || volDownOk
  // Channel up/down only renders for pure-IR TVs. On a modern HA-connected
  // smart TV (LG webOS / Apple TV / Roku / Chromecast / etc.) channel
  // surfing is meaningless for ~75% of the source list (Netflix, YouTube,
  // HDMI, etc.); users who want to switch inputs use the Source picker.
  // The button stays available for legacy cable/antenna setups where the
  // device is IR-only and channel cycling IS the primary navigation.
  const chShown    = facts.isIr && (chUpOk || chDownOk)
  if (!volShown && !chShown) return null

  const bumpVol = (dir) => {
    volTouched.current = true
    setVolLocal(v => Math.max(0, Math.min(100, v + dir)))
    fire(dir > 0 ? 'volume_up' : 'volume_down')
  }
  const bumpCh = (dir) => {
    setChLocal(v => Math.max(1, v + dir))
    fire(dir > 0 ? 'channel_up' : 'channel_down')
  }

  const cols = (volShown && chShown) ? '1fr 1fr' : '1fr'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8 }}>
      {volShown && (
        <Spinner label={i18nT('remote.volumeHeading')} value={volLocal} upOk={volUpOk} downOk={volDownOk}
          onUp={() => bumpVol(+1)} onDown={() => bumpVol(-1)} />
      )}
      {chShown && (
        <Spinner label={i18nT('remote.channelHeading')} value={chLocal} upOk={chUpOk} downOk={chDownOk}
          onUp={() => bumpCh(+1)} onDown={() => bumpCh(-1)} />
      )}
    </div>
  )
}

// Back / Home / Menu live in a remote-app concept that HA's media_player
// domain doesn't expose. Four resolution paths, in order:
//   1. HA media_player (rare — almost no integrations support it)
//   2. Linked IR codeset (for hybrid TVs with a learned IR remote)
//   3. Paired `remote.*` entity (Apple TV, Android TV, Roku, Fire TV, …)
//   4. Vendor adapter table (LG webOS, Samsung Tizen, Sony Bravia, …)
// Render each button when ANY of those paths can fire it; skip the row
// only when none can.
function NavRow({ entity, fire, addToast, pairedRemoteId }) {
  const _ok = (cmd) =>
    commandAvailable(entity, cmd) ||
    !!pairedRemoteId ||
    vendorSupports(entity, cmd)
  const backOk = _ok('back')
  const homeOk = _ok('home')
  const menuOk = _ok('menu')
  if (!backOk && !homeOk && !menuOk) return null

  const fireSmart = (cmd) => {
    if (commandAvailable(entity, cmd)) return fire(cmd)
    if (pairedRemoteId)               return fireViaPairedRemote(pairedRemoteId, cmd, addToast)
    if (vendorSupports(entity, cmd))  return fireViaVendor(entity, cmd, callHaService).catch(e => addToast?.(e?.message || `${cmd} failed`, 'error'))
  }

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
      {backOk && <PillBtn onClick={() => fireSmart('back')}><ChevronLeft size={18} strokeWidth={1.75} className="icon-flip-rtl" /> {i18nT('remote.back')}</PillBtn>}
      {homeOk && <PillBtn onClick={() => fireSmart('home')}><Home size={18} strokeWidth={1.75} /> {i18nT('remote.home')}</PillBtn>}
      {menuOk && <PillBtn onClick={() => fireSmart('menu')}><Menu size={18} strokeWidth={1.75} /> {i18nT('remote.menu')}</PillBtn>}
    </div>
  )
}

function DPad({ entity, fire, pairedRemoteId, addToast }) {
  // Same 4-path resolution as NavRow: HA media_player → linked IR → paired
  // `remote.*` → vendor adapter (webostv.button / samsungtv.send_key /
  // braviatv.send_command).
  const _ok = (cmd) =>
    commandAvailable(entity, cmd) ||
    !!pairedRemoteId ||
    vendorSupports(entity, cmd)
  const okOk    = _ok('nav_ok')
  const upOk    = _ok('nav_up')
  const downOk  = _ok('nav_down')
  const leftOk  = _ok('nav_left')
  const rightOk = _ok('nav_right')

  // Hide the dial entirely when nothing can fire — better than rendering
  // an inert 200×200 puck the user sees as "broken".
  if (!okOk && !upOk && !downOk && !leftOk && !rightOk) return null

  const fireSmart = (cmd) => {
    if (commandAvailable(entity, cmd)) return fire(cmd)
    if (pairedRemoteId)               return fireViaPairedRemote(pairedRemoteId, cmd, addToast)
    if (vendorSupports(entity, cmd))  return fireViaVendor(entity, cmd, callHaService).catch(e => addToast?.(e?.message || `${cmd} failed`, 'error'))
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div className="z-card" style={{
        width: 200, height: 200, borderRadius: '50%',
        position: 'relative', background: 'var(--surface)',
      }}>
        {/* Centered OK — the one inverted control on this remote */}
        <button
          onClick={() => okOk && fireSmart('nav_ok')}
          disabled={!okOk}
          aria-label={i18nT('remote.ok')}
          title={okOk ? '' : i18nT('remote.okNotAvailable')}
          style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 108, height: 108, borderRadius: '50%',
            background: 'var(--ink)', color: 'var(--bg)', border: 'none',
            fontSize: 17, fontWeight: 700, letterSpacing: '0.02em', fontFamily: 'inherit',
            boxShadow: okOk ? 'var(--shadow-md)' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: okOk ? 'pointer' : 'not-allowed',
            opacity: okOk ? 1 : 0.28,
          }}
        >{i18nT('remote.ok')}</button>
        {/* 44×44 arrow targets at the four cardinal edges. The ring between
            the 108px puck and the 200px rim is 46px, so a 44px button at
            offset 2 sits fully inside it. */}
        {[
          { dir: 'up',    cmd: 'nav_up',    ok: upOk,    label: i18nT('remote.up'),    style: { top: 2, left: '50%', transform: 'translateX(-50%)' }, Icon: ChevronUp },
          { dir: 'down',  cmd: 'nav_down',  ok: downOk,  label: i18nT('remote.down'),  style: { bottom: 2, left: '50%', transform: 'translateX(-50%)' }, Icon: ChevronDown },
          { dir: 'left',  cmd: 'nav_left',  ok: leftOk,  label: i18nT('remote.left'),  style: { left: 2, top: '50%', transform: 'translateY(-50%)' }, Icon: ChevronLeft },
          { dir: 'right', cmd: 'nav_right', ok: rightOk, label: i18nT('remote.right'), style: { right: 2, top: '50%', transform: 'translateY(-50%)' }, Icon: ChevronRight },
        ].map(({ dir, cmd, ok, label, style, Icon }) => (
          <button
            key={dir} onClick={() => ok && fireSmart(cmd)} aria-label={label} disabled={!ok}
            title={ok ? '' : i18nT('remote.notAvailable', { name: label })}
            style={{
              position: 'absolute', background: 'none', border: 'none',
              width: 44, height: 44, borderRadius: '50%', padding: 0, lineHeight: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--ink-mute)',
              cursor: ok ? 'pointer' : 'not-allowed',
              opacity: ok ? 1 : 0.3,
              ...style,
            }}
          ><Icon size={20} strokeWidth={1.75} /></button>
        ))}
      </div>
    </div>
  )
}


// Standard 3×4 phone-style number pad. Each digit fires via `fireSmart`
// so it picks the best available channel for this device (HA media_player
// digit service when present, IR `digit_<n>` code, paired `remote.send_command`
// "<n>", or the vendor-adapter digit button — webostv "0".."9", samsungtv
// KEY_0..KEY_9, braviatv Num0..Num9). The bottom row pairs the canonical
// numeric helpers — Back (left), 0 (middle), OK/Enter (right) — so the
// user can dial a channel and confirm without leaving the view.
function NumPad({ fireSmart, entity, fire }) {
  const ok = (cmd) => fireSmart(cmd)

  const digitBtn = (n) => (
    <button
      key={n}
      onClick={() => ok(`digit_${n}`)}
      className="z-mono"
      style={{
        height: 56, borderRadius: 'var(--r-card)',
        background: 'var(--surface)', color: 'var(--ink)',
        border: '0.5px solid var(--line)',
        fontSize: 22, fontWeight: 600, fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >{n}</button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
        maxWidth: 320, margin: '0 auto', width: '100%',
      }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digitBtn)}
        <button
          onClick={() => ok('back')}
          title={i18nT('common.back')}
          aria-label={i18nT('common.back')}
          style={{
            height: 56, borderRadius: 'var(--r-card)',
            background: 'var(--surface-2)', color: 'var(--ink-mute)',
            border: '0.5px solid var(--line)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit',
          }}
        ><ChevronLeft size={20} strokeWidth={1.75} className="icon-flip-rtl" /></button>
        {digitBtn(0)}
        {/* The numpad view has no d-pad, so this OK is its one inverted control. */}
        <button
          onClick={() => ok('nav_ok')}
          title={i18nT('remote.ok')}
          style={{
            height: 56, borderRadius: 'var(--r-card)',
            background: 'var(--ink)', color: 'var(--bg)',
            border: 'none', cursor: 'pointer',
            fontSize: 17, fontWeight: 700, letterSpacing: '0.02em',
            fontFamily: 'inherit',
          }}
        >{i18nT('remote.ok')}</button>
      </div>
    </div>
  )
}

// Secondary pill. Active (shuffle / repeat on) = surface-2 + ink + 0.5px ink
// line, not inverted.
function PillBtn({ children, onClick, active, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={active ? true : undefined}
      className="z-btn-secondary"
      style={{
        padding: '0 16px', fontSize: 15,
        background: active ? 'var(--surface-2)' : undefined,
        borderColor: active ? 'var(--ink)' : undefined,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        transition: 'background var(--dur-press) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
      }}>{children}</button>
  )
}

function Spinner({ label, value, onUp, onDown, upOk = true, downOk = true }) {
  const shown = upOk || downOk
  return (
    <div className="z-card" style={{
      padding: '8px 0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'space-between', gap: 4, minHeight: 120,
      opacity: shown ? 1 : 0.4,
    }}>
      <button onClick={() => upOk && onUp()} disabled={!upOk} style={spinnerBtn(!upOk)}
        title={upOk ? '' : i18nT('remote.notLearned', { name: i18nT('remote.volumeUpAria', { label }) })}
        aria-label={i18nT('remote.volumeUpAria', { label })}>
        <ChevronUp size={20} strokeWidth={1.75} />
      </button>
      <span className="z-mono" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>
        {label}{value != null ? ` ${value}` : ''}
      </span>
      <button onClick={() => downOk && onDown()} disabled={!downOk} style={spinnerBtn(!downOk)}
        title={downOk ? '' : i18nT('remote.notLearned', { name: i18nT('remote.volumeDownAria', { label }) })}
        aria-label={i18nT('remote.volumeDownAria', { label })}>
        <ChevronDown size={20} strokeWidth={1.75} />
      </button>
    </div>
  )
}
function spinnerBtn(disabled) {
  return {
    background: 'none', border: 'none', color: disabled ? 'var(--ink-faint)' : 'var(--ink-2)',
    width: 44, height: 44, padding: 0, borderRadius: 'var(--r-ctl)',
    cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: disabled ? 0.4 : 1,
  }
}

function ChipRow({ label, items, current, isEnabled, onPick }) {
  return (
    <div>
      <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{label}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {items.map((m) => {
          const enabled = isEnabled ? isEnabled(m) : true
          const active = current === m
          return (
            <button key={m} onClick={() => enabled && onPick(m)} disabled={!enabled}
              aria-pressed={active}
              title={enabled ? '' : i18nT('remote.notLearned', { name: m })}
              className="z-chip"
              style={chipStyle({ active, enabled })}>{m.replace(/_/g, ' ')}</button>
          )
        })}
      </div>
    </div>
  )
}

// Source chips check raw learned-IR commands directly because the source
// "command" IS the raw IR cmd (e.g. 'hdmi_1'), not a logical command in
// IR_COMMAND_MAP.
function hasIrCmd(facts, cmd) {
  const ir = facts.entity?._irDevice || facts.entity?._linkedIr
  if (!ir) return false
  return (ir.learned_commands || []).includes(cmd)
}

// Not rendered today (the numpad view replaced it); kept on the shared type
// scale so it is ready if it comes back.
function ChannelEntry({ value, onChange, onSubmit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '0.5px solid var(--line)' }}>
      <Hash size={18} strokeWidth={1.75} style={{ color: 'var(--ink-mute)' }} />
      <span className="z-eyebrow" style={{ flexShrink: 0 }}>{i18nT('remote.channel')}</span>
      <input
        type="number" min={0} max={9999} value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
        onKeyDown={(e) => e.key === 'Enter' && value && onSubmit(parseInt(value, 10))}
        placeholder="12" className="z-input"
        style={{ flex: 1, width: 'auto' }}
      />
      <button onClick={() => value && onSubmit(parseInt(value, 10))}
        className="z-btn-secondary" style={{ flexShrink: 0 }}>{i18nT('remote.go')}</button>
    </div>
  )
}

// Extract source command list from a linked IR device's learned commands.
// Surfaces HDMI inputs and named input commands as picker entries.
//
// Three naming conventions seen in the wild:
//   - `hdmi_1`, `hdmi_2`              (TVs)
//   - `source_tv`, `source_av`        (older TVs)
//   - `input_hdmi`, `input_optical`,  (soundbars / AV receivers — most
//     `input_bluetooth`, `input_aux`,  common modern convention)
//     `input_tv`, `input_usb`, …
//   - bare `input`                     (TVs with a single Source/Input button)
//
// Earlier this function only matched the first two patterns plus bare
// `input`, so soundbar inputs like `input_bluetooth` never appeared in
// the picker even when learned — AND they couldn't fall through to the
// "extras" row because TV_REMOTE_CONSUMES claims every `input_*` for
// the source row. The commands existed in storage but had no UI surface.
function extractIrSources(ir) {
  if (!ir) return []
  const learned = new Set(ir.learned_commands || [])
  const result = []
  for (const c of learned) {
    if (
      c.startsWith('hdmi_') ||
      c.startsWith('source_') ||
      c.startsWith('input_') ||
      c === 'input'
    ) {
      // Strip the prefix in the user-facing label so "input_bluetooth"
      // reads as "bluetooth" instead of "input bluetooth" — cleaner in
      // the source row where the context already says "Source".
      const label = c
        .replace(/^source_/, '')
        .replace(/^input_/, '')
        .replace(/_/g, ' ')
      result.push({ label, cmd: c })
    }
  }
  return result
}

export default TVRemote
