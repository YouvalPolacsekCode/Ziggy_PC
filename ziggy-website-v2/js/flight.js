import { animate, createTimeline, stagger, onScroll, svg } from 'https://cdn.jsdelivr.net/npm/animejs@4/+esm';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PORTRAIT = matchMedia('(orientation: portrait)').matches;

function init() {
  if (!REDUCED) {
    // idle breathing wave — independent loop, not scroll-synced
    animate('.wbar', {
      scaleY: [0.35, 1, 0.35],
      duration: 1600,
      delay: stagger(140),
      loop: true,
      ease: 'inOutSine',
      transformOrigin: '50% 100%',
    });

    const tl = createTimeline({
      defaults: { ease: 'inOutQuad' },
      autoplay: onScroll({
        target: '#scroll-track',
        sync: true,
        enter: 'top top',
        leave: 'bottom bottom',
      }),
    });

    tl
      // Act 1 → 2: lids open, hero copy drifts up as the whole hero fades, and
      // the rise act crossfades in underneath. The copy drift is folded into
      // the same beat as the container fade so nothing lingers on a dead stage.
      .add('#lid-l', { rotate: -120, duration: 700 })
      .add('#lid-r', { rotate: 120, duration: 700 }, '<')
      // hero content lifts up and fades — duration raised to ~1400ms (was ~700ms)
      // for a slower, more deliberate departure. Stagger preserved.
      .add('#act-hero h1, #act-hero .sub, #act-hero .waitlist, #act-hero .scroll-hint',
           { y: -40, opacity: 0, duration: 1400, delay: stagger(50), ease: 'in(2)' }, '<+=200')
      // rise fades in while hero is still ~40% visible — deepen the overlap.
      .add('#act-rise', { opacity: [0, 1], duration: 1000, ease: 'out(2)' })
      // hero container fades on a LONG, late ease so it is still partly on
      // screen while rise ramps up — duration raised to 2400ms, offset deepened
      // to -=2000 to preserve the 40%-visible overlap with the slower hero copy.
      .add('#act-hero', { opacity: [1, 0], duration: 2400, ease: 'inQuad' }, '<-=2000')
      // Act 2 construction guides: vertical projections draw in FIRST — the
      // "box projecting up" feeling before the house itself appears.
      .add('#house-svg .vguide', {
        strokeDashoffset: [216, 0], opacity: [0, 0.3], duration: 900, delay: stagger(160), ease: 'out(2)',
      }, '<+=100')
      // horizontal guide draws in next
      .add('#house-svg .hguide', {
        strokeDashoffset: [400, 0], opacity: [0, 0.35], duration: 700, ease: 'out(2)',
      }, '<+=200')
      // Act 2: the house draws itself line by line — stagger raised to ~530ms per
      // line (6-7 hlines × 530ms = ~3600ms total feel, up from 2400ms).
      .add(svg.createDrawable('#house-svg .hline'), {
        draw: '0 1', duration: 3600, delay: stagger(530), ease: 'inOut(2)',
      }, '<+=200')
      // house-plate settles in: the sketch fades INTO the finished FULL-BLEED
      // drawing (the plate's paper becomes the page). The skeleton crossfades
      // fully OUT — sketch-to-plate geometric registration is impossible, and a
      // clean handoff beats a misregistered ghost. The body warms to cream in
      // the same beat so the plate's paper meets no tonal jump.
      .add('#house-plate', { opacity: [0, 1], duration: 1800, ease: 'inOut(2)' }, '<+=2800')
      .add('#house-svg .hline, #house-svg .hguide, #house-svg .vguide',
           { opacity: 0, duration: 1800, ease: 'inOut(2)' }, '<')
      .add('body', { backgroundColor: '#f4ecdc', duration: 1800, ease: 'linear' }, '<')
      .add('.hnote', { opacity: 0.7, duration: 400 }, '<+=1400')
      // Beat B — house → interior: "through the door"
      // Phases are SEQUENTIAL (no double-exposure): the house zoom fully hands
      // off to the dive's cream paper before the door resolves, and the streaks
      // exist only inside the smear window.
      //
      // Step 1: hnote lifts as the camera dives. The zoom rides #house-plate
      //   itself (full-bleed) — its transform-origin (the front door, 49% 65%)
      //   is set in CSS, NOT passed through the tween: anime v4 animates a
      //   tween-passed transformOrigin from the computed px origin with
      //   mismatched units, hurling the plate off-screen mid-zoom.
      .add('.hnote', { opacity: 0, duration: 500, ease: 'out(2)' })
      .add('#house-plate', { scale: 3.4, duration: 2400, ease: 'inQuad' }, '<<')
      //   the act fades out over the zoom's last 800ms and reaches 0 BEFORE the
      //   door plate is meaningfully visible (phase separation).
      .add('#act-rise', { opacity: [1, 0], duration: 800, ease: 'inQuad' }, '<-=800')
      // Step 2: #act-dive rises as the house fades — its solid cream backing
      //   (CSS background) is the connective tissue; the door plate itself
      //   resolves slowly on top of it (inOut: ~9% opacity when the house hits
      //   0), entering at scale 0.82 → 1.2 to continue the approach momentum.
      .add('#act-dive', { opacity: [0, 1], duration: 700, ease: 'out(2)' }, '<-=300')
      .add('#door-plate', { opacity: [0, 1], scale: [0.82, 1.2], duration: 1400, ease: 'inOut(2)' }, '<<')
      // Step 3: Threshold glow — amber radial overlay grows to 0.85 opacity as
      //   the door fills the screen, "light through the gap".
      .add('#threshold-glow', { opacity: [0, 0.85], duration: 1000, ease: 'inQuad' }, '<-=400')
      // Step 4: Pass-through smear — door-plate + glow smear sideways with blur
      //   over ~700ms. Streaks fire ONLY now, with the door at full opacity.
      .add('#door-plate', {
        scaleX: 2.6, translateX: '-20%', filter: ['blur(0px)', 'blur(18px)'],
        duration: 700, ease: 'in(3)',
      })
      .add('#threshold-glow', {
        scaleX: 2.6, opacity: [0.85, 0], duration: 700, ease: 'in(3)',
      }, '<<')
      .add('#streaks line', { x2: [0, 1000], duration: 650, delay: stagger(70) }, '<<')
      // Step 5: Room resolves FROM the smear — #act-room enters with #room-ink
      //   starting scaleX 1.5 + blur(12px), settling to scaleX 1 / blur(0) over
      //   ~900ms. This replaces the previous simple scale-in from 0.55.
      .add('#act-room', { opacity: [0, 1], duration: 600, ease: 'out(2)' }, '<+=400')
      .add('#room-ink', {
        scaleX: [1.5, 1], filter: ['blur(12px)', 'blur(0px)'], duration: 900, ease: 'out(3)',
      }, '<')
      .add('#act-dive', { opacity: [1, 0], duration: 500 }, '<+=300')
      // gentle in-room camera drift (the parallax feel on a single plate)
      .add('#room-ink', PORTRAIT
        ? { scale: [1.18, 1.05], y: [24, -24], duration: 2400, ease: 'linear' }
        : { scale: [1.12, 1.02], x: [30, -30], duration: 2400, ease: 'linear' }, '<')
      // "ziggyActs": gauge + air + bubble spring in
      .add('#ac-gauge', { opacity: [0, 1], duration: 400 })
      .add('#ac-gauge-needle', { rotate: [-70, 12], duration: 700, ease: 'outBack(2)', transformOrigin: '875px 145px' }, '<')
      .add('#ac-air path', { opacity: [0, 1], strokeDashoffset: [0, -80], duration: 1200, delay: stagger(180) }, '<+=200')
      .add('#bubble-ac', { opacity: [0, 1], y: [24, 0], scale: [0.85, 1], duration: 650, ease: 'outElastic(1, .6)' }, '<+=300')
      // "morph": the room becomes real as Ziggy acts — the page's magic trick
      .add('#room-photo', { opacity: [0, 1], scale: [1.04, 1], maskPosition: ['100% 0', '0% 0'], '-webkit-mask-position': ['100% 0', '0% 0'], duration: 2000, ease: 'inOut(2)' })
      .add('#room-ink',   { opacity: [1, 0], duration: 2000, ease: 'inOut(2)' }, '<')
      // ink life layer PERSISTS over the photo (the AR look) — just re-assert it
      .add('#life-layer', { opacity: [1, 1], duration: 100 }, '<')
      // paper warms from dawn to midday cream
      .add('body', { backgroundColor: '#f4ecdc', duration: 2000, ease: 'linear' }, '<');

    window.__flightTl = tl;
    console.log('ziggy flight: timeline built, duration =', tl.duration);
  } else {
    // reduced motion: reveal everything statically
    document.querySelectorAll('.act').forEach(a => { a.style.opacity = 1; a.removeAttribute('aria-hidden'); });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
