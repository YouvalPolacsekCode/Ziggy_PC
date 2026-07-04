import { animate, createTimeline, stagger, onScroll, svg, utils } from 'https://cdn.jsdelivr.net/npm/animejs@4/+esm';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      // Act 4 arrival is added in Task 6
      ;

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
