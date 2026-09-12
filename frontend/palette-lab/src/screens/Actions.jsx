// Actions — what Ziggy does on its own, and what it does when you ask.
//
// Ziggy splits these two things and refuses to blur them: an Automatic action
// is armed and waiting for a trigger, an On-demand action does nothing until
// you press it. So the screen is two groups, not one list with a tag, and the
// affordance is the tell — a switch that can be disarmed versus a button that
// fires once.
//
// There is almost no chrome here on purpose. This screen is list rhythm and
// type: a mono ordinal, a name set in the display face, the plain-language
// description under it, and a rule of whitespace set by p.space. That makes it
// the screen where a palette's typography has nowhere to hide — uppercase
// wide-tracked labels, a serif name, a fat sans at -0.04em tracking and a 1px
// gutter all read completely differently with identical content.
//
// No colour literals: every colour below comes from usePal().

import { useState } from 'react'
import {
  usePal, Card, H1, H2, Text, Label, Btn, Row, Stack, Section,
  StateBadge, Icon, IconWell, surfaceStyle,
} from '../ui'
import { ACTIONS } from '../data'
// Shared with Room rather than copied: a couple of palettes declare a dark
// hero gradient next to dark ink, and a heading set on that band vanishes. The
// guard lives next to the screen that uses it most.
import { heroSafe } from './Room'

// The armed/disarmed control. A palette with pill radii gets a real switch; a
// sharp palette gets a square one, which is the point — the same control is a
// different object in a different design language.
function Switch({ on, onClick, label }) {
  const p = usePal()
  const r = p.shape.pill
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      style={{
        width: 44, height: 24, padding: 2, flexShrink: 0, cursor: 'pointer',
        borderRadius: r,
        background: on ? (p.grad.accentBtn || p.c.accent) : p.c.surface2,
        border: `1px solid ${on ? 'transparent' : p.c.line}`,
        boxShadow: on && p.c.onGlow !== 'none' ? `0 0 14px ${p.c.onGlow}` : 'none',
        display: 'flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'background 160ms ease, justify-content 160ms ease',
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: r <= 4 ? 0 : 999,
        background: on ? p.c.accentInk : p.c.inkFaint,
        display: 'block',
      }} />
    </button>
  )
}

function ActionRow({ a, n, wide, state, onToggle, onRun }) {
  const p = usePal()
  const automatic = a.kind === 'automatic'
  const armed = state.armed !== false
  const live = automatic ? armed : state.ranAt > 0
  const sub = !automatic && state.ranAt > 0 ? `Ran just now · ${a.sub}` : a.sub

  return (
    <Card active={automatic && armed} pad={false} style={{ padding: `${p.space.cardPad - 3}px ${p.space.cardPad}px` }}>
      <Row gap={p.space.gap < 10 ? 10 : p.space.gap}>
        {/* The ordinal is the screen's typographic spine: it makes the list
            read as a set rather than as loose cards, and it is the one place
            the mono face appears at size. */}
        <Text mono faint size={p.type.small} style={{ width: 20, flexShrink: 0, letterSpacing: 0 }}>
          {String(n).padStart(2, '0')}
        </Text>
        <IconWell name={a.icon} on={live} size={wide ? 40 : 36} />
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <H2 style={{ fontSize: p.type.base + 2, lineHeight: 1.2 }}>{a.name}</H2>
          <Text mute size={p.type.small} style={{
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{sub}</Text>
        </Stack>

        {automatic ? (
          <Row gap={10}>
            {wide && (
              <StateBadge on={armed}>{armed ? 'Armed' : 'Paused'}</StateBadge>
            )}
            <Switch on={armed} onClick={onToggle} label={`${armed ? 'Pause' : 'Arm'} ${a.name}`} />
          </Row>
        ) : (
          <Btn primary small onClick={onRun} style={{ flexShrink: 0 }}>
            <Icon name="play" size={13} color={p.c.accentInk} />
            Run
          </Btn>
        )}
      </Row>
      {/* Automatic actions say what they are waiting for; that sentence is the
          whole reason a user trusts an automation they cannot see running. */}
      {automatic && (
        <Row gap={8} style={{ marginTop: 10, paddingInlineStart: 20 + (p.space.gap < 10 ? 10 : p.space.gap) }}>
          <Icon name="bolt" size={13} color={armed ? p.c.accent : p.c.inkFaint} />
          <Text faint size={p.type.micro} style={{ textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack }}>
            {armed ? 'Waiting for its trigger' : 'Will not run until you arm it'}
          </Text>
        </Row>
      )}
    </Card>
  )
}

function AddRow({ label }) {
  const p = usePal()
  return (
    <button
      style={{
        ...surfaceStyle(p, { flat: true }),
        borderStyle: 'dashed', borderColor: p.c.lineStrong,
        padding: p.space.cardPad,
        width: '100%', cursor: 'pointer', textAlign: 'center',
        fontFamily: p.type.body,
      }}
    >
      <Row gap={8} justify="center">
        <span style={{
          fontFamily: p.type.body, fontSize: p.type.base + 3, fontWeight: 650,
          color: p.c.inkMute, lineHeight: 1,
        }}>+</span>
        <Text mute size={p.type.small} weight={650} style={{
          textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack,
        }}>{label}</Text>
      </Row>
    </button>
  )
}

export default function Actions({ wide }) {
  const p = usePal()
  const [state, setState] = useState({})

  const get = (id) => state[id] || { armed: true, ranAt: 0 }
  const toggle = (id) => setState((s) => ({ ...s, [id]: { ...get(id), armed: !(get(id).armed) } }))
  const run = (id) => setState((s) => ({ ...s, [id]: { ...get(id), ranAt: Date.now() } }))

  const automatic = ACTIONS.filter((a) => a.kind === 'automatic')
  const onDemand = ACTIONS.filter((a) => a.kind === 'on-demand')
  const armedCount = automatic.filter((a) => get(a.id).armed).length

  const group = (list, offset) => (
    <Stack gap={p.space.gap}>
      {list.map((a, i) => (
        <ActionRow
          key={a.id}
          a={a}
          n={offset + i + 1}
          wide={wide}
          state={get(a.id)}
          onToggle={() => toggle(a.id)}
          onRun={() => run(a.id)}
        />
      ))}
    </Stack>
  )

  const header = (
    <div style={{
      paddingTop: wide ? p.space.gutter : 18,
      marginBottom: p.space.section,
      ...(p.grad.hero && heroSafe(p) && !wide ? {
        background: p.grad.hero,
        margin: `0 -16px ${p.space.section}px`,
        padding: `22px 16px ${p.space.cardPad}px`,
        borderBottomLeftRadius: p.shape.sheet,
        borderBottomRightRadius: p.shape.sheet,
      } : null),
    }}>
      <Label style={{ marginBottom: 6 }}>Your home, on its own</Label>
      <Row justify="space-between" align="flex-end" gap={12}>
        <Stack gap={10} style={{ minWidth: 0 }}>
          <H1>Actions</H1>
          <Text mute size={p.type.small}>
            {armedCount} of {automatic.length} armed · {onDemand.length} you can run
          </Text>
        </Stack>
        <Btn primary small style={{ flexShrink: 0 }}>
          <span style={{ fontSize: p.type.base + 2, lineHeight: 1, fontWeight: 700 }}>+</span>
          New
        </Btn>
      </Row>
    </div>
  )

  if (wide) {
    return (
      <div>
        {header}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: p.space.section }}>
          <div>
            <Section label="Automatic · runs itself">
              {group(automatic, 0)}
              <div style={{ marginTop: p.space.gap }}>
                <AddRow label="New automatic action" />
              </div>
            </Section>
          </div>
          <div>
            <Section label="On-demand · runs when you say">
              {group(onDemand, automatic.length)}
              <div style={{ marginTop: p.space.gap }}>
                <AddRow label="New on-demand action" />
              </div>
            </Section>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {header}
      <Section label="Automatic · runs itself">{group(automatic, 0)}</Section>
      <Section label="On-demand · runs when you say">
        {group(onDemand, automatic.length)}
      </Section>
      <AddRow label="Add an action" />
    </div>
  )
}
