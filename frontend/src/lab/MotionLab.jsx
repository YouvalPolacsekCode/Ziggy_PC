// Ziggy Motion Lab — /motion-lab
//
// A completely isolated playground: its own router, its own chrome, no auth,
// no backend, no production component imported. Each section holds
// interactive prototypes with variants, replay, slow motion and knobs.
// Nothing here is wired into the app; App.jsx only mounts this before the
// auth wall, the way the marketing site is mounted.
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, HashRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { LabProvider, useLab } from './LabContext'
import './lab.css'

const SECTIONS = [
  { key: 'overview', label: 'Overview', load: () => import('./sections/Overview') },
  { key: 'navigation', label: 'Navigation', load: () => import('./sections/Navigation') },
  { key: 'cards', label: 'Cards', load: () => import('./sections/Cards') },
  { key: 'devices', label: 'Devices', load: () => import('./sections/Devices') },
  { key: 'rooms', label: 'Rooms', load: () => import('./sections/Rooms') },
  { key: 'controls', label: 'Controls', load: () => import('./sections/Controls') },
  { key: 'feedback', label: 'Feedback', load: () => import('./sections/Feedback') },
  { key: 'data', label: 'Data', load: () => import('./sections/Data') },
  { key: 'pages', label: 'Page transitions', load: () => import('./sections/PageTransitions') },
  { key: 'moments', label: 'Moments', load: () => import('./sections/Moments') },
  { key: 'experimental', label: 'Experimental', load: () => import('./sections/Experimental') },
  { key: 'decisions', label: 'Decisions', load: () => import('./sections/Decisions') },
]
const COMPONENTS = Object.fromEntries(SECTIONS.map(s => [s.key, lazy(s.load)]))

function Seg({ value, options, onChange, label }) {
  return (
    <div className="ml-seg" role="group" aria-label={label}>
      <span className="ml-seg__label">{label}</span>
      {options.map(o => (
        <button
          key={String(o.value)}
          className={`ml-seg__btn ${o.value === value ? 'is-on' : ''}`}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
        >{o.label}</button>
      ))}
    </div>
  )
}

function HapticIndicator() {
  // flashes the haptic kind fired by any demo (desktop has no vibrator)
  useEffect(() => {
    const el = document.getElementById('ml-haptic')
    const onH = (e) => {
      if (!el) return
      el.textContent = `haptic · ${e.detail}`
      el.classList.remove('is-on')
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth
      el.classList.add('is-on')
    }
    window.addEventListener('lab:haptic', onH)
    return () => window.removeEventListener('lab:haptic', onH)
  }, [])
  return <span id="ml-haptic" className="ml-haptic" aria-live="polite" />
}

function Toolbar() {
  const lab = useLab()
  return (
    <div className="ml-toolbar">
      <Seg label="Speed" value={lab.speed} onChange={lab.setSpeed}
        options={lab.SPEEDS.map(s => ({ value: s, label: s === 1 ? '1×' : `${s}×` }))} />
      <Seg label="Theme" value={lab.theme} onChange={lab.setTheme}
        options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      <Seg label="Direction" value={lab.dir} onChange={lab.setDir}
        options={[{ value: 'ltr', label: 'EN' }, { value: 'rtl', label: 'עב' }]} />
      <Seg label="Frame" value={lab.frame} onChange={lab.setFrame}
        options={lab.FRAMES.map(f => ({ value: f.key, label: f.label }))} />
      <Seg label="Reduced motion" value={lab.reduced} onChange={lab.setReduced}
        options={[{ value: false, label: 'Off' }, { value: true, label: 'On' }]} />
      <HapticIndicator />
    </div>
  )
}

// Reviewer shortcuts: act on the demo nearest the middle of the viewport.
// 1–9 pick a variant · R replay · C compare · S cycle speed · D theme · H direction · M reduced motion
function useReviewerKeys(lab) {
  useEffect(() => {
    const nearestDemo = () => {
      const mid = window.innerHeight / 2
      let best = null, bestD = Infinity
      document.querySelectorAll('.ml-demo').forEach(el => {
        const r = el.getBoundingClientRect()
        const d = r.top > mid ? r.top - mid : r.bottom < mid ? mid - r.bottom : 0
        if (d < bestD) { bestD = d; best = el }
      })
      return best
    }
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return
      const k = e.key.toLowerCase()
      if (k >= '1' && k <= '9') { const d = nearestDemo(); const v = d?.querySelectorAll('.ml-variant')[Number(k) - 1]; if (v) { v.click(); e.preventDefault() } return }
      if (k === 'r') { const d = nearestDemo(); const b = [...(d?.querySelectorAll('.ml-demo__actions .ml-btn') || [])].find(x => x.textContent.includes('Replay')); b?.click(); return }
      if (k === 'c') { const d = nearestDemo(); const b = [...(d?.querySelectorAll('.ml-demo__actions .ml-btn') || [])].find(x => x.textContent.includes('Compare')); b?.click(); return }
      if (k === 's') { const i = lab.SPEEDS.indexOf(lab.speed); lab.setSpeed(lab.SPEEDS[(i + 1) % lab.SPEEDS.length]); return }
      if (k === 'd') { lab.setTheme(lab.theme === 'dark' ? 'light' : 'dark'); return }
      if (k === 'h') { lab.setDir(lab.dir === 'rtl' ? 'ltr' : 'rtl'); return }
      if (k === 'm') { lab.setReduced(!lab.reduced); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lab])
}

function Shell() {
  const location = useLocation()
  const lab = useLab()
  useReviewerKeys(lab)
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  return (
    <div className="ml-root">
      <header className="ml-header">
        <div className="ml-brand">
          <span className="ml-brand__mark">Z</span>
          <span className="ml-brand__name">Ziggy Motion Lab</span>
          <span className="ml-brand__sub">concept board · nothing here ships</span>
          <span className="ml-keys" title="Keyboard: act on the demo nearest the middle of the screen">keys · 1–9 variant · R replay · C compare · S speed · D dark · H hebrew · M reduced</span>
        </div>
        <Toolbar />
      </header>
      <nav className="ml-nav" aria-label="Sections">
        {SECTIONS.map(s => (
          <NavLink key={s.key} to={`/${s.key}`} className={({ isActive }) => `ml-nav__link ${isActive ? 'is-active' : ''}`}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <main className="ml-main">
        <Suspense fallback={<div className="ml-loading">Loading section…</div>}>
          <div key={location.pathname} className="ml-section-enter">
          <Routes>
            <Route index element={<Navigate to="/overview" replace />} />
            {SECTIONS.map(s => {
              const C = COMPONENTS[s.key]
              return <Route key={s.key} path={s.key} element={<C />} />
            })}
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
          </div>
        </Suspense>
      </main>
    </div>
  )
}

// `standalone` = the lab.html build (hash routing, hostable at any path).
// Inside the app it lives under /motion-lab with a real basename.
export default function MotionLab({ standalone = false }) {
  const Router = standalone ? HashRouter : BrowserRouter
  const routerProps = standalone ? {} : { basename: '/motion-lab' }
  return (
    <Router {...routerProps}>
      <LabProvider>
        <Routes>
          <Route path="/*" element={<Shell />} />
        </Routes>
      </LabProvider>
    </Router>
  )
}
