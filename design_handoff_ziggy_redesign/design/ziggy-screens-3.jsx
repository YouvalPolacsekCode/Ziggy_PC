// ── Ziggy redesigned screens — Part 3: Tablet · Desktop · Onboarding · RTL · Alerts

// ============================================================================
// TABLET — WALL DISPLAY (10" landscape)
// Modeled as a glanceable in-room control surface, not a phone-shaped tablet
// ============================================================================
function TabletWallDisplay({ palette = 'light' }) {
  const isDark = palette === 'dark';
  return (
    <div style={{
      width: 920, height: 600, borderRadius: 28,
      background: 'var(--bg)',
      border: '0.5px solid var(--line)',
      boxShadow: 'var(--shadow-lg)',
      overflow: 'hidden',
      display: 'flex',
    }}>
      {/* Left sidebar — rooms */}
      <div style={{
        width: 200, padding: '24px 16px',
        borderRight: '0.5px solid var(--line)',
        background: 'var(--bg-2)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ marginBottom: 22, padding: '0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--ink)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>Z</div>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Ziggy</span>
          </div>
          <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4, marginLeft: 32 }}>kitchen · wall</div>
        </div>

        <Eyebrow style={{ marginBottom: 8 }}>Rooms</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {[
            { n: 'Kitchen',    active: true,  here: true },
            { n: 'Living Room' },
            { n: 'Dining' },
            { n: 'Master Bdr.' },
            { n: 'Kids' },
            { n: 'Office' },
            { n: 'Bathroom' },
            { n: 'Garage' },
          ].map(r => (
            <div key={r.n} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 9,
              background: r.active ? 'var(--surface)' : 'transparent',
              border: r.active ? '0.5px solid var(--line)' : '0.5px solid transparent',
              fontSize: 13, fontWeight: r.active ? 600 : 500,
              color: r.active ? 'var(--ink)' : 'var(--ink-mute)',
            }}>
              {r.here && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />}
              {!r.here && <span style={{ width: 5, height: 5, borderRadius: '50%' }} />}
              {r.n}
            </div>
          ))}
        </div>

        <div style={{
          padding: '10px 12px', borderRadius: 12,
          background: 'var(--surface)', border: '0.5px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9, background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ZIcon name="mic" size={14} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>Speak to Ziggy</div>
            <div className="z-mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>or say "Hey Ziggy"</div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: 28, display: 'flex', flexDirection: 'column', gap: 18, overflow: 'hidden' }}>
        {/* Top row — clock + status */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div className="z-mono" style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Wed · MAY 18</div>
            <div style={{ fontSize: 52, fontWeight: 300, color: 'var(--ink)', letterSpacing: '-0.04em', lineHeight: 1, marginTop: 4 }}>19:42</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="z-mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>OUTSIDE · 21° · CLEAR</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
              <span className="z-dot z-dot-on" />
              <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Maya & kids home</span>
            </div>
          </div>
        </div>

        {/* Scenes strip */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { i: 'sunrise', l: 'Morning', tint: 'var(--gold)' },
            { i: 'sun',     l: 'Day',     tint: 'var(--info)' },
            { i: 'sunset',  l: 'Evening', tint: 'var(--accent)', active: true },
            { i: 'moon',    l: 'Night',   tint: 'var(--info)' },
            { i: 'family',  l: 'Dinner',  tint: 'var(--gold)' },
            { i: 'leaf',    l: 'Away',    tint: 'var(--ok)' },
          ].map(s => (
            <button key={s.l} style={{
              flex: 1, padding: '12px 10px', borderRadius: 14,
              background: s.active ? 'var(--ink)' : 'var(--surface)',
              color: s.active ? 'var(--bg)' : 'var(--ink-2)',
              border: '0.5px solid var(--line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 13, fontWeight: 600,
            }}>
              <ZIcon name={s.i} size={15} color={s.tint} />
              {s.l}
            </button>
          ))}
        </div>

        {/* Big control grid for this room */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', gap: 12, flex: 1 }}>
          {/* Lights big card */}
          <div style={{
            padding: 18, borderRadius: 18,
            background: 'var(--ink)', color: 'var(--bg)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <div>
                <ZIcon name="light" size={22} color="var(--gold)" />
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>Kitchen lights</div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>3 on · 80% avg</div>
              </div>
              <span style={{ width: 32, height: 18, borderRadius: 999, background: 'var(--gold)', position: 'relative' }}>
                <span style={{ position: 'absolute', top: 2, left: 16, width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
              </span>
            </div>
            {/* Brightness bar */}
            <div style={{ marginTop: 'auto' }}>
              <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.15)', position: 'relative', marginBottom: 8 }}>
                <div style={{ position: 'absolute', inset: '0 20% 0 0', background: 'var(--gold)', borderRadius: 4 }} />
              </div>
              <div className="z-mono" style={{ fontSize: 10, opacity: 0.6, letterSpacing: '0.08em' }}>80% · 2700K WARM</div>
            </div>
          </div>

          {/* Climate */}
          <div style={{ padding: 16, borderRadius: 18, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <ZIcon name="climate" size={20} color="var(--info)" />
            <div>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--ink)', lineHeight: 1 }}>22°</div>
              <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4 }}>NOW 22.4° · COOL</div>
            </div>
          </div>

          {/* Music */}
          <div style={{ padding: 16, borderRadius: 18, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <ZIcon name="media" size={20} color="var(--accent)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Holocene</div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Bon Iver</div>
              <button style={{ marginTop: 10, width: 36, height: 36, borderRadius: '50%', background: 'var(--ink)', color: 'var(--bg)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ZIcon name="pause" size={14} color="var(--bg)" />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom strip — small alert */}
        <div style={{
          padding: '10px 14px', borderRadius: 12,
          background: 'color-mix(in srgb, var(--info) 8%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--info) 30%, var(--line))',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <ZIcon name="motion" size={14} color="var(--info)" />
          <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>Motion in Kids Room · 2 min ago</span>
          <button style={{ fontSize: 11, color: 'var(--info)', background: 'none', border: 'none', fontWeight: 600 }}>View camera</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DESKTOP — DASHBOARD (web)
// ============================================================================
function DesktopDashboard({ palette = 'light' }) {
  return (
    <div style={{
      width: 1280, height: 800, borderRadius: 14,
      background: 'var(--bg)',
      border: '0.5px solid var(--line)',
      boxShadow: 'var(--shadow-lg)',
      overflow: 'hidden',
      display: 'flex',
      fontFamily: 'Heebo, sans-serif',
    }}>
      {/* Top window chrome */}
      <div style={{ position: 'absolute', top: 8, left: 14, display: 'flex', gap: 6, zIndex: 2 }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#FF5F57' }} />
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#FEBC2E' }} />
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28C840' }} />
      </div>

      {/* Sidebar */}
      <div style={{
        width: 220, padding: '36px 14px 18px',
        background: 'var(--bg-2)',
        borderRight: '0.5px solid var(--line)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 24px' }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--ink)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>Z</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Daniel's Home</span>
          <ZIcon name="down" size={12} color="var(--ink-faint)" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { i: 'home',    l: 'Dashboard', active: true },
            { i: 'rooms',   l: 'Rooms' },
            { i: 'plug',    l: 'Devices' },
            { i: 'sparkle', l: 'AI Chat' },
            { i: 'auto',    l: 'Automations', badge: 3 },
          ].map(it => (
            <div key={it.l} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 9,
              background: it.active ? 'var(--surface)' : 'transparent',
              border: it.active ? '0.5px solid var(--line)' : '0.5px solid transparent',
              fontSize: 13, fontWeight: it.active ? 600 : 500,
              color: it.active ? 'var(--ink)' : 'var(--ink-mute)',
            }}>
              <ZIcon name={it.i} size={15} />
              <span style={{ flex: 1 }}>{it.l}</span>
              {it.badge && (
                <span className="z-mono" style={{
                  fontSize: 10, fontWeight: 600,
                  padding: '1px 6px', borderRadius: 999,
                  background: 'var(--accent)', color: '#fff',
                }}>{it.badge}</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          <Eyebrow style={{ padding: '0 10px', marginBottom: 6 }}>More</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { i: 'alerts', l: 'Alerts', badge: 2, badgeAccent: true },
              { i: 'check',  l: 'Tasks',  badge: 4 },
              { i: 'gear',   l: 'Settings' },
            ].map(it => (
              <div key={it.l} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px', borderRadius: 9,
                fontSize: 12.5, fontWeight: 500, color: 'var(--ink-mute)',
              }}>
                <ZIcon name={it.i} size={14} />
                <span style={{ flex: 1 }}>{it.l}</span>
                {it.badge && (
                  <span className="z-mono" style={{
                    fontSize: 9, fontWeight: 600,
                    padding: '1px 5px', borderRadius: 999,
                    background: it.badgeAccent ? 'var(--err)' : 'var(--surface-2)',
                    color: it.badgeAccent ? '#fff' : 'var(--ink-mute)',
                    border: it.badgeAccent ? 'none' : '0.5px solid var(--line)',
                  }}>{it.badge}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <Eyebrow style={{ padding: '0 10px', marginBottom: 6 }}>Rooms · active</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {['Living Room', 'Kitchen', 'Kids'].map(r => (
              <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, color: 'var(--ink-mute)' }}>
                <span className="z-dot z-dot-on" />
                {r}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 'auto', padding: '10px 10px 0', borderTop: '0.5px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'oklch(0.62 0.12 32)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>D</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Daniel</div>
              <div className="z-mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>admin</div>
            </div>
            <ZIcon name="gear" size={13} color="var(--ink-faint)" />
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: '36px 40px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <Eyebrow>Wednesday · evening</Eyebrow>
            <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.025em', margin: '4px 0 6px' }}>Good evening, Daniel</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--ink-mute)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="z-dot z-dot-on" />3 rooms active · 11 devices on</span>
              <span>·</span>
              <span>Maya, Noa, Tom home</span>
            </div>
          </div>
          <div style={{
            padding: '10px 16px', borderRadius: 12,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            display: 'flex', alignItems: 'center', gap: 10,
            minWidth: 260,
          }}>
            <ZIcon name="search" size={14} color="var(--ink-faint)" />
            <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>Ask anything or search devices</span>
            <span className="z-mono" style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, background: 'var(--surface-2)', border: '0.5px solid var(--line)', color: 'var(--ink-faint)', marginLeft: 'auto' }}>⌘ K</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, flex: 1, minHeight: 0 }}>
          {/* Left col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
            {/* Scenes */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <Eyebrow>Quick routines</Eyebrow>
                <button style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none' }}>Edit</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                {[
                  { i: 'sunrise', l: 'Morning', tint: 'var(--gold)' },
                  { i: 'sun',     l: 'Day',     tint: 'var(--info)' },
                  { i: 'sunset',  l: 'Evening', tint: 'var(--accent)', active: true },
                  { i: 'moon',    l: 'Sleep',   tint: 'var(--info)' },
                  { i: 'leaf',    l: 'Away',    tint: 'var(--ok)' },
                ].map(s => (
                  <div key={s.l} style={{
                    padding: 14, borderRadius: 14,
                    background: s.active ? 'var(--ink)' : 'var(--surface)',
                    color: s.active ? 'var(--bg)' : 'var(--ink)',
                    border: '0.5px solid var(--line)',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <ZIcon name={s.i} size={18} color={s.tint} />
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Active rooms */}
            <div style={{ minHeight: 0, flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <Eyebrow>Rooms · in use</Eyebrow>
                <button style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none' }}>See all 12</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                  { n: 'Living', img: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80', s: '2 lights, music' },
                  { n: 'Kitchen', img: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=400&q=80', s: '1 light · 23°' },
                  { n: 'Kids',   img: 'https://images.unsplash.com/photo-1616046229478-9901c5536a45?w=400&q=80', s: 'Motion · 2m ago' },
                ].map(r => (
                  <div key={r.n} style={{
                    position: 'relative', height: 156, borderRadius: 14, overflow: 'hidden',
                    border: '0.5px solid var(--line)',
                  }}>
                    <img src={r.img} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.7) 100%)' }} />
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, color: '#fff' }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{r.n}</div>
                      <div className="z-mono" style={{ fontSize: 10, opacity: 0.85 }}>{r.s}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
            {/* Alerts */}
            <div style={{
              padding: 16, borderRadius: 14,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
            }}>
              <Eyebrow style={{ marginBottom: 10 }}>Alerts · 2</Eyebrow>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { i: 'door',   t: 'Front door unlocked 14m', s: 'warn' },
                  { i: 'water',  t: 'Garden faucet on 3h',     s: 'err' },
                ].map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 9,
                      background: a.s === 'err' ? 'color-mix(in srgb, var(--err) 12%, var(--surface-2))' : 'color-mix(in srgb, var(--warn) 12%, var(--surface-2))',
                      color: a.s === 'err' ? 'var(--err)' : 'var(--warn)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}><ZIcon name={a.i} size={14} /></div>
                    <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }}>{a.t}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Suggested routine */}
            <div style={{
              padding: 16, borderRadius: 14,
              background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))',
              border: '0.5px solid color-mix(in srgb, var(--accent) 28%, var(--line))',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <ZIcon name="sparkle" size={13} color="var(--accent)" />
                <span className="z-mono" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: '0.12em' }}>SUGGESTED</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45, marginBottom: 10 }}>
                Every weeknight ~19:30 you dim the living room and start music. Save as <strong>"Wind down"</strong>?
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ padding: '6px 12px', borderRadius: 9, background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontSize: 11, fontWeight: 600 }}>Save</button>
                <button style={{ padding: '6px 12px', borderRadius: 9, background: 'transparent', color: 'var(--ink-mute)', border: '0.5px solid var(--line)', fontSize: 11, fontWeight: 500 }}>Not now</button>
              </div>
            </div>

            {/* Activity stream */}
            <div style={{
              padding: 16, borderRadius: 14,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              flex: 1, minHeight: 0, overflow: 'hidden',
            }}>
              <Eyebrow style={{ marginBottom: 10 }}>Recent activity</Eyebrow>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { t: 'Kids room', a: 'motion', m: '2m' },
                  { t: 'Front door', a: 'Maya unlocked', m: '14m' },
                  { t: 'Living', a: 'Ziggy dimmed lights · chat', m: '17m' },
                  { t: 'Bedroom AC', a: 'set 22°', m: '38m' },
                  { t: 'Driveway', a: 'car arrived', m: '1h' },
                ].map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                    <span className="z-mono" style={{ color: 'var(--ink-faint)', fontSize: 10, width: 28 }}>{a.m}</span>
                    <span style={{ color: 'var(--ink-2)', flex: 1 }}><strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{a.t}</strong> — {a.a}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HEBREW RTL — Dashboard
// ============================================================================
function PhoneDashboardRTL({ palette = 'light' }) {
  return (
    <div dir="rtl">
      <PhoneShell height={820}>
        <div style={{ padding: '4px 20px 80px', height: '100%', overflow: 'hidden' }}>
          <div style={{ paddingTop: 8, paddingBottom: 14 }}>
            <Eyebrow>יום רביעי · ערב</Eyebrow>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', margin: '4px 0 0', lineHeight: 1.1 }}>
              ערב טוב, דניאל
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span className="z-dot z-dot-on" />
              <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>3 חדרים פעילים</span>
              <span style={{ color: 'var(--ink-ghost)' }}>·</span>
              <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>מאיה והילדים בבית</span>
            </div>
          </div>

          {/* Hero */}
          <div style={{
            position: 'relative', borderRadius: 22, overflow: 'hidden',
            height: 156, marginBottom: 14, background: 'var(--surface-2)',
          }}>
            <img src="https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=900&q=80" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%)' }} />
            <div style={{ position: 'absolute', inset: 0, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{
                  fontSize: 10, letterSpacing: '0.08em',
                  padding: '3px 8px', borderRadius: 999,
                  background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(10px)',
                  fontFamily: '"IBM Plex Mono", monospace', fontWeight: 500,
                }}>סלון</span>
                <span style={{ fontSize: 11, opacity: 0.85 }} className="z-mono">22.4° · 41%</span>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 2 }}>2 מנורות, Spotify</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>בון איוור — Holocene</div>
              </div>
            </div>
          </div>

          {/* Quick routines */}
          <Eyebrow style={{ marginBottom: 8 }}>שגרות מהירות</Eyebrow>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { i: 'sunrise', l: 'בוקר', tint: 'var(--gold)' },
              { i: 'sun',     l: 'יום',  tint: 'var(--info)' },
              { i: 'sunset',  l: 'ערב',  tint: 'var(--accent)', active: true },
              { i: 'moon',    l: 'לילה', tint: 'var(--info)' },
              { i: 'leaf',    l: 'בחוץ', tint: 'var(--ok)' },
            ].map((s, i) => (
              <div key={i} style={{
                flexShrink: 0, padding: '10px 12px', borderRadius: 14,
                background: s.active ? 'var(--ink)' : 'var(--surface)',
                color: s.active ? 'var(--bg)' : 'var(--ink-2)',
                border: '0.5px solid var(--line)',
                display: 'flex', alignItems: 'center', gap: 7,
                fontSize: 12, fontWeight: 500,
              }}>
                <span style={{ color: s.tint }}><ZIcon name={s.i} size={14} /></span>
                {s.l}
              </div>
            ))}
          </div>

          {/* Controls */}
          <Eyebrow style={{ marginBottom: 8 }}>בקרות מהירות</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <ControlTile icon="light" label="אורות סלון" sub="2 דולקים · 80%" on />
            <ControlTile icon="climate" label="מזגן · חדר שינה" sub="קר · 22°" on accentColor="var(--info)" />
            <ControlTile icon="media" label="טלוויזיה" sub="כבוי" />
            <ControlTile icon="lock"  label="דלת כניסה" sub="נעולה" />
          </div>

          <Eyebrow style={{ marginBottom: 8 }}>עכשיו</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { txt: 'חדר ילדים — זוהתה תנועה', t: '2ד' },
              { txt: 'דלת כניסה — נפתחה ע"י מאיה', t: '14ד' },
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
    </div>
  );
}

// ============================================================================
// ONBOARDING — 3 sequential screens, family-friendly
// ============================================================================
function OnboardingTrio({ palette = 'light' }) {
  return (
    <div style={{ display: 'flex', gap: 24 }}>
      {/* Screen 1 — Welcome */}
      <PhoneShell height={760}>
        <div style={{
          padding: '40px 28px 40px',
          height: '100%', display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%)',
        }}>
          <div style={{ marginTop: 24, marginBottom: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            <div style={{
              width: 92, height: 92, borderRadius: 28,
              background: 'var(--ink)', color: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 44, fontWeight: 700, letterSpacing: '-0.04em',
              boxShadow: 'var(--shadow-md)',
            }}>Z</div>
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.15 }}>Welcome home.</h1>
              <p style={{ fontSize: 14, color: 'var(--ink-mute)', marginTop: 12, lineHeight: 1.5, maxWidth: 280 }}>
                Ziggy is your home's AI. It runs locally, learns your rhythms, and works for everyone in the house.
              </p>
            </div>
          </div>

          {/* Privacy badge */}
          <div style={{
            padding: '12px 14px', borderRadius: 12,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'color-mix(in srgb, var(--ok) 14%, var(--surface-2))', color: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ZIcon name="shield" size={16} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Stays on your device</div>
              <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>No cloud, no selling data.</div>
            </div>
          </div>

          <button style={{
            padding: 16, borderRadius: 14,
            background: 'var(--ink)', color: 'var(--bg)', border: 'none',
            fontSize: 14, fontWeight: 600,
          }}>Set up my home</button>
          <button style={{
            padding: 12, marginTop: 8,
            background: 'none', border: 'none',
            fontSize: 12, color: 'var(--ink-mute)', fontWeight: 500,
          }}>I have an invitation code</button>
        </div>
      </PhoneShell>

      {/* Screen 2 — Discovery */}
      <PhoneShell height={760}>
        <div style={{ padding: '14px 24px 24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <button style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 12, padding: 0 }}>Back</button>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1,2,3].map(i => (
                <span key={i} style={{ width: 18, height: 3, borderRadius: 99, background: i <= 2 ? 'var(--ink)' : 'var(--line-2)' }} />
              ))}
            </div>
            <button style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 12, padding: 0 }}>Skip</button>
          </div>

          <Eyebrow>Step 2 · Discovering</Eyebrow>
          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: '6px 0 12px', lineHeight: 1.2 }}>
            We found <span className="z-mono" style={{ color: 'var(--accent)' }}>47 devices</span> on your network.
          </h2>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5, marginBottom: 18 }}>
            Tap any to assign a room. You can fix this later.
          </p>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { i: 'light',  n: 'Philips Hue · Ceiling',     g: 'Bridge', room: 'Living Room' },
              { i: 'light',  n: 'Philips Hue · Lamp',         g: 'Bridge', room: 'Living Room' },
              { i: 'climate', n: 'Tornado AC',                 g: 'WiFi',  room: 'Bedroom' },
              { i: 'lock',   n: 'August Smart Lock',          g: 'BLE',   room: '— assign' },
              { i: 'camera', n: 'Reolink E1 Pro',              g: 'PoE',   room: 'Kids Room' },
              { i: 'plug',   n: 'TP-Link · Kettle',            g: 'WiFi',  room: '— assign' },
              { i: 'tv',     n: 'Samsung TV',                  g: 'IR',    room: 'Living Room' },
            ].map((d, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 11,
                background: 'var(--surface)', border: '0.5px solid var(--line)',
              }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--surface-2)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ZIcon name={d.i} size={15} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{d.n}</div>
                  <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{d.g}</div>
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 500,
                  color: d.room.startsWith('—') ? 'var(--warn)' : 'var(--ink-2)',
                  padding: '4px 10px', borderRadius: 8,
                  background: 'var(--surface-2)', border: '0.5px solid var(--line)',
                }}>{d.room}</div>
              </div>
            ))}
          </div>

          <button style={{
            marginTop: 16, padding: 14, borderRadius: 13,
            background: 'var(--ink)', color: 'var(--bg)', border: 'none',
            fontSize: 13, fontWeight: 600,
          }}>Continue · 5 unassigned</button>
        </div>
      </PhoneShell>

      {/* Screen 3 — Voice setup */}
      <PhoneShell height={760}>
        <div style={{ padding: '14px 24px 24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <button style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 12 }}>Back</button>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1,2,3].map(i => (
                <span key={i} style={{ width: 18, height: 3, borderRadius: 99, background: i <= 3 ? 'var(--ink)' : 'var(--line-2)' }} />
              ))}
            </div>
            <button style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 12 }}>Skip</button>
          </div>

          <div style={{ marginTop: 8, marginBottom: 28 }}>
            <Eyebrow>Step 3 · How to ask</Eyebrow>
            <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: '6px 0 8px', lineHeight: 1.2 }}>
              Speak naturally.
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
              Ziggy understands compound commands. Try these:
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { en: 'Open the shades and start coffee', he: 'פתח תריסים ותתחיל קפה' },
              { en: 'Dim living room to 30% and play jazz', he: 'עמעם את הסלון ל-30 והפעל ג׳אז' },
              { en: 'Goodnight', he: 'לילה טוב', mini: true },
              { en: 'Who is home?', he: 'מי בבית?', mini: true },
            ].map((p, i) => (
              <div key={i} style={{
                padding: p.mini ? '10px 14px' : '14px 16px', borderRadius: 14,
                background: 'var(--surface)', border: '0.5px solid var(--line)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ZIcon name="mic" size={13} color="var(--accent)" />
                  <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{p.en}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 4, marginLeft: 21, direction: 'rtl' }}>{p.he}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
            <button style={{
              flex: 1, padding: 14, borderRadius: 13,
              background: 'var(--ink)', color: 'var(--bg)', border: 'none',
              fontSize: 13, fontWeight: 600,
            }}>I'm ready</button>
          </div>
        </div>
      </PhoneShell>
    </div>
  );
}

// ============================================================================
// PHONE — UNIFIED ALERTS INBOX (replaces Anomalies + sensor alerts + offline)
// ============================================================================
function PhoneAlerts({ palette = 'light' }) {
  const A = ({ i, t, sub, time, sev, room }) => {
    const sevC = sev === 'err' ? 'var(--err)' : sev === 'warn' ? 'var(--warn)' : 'var(--info)';
    return (
      <div style={{
        display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 14,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        borderLeft: `3px solid ${sevC}`,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: `color-mix(in srgb, ${sevC} 10%, var(--surface-2))`,
          color: sevC,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><ZIcon name={i} size={16} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{t}</span>
            <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>{time}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
          {room && (
            <span style={{ display: 'inline-block', marginTop: 6, fontSize: 10, color: 'var(--ink-faint)', padding: '2px 8px', borderRadius: 999, background: 'var(--surface-2)', border: '0.5px solid var(--line)', fontFamily: '"IBM Plex Mono", monospace' }}>{room}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '10px 0 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <Eyebrow>Today · 2 need attention</Eyebrow>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: '4px 0 0' }}>Alerts</h1>
          </div>
          <button style={{ padding: '7px 12px', borderRadius: 9, background: 'var(--surface)', border: '0.5px solid var(--line)', fontSize: 11, fontWeight: 500, color: 'var(--ink-2)' }}>Mark all read</button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 11, marginBottom: 14 }}>
          {[
            { l: 'All',    n: 7, active: true },
            { l: 'Security' },
            { l: 'Health' },
            { l: 'Devices' },
          ].map(t => (
            <button key={t.l} style={{
              flex: 1, padding: '7px 0', borderRadius: 8,
              background: t.active ? 'var(--surface)' : 'transparent',
              border: 'none', fontSize: 11.5, fontWeight: 600,
              color: t.active ? 'var(--ink)' : 'var(--ink-mute)',
            }}>{t.l}{t.n ? ` · ${t.n}` : ''}</button>
          ))}
        </div>

        <Eyebrow style={{ marginBottom: 8 }}>Needs attention</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <A i="water" t="Garden faucet on 3h" sub="Unusual. Tap to shut off remotely or dismiss." time="3h" sev="err" room="Garden" />
          <A i="door"  t="Front door unlocked overnight" sub="Door was last unlocked 23:14 and stayed open." time="14m" sev="warn" room="Entrance" />
        </div>

        <Eyebrow style={{ marginBottom: 8 }}>Earlier today</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <A i="motion" t="Motion in Kids Room"     sub="Camera captured snapshot at 19:40" time="2m" sev="info" room="Kids" />
          <A i="wifi"   t="Sonos lost connection"     sub="Auto-reconnected after 12s" time="1h" sev="info" room="Living" />
          <A i="camera" t="Reolink E1 went offline"  sub="Resolved after 30s" time="2h" sev="info" room="Driveway" />
        </div>
      </div>
      <BottomNav active="alerts" />
    </PhoneShell>
  );
}

Object.assign(window, { TabletWallDisplay, DesktopDashboard, PhoneDashboardRTL, OnboardingTrio, PhoneAlerts });
