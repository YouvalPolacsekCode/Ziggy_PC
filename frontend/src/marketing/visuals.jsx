// ─────────────────────────────────────────────────────────────────────────
// Ziggy marketing site — decorative & product visuals.
// ─────────────────────────────────────────────────────────────────────────
import { motion, useReducedMotion } from 'framer-motion'
import {
  Lightbulb, Thermometer, DoorClosed, Radio, Plug, Wind, Tv, Lock,
  Mic, Wifi, ShieldCheck, MoveRight,
} from 'lucide-react'
import { ZiggyMark } from './ui'

/* ── Hero: the home as a living constellation around Ziggy's brain ───────── */

const NODES = [
  { icon: Lightbulb,   label: 'Lights',   angle: -90,  r: 1.0 },
  { icon: Wind,        label: 'AC',       angle: -38,  r: 1.0 },
  { icon: Thermometer, label: 'Climate',  angle: 14,   r: 1.0 },
  { icon: Plug,        label: 'Power',    angle: 66,   r: 1.0 },
  { icon: Tv,          label: 'Media',    angle: 118,  r: 1.0 },
  { icon: DoorClosed,  label: 'Doors',    angle: 170,  r: 1.0 },
  { icon: Lock,        label: 'Locks',    angle: 222,  r: 1.0 },
  { icon: Radio,       label: 'Sensors',  angle: -142, r: 1.0 },
]

export function HomeConstellation() {
  const reduce = useReducedMotion()
  const C = 200          // center of 400x400 viewBox
  const R = 150          // orbit radius

  const pts = NODES.map((n) => {
    const rad = (n.angle * Math.PI) / 180
    return { ...n, x: C + Math.cos(rad) * R, y: C + Math.sin(rad) * R }
  })

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[460px]">
      {/* glow */}
      <div className="zmk-corepulse absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, color-mix(in srgb,var(--accent) 55%, transparent), transparent 70%)' }} />

      {/* connection lines */}
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
        {pts.map((p, i) => (
          <line
            key={i}
            x1={C} y1={C} x2={p.x} y2={p.y}
            stroke="var(--line-3)"
            strokeWidth="1"
            strokeDasharray="3 5"
            opacity="0.6"
          />
        ))}
        {/* animated data pulses traveling inward */}
        {!reduce && pts.map((p, i) => (
          <motion.circle
            key={`d-${i}`}
            r="2.4"
            fill="var(--accent)"
            initial={{ cx: p.x, cy: p.y, opacity: 0 }}
            animate={{ cx: [p.x, C], cy: [p.y, C], opacity: [0, 1, 0] }}
            transition={{ duration: 2.4, delay: i * 0.45, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }}
          />
        ))}
      </svg>

      {/* orbit ring */}
      <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line" />

      {/* center brain */}
      <motion.div
        className="absolute left-1/2 top-1/2 z-10 flex h-[88px] w-[88px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl border border-line-2 bg-surface shadow-lg"
        animate={reduce ? {} : { boxShadow: [
          '0 0 0 0 color-mix(in srgb,var(--accent) 0%, transparent)',
          '0 0 40px 4px color-mix(in srgb,var(--accent) 28%, transparent)',
          '0 0 0 0 color-mix(in srgb,var(--accent) 0%, transparent)',
        ] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ZiggyMark size={42} />
      </motion.div>

      {/* device nodes */}
      {pts.map((p, i) => {
        const Icon = p.icon
        return (
          <motion.div
            key={p.label}
            className="absolute z-10 flex flex-col items-center gap-1.5"
            style={{ left: `${(p.x / 400) * 100}%`, top: `${(p.y / 400) * 100}%`, transform: 'translate(-50%,-50%)' }}
            initial={reduce ? false : { opacity: 0, scale: 0.6 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-ink-2 shadow-card">
              <Icon size={20} strokeWidth={1.75} />
            </div>
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-faint">{p.label}</span>
          </motion.div>
        )
      })}
    </div>
  )
}

/* ── Phone mock used in voice section ────────────────────────────────────── */

export function PhoneMock() {
  const reduce = useReducedMotion()
  return (
    <div className="relative mx-auto w-[280px]">
      <div className="overflow-hidden rounded-[40px] border border-line-2 bg-bg p-3 shadow-lg">
        <div className="overflow-hidden rounded-[30px] border border-line bg-surface">
          {/* status bar */}
          <div className="flex items-center justify-between px-5 pb-2 pt-4 font-mono text-[11px] font-semibold text-ink">
            <span>9:41</span>
            <span className="flex items-center gap-1 text-ink-mute"><Wifi size={12} /> ·</span>
          </div>
          {/* chat */}
          <div className="flex flex-col gap-3 px-4 pb-4 pt-2">
            <div className="self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-[13px] text-on-accent shadow-sm" dir="rtl">
              כבי את האורות בסלון ותדליקי מזגן בחדר שינה
            </div>
            <div className="max-w-[88%] self-start rounded-2xl rounded-bl-md border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
              Done — living-room lights off, bedroom AC set to 23°. Want me to pre-cool before you get home tomorrow?
            </div>
            <div className="self-start text-[11px] text-ink-faint">Understood in Hebrew · acted in 0.8s</div>
          </div>
          {/* mic bar */}
          <div className="flex items-center gap-3 border-t border-line px-4 py-3.5">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
              {!reduce && (
                <motion.span
                  className="absolute inset-0 rounded-full"
                  style={{ border: '2px solid var(--accent)' }}
                  animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              <Mic size={18} />
            </div>
            <div className="flex h-6 flex-1 items-end gap-[3px]">
              {Array.from({ length: 22 }).map((_, i) => (
                <motion.span
                  key={i}
                  className="flex-1 rounded-full bg-line-3"
                  style={{ minWidth: 2 }}
                  animate={reduce ? {} : { scaleY: [0.3, 1, 0.4, 0.8, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.06, ease: 'easeInOut' }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Small inline badges reused across sections ──────────────────────────── */

export function MiniStat({ value, label }) {
  return (
    <div className="flex flex-col">
      <span className="text-[clamp(1.6rem,3vw,2.2rem)] font-bold leading-none tracking-tight text-ink">{value}</span>
      <span className="mt-1.5 text-[13px] text-ink-mute">{label}</span>
    </div>
  )
}

export const Glyphs = { ShieldCheck, MoveRight, Wifi }
