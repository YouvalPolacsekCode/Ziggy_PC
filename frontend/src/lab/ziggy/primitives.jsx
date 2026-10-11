// Motion Lab — Ziggy-look primitives (static). Prototypes wrap these with
// motion; the primitives themselves carry no animation so every variant
// starts from the same still frame.
import { forwardRef } from 'react'
import {
  Lightbulb, Thermometer, Tv, Blinds, Radar, DoorClosed, Lock, Camera, Fan, Power, Sofa, CookingPot,
  BedDouble, Baby, Monitor, Bath, Sun, House, LayoutGrid, Zap, Sparkles, Moon, Clapperboard, DoorOpen,
  Snowflake, Check, X, ChevronLeft, ChevronRight, Plus, Wifi, WifiOff, AlertTriangle, Info, Droplets,
  Flame, Settings2, Search, Mic, ArrowLeft, ArrowRight, Undo2, RefreshCw, Users, Bell, Play,
} from 'lucide-react'
import { useLab } from '../LabContext'
import { pick } from '../mock/home'
import './ziggy.css'

const ICONS = {
  lightbulb: Lightbulb, thermometer: Thermometer, tv: Tv, blinds: Blinds, radar: Radar, door: DoorClosed,
  lock: Lock, camera: Camera, fan: Fan, power: Power, sofa: Sofa, 'cooking-pot': CookingPot,
  'bed-double': BedDouble, baby: Baby, monitor: Monitor, bath: Bath, sun: Sun, house: House,
  'layout-grid': LayoutGrid, zap: Zap, sparkles: Sparkles, moon: Moon, clapperboard: Clapperboard,
  'door-open': DoorOpen, snowflake: Snowflake, check: Check, x: X, 'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight, plus: Plus, wifi: Wifi, 'wifi-off': WifiOff, warning: AlertTriangle,
  info: Info, droplets: Droplets, flame: Flame, settings: Settings2, search: Search, mic: Mic,
  'arrow-left': ArrowLeft, 'arrow-right': ArrowRight, undo: Undo2, refresh: RefreshCw, users: Users,
  bell: Bell, play: Play,
}

export const KIND_ICON = {
  light: 'lightbulb', switch: 'power', climate: 'thermometer', media: 'tv', cover: 'blinds',
  sensor: 'radar', lock: 'lock', camera: 'camera', fan: 'fan', ir: 'tv',
}

export function Icon({ name, size = 20, strokeWidth = 1.9, ...rest }) {
  const C = ICONS[name] || Lightbulb
  return <C size={size} strokeWidth={strokeWidth} {...rest} />
}

// t(): pick the current language from a {en, he} value
export function useT() {
  const { dir } = useLab()
  const lang = dir === 'rtl' ? 'he' : 'en'
  return (v, ...args) => {
    const x = pick(v, lang)
    return typeof x === 'function' ? x(...args) : x
  }
}

export const Tile = forwardRef(function Tile({ on, icon, name, meta, className = '', children, style, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={`zl zl-tile ${className}`} data-on={on ? 'true' : 'false'} style={style} {...rest}>
      <div className="zl-tile__row">
        <span className="zl-tile__icon"><Icon name={icon} /></span>
        {children}
      </div>
      <div>
        <div className="zl-tile__name">{name}</div>
        {meta != null && <div className="zl-tile__meta">{meta}</div>}
      </div>
    </button>
  )
})

export function Dot({ state }) {
  return <span className="zl-dot" data-state={state} />
}

export function Button({ variant = 'default', className = '', children, ...rest }) {
  return (
    <button type="button" className={`zl zl-btn ${variant !== 'default' ? `zl-btn--${variant}` : ''} ${className}`} {...rest}>
      {children}
    </button>
  )
}

export function Card({ pad = true, className = '', children, ...rest }) {
  return <div className={`zl zl-card ${pad ? 'zl-card--pad' : ''} ${className}`} {...rest}>{children}</div>
}

export function Row({ icon, title, sub, right, ...rest }) {
  return (
    <div className="zl zl-row" {...rest}>
      <span className="zl-row__icon"><Icon name={icon} /></span>
      <div className="zl-row__main">
        <div className="zl-row__title">{title}</div>
        {sub && <div className="zl-row__sub">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

export function Chip({ on, children, ...rest }) {
  return <span className="zl zl-chip" data-on={on ? 'true' : 'false'} {...rest}>{children}</span>
}

export function Page({ title, children, footer, scrollRef, style }) {
  return (
    <div className="zl zl-page" style={style}>
      <div className="zl-page__scroll" ref={scrollRef}>
        {title && <h1 className="zl-title2 zl-page__title">{title}</h1>}
        {children}
      </div>
      {footer}
    </div>
  )
}
