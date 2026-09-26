// Motion Lab — a stage that renders the prototype inside Ziggy's real palette
// (data-palette drives every CSS variable), sized like a phone, a tablet or
// the full width, depending on the global frame control.
import { useLab } from '../LabContext'

export function Stage({ kind = 'phone', height, children }) {
  const { theme, frameWidth, frame, speed, dir } = useLab()
  const isPhone = frame === 'phone'
  const width = kind === 'fixed' ? 390 : frameWidth
  const h = height ?? (isPhone ? 640 : 560)
  return (
    <div className={`ml-stage ml-stage--${frame}`} style={{ '--lab-speed': 1 / speed }}>
      <div
        className={`ml-stage__frame ${isPhone ? 'ml-stage__frame--phone' : ''}`}
        data-palette={theme}
        dir={dir}
        style={{ width: width ? `${width}px` : '100%', height: `${h}px` }}
      >
        {children}
      </div>
    </div>
  )
}
