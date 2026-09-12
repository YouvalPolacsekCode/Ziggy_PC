// Opening a device is a sheet coming up, not a page replacing the world.
//
// The peek shows the CONTROL and nothing else: a grabber, the device name on
// one line, and <DeviceRemote/> — which already dispatches by device kind, so a
// light gets brightness and warmth, an AC gets temperature, mode and fan, a
// cover gets position, a sensor gets its reading. No room line, no state line,
// no "why it changed", no tabs, no identity card. Those live on the page, and
// the page is one drag away.
//
// Dragging to the top does not *simulate* the page — it hands off to it. The
// URL is already /devices/<id> (see the background-location plumbing in
// App.jsx), so promotion is simply "stop presenting this as a sheet": browser
// back, refresh and sharing all work because the address was never a fiction.
// On a wide screen there is no drag to make, so the docked panel's header
// carries a labelled expand button that does the same thing.
//
// Deliberately NOT passed to DeviceRemote: `automations` and `suggestion`. Both
// render extra cards (a schedule, an AI suggestion) and the peek is the control
// only. The full page still shows them.
//
// This is the same component the chat sheet is — motion/SheetSurface — with a
// different skin and two detents instead of one.

import { useDeviceStore } from '../stores/deviceStore'
import { DeviceRemote } from '../components/device/DeviceRemote'
import { deviceFacts } from '../lib/devices'
import { useT, useTranslatedName } from '../lib/i18n'
import { SheetSurface } from './SheetSurface'

// Peek first, full height second. SheetSurface sorts these into y-offsets, so
// the sheet rests at the peek and "the top" is one drag up.
//
// 0.72, not 0.55. Two reasons, and the first is the real one:
//
//   - At 0.55 the peek CUT THE CONTROL IN HALF. A light's remote is a
//     brightness well, a brightness bar, presets and the power button, and the
//     power button — the single most likely thing you opened the device to
//     press — fell below the fold. A peek that hides the main control is not a
//     peek, it is a teaser, and it forces a drag to do the one-tap thing.
//   - It is the height the chat sheet already rests at, so the app has ONE
//     resting height for a bottom sheet rather than two that differ by enough
//     to look like an accident.
//
// It stays a fraction rather than "however tall the content is" on purpose: a
// sheet whose resting height changes per device would make every device open
// feel like a different interaction.
const DETENTS = [0.72, 1]
// Rubber-band resistance past the top stop — motion/gestures.js's number.
const ELASTIC = { top: 0.12, bottom: 1 }
const CLASSES = { panel: 'z-msheet', head: 'z-msheet-head', body: 'z-msheet-body scrollbar-thin' }

// `open` and `handoff` are how App.jsx keeps a sheet alive for one beat after
// the navigation that ended it: open=false plays the exit a dismissal should
// have, and handoff holds the promoted surface while the page — already at this
// same URL — establishes underneath it. Both default to the plain case.
export default function DeviceSheet({ entityId, onClose, onPromote, open = true, handoff = false }) {
  const t = useT()
  const entity = useDeviceStore((s) => s.entities.find((e) => e.entity_id === entityId) ?? null)
  // Same group-name preference the page uses: the primary entity of a
  // multi-entity device is called "Switcher Boiler", not "Switcher Boiler
  // Power". A sheet and a page that disagree about a device's name would read
  // as two different screens, which is exactly what this is meant to stop being.
  const groupByEntityId = useDeviceStore((s) => s.groupByEntityId)
  const groupById = useDeviceStore((s) => s.groupById)
  const group = groupById[groupByEntityId[entityId]] || null
  const isGroupPrimary = group ? group.primary_entity_id === entityId : false

  const facts = entity ? deviceFacts(entity) : null
  const rawName = (isGroupPrimary && group?.name)
    ? group.name
    : (facts?.name || entity?.attributes?.friendly_name || entityId)
  const name = useTranslatedName(rawName)

  return (
    <SheetSurface
      open={open}
      handoff={handoff}
      dock
      onClose={onClose}
      onPromote={onPromote}
      promoteLabel={t('deviceCard.openDetails')}
      title={name}
      detents={DETENTS}
      dragElastic={ELASTIC}
      bodyDrag
      restoreFocus
      classNames={CLASSES}
    >
      <DeviceRemote entity={entity} />
    </SheetSurface>
  )
}
