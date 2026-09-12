# Ziggy motion layer

An interaction and motion grammar for the Ziggy app. **Feel only**: no colour,
size, radius, spacing, font, layout or copy changes. The design is whatever the
app's own design is; this layer only decides how it moves and how it answers a
finger.

It began as the motion half of "Lumen", one of four design directions explored
in a Design Lab. The Lab itself was a throwaway; only this came out of it, and
it was deliberately built to sit on top of the app's real design rather than to
bring Lumen's look with it. Where the text below says *Lumen* it means that
exploration, not anything in this repository.

`<html data-motion="off">` restores the app exactly as it was before this layer
existed. Set it with **`?motion=off`**, which sticks in that browser until
`?motion=on`. That is the rollback path, so keep it honest: see the note in
`flag.js`.

There is deliberately no on-screen switch and no keyboard shortcut. An earlier
build had both, plus a tuner with speed and curve dials; all of it was review
instrumentation, and a real home is not a review. The `m` shortcut was actively
unsafe — a stray keypress outside a text field stripped the app of its motion
with nothing to explain why.

```
src/motion/
  motion.js      easing, springs, haptics, reduced-motion, velocity helpers
  flag.js        the data-motion switch (URL → localStorage → default on)
  gestures.js    useLongPress · useSwipeBack · useSheetDetents · useScrub · useScrollChrome
  morph.js       shared-element FLIP across a route change
  pressLayer.js  delegated press + haptic feedback for the whole app
  SheetSurface.jsx  one surface, two frames: bottom sheet / docked right panel
  DeviceSheet.jsx   the device peek (name + the control, nothing else)
  sheet.css         structure for both frames
  motion.css     every visual rule, scoped under [data-motion="on"]
                 (its @import of controls.css MUST stay at the top of the file:
                  an @import after any rule is invalid and is dropped silently)
  controls.css   the feel of sliders, toggles and power buttons
  MotionRoot.jsx mounts the layer (press + haptics + motion.css); renders nothing
```

## Why a layer and not a redesign

Two reasons. It can be switched off, so any regression is one attribute away
from being disproved. And it can be reviewed as what it is: a claim that the
app's *feel*, not its *look*, is what needs work first.

## The rules it follows

From Apple's HIG (Motion, Feedback, Gestures, Accessibility) and Emil
Kowalski's animation work:

- Motion answers an action. **Nothing loops for decoration** — and unlike the
  first draft of this document, there is now no exception. A breathing
  occupancy dot was designed and specified here, and nothing in the app ever
  emitted the attribute for it, so it never existed. It is listed below as
  unwired rather than quietly deleted, because "specified but never emitted" is
  exactly the failure mode this file exists to prevent.
- Entrances use a strong ease-out; **exits are always faster than entrances**.
  Never `ease-in`, which delays the first frame, exactly when the eye is
  watching hardest.
- Transform and opacity only, plus `clip-path` for reveals. Nothing animates a
  layout property, so nothing costs a reflow per frame. **One deliberate
  exception**: a disclosure animates its container open via
  `grid-template-rows: 0fr → 1fr`. Clipping cannot move layout, so without it
  the page jumps to full height before the reveal plays, which reads as broken.
  A jump is worse than the reflow, and a disclosure is a rare interaction.
- Frequent interactions get little or no animation. A tab switch is not a
  moment.
- Every gesture is interruptible, pointer-captured, and cancellable below its
  commit threshold.
- Velocity counts as much as distance: a short fast flick commits like a long
  slow drag, which is what makes a gesture feel like it obeys physics rather
  than a rule.
- Reduced motion removes travel, scale and loops, and keeps colour and opacity,
  because removing those would remove information.

## The hooks a component emits

| Attribute | On | Effect |
|---|---|---|
| `data-on="true\|false"` | a device/room tile root | on-state arrives in 220ms, leaves in 160ms |
| `data-motion-icon` | the icon box inside such a tile | ignition pop, 6% overshoot |
| `data-pending="true"` | a control with a command in flight | breathes until the hub answers |
| `data-motion-enter` | routed page content | quiet rise on navigation |
| `data-motion-stagger` | a grid or list container | children arrive 35ms apart, capped at 8 |
| `data-motion-disclosure` | a disclosure wrapper | animates open, so nothing below jumps |
| `data-motion-reveal` | a disclosure panel | its content fades in behind the expansion |
| `data-motion-chevron` + `data-open` | a disclosure chevron | rotates |
| `data-motion-nav` + `data-tucked` | the bottom nav | tucks away on scroll down |
| `data-motion-nav-hl` | the **sidebar**'s active highlight | slides between items |
| `data-motion-live="true"` | **UNWIRED** — nothing emits this | would breathe; see the rules above |
| `data-scrubbing="true"` | a control mid-drag | kills the fill transition so it tracks the finger |
| `data-motion-hold` + `data-motion-grow` | a slider being held | the control grows under the finger |
| `data-motion-ring` | a power/toggle button | hover ring, pointer devices only |
| `data-pressing` | set by `pressLayer.js`, not by you | press scale |
| `data-no-press` / `data-no-swipe` | anything | opt out |

## What it adds, interaction by interaction

**Press.** Every tappable thing in the app scales 1.5–3% under the finger,
sized to the element. Delegated from one listener, so no component needed
changing. This is the only signal that the interface heard you before the
radio answers, and on a smart-home app that gap is real.

**Ignition.** A light coming on arrives over 220ms with a 6% overshoot on the
icon and settles; going off takes 160ms and does not overshoot. Today both cut
instantly.

**A tile becomes the room.** Tapping a room tile records its rectangle; the
room's hero photo starts from that rectangle and animates to its own, with the
text fading in behind the motion. Implemented as a FLIP, not framer-motion's
`layoutId`, because AppShell already carries a comment about two exit-handshake
page transitions that black-screened the app. A FLIP has no handshake: if the
origin is missing or stale, the page simply renders as it does today.

**Swipe back.** Drag from the leading edge on any detail page. The page tracks
the finger, commits past 30% of the width or on a 500px/s flick, springs back
otherwise.

**Sheets with detents.** Full-screen modals gain a grabber, two resting
heights, velocity-aware snapping, rubber-band resistance past the top, and a
backdrop whose opacity follows the drag. Body drags only count when the body is
already scrolled to the top, so the scroller keeps its gesture.

**Scrub a tile.** Drag horizontally across a dimmable light to set brightness
without opening anything, with a selection tick every 5%. A press that does not
move is still a tap; a mostly-vertical drag still scrolls the page.

**Long-press a room.** Toggles every light in it.

**Opening a device is a sheet, not a page.** Tapping a device anywhere brings
the control up over where you already were, instead of replacing the world with
a page. The peek is deliberately the control and nothing else: no room line, no
state line, no tabs. Drag it to the top and it *becomes* the real page rather
than imitating one, because the URL was `/devices/<id>` the whole time and
promotion just drops the background location. Back, refresh and sharing
therefore all work, and a cold deep link renders the full page exactly as it
always did.

On a phone it rises from the bottom to 72% with a grabber and the full detent
machinery. It was 55%, which cut the control in half and left a light's power
button below the fold — see the note on `DETENTS` in `DeviceSheet.jsx`, and the
one on `height` in `sheet.css` explaining why the panel must be pinned to the
layer for a detent fraction to mean anything.
At 768px and up it docks as a 320px panel against the trailing
edge, which is what Lumen does at wide sizes, and matches the width of the
Recent Activity rail the dashboard already has. No grabber and no drag there,
because neither means anything in a side panel; the header carries an expand
control instead. The page underneath stays live and scrolled where you left it.

Interception is central. None of the eight places that open a device needed
changing: `App.jsx` keeps the page you came from mounted as a background
location and presents the sheet over it.

Actions' create chooser and Library use the same surface through one optional
`sheet` prop on `Modal`. The other 38 `Modal` call sites take the identical
code path they always did.

**Haptics.** Named after the HIG's feedback generators: `selection` while a
value changes, `light` on a switch closing, `medium` on a detent or threshold,
`success`/`warning` on an outcome. Silent where the platform has no vibrator.

## What it deliberately does not do

Lumen's dial and its tall light well are new *controls*, not new motion.
Bringing them across would change the design, which was explicitly out of
scope, so the existing stepper and slider were given Lumen's feel instead.
Lumen's glow is likewise a visual idea, not a motion one: what came across is
the timing of the state change, not the light.
