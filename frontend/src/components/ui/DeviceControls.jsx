import { useState, useEffect } from 'react'
import {
  SkipBack, SkipForward, Play, Pause, Volume2, VolumeX,
  ArrowUp, ArrowDown, Lock, LockOpen, Home, Square, Minus, Plus,
  Shuffle, Repeat, ChevronDown,
} from 'lucide-react'
import { Slider } from './Slider'
import { cn } from '../../lib/utils'

// Domains that show the toggle switch in the card/row header
export const TOGGLEABLE_DOMAINS = new Set([
  'light', 'switch', 'fan', 'input_boolean', 'media_player',
])

// ─── Shared helpers ───────────────────────────────────────────────────────────

const COLOR_SWATCHES = [
  { label: 'Red',    rgb: [255, 30,  0]   },
  { label: 'Orange', rgb: [255, 120, 0]   },
  { label: 'Yellow', rgb: [255, 210, 0]   },
  { label: 'Green',  rgb: [0,   200, 0]   },
  { label: 'Cyan',   rgb: [0,   200, 220] },
  { label: 'Blue',   rgb: [0,   60,  255] },
  { label: 'Purple', rgb: [160, 0,   255] },
  { label: 'Pink',   rgb: [255, 0,   140] },
  { label: 'White',  rgb: [255, 255, 255] },
]

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return '#ffffff'
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function MoreToggle({ expanded, onToggle, label = 'More options' }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-0.5 text-[10px] font-medium text-violet-500 hover:text-violet-600 dark:hover:text-violet-400 transition-colors mt-0.5 self-start"
    >
      <ChevronDown
        size={11}
        className={cn('transition-transform duration-150', expanded && 'rotate-180')}
      />
      {expanded ? 'Less' : label}
    </button>
  )
}

function ModeChips({ label, modes, current, colorActive, colorIdle, onSelect }) {
  if (!modes || modes.length === 0) return null
  return (
    <div className="flex gap-1 flex-wrap items-center">
      {label && <span className="text-[10px] text-zinc-400 mr-0.5 shrink-0">{label}</span>}
      {modes.map((mode) => (
        <button
          key={mode}
          onClick={() => onSelect(mode)}
          className={cn(
            'px-2 py-0.5 rounded-lg text-[10px] font-medium capitalize transition-colors',
            current === mode ? colorActive : colorIdle,
          )}
        >
          {mode.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  )
}

// ─── Light ────────────────────────────────────────────────────────────────────
function LightControls({ entity, onService }) {
  const isOn = entity.state === 'on'
  const rawBrightness = entity.brightness != null ? Math.round(entity.brightness / 255 * 100) : 0
  const [brightness, setBrightness] = useState(rawBrightness)
  const [expanded, setExpanded] = useState(false)

  const colorModes = entity.supported_color_modes || []
  const supportsColorTemp = colorModes.includes('color_temp') || entity.color_temp != null
  const supportsColor = colorModes.some((m) => ['hs', 'rgb', 'xy', 'rgbw', 'rgbww'].includes(m))
  const effectList = entity.effect_list || []
  const currentEffect = entity.effect
  const currentRgb = entity.rgb_color

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

  const hasSecondary = supportsColorTemp || supportsColor || effectList.length > 0
  if (!isOn) return null

  return (
    <div className="flex flex-col gap-3 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      {/* Primary: brightness */}
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

      {hasSecondary && (
        <MoreToggle
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          label="Color & effects"
        />
      )}

      {/* Secondary: color temp + swatches + effects */}
      {expanded && (
        <div className="flex flex-col gap-3">
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

          {supportsColor && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLOR_SWATCHES.map(({ label, rgb }) => {
                const hex = rgbToHex(rgb)
                const isActive = currentRgb &&
                  Math.abs(currentRgb[0] - rgb[0]) < 25 &&
                  Math.abs(currentRgb[1] - rgb[1]) < 25 &&
                  Math.abs(currentRgb[2] - rgb[2]) < 25
                return (
                  <button
                    key={label}
                    title={label}
                    onClick={() => onService('turn_on', { rgb_color: rgb })}
                    className={cn(
                      'w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 shrink-0',
                      isActive
                        ? 'border-zinc-900 dark:border-white scale-110'
                        : 'border-zinc-200 dark:border-zinc-600',
                    )}
                    style={{ backgroundColor: hex }}
                  />
                )
              })}
              <label
                title="Custom color"
                className="w-5 h-5 rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-600 overflow-hidden cursor-pointer shrink-0 relative flex items-center justify-center"
              >
                <input
                  type="color"
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  value={rgbToHex(currentRgb)}
                  onChange={(e) => onService('turn_on', { rgb_color: hexToRgb(e.target.value) })}
                />
                <span className="text-[9px] text-zinc-400 pointer-events-none">+</span>
              </label>
            </div>
          )}

          {effectList.length > 0 && (
            <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
              <button
                onClick={() => onService('turn_on', { effect: 'none' })}
                className={cn(
                  'px-2 py-0.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors shrink-0',
                  !currentEffect || currentEffect === 'none'
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                )}
              >
                No effect
              </button>
              {effectList.map((effect) => (
                <button
                  key={effect}
                  onClick={() => onService('turn_on', { effect })}
                  className={cn(
                    'px-2 py-0.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors shrink-0',
                    currentEffect === effect
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                  )}
                >
                  {effect}
                </button>
              ))}
            </div>
          )}
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
  const [expanded, setExpanded] = useState(false)

  const hvacMode  = entity.hvac_mode || entity.state
  const hvacModes = entity.hvac_modes || []
  const targetTemp    = entity.temperature
  const currentTemp   = entity.current_temperature
  const step    = entity.target_temp_step || 0.5
  const minTemp = entity.min_temp || 16
  const maxTemp = entity.max_temp || 30

  const fanMode    = entity.fan_mode
  const fanModes   = entity.fan_modes   || []
  const presetMode  = entity.preset_mode
  const presetModes = entity.preset_modes || []
  const swingMode   = entity.swing_mode
  const swingModes  = entity.swing_modes  || []

  const adjustTemp = (delta) => {
    const base = targetTemp ?? currentTemp ?? 20
    const next = Math.round(Math.min(maxTemp, Math.max(minTemp, base + delta)) * 10) / 10
    onService('set_temperature', { temperature: next })
  }

  const hasSecondary = fanModes.length > 1 || presetModes.length > 0 || swingModes.length > 1

  return (
    <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      {/* Primary: temp + hvac modes */}
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
                  : (HVAC_IDLE[mode]   || 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'),
              )}
            >
              {mode.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {hasSecondary && (
        <MoreToggle
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          label="Fan & presets"
        />
      )}

      {/* Secondary: fan / preset / swing */}
      {expanded && (
        <div className="flex flex-col gap-2">
          {fanModes.length > 1 && (
            <ModeChips
              label="Fan"
              modes={fanModes}
              current={fanMode}
              colorActive="bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300"
              colorIdle="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              onSelect={(mode) => onService('set_fan_mode', { fan_mode: mode })}
            />
          )}
          {presetModes.length > 0 && (
            <ModeChips
              label="Preset"
              modes={presetModes}
              current={presetMode}
              colorActive="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
              colorIdle="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              onSelect={(mode) => onService('set_preset_mode', { preset_mode: mode })}
            />
          )}
          {swingModes.length > 1 && (
            <ModeChips
              label="Swing"
              modes={swingModes}
              current={swingMode}
              colorActive="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
              colorIdle="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              onSelect={(mode) => onService('set_swing_mode', { swing_mode: mode })}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Media Player ─────────────────────────────────────────────────────────────
const MP_SHUFFLE = 32768
const MP_REPEAT  = 262144

function MediaPlayerControls({ entity, onService }) {
  const [expanded, setExpanded] = useState(false)
  const isPlaying = entity.state === 'playing'
  const isMuted   = entity.is_volume_muted
  const rawVol    = entity.volume_level != null ? Math.round(entity.volume_level * 100) : null
  const [volume, setVolume] = useState(rawVol ?? 50)

  useEffect(() => {
    if (entity.volume_level != null) setVolume(Math.round(entity.volume_level * 100))
  }, [entity.volume_level])

  const source     = entity.source
  const sourceList = entity.source_list || []
  const appList    = entity.app_list    || []
  const mediaTitle  = entity.media_title
  const mediaArtist = entity.media_artist
  const shuffle    = entity.shuffle
  const repeat     = entity.repeat
  const soundMode  = entity.sound_mode
  const soundModes = entity.sound_mode_list || []
  const features   = entity.supported_features || 0

  const supportsShuffle = !!(features & MP_SHUFFLE)
  const supportsRepeat  = !!(features & MP_REPEAT)

  // sourceList goes in secondary so the card stays compact even with many inputs
  const hasSecondary = sourceList.length > 0 || supportsShuffle || supportsRepeat || appList.length > 0 || soundModes.length > 1
  const moreLabel = sourceList.length > 0 ? 'Sources & more' : 'Shuffle & more'

  if (entity.state === 'off' || entity.state === 'unavailable') return null

  const nextRepeat = repeat === 'off' || !repeat ? 'all' : repeat === 'all' ? 'one' : 'off'

  return (
    <div className="flex flex-col gap-2.5 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      {/* Now playing */}
      {(mediaTitle || mediaArtist) && (
        <p className="text-[10px] text-zinc-400 truncate">
          {[mediaTitle, mediaArtist].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Primary: playback */}
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
            : <Play  size={14} className="text-white dark:text-zinc-900 translate-x-px" />}
        </button>
        <button
          onClick={() => onService('media_next_track', {})}
          className="p-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <SkipForward size={15} />
        </button>
      </div>

      {/* Primary: volume */}
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

      {/* "Sources & more" toggle — sources + shuffle/apps/sound all live here */}
      {hasSecondary && (
        <MoreToggle
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          label={moreLabel}
        />
      )}

      {expanded && (
        <div className="flex flex-col gap-2">
          {/* Source list */}
          {sourceList.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {sourceList.map((s) => (
                <button
                  key={s}
                  onClick={() => onService('select_source', { source: s })}
                  className={cn(
                    'px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors',
                    source === s
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* App list (distinct from source list) */}
          {appList.length > 0 && (
            <div className="flex gap-1 flex-wrap items-center">
              <span className="text-[10px] text-zinc-400 mr-0.5 shrink-0">Apps</span>
              {appList.map((app) => (
                <button
                  key={app}
                  onClick={() => onService('select_source', { source: app })}
                  className={cn(
                    'px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors',
                    source === app
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                  )}
                >
                  {app}
                </button>
              ))}
            </div>
          )}

          {/* Shuffle + Repeat */}
          {(supportsShuffle || supportsRepeat) && (
            <div className="flex gap-1.5">
              {supportsShuffle && (
                <button
                  onClick={() => onService('shuffle_set', { shuffle: !shuffle })}
                  title={shuffle ? 'Shuffle: On' : 'Shuffle: Off'}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors',
                    shuffle
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                  )}
                >
                  <Shuffle size={10} /> Shuffle
                </button>
              )}
              {supportsRepeat && (
                <button
                  onClick={() => onService('repeat_set', { repeat: nextRepeat })}
                  title={`Repeat: ${repeat || 'off'}`}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors',
                    repeat && repeat !== 'off'
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                  )}
                >
                  <Repeat size={10} />
                  {repeat === 'one' ? ' ×1' : repeat === 'all' ? ' All' : ' Off'}
                </button>
              )}
            </div>
          )}

          {/* Sound mode */}
          {soundModes.length > 1 && (
            <ModeChips
              label="Sound"
              modes={soundModes}
              current={soundMode}
              colorActive="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
              colorIdle="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              onSelect={(mode) => onService('select_sound_mode', { sound_mode: mode })}
            />
          )}
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
  const presetMode  = entity.preset_mode
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
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700',
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
  const isLocked  = entity.state === 'locked'
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
  const state      = entity.state
  const isCleaning = state === 'cleaning'
  const isPaused   = state === 'paused'
  const isDocked   = state === 'docked'
  const isIdle     = state === 'idle'

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

// ─── IR Remote Panel — for merged Wi-Fi + IR device cards ────────────────────
// onCommand(irDeviceId, commandName)

const REMOTE_DISPLAY = {
  power:        { label: '⏻',      title: 'Power' },
  volume_up:    { label: '🔊+',    title: 'Vol +' },
  volume_down:  { label: '🔊−',    title: 'Vol −' },
  mute:         { label: '🔇',     title: 'Mute' },
  nav_up:       { label: '▲',      title: 'Up' },
  nav_down:     { label: '▼',      title: 'Down' },
  nav_left:     { label: '◄',      title: 'Left' },
  nav_right:    { label: '►',      title: 'Right' },
  nav_ok:       { label: '●',      title: 'OK' },
  back:         { label: '↩',      title: 'Back' },
  home:         { label: '⌂',      title: 'Home' },
  menu:         { label: '☰',      title: 'Menu' },
  hdmi_1:       { label: 'HDMI 1', title: 'HDMI 1' },
  hdmi_2:       { label: 'HDMI 2', title: 'HDMI 2' },
  hdmi_3:       { label: 'HDMI 3', title: 'HDMI 3' },
  hdmi_4:       { label: 'HDMI 4', title: 'HDMI 4' },
  channel_up:   { label: 'CH+',    title: 'Chan +' },
  channel_down: { label: 'CH−',    title: 'Chan −' },
  mode_cool:    { label: '❄ Cool', title: 'Cool' },
  mode_heat:    { label: '🔥 Heat',title: 'Heat' },
  mode_fan:     { label: '💨 Fan', title: 'Fan' },
  mode_auto:    { label: '🔄 Auto',title: 'Auto' },
  mode_dry:     { label: '💧 Dry', title: 'Dry' },
  fan_low:      { label: 'Fan Lo', title: 'Fan Low' },
  fan_medium:   { label: 'Fan Md', title: 'Fan Med' },
  fan_high:     { label: 'Fan Hi', title: 'Fan High' },
  fan_auto:     { label: 'Fan ⟲',  title: 'Fan Auto' },
  swing_on:     { label: 'Swing ✓',title: 'Swing On' },
  swing_off:    { label: 'Swing ✗',title: 'Swing Off' },
}

// Priority order within the IR remote panel
const REMOTE_ORDER = [
  'power',
  'nav_up','nav_left','nav_ok','nav_right','nav_down','back','home','menu',
  'volume_up','volume_down','mute','channel_up','channel_down',
  'hdmi_1','hdmi_2','hdmi_3','hdmi_4',
  'mode_cool','mode_heat','mode_fan','mode_auto','mode_dry',
  'fan_low','fan_medium','fan_high','fan_auto','swing_on','swing_off',
]

export function IRRemotePanel({ irDevice, onCommand, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  if (!irDevice) return null

  const learned = new Set(irDevice.learned_commands || [])
  const cmds = irDevice.commands || {}
  const canDo = (cmd) => cmd in cmds && learned.has(cmd)

  // Ordered known commands, then any remaining learned commands not in the display table
  const knownOrdered = REMOTE_ORDER.filter(canDo)
  const allLearned = learned
  const extra = [...allLearned].filter((c) => !REMOTE_ORDER.includes(c) && canDo(c)).sort()
  const allCmds = [...knownOrdered, ...extra]

  if (allCmds.length === 0) return null

  return (
    <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[10px] font-medium text-violet-500 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
      >
        <ChevronDown size={10} className={cn('transition-transform duration-150', expanded && 'rotate-180')} />
        IR Remote · {allLearned.size} cmd{allLearned.size !== 1 ? 's' : ''}
      </button>

      {expanded && (
        <div className="flex gap-1.5 flex-wrap mt-2">
          {allCmds.map((cmd) => {
            const disp = REMOTE_DISPLAY[cmd]
            return (
              <button
                key={cmd}
                title={disp?.title || cmd}
                onClick={() => onCommand(irDevice.id, cmd)}
                className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-[10px] font-medium leading-none"
              >
                {disp?.label || cmd.replace(/_/g, ' ')}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function DeviceControls({ entity, onService }) {
  switch (entity.domain) {
    case 'light':        return <LightControls        entity={entity} onService={onService} />
    case 'climate':      return <ClimateControls      entity={entity} onService={onService} />
    case 'media_player': return <MediaPlayerControls  entity={entity} onService={onService} />
    case 'cover':        return <CoverControls        entity={entity} onService={onService} />
    case 'fan':          return <FanControls          entity={entity} onService={onService} />
    case 'lock':         return <LockControls         entity={entity} onService={onService} />
    case 'vacuum':       return <VacuumControls       entity={entity} onService={onService} />
    default:             return null
  }
}
