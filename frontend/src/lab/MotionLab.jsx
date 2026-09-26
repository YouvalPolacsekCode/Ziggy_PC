// Ziggy Motion Lab — /motion-lab
//
// A completely isolated playground: its own router, its own chrome, no auth,
// no backend, no production component imported. Each section holds
// interactive prototypes with variants, replay, slow motion and knobs.
// Nothing here is wired into the app; App.jsx only mounts this before the
// auth wall, the way the marketing site is mounted.
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
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
  { key: 'experimental', label: 'Experimental', load: () => import('./sections/Experimental') },
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

function Shell() {
  const location = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  return (
    <div className="ml-root">
      <header className="ml-header">
        <div className="ml-brand">
          <span className="ml-brand__mark">Z</span>
          <span className="ml-brand__name">Ziggy Motion Lab</span>
          <span className="ml-brand__sub">concept board · nothing here ships</span>
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
          <Routes>
            <Route index element={<Navigate to="/overview" replace />} />
            {SECTIONS.map(s => {
              const C = COMPONENTS[s.key]
              return <Route key={s.key} path={s.key} element={<C />} />
            })}
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}

export default function MotionLab() {
  return (
    <BrowserRouter basename="/motion-lab">
      <LabProvider>
        <Routes>
          <Route path="/*" element={<Shell />} />
        </Routes>
      </LabProvider>
    </BrowserRouter>
  )
}
