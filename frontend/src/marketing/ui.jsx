// ─────────────────────────────────────────────────────────────────────────
// Ziggy marketing site — shared primitives.
//
// Self-contained module for the public marketing site mounted at /welcome.
// Reuses the app's design tokens (CSS variables in src/index.css) and the
// installed stack (Tailwind + framer-motion + lucide-react). Nothing here is
// imported by the authenticated app — delete the `marketing/` folder and the
// /welcome branch in App.jsx to fully revert.
// ─────────────────────────────────────────────────────────────────────────
import { motion, useReducedMotion } from 'framer-motion'

const EASE = [0.16, 1, 0.3, 1]

/** Brand mark — the gold lightning "Z" from public/icons/icon.svg. */
export function ZiggyMark({ size = 28, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="zmk-bolt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--gold)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <path
        d="M320 80H160l-48 160h96L160 432l192-224h-96z"
        fill="url(#zmk-bolt)"
      />
    </svg>
  )
}

export function Wordmark({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <ZiggyMark size={22} />
      <span className="text-[19px] font-extrabold tracking-tight text-ink">Ziggy</span>
    </span>
  )
}

export function Eyebrow({ children, className = '' }) {
  return (
    <span
      className={`font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent ${className}`}
    >
      {children}
    </span>
  )
}

/** Scroll-reveal wrapper. Honors prefers-reduced-motion. */
export function Reveal({ children, delay = 0, y = 20, className = '', as = 'div' }) {
  const reduce = useReducedMotion()
  const M = motion[as] || motion.div
  return (
    <M
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.75, delay, ease: EASE }}
    >
      {children}
    </M>
  )
}

/** Section header block — eyebrow + display title + optional lede. */
export function SectionHeading({ eyebrow, title, lede, align = 'center', className = '' }) {
  const alignCls = align === 'center' ? 'items-center text-center mx-auto' : 'items-start text-left'
  return (
    <div className={`flex max-w-2xl flex-col gap-4 ${alignCls} ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="text-balance text-[clamp(1.9rem,4.6vw,3.1rem)] font-bold leading-[1.05] tracking-tight text-ink">
        {title}
      </h2>
      {lede && (
        <p className="text-balance text-[clamp(1rem,1.6vw,1.18rem)] leading-relaxed text-ink-mute">
          {lede}
        </p>
      )}
    </div>
  )
}

/** Generic card surface matching the app's z-card language. */
export function Card({ children, className = '', hover = false, style }) {
  return (
    <div
      style={style}
      className={[
        'relative rounded-[20px] border border-line bg-surface',
        hover ? 'transition-transform duration-300 will-change-transform hover:-translate-y-1' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  )
}

export function Pill({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[12.5px] font-medium text-ink-2 ${className}`}
    >
      {children}
    </span>
  )
}

/** Primary + secondary marketing buttons. */
export function ButtonPrimary({ children, href, onClick, className = '', ...rest }) {
  const cls =
    `group inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-on-accent shadow-lg transition-all duration-300 hover:brightness-[1.06] hover:shadow-[0_18px_40px_-12px_var(--accent)] active:scale-[0.98] ${className}`
  return href ? (
    <a href={href} className={cls} {...rest}>{children}</a>
  ) : (
    <button onClick={onClick} className={cls} {...rest}>{children}</button>
  )
}

export function ButtonGhost({ children, href, onClick, className = '', ...rest }) {
  const cls =
    `inline-flex items-center justify-center gap-2 rounded-full border border-line-2 bg-surface/40 px-6 py-3 text-[15px] font-semibold text-ink backdrop-blur-sm transition-colors duration-300 hover:border-line-3 hover:bg-surface ${className}`
  return href ? (
    <a href={href} className={cls} {...rest}>{children}</a>
  ) : (
    <button onClick={onClick} className={cls} {...rest}>{children}</button>
  )
}

/** Subtle dot-grid + aurora background usable behind any section. */
export function AuroraField({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <div className="zmk-aurora zmk-aurora-a" />
      <div className="zmk-aurora zmk-aurora-b" />
      <div className="zmk-grid absolute inset-0 opacity-[0.5]" />
    </div>
  )
}
