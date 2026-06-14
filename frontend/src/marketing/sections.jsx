// ─────────────────────────────────────────────────────────────────────────
// Ziggy marketing site — content sections.
// Copy is grounded entirely in the product docs / codebase. No HA / Zigbee2MQTT
// / cloud-infra internals leak into client-facing language.
// ─────────────────────────────────────────────────────────────────────────
import { motion } from 'framer-motion'
import {
  Sparkles, PackageOpen, Hand, Tag, Home, Snowflake,
  LogOut, Moon, Eye, SunMedium, Film, Waves, AlertTriangle, Baby,
  WifiOff, ShieldCheck, RefreshCw, Lock, Languages, X, Check, Minus,
  Cpu, Sticker, Boxes, MoveRight,
} from 'lucide-react'
import {
  Reveal, SectionHeading, Card, Eyebrow, Pill, ButtonPrimary, AuroraField,
} from './ui'
import { PhoneMock } from './visuals'

const wrap = 'mx-auto w-full max-w-[1120px] px-5 sm:px-8'

/* ── 1 · Trust / capability strip ───────────────────────────────────────── */
export function TrustStrip() {
  const items = ['Lights', 'Climate & AC', 'Sensors', 'Door & motion', 'Smart plugs', 'IR devices', 'Voice', 'Presence']
  return (
    <section className="border-y border-line bg-bg-2/60">
      <div className={`${wrap} py-6`}>
        <p className="mb-5 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          One home. One app. Everything talks to everything.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2.5">
          {items.map((it) => (
            <Pill key={it}><span className="h-1.5 w-1.5 rounded-full bg-ok" />{it}</Pill>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 2 · The problem ────────────────────────────────────────────────────── */
export function Problem() {
  const pains = [
    { before: 'Four apps for four brands', after: 'One app for the whole home' },
    { before: 'A weekend lost to YAML', after: 'Pre-paired — running in 40 minutes' },
    { before: '₪40,000 wired install', after: 'Peel-and-stick, renter-friendly' },
    { before: 'Leave it behind when you move', after: 'Pack it. It moves with you.' },
  ]
  return (
    <section className="py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <SectionHeading
            eyebrow="Why Ziggy"
            title="A smart home shouldn't need an engineer"
            lede="Most smart homes are either a drawer of half-paired gadgets or a five-figure installation bolted to a wall you don't own. Ziggy is the third option."
          />
        </Reveal>
        <div className="mt-14 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {pains.map((p, i) => (
            <Reveal key={p.before} delay={i * 0.06}>
              <Card className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-2.5 text-[15px] text-ink-faint line-through decoration-err/50">
                  <X size={16} className="shrink-0 text-err" /> {p.before}
                </span>
                <MoveRight size={16} className="hidden shrink-0 text-ink-ghost sm:block" />
                <span className="flex items-center gap-2.5 text-[15px] font-medium text-ink">
                  <Check size={16} className="shrink-0 text-ok" /> {p.after}
                </span>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── 3 · What's in the box ──────────────────────────────────────────────── */
export function Kit() {
  const box = [
    { icon: Cpu, name: 'The Ziggy brain', note: 'A small, silent computer. Your home runs on it — locally.' },
    { icon: Boxes, name: 'Zigbee gateway', note: 'Speaks to every sensor and device, out of the box.' },
    { icon: Sticker, name: 'Peel-and-stick sensors', note: 'Temperature, motion and door sensors. No tools, no holes.' },
    { icon: SunMedium, name: 'Smart lighting', note: 'Bulbs and a warm filament bulb, paired and ready.' },
    { icon: Waves, name: 'Smart plug', note: 'Fits Israeli sockets natively. Makes anything switchable.' },
    { icon: Film, name: 'IR blaster', note: 'Controls your AC and TV — even the “dumb” ones.' },
  ]
  return (
    <section className="relative overflow-hidden border-y border-line bg-bg-2/50 py-20 sm:py-28">
      <AuroraField />
      <div className={`${wrap} relative`}>
        <Reveal>
          <SectionHeading
            eyebrow="The kit"
            title="Everything pre-paired, in one box"
            lede="No pairing screens. No hub-of-hubs. Open the box and the hardest part is already done."
          />
        </Reveal>
        <div className="mt-14 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {box.map((b, i) => {
            const Icon = b.icon
            return (
              <Reveal key={b.name} delay={i * 0.05}>
                <Card hover className="h-full p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-2 text-accent">
                    <Icon size={20} strokeWidth={1.75} />
                  </div>
                  <h3 className="text-[16px] font-semibold text-ink">{b.name}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-mute">{b.note}</p>
                </Card>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ── 4 · Setup in 40 minutes ────────────────────────────────────────────── */
export function HowItWorks() {
  const steps = [
    { icon: PackageOpen, n: '01', t: 'Unbox', d: 'Plug in the brain. Every device inside is already paired at the factory.' },
    { icon: Hand, n: '02', t: 'Peel & stick', d: 'Place the sensors where they belong. No drilling, no wiring, no damage.' },
    { icon: Tag, n: '03', t: 'Name & assign', d: 'Open the app, name your devices, drop them into rooms.' },
    { icon: Home, n: '04', t: 'Ziggy takes over', d: 'It reads your devices and suggests the automations worth turning on.' },
  ]
  return (
    <section className="py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <SectionHeading
            eyebrow="Setup"
            title="From box to brilliant in 40 minutes"
            lede="No installer. No expertise. The kind of setup you can finish before dinner."
          />
        </Reveal>
        <div className="relative mt-14 grid grid-cols-1 gap-3.5 md:grid-cols-4">
          <div className="pointer-events-none absolute left-0 right-0 top-[34px] hidden h-px bg-gradient-to-r from-transparent via-line-3 to-transparent md:block" />
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <Reveal key={s.n} delay={i * 0.08}>
                <div className="flex flex-col gap-4">
                  <div className="relative flex h-[68px] w-[68px] items-center justify-center rounded-2xl border border-line bg-surface text-accent shadow-card">
                    <Icon size={24} strokeWidth={1.75} />
                    <span className="absolute -right-1.5 -top-1.5 rounded-full bg-ink px-1.5 py-0.5 font-mono text-[10px] font-semibold text-bg">{s.n}</span>
                  </div>
                  <div>
                    <h3 className="text-[17px] font-semibold text-ink">{s.t}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-ink-mute">{s.d}</p>
                  </div>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ── 5 · The living system — automations ────────────────────────────────── */
const AUTOMATIONS = [
  { icon: Snowflake, t: 'Pre-Cool', d: 'AC kicks on before you walk in, timed to your arrival.' },
  { icon: LogOut, t: 'Last One Out', d: 'When the home empties, everything switches off behind you.' },
  { icon: Moon, t: 'Night Watch', d: 'At bedtime, Ziggy checks every light and device is off.' },
  { icon: Eye, t: 'Fake Occupancy', d: 'Away? Lights flicker on and off so the home looks lived-in.' },
  { icon: SunMedium, t: 'Circadian Light', d: 'Color and warmth shift gently with the hour of the day.' },
  { icon: Film, t: 'Movie Mode', d: 'TV turns on, the lights dim to a scene. No remote juggling.' },
  { icon: Waves, t: 'Laundry Done', d: 'Senses the wash cycle finish and pings you it’s ready.' },
  { icon: AlertTriangle, t: 'Overload Alert', d: 'Warns you before the total power draw trips a breaker.' },
  { icon: Baby, t: 'Kid Bedtime', d: 'Lights fade down and certain devices lock on schedule.' },
]
export function Automations() {
  return (
    <section id="automations" className="relative overflow-hidden border-y border-line bg-bg-2/50 py-20 sm:py-28">
      <AuroraField />
      <div className={`${wrap} relative`}>
        <Reveal>
          <SectionHeading
            eyebrow="The living system"
            title="A home that anticipates, not just obeys"
            lede="Ziggy ships with a library of automations and suggests the right ones based on the devices you have. Switch on the ones you want — adjust them in plain language, never code."
          />
        </Reveal>
        <div className="mt-14 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {AUTOMATIONS.map((a, i) => {
            const Icon = a.icon
            return (
              <Reveal key={a.t} delay={(i % 3) * 0.06}>
                <Card hover className="group h-full overflow-hidden p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-accent transition-colors group-hover:bg-accent group-hover:text-on-accent">
                      <Icon size={18} strokeWidth={1.85} />
                    </div>
                    <div>
                      <h3 className="text-[15.5px] font-semibold text-ink">{a.t}</h3>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-mute">{a.d}</p>
                    </div>
                  </div>
                </Card>
              </Reveal>
            )
          })}
        </div>
        <Reveal delay={0.1}>
          <p className="mt-8 text-center text-[14px] text-ink-faint">
            <Sparkles size={14} className="mr-1.5 inline text-gold" />
            …and more, including a built-in <span className="text-ink-2">Shabbat Mode</span>. Ziggy suggests automations the moment it sees a matching device.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

/* ── 6 · Voice & AI ─────────────────────────────────────────────────────── */
export function Voice() {
  return (
    <section className="py-20 sm:py-28">
      <div className={`${wrap} grid grid-cols-1 items-center gap-14 lg:grid-cols-2`}>
        <Reveal>
          <div className="flex flex-col gap-5">
            <Eyebrow>Voice &amp; AI</Eyebrow>
            <h2 className="text-[clamp(1.9rem,4.4vw,3rem)] font-bold leading-[1.06] tracking-tight text-ink">
              Just say it. <br />In Hebrew or English.
            </h2>
            <p className="max-w-xl text-[clamp(1rem,1.6vw,1.15rem)] leading-relaxed text-ink-mute">
              Ziggy understands real, messy, everyday Hebrew — not a phrasebook of trigger words. Ask it to do two things at once, ask it a question, or let it propose what to automate next. It answers in the language you spoke.
            </p>
            <ul className="mt-1 flex flex-col gap-3">
              {[
                ['Hebrew-first, English-fluent', 'Built for Israeli homes, not translated into one.'],
                ['Understands intent', '“Turn off the salon and cool the bedroom” — handled in one breath.'],
                ['Suggests, doesn’t nag', 'It learns your devices and offers automations worth having.'],
              ].map(([h, d]) => (
                <li key={h} className="flex gap-3">
                  <Check size={18} className="mt-0.5 shrink-0 text-accent" />
                  <span className="text-[14.5px] text-ink-2"><span className="font-semibold text-ink">{h}.</span> <span className="text-ink-mute">{d}</span></span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill><Languages size={13} className="text-accent" /> עברית</Pill>
              <Pill><Languages size={13} className="text-accent" /> English</Pill>
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <PhoneMock />
        </Reveal>
      </div>
    </section>
  )
}

/* ── 7 · Local-first / privacy / reliability ────────────────────────────── */
export function Local() {
  const cards = [
    { icon: WifiOff, t: 'Works offline', d: 'Your home runs on the brain in the room — not on someone else’s server. The internet can blink; your lights won’t.' },
    { icon: Lock, t: 'Private by design', d: 'Local-first means your routines, presence and sensors stay in your home. No always-listening cloud microphone.' },
    { icon: RefreshCw, t: 'Cancel-proof', d: 'Stop your subscription and the kit keeps working. Only the cloud extras step back — your automations never break.' },
    { icon: ShieldCheck, t: 'Yours to keep', d: 'Open Zigbee standard, not a walled garden. Add compatible devices freely, and take the whole system with you.' },
  ]
  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <SectionHeading
            eyebrow="Local-first"
            title="The intelligence lives in your home"
            lede="Ziggy runs on the brain on your shelf. The cloud adds remote access, backups and the smartest conversations — but it’s never the thing keeping your lights on."
          />
        </Reveal>
        <div className="mt-14 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {cards.map((c, i) => {
            const Icon = c.icon
            return (
              <Reveal key={c.t} delay={i * 0.06}>
                <Card className="flex h-full gap-4 p-6">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-2 text-accent">
                    <Icon size={20} strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-semibold text-ink">{c.t}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-ink-mute">{c.d}</p>
                  </div>
                </Card>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ── 8 · Comparison ─────────────────────────────────────────────────────── */
export function Compare() {
  const rows = [
    ['Ready in 40 minutes', true, false, 'mid', true],
    ['No code, no YAML', true, false, true, true],
    ['Renter-friendly, no drilling', true, 'mid', false, true],
    ['Moves to your next home', true, true, false, false],
    ['Hebrew-first voice & app', true, false, false, 'mid'],
    ['Works offline / private', true, true, false, false],
    ['Cross-brand automations', true, true, false, 'mid'],
  ]
  const cols = ['Ziggy', 'DIY Home Assistant', 'Pro install', 'Google / Alexa']
  const Cell = ({ v }) => {
    if (v === true) return <Check size={17} className="mx-auto text-ok" />
    if (v === false) return <X size={16} className="mx-auto text-err/70" />
    return <Minus size={16} className="mx-auto text-warn" />
  }
  return (
    <section className="relative overflow-hidden border-y border-line bg-bg-2/50 py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <SectionHeading eyebrow="The honest comparison" title="Where Ziggy stands apart" />
        </Reveal>
        <Reveal delay={0.08}>
          <Card className="mt-12 overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-5 py-4 text-left font-medium text-ink-faint" />
                    {cols.map((c, i) => (
                      <th key={c} className={`px-4 py-4 text-center font-semibold ${i === 0 ? 'text-accent' : 'text-ink-mute'}`}>
                        {i === 0 ? <span className="inline-flex items-center gap-1.5">{c}</span> : c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={ri} className="border-b border-line last:border-0">
                      <td className="px-5 py-3.5 text-left font-medium text-ink-2">{r[0]}</td>
                      {[1, 2, 3, 4].map((ci) => (
                        <td key={ci} className={`px-4 py-3.5 ${ci === 1 ? 'bg-accent-2/40' : ''}`}><Cell v={r[ci]} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Reveal>
        <p className="mt-4 text-center text-[12.5px] text-ink-faint">
          <Check size={12} className="inline text-ok" /> full · <Minus size={12} className="inline text-warn" /> partial · <X size={12} className="inline text-err/70" /> not really
        </p>
      </div>
    </section>
  )
}

/* ── 9 · Pricing ────────────────────────────────────────────────────────── */
export function Pricing() {
  const tiers = [
    {
      name: 'Home',
      price: '$599',
      founder: '$499',
      tag: 'The complete starter home',
      feats: ['The Ziggy brain + gateway', 'Sensors, plug, IR blaster & bulbs', 'All automations & voice', 'Remote access & backups'],
      featured: false,
    },
    {
      name: 'Pro',
      price: '$999',
      founder: '$799',
      tag: 'Fully local, more devices',
      feats: ['Everything in Home', 'More sensors & coverage', 'Fully on-device intelligence', 'Priority support'],
      featured: true,
    },
  ]
  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <SectionHeading
            eyebrow="Pricing"
            title="One kit. Then it’s yours."
            lede="A one-time kit, plus an optional subscription for cloud access, backups and the smartest AI — about the price of a coffee a month."
          />
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          {tiers.map((t, i) => (
            <Reveal key={t.name} delay={i * 0.08}>
              <Card
                className={`flex h-full flex-col p-7 ${t.featured ? 'border-accent/40 shadow-lg' : ''}`}
                style={t.featured ? { background: 'linear-gradient(180deg, color-mix(in srgb,var(--accent) 7%, var(--surface)), var(--surface))' } : undefined}
              >
                {t.featured && (
                  <span className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-on-accent">
                    <Sparkles size={12} /> Most capable
                  </span>
                )}
                <h3 className="text-[20px] font-bold text-ink">{t.name}</h3>
                <p className="mt-1 text-[13.5px] text-ink-mute">{t.tag}</p>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="text-[40px] font-bold leading-none tracking-tight text-ink">{t.founder}</span>
                  <span className="text-[15px] text-ink-faint line-through">{t.price}</span>
                </div>
                <p className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-gold">Founding-member price</p>
                <ul className="mt-6 flex flex-col gap-3">
                  {t.feats.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[14px] text-ink-2">
                      <Check size={16} className="mt-0.5 shrink-0 text-accent" /> {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-7">
                  <ButtonPrimary href="#waitlist" className="w-full">Reserve your kit</ButtonPrimary>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <div className="mx-auto mt-5 flex max-w-3xl flex-col items-center justify-between gap-3 rounded-[18px] border border-line bg-surface-2 px-6 py-4 text-center sm:flex-row sm:text-left">
            <p className="text-[14px] text-ink-mute">
              <span className="font-semibold text-ink">Ziggy+ subscription</span> — cloud access, encrypted backups & the smartest AI.
            </p>
            <p className="shrink-0 text-[14px] text-ink-2">
              <span className="font-semibold text-ink">$9</span>/mo · $89/yr · <span className="text-gold">Founders $5/mo for life</span>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
