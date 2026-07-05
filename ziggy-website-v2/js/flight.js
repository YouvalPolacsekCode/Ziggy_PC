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
      // Act 1 → 2: lids open, hero copy drifts away, rise act appears
      .add('#lid-l', { rotate: -120, duration: 700 })
      .add('#lid-r', { rotate: 120, duration: 700 }, '<')
      .add('#act-hero h1, #act-hero .sub, #act-hero .waitlist, #act-hero .scroll-hint',
           { opacity: 0, y: -40, duration: 500, delay: stagger(60) }, '<+=200')
      .add('#act-hero', { opacity: 0, duration: 400 })
      .add('#act-rise', { opacity: 1, duration: 400 }, '<')
      // Act 2: the house draws itself line by line
      .add(svg.createDrawable('#house-svg .hline'), {
        draw: '0 1', duration: 2600, delay: stagger(180), ease: 'inOut(2)',
      })
      .add('.hnote', { opacity: 0.7, duration: 300 })
      // Act 2 → 3: dive toward the front door
      .add('#act-rise', {
        scale: 9, opacity: [1, 0], duration: 1400, ease: 'in(2)',
        transformOrigin: '50% 72%', // the door's position in the composition
      })
      .add('#act-dive', { opacity: [0, 1, 0], duration: 700 }, '<+=500')
      .add('#streaks line', { x2: [0, 1000], duration: 500, delay: stagger(60) }, '<')
      // Act 4 "roomArrive": arrive inside — ink room scales in from the dive
      .add('#act-room', { opacity: [0, 1], scale: [0.55, 1], duration: 1000, ease: 'out(2)' }, '<-=200')
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
