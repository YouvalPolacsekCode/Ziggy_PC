// Assistant — the Ziggy conversation.
//
// This is where a palette's temperature shows. A thread is mostly two kinds of
// block repeated, so there is nowhere to hide: the warmth (or coldness) is
// carried by the bubble construction, the type and the space between turns.
//
// Two rules the screen is built around:
//
//   1. A user turn and a Ziggy turn must never be confusable. They differ by
//      three things at once — side, construction (a filled tint with no border
//      vs. the palette's real card construction) and the presence of Ziggy's
//      mark — so the distinction survives even the palette that has no colour.
//
//   2. Ziggy's second answer is "I don't know". That is a real Ziggy
//      behaviour, not a failure: unknown is never collapsed into empty. So it
//      is rendered as a *fact with a reason* — a hollow state dot, an outlined
//      badge, and the sensor's last report — and never as an alarm. Palettes
//      have no red; nothing here should ask for one.

import { useState } from 'react'
import {
  usePal, Card, H1, H2, Text, Label, Chip, Row, Stack, Section,
  OccDot, StateBadge, Bar, Icon, IconWell, surfaceStyle,
} from '../ui'
import { CHAT, SUGGESTIONS, ROOMS, GREETING, NOW, STATS, OCCUPANCY_LABEL } from '../data'

// Two glyphs the shared icon set does not carry. Drawn here in the same four
// renderings the DNA describes, so they do not look imported from elsewhere.
const LOCAL_PATHS = {
  mic: 'M12 3.2a2.8 2.8 0 0 1 2.8 2.8v5a2.8 2.8 0 0 1-5.6 0V6A2.8 2.8 0 0 1 12 3.2zM5.8 11.2a6.2 6.2 0 0 0 12.4 0M12 17.4v3.1M9 20.5h6',
  send: 'M20.4 12 3.6 4.4l3.9 7.6-3.9 7.6z',
}

function Glyph({ name, size = 20, color }) {
  const p = usePal()
  const col = color || p.c.ink
  const d = LOCAL_PATHS[name]
  if (p.icons === 'filled' && name === 'send') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d={d} fill={col} stroke={col} strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    )
  }
  const sw = p.icons === 'thin' ? 1 : p.icons === 'outline' ? 1.6 : 1.9
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      {p.icons === 'duotone' && <path d={d} fill={col} opacity="0.16" stroke="none" />}
      <path d={d} stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Turns ───────────────────────────────────────────────────────────────

function ZiggyMark() {
  const p = usePal()
  return (
    <div style={{
      width: 30, height: 30, flexShrink: 0,
      borderRadius: p.shape.pill === 999 ? 999 : p.shape.ctl,
      background: p.grad.accentBtn || p.c.accent,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: p.c.onGlow !== 'none' ? `0 0 16px ${p.c.onGlow}` : 'none',
    }}>
      <Icon name="star" size={16} color={p.c.accentInk} />
    </div>
  )
}

function UserTurn({ text }) {
  const p = usePal()
  const soft = Math.max(2, Math.round(p.shape.card / 4))
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{
        maxWidth: '80%',
        padding: `${Math.round(p.space.cardPad * 0.65)}px ${p.space.cardPad}px`,
        // A user turn is a filled tint — the same fill a device uses to say
        // "on". No border, no shadow: it is the loud block in the thread.
        // The flat tint goes under the gradient as its own layer (CSS allows a
        // colour only in the last one), or the palettes whose activeTile fades
        // to transparent end up with a bubble that dissolves at one corner.
        background: p.grad.activeTile
          ? `${p.grad.activeTile}, linear-gradient(${p.c.onTint}, ${p.c.onTint}), ${p.c.surface}`
          : p.c.onTint,
        color: p.c.onInk,
        borderRadius: p.shape.card,
        borderEndEndRadius: soft,
        border: p.border === 'hard' ? `1px solid ${p.c.lineStrong}` : '1px solid transparent',
      }}>
        <span style={{
          fontFamily: p.type.body, fontSize: p.type.base, fontWeight: p.type.bodyWeight,
          lineHeight: 1.4, letterSpacing: p.type.tracking, color: p.c.onInk,
        }}>{text}</span>
      </div>
    </div>
  )
}

function ReasonLine({ children }) {
  const p = usePal()
  return (
    <div style={{
      marginTop: 10, paddingInlineStart: 10,
      borderInlineStart: `2px solid ${p.c.line}`,
    }}>
      <Text faint size={p.type.micro} style={{
        display: 'block', marginBottom: 2,
        textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack,
      }}>Because</Text>
      <Text mute size={p.type.small}>{children}</Text>
    </div>
  )
}

// A room Ziggy is talking about. The Office is `unknown`, and that is the
// case this card exists to get right.
function RoomCard({ card }) {
  const p = usePal()
  const room = ROOMS.find((r) => r.name === card.room)
  const occ = card.state
  return (
    <Card active={occ === 'occupied'}>
      <Row justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
        <Row gap={11} style={{ minWidth: 0 }}>
          <IconWell name="room" on={occ === 'occupied'} size={36} />
          <Stack gap={3} style={{ minWidth: 0 }}>
            <H2 style={{ fontSize: p.type.h2 }}>{card.room}</H2>
            <Text faint size={p.type.micro}>
              {room ? `${room.deviceCount} devices · ${room.temp.toFixed(1)}°` : 'Room'}
            </Text>
          </Stack>
        </Row>
        <OccDot state={occ} style={{ marginTop: 6 }} />
      </Row>
      <StateBadge on={occ === 'occupied'} state={occ}>{OCCUPANCY_LABEL[occ]}</StateBadge>
      <ReasonLine>{card.reason}</ReasonLine>
    </Card>
  )
}

function DeviceCard({ card }) {
  const p = usePal()
  const on = card.state === 'on'
  // The level Ziggy says it set, taken from its own sentence rather than
  // invented next to it.
  const m = /(\d+)%\s*$/.exec(card.reason)
  const level = m ? Number(m[1]) : null
  return (
    <Card active={on}>
      <Row gap={11}>
        <IconWell name="light" on={on} size={36} />
        <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
          <Text weight={700} style={{
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{card.device}</Text>
          <Text faint size={p.type.micro}>Living Room</Text>
        </Stack>
        <StateBadge on={on}>{on ? 'On' : 'Off'}</StateBadge>
      </Row>
      {level !== null && (
        <Row gap={10} style={{ marginTop: 13 }}>
          <Bar value={level} style={{ flex: 1 }} />
          <Text mono size={p.type.small} mute>{level}%</Text>
        </Row>
      )}
      <ReasonLine>{card.reason}</ReasonLine>
    </Card>
  )
}

function ZiggyTurn({ msg }) {
  const p = usePal()
  const soft = Math.max(2, Math.round(p.shape.card / 4))
  return (
    <Row align="flex-start" gap={10}>
      <ZiggyMark />
      <Stack gap={p.space.gap === 1 ? 8 : p.space.gap} style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          ...surfaceStyle(p, {}),
          padding: `${Math.round(p.space.cardPad * 0.7)}px ${p.space.cardPad}px`,
          borderStartStartRadius: soft,
        }}>
          <Text style={{ display: 'block', lineHeight: 1.45 }}>{msg.text}</Text>
        </div>
        {msg.card && (msg.card.kind === 'room'
          ? <RoomCard card={msg.card} />
          : <DeviceCard card={msg.card} />)}
      </Stack>
    </Row>
  )
}

function Divider({ children }) {
  const p = usePal()
  return (
    <Row gap={10} style={{ margin: '2px 0' }}>
      <span style={{ flex: 1, height: 1, background: p.c.line }} />
      <Text faint size={p.type.micro} style={{
        textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack,
      }}>{children}</Text>
      <span style={{ flex: 1, height: 1, background: p.c.line }} />
    </Row>
  )
}

// ── Composer ────────────────────────────────────────────────────────────

function Composer({ value, onValue, wide }) {
  const p = usePal()
  const round = p.shape.pill === 999 ? 999 : p.shape.ctl
  const RoundBtn = ({ accent, label, children, ...rest }) => (
    <button
      aria-label={label}
      style={{
        width: 42, height: 42, flexShrink: 0, borderRadius: round, cursor: 'pointer',
        background: accent ? (p.grad.accentBtn || p.c.accent) : p.c.surface2,
        border: `1px solid ${accent ? 'transparent' : p.c.line}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: accent && p.c.onGlow !== 'none' ? `0 0 18px ${p.c.onGlow}` : 'none',
      }}
      {...rest}
    >{children}</button>
  )
  return (
    <div style={{
      ...surfaceStyle(p, { raised: true }),
      borderRadius: round === 999 ? 999 : p.shape.card,
      padding: 6, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <input
        value={value}
        onChange={(e) => onValue(e.target.value)}
        placeholder="Ask Ziggy"
        style={{
          flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
          padding: `0 ${p.space.cardPad - 6}px`, color: p.c.ink,
          fontFamily: p.type.body, fontSize: p.type.base, fontWeight: p.type.bodyWeight,
          letterSpacing: p.type.tracking,
        }}
      />
      {wide && (
        <RoundBtn label="Send">
          <Glyph name="send" size={18} color={p.c.inkMute} />
        </RoundBtn>
      )}
      <RoundBtn accent label="Hold to talk">
        <Glyph name="mic" size={19} color={p.c.accentInk} />
      </RoundBtn>
    </div>
  )
}

function SuggestionStrip({ onPick }) {
  const p = usePal()
  return (
    <div style={{
      display: 'flex', gap: p.space.gap === 1 ? 6 : p.space.gap - 2, overflowX: 'auto',
      margin: '0 -16px', padding: '0 16px 2px', scrollbarWidth: 'none',
    }}>
      {SUGGESTIONS.map((s) => (
        <Chip key={s} onClick={() => onPick(s)} style={{ cursor: 'pointer', padding: '9px 13px' }}>
          {s}
        </Chip>
      ))}
    </div>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────

export default function Assistant({ wide }) {
  const p = usePal()
  const [draft, setDraft] = useState('')
  const unknownRooms = ROOMS.filter((r) => r.occupancy === 'unknown').length

  const header = (
    <div style={{ paddingTop: wide ? p.space.gutter : 14, marginBottom: p.space.section - 8 }}>
      <Label style={{ marginBottom: 6 }}>{GREETING} · {NOW}</Label>
      <H1 style={{ marginBottom: 10 }}>Ziggy</H1>
      <Row gap={8}>
        <OccDot state="occupied" />
        <Text mute size={p.type.small}>
          {STATS.active} of {STATS.total} active
          {unknownRooms ? ` · ${unknownRooms} room unknown` : ''}
        </Text>
      </Row>
    </div>
  )

  const thread = (
    <Stack gap={p.space.gap === 1 ? 12 : p.space.gap + 6}>
      <Divider>Today {NOW}</Divider>
      {CHAT.map((m, i) => (
        m.who === 'user'
          ? <UserTurn key={i} text={m.text} />
          : <ZiggyTurn key={i} msg={m} />
      ))}
    </Stack>
  )

  if (wide) {
    return (
      <div>
        {header}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: p.space.section }}>
          <div style={{ minWidth: 0, maxWidth: 720 }}>
            {thread}
            {/* On a desktop the composer stays put while the thread scrolls
                under it — the one thing on this screen you always need. There
                is no floating affordance to collide with here. */}
            <div style={{
              position: 'sticky', bottom: 0, marginTop: p.space.section,
              paddingTop: 12, paddingBottom: p.space.gutter, background: p.c.bg,
            }}>
              <Composer value={draft} onValue={setDraft} wide />
            </div>
          </div>
          <div>
            <Section label="Try asking">
              <Stack gap={p.space.gap === 1 ? 1 : 8}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setDraft(s)}
                    style={{
                      display: 'block', width: '100%', padding: 0, border: 'none',
                      background: 'none', textAlign: 'start', cursor: 'pointer',
                      fontFamily: p.type.body,
                    }}
                  >
                    <Card pad={false} style={{ padding: '10px 13px' }}>
                      <Row gap={10}>
                        <Icon name="chat" size={16} color={p.c.inkFaint} />
                        <Text size={p.type.small}>{s}</Text>
                      </Row>
                    </Card>
                  </button>
                ))}
              </Stack>
            </Section>
            <Section label="What I can see">
              <Card>
                <Stack gap={11}>
                  {ROOMS.map((r) => (
                    <Row key={r.id} gap={10}>
                      <OccDot state={r.occupancy} />
                      <Text size={p.type.small} style={{ flex: 1, minWidth: 0 }}>{r.name}</Text>
                      <Text
                        faint={r.occupancy !== 'unknown'}
                        mute={r.occupancy === 'unknown'}
                        size={p.type.micro}
                        style={{ textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack }}
                      >{OCCUPANCY_LABEL[r.occupancy]}</Text>
                    </Row>
                  ))}
                </Stack>
              </Card>
            </Section>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {header}
      {thread}
      <div style={{
        marginTop: p.space.section,
        // The palettes with a floating nav also float an "Ask Ziggy" bubble
        // over the bottom-right corner. The composer has to end above it, or
        // the mic button ends up underneath a button that does the same job.
        paddingBottom: p.nav === 'floating' ? 62 : 0,
      }}>
        <Label>Try asking</Label>
        <SuggestionStrip onPick={setDraft} />
        <div style={{ marginTop: p.space.gap === 1 ? 10 : p.space.gap }}>
          <Composer value={draft} onValue={setDraft} />
        </div>
      </div>
    </div>
  )
}
