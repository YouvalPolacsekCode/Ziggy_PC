// ── Ziggy redesigned screens — Part 4: Devices · Tasks · Settings ────────

// ============================================================================
// PHONE — DEVICES (grouped by room, bidirectional with Rooms)
// ============================================================================
function PhoneDevices({ palette = 'light' }) {
  // A room block — header is tappable (jumps to Rooms/<id>), each device row is tappable.
  const RoomBlock = ({ name, count, devices, photo }) => (
    <div style={{ marginBottom: 16 }}>
      {/* Header — tap → jumps to that Room */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 4px 10px',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9, overflow: 'hidden',
          background: 'var(--surface-2)', flexShrink: 0,
        }}>
          <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.005em' }}>{name}</div>
          <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{count} devices</div>
        </div>
        <button style={{
          padding: '5px 10px', borderRadius: 8,
          background: 'transparent', border: '0.5px solid var(--line)',
          fontSize: 10, fontWeight: 500, color: 'var(--ink-mute)',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          Open room <ZIcon name="fwd" size={10} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {devices.map(d => {
          const accent = d.on ? (d.tint || 'var(--ok)') : 'var(--ink-ghost)';
          return (
            <div key={d.name} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 12,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: 9,
                background: d.on ? `color-mix(in srgb, ${d.tint || 'var(--accent)'} 14%, var(--surface-2))` : 'var(--surface-2)',
                color: accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}><ZIcon name={d.icon} size={14} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{d.state}</div>
              </div>
              {d.toggle ? (
                <span style={{
                  width: 28, height: 16, borderRadius: 999, position: 'relative', display: 'inline-block',
                  background: d.on ? 'var(--ok)' : 'var(--line-2)',
                }}>
                  <span style={{ position: 'absolute', top: 2, left: d.on ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff' }} />
                </span>
              ) : (
                <ZIcon name="fwd" size={12} color="var(--ink-faint)" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', overflow: 'hidden' }}>
        {/* Title */}
        <div style={{ padding: '10px 0 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <Eyebrow>47 devices · 12 rooms</Eyebrow>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: '4px 0 0' }}>Devices</h1>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 10, padding: 3, gap: 2 }}>
              <button style={{ padding: '5px 10px', borderRadius: 8, background: 'var(--surface)', border: 'none', fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>By room</button>
              <button style={{ padding: '5px 10px', borderRadius: 8, background: 'transparent', border: 'none', fontSize: 11, fontWeight: 500, color: 'var(--ink-mute)' }}>By type</button>
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface-2)', borderRadius: 12,
          padding: '9px 12px', marginBottom: 14,
          border: '0.5px solid var(--line)',
        }}>
          <ZIcon name="search" size={14} color="var(--ink-faint)" />
          <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>Search devices…</span>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
          {[
            { l: 'All', n: 47, active: true },
            { l: 'On',  n: 11 },
            { l: 'Lights', n: 18 },
            { l: 'Climate', n: 4 },
            { l: 'Sensors', n: 9 },
            { l: 'Offline', n: 1, warn: true },
          ].map(c => (
            <button key={c.l} style={{
              padding: '6px 12px', borderRadius: 999, flexShrink: 0,
              background: c.active ? 'var(--ink)' : 'var(--surface)',
              color: c.active ? 'var(--bg)' : c.warn ? 'var(--err)' : 'var(--ink-2)',
              border: '0.5px solid var(--line)',
              fontSize: 11.5, fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              {c.l} <span className="z-mono" style={{ opacity: 0.6, fontSize: 10 }}>{c.n}</span>
            </button>
          ))}
        </div>

        {/* Room groups */}
        <div style={{ overflowY: 'auto', maxHeight: 540, paddingRight: 2 }}>
          <RoomBlock
            name="Living Room"
            count={8}
            photo="https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=200&q=80"
            devices={[
              { icon: 'light',   name: 'Ceiling lights',    state: 'ON · 90%',    on: true,  tint: 'var(--gold)', toggle: true },
              { icon: 'light',   name: 'Lamp',              state: 'ON · 70%',    on: true,  tint: 'var(--gold)', toggle: true },
              { icon: 'climate', name: 'AC',                 state: 'OFF',          on: false, toggle: true },
              { icon: 'media',   name: 'Sonos Beam',         state: 'PLAYING · Bon Iver', on: true, tint: 'var(--accent)' },
              { icon: 'tv',      name: 'Samsung TV',         state: 'OFF · IR',     on: false },
              { icon: 'motion',  name: 'Motion sensor',      state: '2m AGO',       on: false },
            ]}
          />
          <RoomBlock
            name="Kitchen"
            count={6}
            photo="https://images.unsplash.com/photo-1484154218962-a197022b5858?w=200&q=80"
            devices={[
              { icon: 'light',  name: 'Pendants',        state: 'ON · 80%',     on: true,  tint: 'var(--gold)', toggle: true },
              { icon: 'plug',   name: 'Kettle plug',     state: 'OFF',           on: false, toggle: true },
              { icon: 'temp',   name: 'Temp sensor',     state: '23.1°',          on: false },
            ]}
          />
          <RoomBlock
            name="Kids Room"
            count={4}
            photo="https://images.unsplash.com/photo-1616046229478-9901c5536a45?w=200&q=80"
            devices={[
              { icon: 'camera', name: 'Reolink E1 Pro',   state: 'MOTION · 2m',  on: true,  tint: 'var(--info)' },
              { icon: 'light',  name: 'Night light',      state: 'OFF',           on: false, toggle: true },
            ]}
          />
        </div>
      </div>
      <BottomNav active="devices" />
    </PhoneShell>
  );
}

// ============================================================================
// PHONE — TASKS
// Family task list with smart suggestions from Ziggy
// ============================================================================
function PhoneTasks({ palette = 'light' }) {
  const Task = ({ done, t, due, who, repeat, overdue }) => (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '11px 12px', borderRadius: 12,
      background: 'var(--surface)', border: '0.5px solid var(--line)',
      borderLeft: overdue ? '3px solid var(--err)' : '0.5px solid var(--line)',
      opacity: done ? 0.55 : 1,
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
        border: done ? 'none' : '1.5px solid var(--ink-mute)',
        background: done ? 'var(--ok)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginTop: 1,
      }}>
        {done && <ZIcon name="check" size={12} color="#fff" stroke={2.5} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', textDecoration: done ? 'line-through' : 'none', lineHeight: 1.35 }}>{t}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {due && (
            <span className="z-mono" style={{ fontSize: 10, color: overdue ? 'var(--err)' : 'var(--ink-faint)' }}>
              {due}
            </span>
          )}
          {repeat && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--ink-faint)' }}>
              <ZIcon name="route" size={10} /> {repeat}
            </span>
          )}
          {who && (
            <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
              · {who}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '10px 0 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <Eyebrow>3 due today · 1 overdue</Eyebrow>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: '4px 0 0' }}>Tasks</h1>
          </div>
          <button style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--ink)', color: 'var(--bg)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ZIcon name="plus" size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 11, marginBottom: 14 }}>
          {[
            { l: 'Today',     n: 3, active: true },
            { l: 'Upcoming',  n: 7 },
            { l: 'Anyone',    n: 12 },
            { l: 'Done' },
          ].map(t => (
            <button key={t.l} style={{
              flex: 1, padding: '7px 0', borderRadius: 8,
              background: t.active ? 'var(--surface)' : 'transparent',
              border: 'none', fontSize: 11.5, fontWeight: 600,
              color: t.active ? 'var(--ink)' : 'var(--ink-mute)',
            }}>{t.l}{t.n ? ` · ${t.n}` : ''}</button>
          ))}
        </div>

        {/* Overdue */}
        <Eyebrow style={{ marginBottom: 8 }}>Overdue</Eyebrow>
        <div style={{ marginBottom: 16 }}>
          <Task t="Take out recycling" due="Yesterday" who="Daniel" overdue />
        </div>

        {/* Today */}
        <Eyebrow style={{ marginBottom: 8 }}>Today</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          <Task t="Pick up Noa from school" due="14:30" who="Maya" />
          <Task t="Water the garden" due="evening" repeat="Mon · Wed · Fri" who="Daniel" />
          <Task t="Replace kitchen filter" due="today" />
          <Task done t="Buy milk" who="Daniel" />
        </div>

        {/* Ziggy-suggested */}
        <Eyebrow style={{ marginBottom: 8 }}>From Ziggy</Eyebrow>
        <div style={{
          padding: 14, borderRadius: 13,
          background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--accent) 28%, var(--line))',
          display: 'flex', alignItems: 'flex-start', gap: 11,
        }}>
          <ZIcon name="sparkle" size={14} color="var(--accent)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.45, marginBottom: 8 }}>
              You haven't replaced the AC filter in <span className="z-mono" style={{ fontWeight: 600 }}>92 days</span>. Add as a recurring task?
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={{ padding: '6px 11px', borderRadius: 8, background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontSize: 11, fontWeight: 600 }}>Every 60 days</button>
              <button style={{ padding: '6px 11px', borderRadius: 8, background: 'transparent', color: 'var(--ink-mute)', border: '0.5px solid var(--line)', fontSize: 11, fontWeight: 500 }}>Dismiss</button>
            </div>
          </div>
        </div>
      </div>

      {/* No bottom nav — Tasks is secondary nav */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 20px 22px',
        background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
        backdropFilter: 'blur(20px)', borderTop: '0.5px solid var(--line)',
      }}>
        <button style={{ width: '100%', padding: '11px', borderRadius: 12, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ink-2)', fontSize: 13, fontWeight: 500 }}>
          <ZIcon name="back" size={14} />
          Back to Home
        </button>
      </div>
    </PhoneShell>
  );
}

// ============================================================================
// PHONE — SETTINGS (with Quick Asks + Memory embedded)
// ============================================================================
function PhoneSettings({ palette = 'light' }) {
  const Row = ({ i, l, val, badge, danger }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px', borderBottom: '0.5px solid var(--line)',
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 9,
        background: danger ? 'color-mix(in srgb, var(--err) 12%, var(--surface-2))' : 'var(--surface-2)',
        color: danger ? 'var(--err)' : 'var(--ink-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}><ZIcon name={i} size={14} /></div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: danger ? 'var(--err)' : 'var(--ink)' }}>{l}</div>
        {val && <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 1 }}>{val}</div>}
      </div>
      {badge && <span className="z-mono" style={{ fontSize: 9, padding: '2px 6px', borderRadius: 999, background: 'var(--accent-2)', color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.06em' }}>{badge}</span>}
      <ZIcon name="fwd" size={12} color="var(--ink-faint)" />
    </div>
  );

  const Group = ({ title, children }) => (
    <div style={{ marginBottom: 16 }}>
      <Eyebrow style={{ padding: '0 4px', marginBottom: 6 }}>{title}</Eyebrow>
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--line)', borderRadius: 13, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );

  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '10px 0 14px' }}>
          <Eyebrow>You & your home</Eyebrow>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: '4px 0 0' }}>Settings</h1>
        </div>

        <div style={{ overflowY: 'auto', maxHeight: 640, paddingRight: 2 }}>
          {/* Profile card */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: 14, borderRadius: 14,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            marginBottom: 16,
          }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'oklch(0.62 0.12 32)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600 }}>D</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Daniel Cohen</div>
              <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>daniel@home · admin</div>
            </div>
            <ZIcon name="fwd" size={14} color="var(--ink-faint)" />
          </div>

          {/* Home */}
          <Group title="Home">
            <Row i="home"   l="Home name & address" val="Daniel's Home · Tel Aviv" />
            <Row i="family" l="People"               val="4 members · 2 guests" />
            <Row i="globe"  l="Language"             val="English · עברית" />
          </Group>

          {/* Ziggy intelligence — formerly memory + quick asks */}
          <Group title="Ziggy intelligence">
            <Row i="sparkle" l="Quick Asks"          val="6 saved shortcuts" badge="MOVED" />
            <Row i="eye"     l="Memory"               val="What Ziggy remembers · 142 facts" badge="MOVED" />
            <Row i="auto"    l="Suggestion sensitivity" val="Balanced" />
            <Row i="mic"     l="Wake word"             val="Hey Ziggy" />
          </Group>

          {/* Devices & system */}
          <Group title="Devices & system">
            <Row i="plug"   l="Pair a new device" />
            <Row i="wifi"   l="Network & connectivity" val="WiFi · Zigbee · MQTT" />
            <Row i="shield" l="Privacy & data"          val="Local-only · no cloud" />
          </Group>

          {/* Danger / advanced */}
          <Group title="Advanced">
            <Row i="key"   l="Admin console"         val="/admin · super_admin only" />
            <Row i="close" l="Sign out" danger />
          </Group>

          <div style={{ textAlign: 'center', padding: '8px 0 16px', fontSize: 10, color: 'var(--ink-faint)' }} className="z-mono">
            Ziggy v4.2.1 · local · backend healthy
          </div>
        </div>
      </div>
      <BottomNav active="" />
    </PhoneShell>
  );
}

Object.assign(window, { PhoneDevices, PhoneTasks, PhoneSettings });
