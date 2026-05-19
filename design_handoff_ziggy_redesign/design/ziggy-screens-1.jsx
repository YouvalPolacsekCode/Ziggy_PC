// ── Ziggy redesigned screens — Part 1: Dashboard + Rooms ──────────────────

// ============================================================================
// IA Diagram — the brutal pruning artboard
// ============================================================================
function IAArtboard() {
  const C = ({ kind, title, sub }) => {
    const colors = {
      keep:   { bg: 'color-mix(in srgb, var(--ok) 8%, var(--surface))',  border: 'color-mix(in srgb, var(--ok) 40%, var(--line))',   accent: 'var(--ok)' },
      merge:  { bg: 'color-mix(in srgb, var(--warn) 8%, var(--surface))', border: 'color-mix(in srgb, var(--warn) 40%, var(--line))', accent: 'var(--warn)' },
      kill:   { bg: 'color-mix(in srgb, var(--err) 6%, var(--surface))',  border: 'color-mix(in srgb, var(--err) 40%, var(--line))',  accent: 'var(--err)' },
      admin:  { bg: 'var(--surface-2)', border: 'var(--line)', accent: 'var(--ink-mute)' },
      defer:  { bg: 'var(--surface-2)', border: 'var(--line)', accent: 'var(--ink-mute)' },
    }[kind];
    const verb = { keep: 'KEEP', merge: 'MERGE', kill: 'KILL', admin: 'ADMIN', defer: 'DEFER' }[kind];
    return (
      <div style={{
        padding: '10px 12px', borderRadius: 10,
        background: colors.bg, border: `0.5px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="z-mono" style={{ fontSize: 9, color: colors.accent, fontWeight: 600, letterSpacing: '0.1em' }}>{verb}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
        </div>
        {sub && <div style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.45 }}>{sub}</div>}
      </div>
    );
  };

  return (
    <div className="z-art" style={{ padding: 36, width: 980, background: 'var(--bg)' }}>
      <Eyebrow>Phase 0 · IA · your call</Eyebrow>
      <h1 className="z-display" style={{ fontSize: 38, marginTop: 8, marginBottom: 4 }}>From 21 pages to 8.</h1>
      <p style={{ fontSize: 14, color: 'var(--ink-mute)', marginBottom: 28, maxWidth: 640 }}>
        Eight user-facing surfaces. Devices and Rooms are siblings (bidirectional). Scenes deleted entirely —
        routines absorb the role. Tasks survives as its own page but lives in the secondary nav, not the bottom tab bar.
        Admin and Cloud Admin sit behind a separate <span className="z-mono" style={{ color: 'var(--ink)' }}>/admin</span> gate.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
        <div>
          <Eyebrow style={{ marginBottom: 12 }}>Today · 21 routes</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <C kind="keep"  title="Dashboard" />
            <C kind="keep"  title="AI Chat" />
            <C kind="keep"  title="Tasks"        sub="Stays. Lives in secondary nav, not bottom bar" />
            <C kind="keep"  title="Settings"     sub="Absorbs Quick Asks + Memory as panels" />
            <C kind="merge" title="Rooms"        sub="Pairs with Devices (bidirectional)" />
            <C kind="merge" title="Devices"      sub="Stays. Grouped by room, not flat search" />
            <C kind="merge" title="Automations"  sub="Absorbs Routines + Suggestions" />
            <C kind="merge" title="Routines"     sub="→ tab inside Automations" />
            <C kind="merge" title="Suggestions"  sub="→ tab inside Automations" />
            <C kind="merge" title="Anomalies"    sub="→ Alerts (unified inbox)" />
            <C kind="merge" title="Cameras"      sub="→ Rooms + Alerts" />
            <C kind="merge" title="QuickAsks"    sub="→ Settings panel + Dashboard widget" />
            <C kind="merge" title="Memory"       sub="→ Settings panel" />
            <C kind="kill"  title="Scenes"        sub="Gone. Routines do this job" />
            <C kind="defer" title="HomeMap"       sub="Out of scope this round" />
            <C kind="admin" title="VirtualDevices" />
            <C kind="admin" title="AdminSettings" />
            <C kind="admin" title="AdminConsole" />
            <C kind="admin" title="CloudAdmin" />
            <C kind="admin" title="DebugPage" />
            <C kind="keep"  title="LoginPage" />
          </div>
        </div>

        <div>
          <Eyebrow style={{ marginBottom: 12 }}>Proposed · 8 routes</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { i: 'home',    t: 'Dashboard',  s: 'Status, favorites, alerts strip, recent activity, today\u2019s tasks peek', primary: true },
              { i: 'sparkle', t: 'AI Chat',    s: 'Conversational control. Compound commands. Replaces floating orb', primary: true },
              { i: 'rooms',   t: 'Rooms',      s: 'Photo tiles. Tap a room → all its devices. Bidirectional with Devices', primary: true },
              { i: 'plug',    t: 'Devices',    s: 'All devices grouped by room. Tap room header → jumps to Rooms.', primary: true },
              { i: 'auto',    t: 'Automations', s: 'Two tabs: Active · Suggested. Absorbs old Routines & Suggestions', primary: true },
              { i: 'alerts',  t: 'Alerts',     s: 'Unified inbox. Anomalies + sensor events + offline devices' },
              { i: 'check',   t: 'Tasks',       s: 'Full list. Reachable from Dashboard widget + sidebar / overflow menu' },
              { i: 'gear',    t: 'Settings',   s: 'User-facing only. Embeds Quick Asks + Memory as panels. Admin lives at /admin' },
            ].map(r => (
              <div key={r.t} style={{
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--surface)', border: '0.5px solid var(--line)',
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: 'var(--accent-2)', color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ZIcon name={r.i} size={16} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{r.t}</span>
                    {r.primary && (
                      <span className="z-mono" style={{ fontSize: 8, color: 'var(--accent)', letterSpacing: '0.12em', padding: '1px 5px', borderRadius: 3, background: 'var(--accent-2)' }}>BOTTOM NAV</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-mute)', lineHeight: 1.45 }}>{r.s}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 14, padding: '11px 13px', borderRadius: 11,
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
            fontSize: 11.5, color: 'var(--ink-mute)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--ink)' }}>Mobile bottom nav (5):</strong>
            <span className="z-mono" style={{ color: 'var(--ink)', marginLeft: 4 }}>Home · Rooms · Ask · Devices · Automations.</span>
            <br />
            <strong style={{ color: 'var(--ink)' }}>Secondary (sidebar / overflow):</strong>
            <span className="z-mono" style={{ color: 'var(--ink)', marginLeft: 4 }}>Alerts · Tasks · Settings.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PHONE — DASHBOARD
// ============================================================================
function PhoneDashboard({ palette = 'light' }) {
  const isDark = palette === 'dark';
  const heroImg = isDark
    ? 'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?w=900&q=80&auto=format&fit=crop'
    : 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=900&q=80&auto=format&fit=crop';

  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', overflow: 'hidden' }}>
        {/* Greeting */}
        <div style={{ paddingTop: 8, paddingBottom: 14 }}>
          <Eyebrow>Wednesday · evening</Eyebrow>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.1 }}>
              Good evening, Daniel
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span className="z-dot z-dot-on" />
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>3 rooms active</span>
            <span style={{ color: 'var(--ink-ghost)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Maya & kids home</span>
          </div>
        </div>

        {/* Hero scene card — image + state */}
        <div style={{
          position: 'relative', borderRadius: 22, overflow: 'hidden',
          height: 168, marginBottom: 14, background: 'var(--surface-2)',
          border: '0.5px solid var(--line)',
        }}>
          <img src={heroImg} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: isDark ? 0.55 : 0.92 }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: isDark
              ? 'linear-gradient(180deg, rgba(10,9,7,0.2) 0%, rgba(10,9,7,0.85) 100%)'
              : 'linear-gradient(180deg, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.45) 100%)',
          }} />
          <div style={{
            position: 'absolute', inset: 0, padding: 16,
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            color: '#fff',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{
                fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                padding: '3px 8px', borderRadius: 999,
                background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(10px)',
                fontFamily: '"IBM Plex Mono", monospace', fontWeight: 500,
              }}>Living Room</span>
              <span style={{ fontSize: 11, opacity: 0.85 }} className="z-mono">22.4° · 41%</span>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 2 }}>2 lights, Spotify</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>Bon Iver — Holocene</div>
            </div>
          </div>
        </div>

        {/* Favorite routines */}
        <Eyebrow style={{ marginBottom: 8 }}>Quick routines</Eyebrow>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' }}>
          {[
            { icon: 'sunrise', label: 'Morning', tint: 'var(--gold)' },
            { icon: 'sun',     label: 'Day',     tint: 'var(--info)' },
            { icon: 'sunset',  label: 'Evening', tint: 'var(--accent)', active: true },
            { icon: 'moon',    label: 'Sleep',   tint: 'var(--info)' },
            { icon: 'leaf',    label: 'Away',    tint: 'var(--ok)' },
          ].map((s, i) => (
            <div key={i} style={{
              flexShrink: 0, padding: '10px 12px', borderRadius: 14,
              background: s.active ? 'var(--ink)' : 'var(--surface)',
              color: s.active ? 'var(--bg)' : 'var(--ink-2)',
              border: '0.5px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 7,
              fontSize: 12, fontWeight: 500,
            }}>
              <span style={{ color: s.active ? s.tint : s.tint }}>
                <ZIcon name={s.icon} size={14} />
              </span>
              {s.label}
            </div>
          ))}
        </div>

        {/* Quick controls grid */}
        <Eyebrow style={{ marginBottom: 8 }}>Quick controls</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          <ControlTile icon="light" label="Living lights" sub="2 on · 80%" on />
          <ControlTile icon="climate" label="AC · Bedroom" sub="Cool · 22°" on accentColor="var(--info)" />
          <ControlTile icon="media" label="TV · Living" sub="Off" />
          <ControlTile icon="lock"  label="Front door" sub="Locked" />
        </div>

        {/* Today's tasks peek — links into Tasks page */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '11px 14px', borderRadius: 13,
          background: 'var(--surface)', border: '0.5px solid var(--line)',
          marginBottom: 14,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'color-mix(in srgb, var(--accent) 12%, var(--surface-2))',
            color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><ZIcon name="check" size={14} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>3 tasks today</div>
            <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>1 overdue · pick up Noa 14:30</div>
          </div>
          <ZIcon name="fwd" size={12} color="var(--ink-faint)" />
        </div>

        {/* Recent activity */}
        <Eyebrow style={{ marginBottom: 8 }}>Just now</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { txt: 'Kids room — motion detected', t: '2m' },
            { txt: 'Front door — unlocked by Maya', t: '14m' },
          ].map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px' }}>
              <span className="z-dot z-dot-info" />
              <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>{a.txt}</span>
              <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{a.t}</span>
            </div>
          ))}
        </div>
      </div>
      <BottomNav active="home" />
    </PhoneShell>
  );
}

// ============================================================================
// PHONE — ROOMS LIST
// ============================================================================
function PhoneRoomsList({ palette = 'light' }) {
  const rooms = [
    { name: 'Living Room', img: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=500&q=80', devices: '8 devices', active: '2 on', status: 'on' },
    { name: 'Kitchen',      img: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=500&q=80', devices: '6 devices', active: '1 on', status: 'on' },
    { name: 'Master Bedroom', img: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=500&q=80', devices: '5 devices', active: 'idle', status: 'idle' },
    { name: 'Kids Room',    img: 'https://images.unsplash.com/photo-1616046229478-9901c5536a45?w=500&q=80', devices: '4 devices', active: 'motion', status: 'info' },
    { name: 'Office',        img: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=500&q=80', devices: '7 devices', active: 'idle', status: 'idle' },
    { name: 'Bathroom',      img: 'https://images.unsplash.com/photo-1552158499-6b1b75f69a04?w=500&q=80', devices: '3 devices', active: 'idle', status: 'idle' },
  ];
  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '10px 0 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <Eyebrow>Your home</Eyebrow>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: '4px 0 0' }}>Rooms</h1>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 10, padding: 3, gap: 2 }}>
              <button style={{ padding: '5px 10px', borderRadius: 8, background: 'var(--surface)', border: 'none', fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>Tiles</button>
              <button style={{ padding: '5px 10px', borderRadius: 8, background: 'transparent', border: 'none', fontSize: 11, fontWeight: 500, color: 'var(--ink-mute)' }}>Map</button>
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
          <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>Search any device…</span>
        </div>

        {/* Tiles grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {rooms.map(r => (
            <div key={r.name} style={{
              position: 'relative', height: 156, borderRadius: 16, overflow: 'hidden',
              border: '0.5px solid var(--line)', background: 'var(--surface-2)',
            }}>
              <img src={r.img} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.92 }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(180deg, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.7) 100%)',
              }} />
              <div style={{ position: 'absolute', inset: 0, padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {r.status === 'on'   && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', boxShadow: '0 0 0 4px rgba(61,138,95,0.25)' }} />}
                  {r.status === 'info' && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--info)', boxShadow: '0 0 0 4px rgba(61,106,158,0.25)' }} />}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', letterSpacing: '-0.01em' }}>{r.name}</div>
                  <div className="z-mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.78)', letterSpacing: '0.04em' }}>
                    {r.devices} · {r.active}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <BottomNav active="rooms" />
    </PhoneShell>
  );
}

// ============================================================================
// PHONE — ROOM DETAIL
// ============================================================================
function PhoneRoomDetail({ palette = 'light' }) {
  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 0 80px', height: '100%', overflow: 'hidden' }}>
        {/* Hero with photo */}
        <div style={{
          position: 'relative', height: 220, marginBottom: 16, overflow: 'hidden',
          background: 'var(--surface-2)',
        }}>
          <img src="https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=900&q=80" alt="" style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0.7) 100%)',
          }} />
          <div style={{ position: 'absolute', top: 12, left: 16, right: 16, display: 'flex', justifyContent: 'space-between' }}>
            <button style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(20px)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ZIcon name="back" size={16} color="#fff" />
            </button>
            <button style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(20px)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ZIcon name="more" size={16} color="#fff" />
            </button>
          </div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>Living Room</h1>
              <span className="z-mono" style={{ fontSize: 11, opacity: 0.85 }}>22.4° · 41%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, opacity: 0.85 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6CBF8C' }} />2 devices on
              </span>
              <span>·</span>
              <span>8 total</span>
            </div>
          </div>
        </div>

        <div style={{ padding: '0 20px' }}>
          {/* Big room toggle */}
          <div style={{
            display: 'flex', gap: 8, marginBottom: 16,
          }}>
            <button style={{
              flex: 1, padding: '12px 14px', borderRadius: 14,
              background: 'var(--ink)', color: 'var(--bg)',
              border: 'none', fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <ZIcon name="bolt" size={14} />
              Everything off
            </button>
            <button style={{
              width: 48, padding: 12, borderRadius: 14,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ZIcon name="sparkle" size={16} color="var(--ink-2)" />
            </button>
          </div>

          {/* Section — Lights */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Eyebrow>Lights · 2 of 3 on</Eyebrow>
            <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>80% avg</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              { name: 'Ceiling', val: '90%', on: true },
              { name: 'Lamp',    val: '70%', on: true },
              { name: 'Wall',    val: 'off', on: false },
            ].map(l => (
              <div key={l.name} style={{
                padding: 12, borderRadius: 13,
                background: l.on ? 'var(--ink)' : 'var(--surface)',
                color: l.on ? 'var(--bg)' : 'var(--ink-2)',
                border: '0.5px solid var(--line)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                aspectRatio: '1',
              }}>
                <ZIcon name="light" size={20} color={l.on ? 'var(--gold)' : 'var(--ink-faint)'} />
                <div style={{ fontSize: 11, fontWeight: 600, textAlign: 'center' }}>{l.name}</div>
                <div className="z-mono" style={{ fontSize: 10, opacity: 0.7 }}>{l.val}</div>
              </div>
            ))}
          </div>

          {/* Climate row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: 14, borderRadius: 14,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            marginBottom: 10,
          }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12,
              background: 'color-mix(in srgb, var(--info) 12%, var(--surface-2))',
              color: 'var(--info)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><ZIcon name="climate" size={18} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Air conditioner</div>
              <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Cool · 22° → 22.4°</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ZIcon name="back" size={14} color="var(--ink-2)" /></button>
              <span className="z-mono" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', minWidth: 26, textAlign: 'center' }}>22°</span>
              <button style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', border: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ZIcon name="fwd" size={14} color="var(--ink-2)" /></button>
            </div>
          </div>

          {/* Media row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: 14, borderRadius: 14,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            marginBottom: 10,
          }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12,
              background: 'color-mix(in srgb, var(--accent) 12%, var(--surface-2))',
              color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><ZIcon name="media" size={18} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Holocene · Bon Iver</div>
              <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Spotify · Sonos</div>
            </div>
            <button style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--ink)', color: 'var(--bg)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ZIcon name="pause" size={14} color="var(--bg)" />
            </button>
          </div>

          {/* TV row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: 14, borderRadius: 14,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            marginBottom: 16,
          }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12,
              background: 'var(--surface-2)',
              color: 'var(--ink-mute)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><ZIcon name="tv" size={18} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Samsung TV</div>
              <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Off · IR</div>
            </div>
            <button style={{ padding: '6px 12px', borderRadius: 9, background: 'var(--surface-2)', border: '0.5px solid var(--line)', fontSize: 11, fontWeight: 600, color: 'var(--ink-2)' }}>Remote</button>
          </div>

          {/* Sensors strip */}
          <Eyebrow style={{ marginBottom: 8 }}>Sensors</Eyebrow>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { i: 'temp',   k: 'Temp',     v: '22.4°' },
              { i: 'humid',  k: 'Humidity', v: '41%' },
              { i: 'motion', k: 'Motion',   v: '2m ago' },
            ].map(s => (
              <div key={s.k} style={{
                flex: 1, padding: '10px 12px', borderRadius: 12,
                background: 'var(--surface)', border: '0.5px solid var(--line)',
              }}>
                <div style={{ color: 'var(--ink-faint)', marginBottom: 6 }}>
                  <ZIcon name={s.i} size={13} />
                </div>
                <div className="z-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{s.v}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{s.k}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomNav active="rooms" />
    </PhoneShell>
  );
}

Object.assign(window, { IAArtboard, PhoneDashboard, PhoneRoomsList, PhoneRoomDetail });
