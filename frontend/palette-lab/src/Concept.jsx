// One complete concept: a palette + a viewport + a screen.
//
// This is the only thing the lab shell knows how to render. Everything about
// how it looks comes from the palette; the shell never styles the inside of a
// concept, which is what keeps the comparison honest.

import { useState } from 'react'
import { PaletteProvider, usePal } from './ui'
import { MobileNav, DesktopRail, StatusLine, AssistantBubble } from './Chrome'
import Home from './screens/Home'
import Room from './screens/Room'
import Device from './screens/Device'
import Assistant from './screens/Assistant'
import Actions from './screens/Actions'

const SCREENS = { home: Home, rooms: Room, device: Device, assistant: Assistant, actions: Actions }

function Body({ screen, onScreen, wide }) {
  const p = usePal()
  const Screen = SCREENS[screen] || Home
  // A floating nav sits over the content, so the scroller has to end above it.
  const bottomPad = wide ? p.space.gutter : (p.nav === 'floating' ? 96 : p.nav === 'top' ? 24 : 78)

  return (
    <div style={{
      flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
      padding: `0 ${wide ? p.space.gutter : 16}px ${bottomPad}px`,
      background: p.grad.hero && screen === 'home' ? undefined : undefined,
    }}>
      <Screen wide={wide} onScreen={onScreen} />
    </div>
  )
}

export default function Concept({ palette, viewport = 'mobile', screen: screenProp, onScreen: onScreenProp }) {
  const [localScreen, setLocalScreen] = useState('home')
  const screen = screenProp ?? localScreen
  const onScreen = onScreenProp ?? setLocalScreen
  const wide = viewport === 'desktop'

  return (
    <PaletteProvider value={palette}>
      <div style={{
        position: 'relative', height: '100%', width: '100%',
        display: 'flex', flexDirection: wide ? 'row' : 'column',
        background: palette.c.bg, color: palette.c.ink,
        fontFamily: palette.type.body,
        overflow: 'hidden',
      }}>
        {wide ? (
          <>
            <DesktopRail screen={screen} onScreen={onScreen} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <Body screen={screen} onScreen={onScreen} wide />
            </div>
          </>
        ) : (
          <>
            <StatusLine />
            {palette.nav === 'top' && <MobileNav screen={screen} onScreen={onScreen} />}
            <Body screen={screen} onScreen={onScreen} wide={false} />
            {palette.nav !== 'top' && (
              <>
                <AssistantBubble onClick={() => onScreen('assistant')} offsetForNav={92} />
                <MobileNav screen={screen} onScreen={onScreen} />
              </>
            )}
          </>
        )}
      </div>
    </PaletteProvider>
  )
}
