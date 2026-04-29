import { useState, useEffect } from 'react'
import {
  SkipBack, SkipForward, Play, Pause, Volume2, VolumeX,
  ArrowUp, ArrowDown, Lock, LockOpen, Home, Square, Minus, Plus,
} from 'lucide-react'
import { Slider } from './Slider'
import { cn } from '../../lib/utils'

// Domains that show the toggle switch in the card/row header
export const TOGGLEABLE_DOMAINS = new Set([
  'light', 'switch', 'fan', 'input_boolean', 'media_player',
])

// ─── Light ────────────────────────────────────────────────────────────────────
function LightControls({ entity, onService }) {
  const isOn = entity.state === 'on'
  const rawBrightness = entity.brightness != null ? Math.round(entity.brightness / 255 * 100) : 0
  const [brightness, setBrightness] = useState(rawBrightness)

  const colorModes = entity.supported_color_modes || []
  const supportsColorTemp = colorModes.includes('color_temp') || entity.color_temp != null
  const minK = entity.max_mireds ? Math.round(1000000 / entity.max_mireds) : 2700
  const maxK = entity.min_mireds ? Math.round(1000000 / entity.min_mireds) : 6500
  const rawK = entity.color_temp ? Math.round(1000000 / entity.color_temp) : minK
  const [colorTemp, setColorTemp] = useState(rawK)

  useEffect(() => {
    setBrightness(entity.brightness != null ? Math.round(entity.brightness / 255 * 100) : 0)
  }, [entity.brightness])
  useEffect(() => {
    setColorTemp(entity.color_temp ? Math.round(1000000 / entity.color_temp) : minK)
  }, [entity.color_temp])

  if (!isOn) return null

  return (
    <div className="flex flex-col gap-3 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      <div>
        <div className="flex justify-between text-[10px] text-zinc-400 mb-1.5">
          <span>Brightness</span>
          <span className="tabular-nums">{brightness}%</span>
        </div>
        <Slider
          value={brightness}
          onValueChange={setBrightness}
          onValueCommit={(v) => onService('turn_on', { brightness_pct: v })}
          min={1} max={100}
        />
      </div>
      {supportsColorTemp && (
        <div>
          <div className="flex justify-between text-[10px] text-zinc-400 mb-1.5">
            <span>☀ Warm</span>
            <span>Cool ❄</span>
          </div>
          <Slider
            value={colorTemp}
            onValueChange={setColorTemp}
            onValueCommit={(v) => onService('turn_on', { color_temp_kelvin: v })}
            min={minK} max={maxK}
          />
        </div>
      )}
    </div>
  )
}

// ─── Climate ──────────────────────────────────────────────────────────────────
const HVAC_IDLE = {
  off:       'bg-zinc-100 dark:bg-zinc-800 text-zinc-500',
  heat:      'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
  cool:      'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  heat_cool: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
  auto:      'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
  fan_only:  'bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400',
  dry:       'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
}
const HVAC_ACTIVE = {
  off:       'bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900',
  heat:      'bg-orange-500 text-white',
  cool:      'bg-blue-500 text-white',
  heat_cool: 'bg-purple-500 text-white',
  auto:      'bg-emerald-500 text-white',
  fan_only:  'bg-sky-500 text-white',
  dry:       'bg-amber-500 text-white',
}

function ClimateControls({ entity, onService }) {
  const hvacMode = entity.hvac_mode || entity.state
  const hvacModes = entity.hvac_modes || []
  const targetTemp = entity.temperature
  const currentTemp = entity.current_temperature
  const step = entity.target_temp_step || 0.5
  const minTemp = entity.min_temp || 16
  const maxTemp = entity.max_temp || 30

  const adjustTemp = (delta) => {
    const base = targetTemp ?? currentTemp ?? 20
    const next = Math.round(Math.min(maxTemp, Math.max(minTemp, base + delta)) * 10) / 10
    onService('set_temperature', { temperature: next })
  }

  return (
    <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        {currentTemp != null && (
          <span className="text-xs text-zinc-400">Now {currentTemp}°</span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => adjustTemp(-step)}
            className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            <Minus size={12} className="text-zinc-600 dark:text-zinc-400" />
          </button>
          <span className="text-sm font-semibold tabular-nums w-10 text-center text-zinc-900 dark:text-zinc-100">
            {targetTemp != null ? `${targetTemp}°` : '—'}
          </span>
          <button
            onClick={() => adjustTemp(step)}
            className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            <Plus size={12} className="text-zinc-600 dark:text-zinc-400" />
          </button>
        </div>
      </div>
      {hvacModes.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {hvacModes.map((mode) => (
            <button
              key={mode}
              onClick={() => onService('set_hvac_mode', { hvac_mode: mode })}
              className={cn(
                'px-2 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors',
                hvacMode === mode
                  ? (HVAC_ACTIVE[mode] || 'bg-zinc-900 text-white')
                  : (HVAC_IDLE[mode] || 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500')
              )}
            >
              {mode.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Media Player ─────────────────────────────────────────────────────────────
function MediaPlayerControls({ entity, onService }) {
  const isPlaying = entity.state === 'playing'
  const isMuted = entity.is_volume_muted
  const rawVol = entity.volume_level != null ? Math.round(entity.volume_level * 100) : null
  const [volume, setVolume] = useState(rawVol ?? 50)

  useEffect(() => {
    if (entity.volume_level != null) setVolume(Math.round(entity.volume_level * 100))
  }, [entity.volume_level])

  const source = entity.source
  const sourceList = entity.source_list || []
  const mediaTitle = entity.media_title
  const mediaArtist = entity.media_artist

  if (entity.state === 'off' || entity.state === 'unavailable') return null

  return (
    <div className="flex flex-col gap-2.5 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      {(mediaTitle || mediaArtist) && (
        <p className="text-[10px] text-zinc-400 truncate">
          {[mediaTitle, mediaArtist].filter(Boolean).join(' · ')}
        </p>
      )}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => onService('media_previous_track', {})}
          className="p-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <SkipBack size={15} />
        </button>
        <button
          onClick={() => onService(isPlaying ? 'media_pause' : 'media_play', {})}
          className="w-9 h-9 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center shrink-0 hover:opacity-80 transition-opacity"
        >
          {isPlaying
            ? <Pause size={14} className="text-white dark:text-zinc-900" />
            : <Play size={14} className="text-white dark:text-zinc-900 translate-x-px" />}
        </button>
        <button
          onClick={() => onService('media_next_track', {})}
          className="p-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <SkipForward size={15} />
        </button>
      </div>
      {rawVol != null && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onService('volume_mute', { is_volume_muted: !isMuted })}
            className="shrink-0 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <Slider
            value={isMuted ? 0 : volume}
            onValueChange={setVolume}
            onValueCommit={(v) => onService('volume_set', { volume_level: v / 100 })}
            min={0} max={100}
          />
          <span className="text-[10px] text-zinc-400 w-7 text-right tabular-nums shrink-0">
            {isMuted ? 'M' : `${volume}%`}
          </span>
        </div>
      )}
      {sourceList.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {sourceList.slice(0, 5).map((s) => (
            <button
              key={s}
              onClick={() => onService('select_source', { source: s })}
              className={cn(
                'px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors',
                source === s
                  ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Cover ────────────────────────────────────────────────────────────────────
function CoverControls({ entity, onService }) {
  const position = entity.current_position
  const [localPos, setLocalPos] = useState(position ?? 0)

  useEffect(() => { if (position != null) setLocalPos(position) }, [position])

  return (
    <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      <div className="flex items-stretch gap-1.5">
        <button
          onClick={() => onService('open_cover', {})}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <ArrowUp size={11} /> Open
        </button>
        <button
          onClick={() => onService('stop_cover', {})}
          className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm leading-none"
        >
          ■
        </button>
        <button
          onClick={() => onService('close_cover', {})}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <ArrowDown size={11} /> Close
        </button>
      </div>
      {position != null && (
        <div>
          <div className="flex justify-between text-[10px] text-zinc-400 mb-1.5">
            <span>Position</span>
            <span className="tabular-nums">{localPos}%</span>
          </div>
          <Slider
            value={localPos}
            onValueChange={setLocalPos}
            onValueCommit={(v) => onService('set_cover_position', { position: v })}
            min={0} max={100}
          />
        </div>
      )}
    </div>
  )
}

// ─── Fan ──────────────────────────────────────────────────────────────────────
function FanControls({ entity, onService }) {
  const isOn = entity.state === 'on'
  const rawPct = entity.percentage ?? 0
  const [pct, setPct] = useState(rawPct)
  const presetMode = entity.preset_mode
  const presetModes = entity.preset_modes || []

  useEffect(() => { setPct(entity.percentage ?? 0) }, [entity.percentage])

  if (!isOn) return null

  return (
    <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      <div>
        <div className="flex justify-between text-[10px] text-zinc-400 mb-1.5">
          <span>Speed</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <Slider
          value={pct}
          onValueChange={setPct}
          onValueCommit={(v) => onService('set_percentage', { percentage: v })}
          min={0} max={100}
        />
      </div>
      {presetModes.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {presetModes.map((mode) => (
            <button
              key={mode}
              onClick={() => onService('set_preset_mode', { preset_mode: mode })}
              className={cn(
                'px-2 py-0.5 rounded-lg text-[10px] font-medium capitalize transition-colors',
                presetMode === mode
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Lock ─────────────────────────────────────────────────────────────────────
function LockControls({ entity, onService }) {
  const [confirming, setConfirming] = useState(false)
  const isLocked = entity.state === 'locked'
  const isPending = entity.state === 'locking' || entity.state === 'unlocking'

  return (
    <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      {isPending ? (
        <div className="text-center text-xs text-zinc-400 py-1.5 capitalize">{entity.state}…</div>
      ) : !isLocked ? (
        <button
          onClick={() => onService('lock', {})}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
        >
          <Lock size={12} /> Lock
        </button>
      ) : confirming ? (
        <div className="flex gap-1.5">
          <button
            onClick={() => { onService('unlock', {}); setConfirming(false) }}
            className="flex-1 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
          >
            Confirm unlock
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs hover:bg-zinc-200 transition-colors"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
        >
          <LockOpen size={12} /> Unlock
        </button>
      )}
    </div>
  )
}

// ─── Vacuum ───────────────────────────────────────────────────────────────────
function VacuumControls({ entity, onService }) {
  const state = entity.state
  const isCleaning = state === 'cleaning'
  const isPaused = state === 'paused'
  const isDocked = state === 'docked'
  const isIdle = state === 'idle'

  return (
    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      {!isCleaning ? (
        <button
          onClick={() => onService('start', {})}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 text-xs font-medium hover:bg-violet-100 transition-colors"
        >
          <Play size={11} /> Start
        </button>
      ) : (
        <button
          onClick={() => onService('pause', {})}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium hover:bg-amber-100 transition-colors"
        >
          <Pause size={11} /> Pause
        </button>
      )}
      {(isCleaning || isPaused || isIdle) && (
        <button
          onClick={() => onService('return_to_base', {})}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium hover:bg-zinc-200 transition-colors"
        >
          <Home size={11} /> Dock
        </button>
      )}
      {(isCleaning || isPaused) && (
        <button
          onClick={() => onService('stop', {})}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors"
        >
          <Square size={11} /> Stop
        </button>
      )}
      {isDocked && (
        <span className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
          <Home size={11} /> Docked
        </span>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function DeviceControls({ entity, onService }) {
  switch (entity.domain) {
    case 'light':         return <LightControls entity={entity} onService={onService} />
    case 'climate':       return <ClimateControls entity={entity} onService={onService} />
    case 'media_player':  return <MediaPlayerControls entity={entity} onService={onService} />
    case 'cover':         return <CoverControls entity={entity} onService={onService} />
    case 'fan':           return <FanControls entity={entity} onService={onService} />
    case 'lock':          return <LockControls entity={entity} onService={onService} />
    case 'vacuum':        return <VacuumControls entity={entity} onService={onService} />
    default:              return null
  }
}
