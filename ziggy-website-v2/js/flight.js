import { animate, createTimeline, stagger, onScroll, svg, utils } from 'https://cdn.jsdelivr.net/npm/animejs@4/+esm';

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
      // hero content lifts up and fades together (same block) as it leaves
      .add('#act-hero h1, #act-hero .sub, #act-hero .waitlist, #act-hero .scroll-hint',
           { y: -40, opacity: 0, duration: 700, delay: stagger(50), ease: 'in(2)' }, '<+=200')
      // rise fades in as hero leaves.
      .add('#act-rise', { opacity: [0, 1], duration: 800, ease: 'out(2)' })
      // hero container fades on a LONG, late ease so it is still partly on
      // screen while rise ramps up — the overlap kills the blank handoff frame.
      // (anime's onScroll timeline pins add positions, so duration — not the
      // position token — is what actually controls the overlap here.)
      .add('#act-hero', { opacity: [1, 0], duration: 1600, ease: 'inQuad' }, '<-=1500')
      // Act 2: the house draws itself line by line, on an already-visible stage.
      .add(svg.createDrawable('#house-svg .hline'), {
        draw: '0 1', duration: 2400, delay: stagger(220), ease: 'inOut(2)',
      }, '<+=100')
      .add('.hnote', { opacity: 0.7, duration: 300 })
      // Act 2 → 3: dive toward the front door. Longer than half a viewport
      // of scroll so the plunge reads as a plunge, not a cut.
      .add('#act-rise', {
        scale: 9, opacity: [1, 0], duration: 1900, ease: 'inQuad',
        transformOrigin: '50% 71%', // the door's position in the composition
      })
      // dive streaks fade in DURING the plunge (negative offset overlaps the
      // rise-zoom, which fades out near its end) and HOLD — so the stage is
      // covered before the rise opacity crashes. '<' = end-of-previous here, so
      // a negative offset is what pulls the dive back over the plunge.
      .add('#act-dive', { opacity: [0, 1], duration: 700 }, '<-=1100')
      .add('#streaks line', { x2: [0, 1000], duration: 650, delay: stagger(70) }, '<<')
      // Act 4 "roomArrive": the room arrives while the streaks still hold —
      // its opacity snaps in fast, its scale eases from the dive, and it covers
      // the streaks. Then the streaks fade out behind it.
      .add('#act-room', { opacity: [0, 1], scale: [0.55, 1], duration: 1100, ease: 'out(2)' }, '<+=150')
      .add('#act-dive', { opacity: [1, 0], duration: 500 }, '<+=500')
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
