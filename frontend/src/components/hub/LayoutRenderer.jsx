// LayoutRenderer — dispatches each layout section to its component, and in
// edit mode wraps each one in an EditOverlay (×, ↑/↓, size cycler).
//
// Single map from `type` → component keeps the schema definition (server)
// and the renderer (client) in lock-step: adding a new section type means
// adding the type to services/dashboard_layouts.py's _KNOWN_TYPES, EditOverlay's
// CATALOG, *and* a row here. Unknown types render UnknownSection (graceful
// degradation when the server schema runs ahead of the client).

import { useHubStore } from '../../stores/hubStore'
import { EditOverlay } from './EditOverlay'
import {
  StatusStripSection,
  RoomsCarouselSection,
  SceneGridSection,
  QuickDevicesSection,
  TasksListSection,
  AlertsInboxSection,
  WeatherCardSection,
  ModeSwitcherSection,
  CameraTileSection,
  CommandButtonSection,
  MediaCardSection,
  UnknownSection,
} from './sections'

const REGISTRY = {
  status_strip:    StatusStripSection,
  rooms_carousel:  RoomsCarouselSection,
  scene_grid:      SceneGridSection,
  quick_devices:   QuickDevicesSection,
  tasks_list:      TasksListSection,
  alerts_inbox:    AlertsInboxSection,
  weather_card:    WeatherCardSection,
  mode_switcher:   ModeSwitcherSection,
  camera_tile:     CameraTileSection,
  command_button:  CommandButtonSection,
  media_card:      MediaCardSection,
}

// Size → grid column span on the responsive grid. FULL always spans the row.
// These are the "S/M/L/FULL" presets from the design doc; the cycler button
// in edit mode rotates between them.
function spanForSize(size) {
  switch (size) {
    case 'S':    return { mobile: 2, tablet: 2, desktop: 3  }
    case 'M':    return { mobile: 4, tablet: 4, desktop: 6  }
    case 'L':    return { mobile: 4, tablet: 6, desktop: 9  }
    case 'FULL': return { mobile: 4, tablet: 8, desktop: 12 }
    default:     return { mobile: 4, tablet: 4, desktop: 6  }
  }
}

function SectionWrap({ section, editing, dragId, children }) {
  const span = spanForSize(section.size)
  const isDragging = editing && dragId === section.id
  // Inline style writes CSS vars consumed by the grid in Hub.css — keeps
  // breakpoint logic in one place and lets sections stay dumb. data-section-id
  // is read by Hub.jsx's pointermove hit-test (document.elementFromPoint →
  // closest('[data-section-id]')) to figure out which section the pointer is over.
  const style = {
    '--col-mobile':  span.mobile,
    '--col-tablet':  span.tablet,
    '--col-desktop': span.desktop,
    gridColumn: `span var(--col-mobile)`,
    position: 'relative',
  }
  return (
    <div
      className={`z-hub-section${editing ? ' is-editing' : ''}${isDragging ? ' is-dragging' : ''}`}
      data-section-id={section.id}
      style={style}
    >
      {children}
      {editing && <EditOverlay section={section} />}
    </div>
  )
}

export default function LayoutRenderer() {
  // Pick which doc to render — the saved layout when not editing, the draft
  // when editing. Both come from the store so the renderer doesn't need
  // props plumbing from Hub.jsx.
  const editing = useHubStore(s => s.editing)
  const layout  = useHubStore(s => s.layout)
  const draft   = useHubStore(s => s.draft)
  const dragId  = useHubStore(s => s.dragId)
  const doc     = editing ? draft : layout

  const sections = doc?.sections || []
  if (sections.length === 0) {
    return (
      <p style={{ padding: 24, color: 'var(--ink-faint)', fontSize: 13 }}>
        {editing ? 'No sections yet — tap the + button to add one.'
                 : 'This layout has no sections. Tap edit to add some.'}
      </p>
    )
  }
  return (
    <>
      {sections.map(s => {
        const Component = REGISTRY[s.type] || UnknownSection
        return (
          <SectionWrap key={s.id} section={s} editing={editing} dragId={dragId}>
            <Component config={s.config || {}} id={s.id} type={s.type} />
          </SectionWrap>
        )
      })}
    </>
  )
}
