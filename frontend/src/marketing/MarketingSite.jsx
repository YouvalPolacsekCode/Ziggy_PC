// ─────────────────────────────────────────────────────────────────────────
// Ziggy — public marketing site (mounted at /welcome).
//
// Fully self-contained. Forces the premium-dark palette on its own subtree
// (the app's token system is attribute-scoped, so a wrapper data-palette is
// all it takes — the authenticated app's theme is untouched). Reuses the
// app's tokens, Tailwind, framer-motion and lucide-react. Delete this folder
// and the /welcome branch in App.jsx to revert with zero side effects.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { motion, useScroll, useTransform, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Menu, X, ArrowRight, CheckCircle2, Mail, Sparkles } from 'lucide-react'
import {
  Wordmark, ZiggyMark, Eyebrow, Reveal, ButtonPrimary, ButtonGhost, Pill, AuroraField,
} from './ui'
import { HomeConstellation, MiniStat } from './visuals'
import {
  TrustStrip, Problem, Kit, HowItWorks, Automations, Voice, Local, Compare, Pricing,
} from './sections'

const WAITLIST_EMAIL = 'hello@ziggy-home.co.il'

/* ── Marketing-only keyframes, scoped under .zmk so nothing leaks app-wide ── */
function ScopedStyles() {
  return (
    <style>{`
      .zmk { background: var(--bg); }
      @keyframes zmkFloatA { 0%,100%{ transform: translate(-50%,-50%) translate(0,0) } 50%{ transform: translate(-50%,-50%) translate(6%,-4%) } }
      @keyframes zmkFloatB { 0%,100%{ transform: translate(-50%,-50%) translate(0,0) } 50%{ transform: translate(-50%,-50%) translate(-7%,5%) } }
      @keyframes zmkPulse { 0%,100%{ opacity:.45; transform: translate(-50%,-50%) scale(1) } 50%{ opacity:.8; transform: translate(-50%,-50%) scale(1.12) } }
      .zmk-aurora { position:absolute; width:46vw; height:46vw; max-width:680px; max-height:680px; border-radius:9999px; filter: blur(90px); }
      .zmk-aurora-a { top:18%; left:22%; background: radial-gradient(circle, color-mix(in srgb,var(--accent) 32%, transparent), transparent 70%); animation: zmkFloatA 16s ease-in-out infinite; }
      .zmk-aurora-b { top:74%; left:80%; background: radial-gradient(circle, color-mix(in srgb,var(--gold) 22%, transparent), transparent 70%); animation: zmkFloatB 20s ease-in-out infinite; }
      .zmk-corepulse { animation: zmkPulse 3.4s ease-in-out infinite; }
      .zmk-grid { background-image: linear-gradient(var(--line) .5px, transparent .5px), linear-gradient(90deg, var(--line) .5px, transparent .5px); background-size: 46px 46px; mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, #000 30%, transparent 75%); -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, #000 30%, transparent 75%); }
      @media (prefers-reduced-motion: reduce) {
        .zmk-aurora-a, .zmk-aurora-b, .zmk-corepulse { animation: none; }
      }
    `}</style>
  )
}

/* ── Navigation ─────────────────────────────────────────────────────────── */
const NAV = [
  ['How it works', '#how'],
  ['Automations', '#automations'],
  ['Pricing', '#pricing'],
]
function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? 'border-b border-line bg-bg/80 backdrop-blur-xl' : 'border-b border-transparent'}`}>
      <nav className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <a href="#top" className="flex items-center"><Wordmark /></a>
        <div className="hidden items-center gap-8 md:flex">
          {NAV.map(([label, href]) => (
            <a key={href} href={href} className="text-[14px] font-medium text-ink-mute transition-colors hover:text-ink">{label}</a>
          ))}
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <a href="/" className="text-[14px] font-medium text-ink-mute transition-colors hover:text-ink">Open app</a>
          <ButtonPrimary href="#waitlist" className="px-5 py-2.5 text-[14px]">Join the waitlist</ButtonPrimary>
        </div>
        <button className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink md:hidden" onClick={() => setOpen(v => !v)} aria-label="Menu">
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            className="overflow-hidden border-t border-line bg-bg/95 backdrop-blur-xl md:hidden"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="flex flex-col gap-1 px-5 py-4">
              {NAV.map(([label, href]) => (
                <a key={href} href={href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-[15px] font-medium text-ink-2 hover:bg-surface-2">{label}</a>
              ))}
              <a href="/" className="rounded-lg px-3 py-3 text-[15px] font-medium text-ink-2 hover:bg-surface-2">Open app</a>
              <ButtonPrimary href="#waitlist" onClick={() => setOpen(false)} className="mt-2 w-full">Join the waitlist</ButtonPrimary>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

/* ── Hero ───────────────────────────────────────────────────────────────── */
function Hero() {
  const reduce = useReducedMotion()
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, [0, 600], [0, reduce ? 0 : 80])
  return (
    <section id="top" className="relative overflow-hidden pb-16 pt-32 sm:pb-24 sm:pt-40">
      <motion.div style={{ y }}><AuroraField /></motion.div>
      <div className="relative mx-auto grid w-full max-w-[1120px] grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col items-start gap-6">
          <Reveal>
            <Pill className="border-line-2 bg-surface/60 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-ok zmk-corepulse" style={{ position: 'static' }} />
              Founding-member kits — now open
            </Pill>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="text-balance text-[clamp(2.6rem,6.5vw,4.6rem)] font-extrabold leading-[0.98] tracking-[-0.03em] text-ink">
              Your smart home,<br />
              <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--gold)] bg-clip-text text-transparent">in a box.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="max-w-xl text-balance text-[clamp(1.05rem,1.8vw,1.3rem)] leading-relaxed text-ink-mute">
              A complete home that arrives pre-paired, sets up in 40 minutes, and just works — no installer, no code, no five-figure wiring. And when you move, it comes with you.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="flex flex-wrap items-center gap-3">
              <ButtonPrimary href="#waitlist">Join the waitlist <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" /></ButtonPrimary>
              <ButtonGhost href="#how">See how it works</ButtonGhost>
            </div>
          </Reveal>
          <Reveal delay={0.24}>
            <div className="mt-4 flex flex-wrap gap-x-9 gap-y-5 border-t border-line pt-6">
              <MiniStat value="40 min" label="From box to running" />
              <MiniStat value="0" label="Lines of code to write" />
              <MiniStat value="עב / EN" label="Speaks your language" />
            </div>
          </Reveal>
        </div>
        <Reveal delay={0.1}>
          <HomeConstellation />
        </Reveal>
      </div>
    </section>
  )
}

/* ── Waitlist / final CTA ───────────────────────────────────────────────── */
function Waitlist() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const submit = (e) => {
    e.preventDefault()
    if (!email.trim()) return
    // No backend wired here yet — capture gracefully and hand off to the
    // brand inbox. (Production replaces this with the Formspree endpoint.)
    setSent(true)
    window.location.href = `mailto:${WAITLIST_EMAIL}?subject=${encodeURIComponent('Ziggy waitlist')}&body=${encodeURIComponent(`Please add me to the Ziggy waitlist: ${email}`)}`
  }
  return (
    <section id="waitlist" className="relative overflow-hidden py-24 sm:py-32">
      <AuroraField />
      <div className="relative mx-auto w-full max-w-[760px] px-5 text-center sm:px-8">
        <Reveal>
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface shadow-lg">
            <ZiggyMark size={30} />
          </div>
          <Eyebrow>Be among the first</Eyebrow>
          <h2 className="mt-4 text-balance text-[clamp(2rem,5vw,3.3rem)] font-bold leading-[1.04] tracking-tight text-ink">
            Give your home a brain.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-balance text-[1.08rem] leading-relaxed text-ink-mute">
            Join the founding members getting Ziggy first — at the lifetime founder price. No spam, just an invite when your kit is ready.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <AnimatePresence mode="wait">
            {sent ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                className="mx-auto mt-9 flex max-w-md items-center justify-center gap-3 rounded-full border border-ok/40 bg-surface px-6 py-4 text-[15px] font-medium text-ink"
              >
                <CheckCircle2 size={20} className="text-ok" /> You’re on the list — opening your mail to confirm.
              </motion.div>
            ) : (
              <motion.form
                key="form"
                onSubmit={submit}
                initial={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="mx-auto mt-9 flex max-w-md flex-col gap-3 sm:flex-row"
              >
                <div className="relative flex-1">
                  <Mail size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    className="h-[52px] w-full rounded-full border border-line-2 bg-surface pl-11 pr-4 text-[15px] text-ink placeholder:text-ink-faint outline-none transition-colors focus:border-accent"
                  />
                </div>
                <ButtonPrimary className="h-[52px] shrink-0">Reserve my kit</ButtonPrimary>
              </motion.form>
            )}
          </AnimatePresence>
          <p className="mt-5 text-[13px] text-ink-faint">
            <Sparkles size={13} className="mr-1 inline text-gold" /> Founders lock in $5/mo for life · cancel anytime — your kit never stops working.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

/* ── Footer ─────────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-line bg-bg-2/60">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex flex-col gap-2">
          <Wordmark />
          <p className="text-[13px] text-ink-faint">Your smart home, in a box. Hebrew-first, renter-friendly, yours to keep.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px] text-ink-mute">
          <a href="#how" className="transition-colors hover:text-ink">How it works</a>
          <a href="#automations" className="transition-colors hover:text-ink">Automations</a>
          <a href="#pricing" className="transition-colors hover:text-ink">Pricing</a>
          <a href="/" className="transition-colors hover:text-ink">Open app</a>
          <a href={`mailto:${WAITLIST_EMAIL}`} className="transition-colors hover:text-ink">{WAITLIST_EMAIL}</a>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-5 text-[12px] text-ink-faint sm:px-8">
          © {new Date().getFullYear()} Ziggy. All rights reserved.
        </div>
      </div>
    </footer>
  )
}

/* ── Page ───────────────────────────────────────────────────────────────── */
export default function MarketingSite() {
  // Keep the document title sane while on the marketing route; restore on leave.
  useEffect(() => {
    const prev = document.title
    document.title = 'Ziggy — Your smart home, in a box'
    return () => { document.title = prev }
  }, [])
  return (
    <div data-palette="dark" className="zmk min-h-screen scroll-smooth font-sans text-ink antialiased" style={{ background: 'var(--bg)' }}>
      <ScopedStyles />
      <Nav />
      <main>
        <Hero />
        <TrustStrip />
        <Problem />
        <div id="how"><Kit /></div>
        <HowItWorks />
        <Automations />
        <Voice />
        <Local />
        <Compare />
        <Pricing />
        <Waitlist />
      </main>
      <Footer />
    </div>
  )
}
