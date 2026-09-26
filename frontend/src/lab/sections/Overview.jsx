// Motion Lab — OVERVIEW
// What the investigation found, the principle the lab follows, the proposed
// architecture, and an index of every concept with its variants.
import { Link } from 'react-router-dom'

const FINDINGS = [
  ['A motion layer already ships', 'frontend/src/motion/ (2,665 lines): press scale, state colour crossfade + icon "ignition", enter-only page rise, 35ms stagger, disclosure fold, room tile → hero FLIP, device sheet with detents and handoff, swipe-back, scrub-to-dim, long-press, haptics. Default ON, ?motion=off is the rollback. Everything in this lab builds on it, not beside it.'],
  ['Nothing interpolates a number', 'No useSpring / useMotionValue / count-up in any device, room or dashboard view. Brightness %, °C, W, battery %, counts, countdowns and the climate arc all cut. The only smoothly advancing number is media position at 1 Hz.'],
  ['The phone nav has no indicator', 'NAV_HL_SURFACE is null (BottomNav.jsx:140); the active tab changes stroke width, colour and weight in one frame. The desktop sidebar has a 320 ms sliding highlight, but its icon and label still cut.'],
  ['Every route is enter-only', 'Forward: 340 ms fade + 8 px rise. Back: 260 ms fade + 1.2% scale. The old page vanishes in the same commit the new one mounts, because two earlier exit handshakes black-screened the app (AppShell.jsx:306-333). A cold lazy route plays its enter on a blank 60 vh box.'],
  ['Occupancy shows one of three states', 'A User-glyph chip renders only when occupied === true; empty and unknown are indistinguishable. The chip mounts with no transition. data-motion-live (the breathing dot) was specified and never emitted.'],
  ['Feedback lives in toasts', '190 error toasts vs 119 success. Toast exit is as slow as its enter; newest appends below; no undo anywhere. Run on an automation has no busy state; the outcome arrives as a WS toast seconds later.'],
  ['Local and remote changes look identical', 'A wall switch flip and your own tap both render as a 160/220 ms crossfade. The only origin cues in the app are IR-specific (a pulsing dot and a toast).'],
  ['Cross-container moves teleport', 'A task ticked done, an anomaly changing severity, a suggestion actioned: two AnimatePresence trees, so exit + enter, never a travel. Actions.jsx wraps a plain <div> in popLayout, so its card exits do nothing.'],
  ['Banners reflow the page', 'ConnectionStatus enters over 240 ms and exits with return null; being sticky, the whole page jumps. "Back online" exists in i18n and is never shown. SystemHealthBanner has no motion at all.'],
  ['Five optimistic-update strategies coexist', 'DeviceCard reverts on throw; Devices.jsx does not flip locally; LightControls holds a commit lock; SwitchRemote predicts; only the wall has a snapshot + rollback pair. In-flight "breathe" is applied to some surfaces and not others.'],
  ['A global reduced-motion clamp overrides the layer', 'index.css:718 sets *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important }. It wins over every nuanced "keep colour and opacity, drop travel" rule in motion.css and controls.css. Reduced motion today is "remove", not "reduce".'],
  ['Two strong ease-out curves coexist', 'CSS_EASE.out (0.23, 1, 0.32, 1) vs --ease-enter / --m-out (0.16, 1, 0.3, 1). motion.js exports EASE, DUR and SPRING that nothing imports. lib/motion.js is a second, smaller token file.'],
  ['No icon morphs', 'Play/Pause, Lock/LockOpen, Volume/Mute hard-swap. The bulb glyph is the same asset on and off; only its box recolours.'],
  ['Dead motion code', 'useSheetDetents, pageEnterProps, setMotion, setHaptics, safe(), onReducedChange, DataState (the canonical four-state wrapper), uiStore.toastError: all defined, none called.'],
]

const PRINCIPLES = [
  ['Continuity', 'The thing you touched is the thing that moves. A tile becomes the sheet; a status dot becomes the toast; the row you ticked flies to Done.'],
  ['Causality', 'Effects follow causes in time. Thumb first, then the circuit closes. Surface first, then the content. Ring while waiting, check on the answer.'],
  ['Hierarchy', 'Importance has weight. The open card lifts and the others recede. The touched room rises over its siblings for the journey.'],
  ['State', 'A number that changes is an event: roll it or glide it. A glyph that changes state should turn into its next self.'],
  ['Physical relationship', 'Detail is beside list, sheet is below page, Done is below To do. Springs for what the finger drives; tweens for what the system decides. Exits faster than entrances. Never ease-in.'],
  ['Restraint', 'Frequent interactions get little or no motion. One earned ambient loop (occupied = "true right now"). Reduced motion keeps colour and opacity and drops travel, scale and loops.'],
]

const ARCH = [
  ['framer-motion 11 → motion 13', 'No breaking changes for this app (React 18 supported; the only 13.x break concerns styled-components). Gains: Reorder with RTL, faster spring retargeting, hardware-accelerated useScroll. The lab still imports framer-motion so it runs on today\'s dependency; the swap is a find-and-replace.'],
  ['GSAP 3.15 (free, all plugins)', 'Added to this branch for the lab. Use it only where Motion cannot: MorphSVG path morphs (icons, the orb), Flip for DOM-reparenting morphs, timelines with labels. Motion stays the primary engine for UI state.'],
  ['One token file', 'Merge motion/motion.js, lib/motion.js and the CSS custom properties into one vocabulary: durations (press 120, micro 160, fast 200, base 260, slow 400), one strong ease-out, one in-out, the drawer curve, and three springs (snappy / gentle / gesture). Delete the unused exports.'],
  ['Fix the reduced-motion clamp', 'Replace the !important blanket with the layer\'s own policy: transforms and loops off, opacity and colour on at ≤160 ms. MotionConfig reducedMotion="user" already does this for framer; CSS must match.'],
  ['Exit handshake, safely', 'Every page-transition variant here keeps both pages absolutely positioned inside one AnimatePresence without mode="wait", which is the configuration that never stalls. Shared-element travel needs a LayoutGroup above the router.'],
  ['Origin on the wire', 'Remote-change cues need the WS state_changed event to carry an origin (HA context.user_id / parent_id). Backend change, small.'],
  ['Numbers via motion values', 'Interpolated readouts render through useSpring + useTransform on a motion.span, off React\'s render loop. NumberFlow declares Hebrew/RTL unsupported; the 20-line rolling digit here works inside a dir="ltr" island.'],
  ['Haptics through Capacitor', 'navigator.vibrate is a no-op on iOS and desktop. Map: selectionChanged for scrubs, impact Light for toggles, Medium for detents, Heavy for destructive confirms, notification Success/Error for outcomes.'],
  ['Performance rules kept', 'Transform / opacity / clip-path / filter only, plus two deliberate layout animations (disclosure, banner push). No `transition: all`. Hover only under (hover:hover) and (pointer:fine). Glow blooms and dimmed siblings capped to small sets.'],
]

const INDEX = [
  ['navigation', 'Navigation', ['Nav active state (5)', 'More menu (3)', 'Nav on scroll (3)', 'Sidebar highlight (3)']],
  ['cards', 'Cards', ['Expanding card (4)', 'List insert / remove (3)', 'Re-sort (3)', 'Cross-container travel (2)']],
  ['devices', 'Devices', ['State change origin (4)', 'Pending → confirmed / failed (4)', 'Card expand: Show controls (3)', 'Icon morphs', 'Device sheet detents']],
  ['rooms', 'Rooms', ['Room occupancy (5)', 'Temperature change (2)', 'Long-press all lights (2)', 'Home status line (2)']],
  ['controls', 'Controls', ['Toggle (4)', 'Power button (4)', 'Brightness (4)', 'Temperature target (4)', 'Mode segment (3)', 'Hold to delete']],
  ['feedback', 'Feedback', ['Toast (4)', 'Connection banner (3)', 'Empty → first item (2)', 'Loading → content (3)', 'Destructive confirmation (2)']],
  ['data', 'Data', ['Live readout (3)', 'Sparkline', 'Battery + signal', 'Confidence meter (2)', 'Counts + badges', 'Cooling progress']],
  ['pages', 'Page transitions', ['List → detail (5)', 'Tab content (3)', 'Sheet → page (2)', 'Swipe back']],
  ['experimental', 'Experimental', ['Ambient home', 'Room exposure', 'Ziggy orb', 'Rewind the day', 'Parallax tiles', 'AC breeze']],
]

export default function Overview() {
  return (
    <div className="ml-overview">
      <div className="ml-section__intro">
        <h2>Ziggy Motion Lab</h2>
        <p>A concept board for how Ziggy should move. Every prototype is interactive; most have variants (A/B/C…) so a decision can be made by feel, not by description. Use the toolbar: slow it to 0.25×, switch to dark, flip to Hebrew, simulate reduced motion. Nothing here touches the product.</p>
        <p>The starred variant (★) is the one I would pick. It is a recommendation, not a decision.</p>
      </div>

      <h3 className="ml-h3">What the investigation found</h3>
      <div className="ml-findings">
        {FINDINGS.map(([h, b]) => <div key={h} className="ml-finding"><strong>{h}</strong><p>{b}</p></div>)}
      </div>

      <h3 className="ml-h3">The principle</h3>
      <p className="ml-lede">Motion communicates continuity, causality, hierarchy, state and physical relationship. Prefer an object moving or morphing into its next state over "old thing fades out, new thing fades in".</p>
      <div className="ml-findings">
        {PRINCIPLES.map(([h, b]) => <div key={h} className="ml-finding"><strong>{h}</strong><p>{b}</p></div>)}
      </div>

      <h3 className="ml-h3">Proposed architecture (when we implement)</h3>
      <div className="ml-findings">
        {ARCH.map(([h, b]) => <div key={h} className="ml-finding"><strong>{h}</strong><p>{b}</p></div>)}
      </div>

      <h3 className="ml-h3">Index · 44 concepts · 110 variants</h3>
      <div className="ml-index">
        {INDEX.map(([key, label, items]) => (
          <Link key={key} to={`/${key}`} className="ml-index__card">
            <strong>{label}</strong>
            <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>
          </Link>
        ))}
      </div>
    </div>
  )
}
