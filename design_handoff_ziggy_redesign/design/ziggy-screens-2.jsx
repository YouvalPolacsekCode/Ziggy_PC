// ── Ziggy redesigned screens — Part 2: Device controls + Remote + Chat ───

// ============================================================================
// PHONE — LIGHT CONTROL (full-screen, dial + color)
// ============================================================================
function PhoneLightControl({ palette = 'light' }) {
  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 18px' }}>
          <button className="z-icon-btn"><ZIcon name="back" size={16} /></button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Ceiling light</div>
            <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Living Room</div>
          </div>
          <button className="z-icon-btn"><ZIcon name="more" size={16} /></button>
        </div>

        {/* Dial */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8, marginBottom: 24 }}>
          <Dial size={260} value={80} label="80%" sublabel="WARM · 2700K" color="var(--gold)" />
        </div>

        {/* Brightness slider */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <Eyebrow>Brightness</Eyebrow>
            <span className="z-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>80%</span>
          </div>
          <div style={{
            height: 44, borderRadius: 14, position: 'relative',
            background: 'linear-gradient(90deg, var(--ink-ghost) 0%, var(--gold) 100%)',
            border: '0.5px solid var(--line)', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '80%', width: 4, background: 'var(--ink)', borderRadius: 2 }} />
          </div>
        </div>

        {/* Color temp */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <Eyebrow>Temperature</Eyebrow>
            <span className="z-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>2700K · warm</span>
          </div>
          <div style={{
            height: 44, borderRadius: 14, position: 'relative',
            background: 'linear-gradient(90deg, #FFB060 0%, #FFE6C0 30%, #FFFFFF 60%, #C0DDFF 100%)',
            border: '0.5px solid var(--line)', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '18%', width: 4, background: 'var(--ink)', borderRadius: 2 }} />
          </div>
        </div>

        {/* Color presets */}
        <div style={{ marginBottom: 18 }}>
          <Eyebrow style={{ marginBottom: 8 }}>Presets</Eyebrow>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { c: '#F4D08E', name: 'Warm' },
              { c: '#FFFFFF', name: 'Cool' },
              { c: '#E27A55', name: 'Sunset' },
              { c: '#7AAEE0', name: 'Ocean' },
              { c: '#6CBF8C', name: 'Forest' },
              { c: '#C99845', name: 'Candle' },
            ].map(p => (
              <div key={p.name} style={{
                flex: 1, aspectRatio: '1', borderRadius: 12,
                background: p.c,
                border: '0.5px solid var(--line)',
                position: 'relative',
                boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.1)',
              }} />
            ))}
          </div>
        </div>

        {/* Big toggle */}
        <div style={{ marginTop: 'auto' }}>
          <button style={{
            width: '100%', padding: '14px', borderRadius: 14,
            background: 'var(--ink)', color: 'var(--bg)', border: 'none',
            fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <ZIcon name="light" size={16} color="var(--gold)" /> On
          </button>
        </div>
      </div>
    </PhoneShell>
  );
}

// ============================================================================
// PHONE — CLIMATE CONTROL
// ============================================================================
function PhoneClimateControl({ palette = 'light' }) {
  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 18px' }}>
          <button className="z-icon-btn"><ZIcon name="back" size={16} /></button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Air conditioner</div>
            <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Bedroom</div>
          </div>
          <button className="z-icon-btn"><ZIcon name="more" size={16} /></button>
        </div>

        {/* Big temp */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8, marginBottom: 18 }}>
          <Dial size={260} value={(22 - 16) / (30 - 16) * 100} label="22°" sublabel="COOL · 22.4° NOW" color="var(--info)" />
        </div>

        {/* Mode chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 22, justifyContent: 'center' }}>
          {[
            { i: 'sparkle', n: 'Auto' },
            { i: 'leaf', n: 'Cool', active: true },
            { i: 'flame', n: 'Heat' },
            { i: 'fan', n: 'Fan' },
            { i: 'moon', n: 'Dry' },
          ].map(m => (
            <button key={m.n} style={{
              padding: '8px 12px', borderRadius: 11,
              background: m.active ? 'var(--ink)' : 'var(--surface)',
              color: m.active ? 'var(--bg)' : 'var(--ink-2)',
              border: '0.5px solid var(--line)',
              fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <ZIcon name={m.i} size={12} />
              {m.n}
            </button>
          ))}
        </div>

        {/* Fan speed */}
        <div style={{ marginBottom: 14 }}>
          <Eyebrow style={{ marginBottom: 8 }}>Fan speed</Eyebrow>
          <div style={{ display: 'flex', gap: 6 }}>
            {['Auto', 'Low', 'Med', 'High', 'Turbo'].map((s, i) => (
              <button key={s} style={{
                flex: 1, padding: '10px 0', borderRadius: 11,
                background: i === 2 ? 'var(--ink)' : 'var(--surface)',
                color: i === 2 ? 'var(--bg)' : 'var(--ink-2)',
                border: '0.5px solid var(--line)',
                fontSize: 11, fontWeight: 600,
              }}>{s}</button>
            ))}
          </div>
        </div>

        {/* Schedule row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 14, borderRadius: 14,
          background: 'var(--surface)', border: '0.5px solid var(--line)',
          marginBottom: 10,
        }}>
          <ZIcon name="auto" size={18} color="var(--accent)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Will turn off at 23:30</div>
            <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Sleep routine</div>
          </div>
          <ZIcon name="fwd" size={14} color="var(--ink-faint)" />
        </div>

        <div style={{
          padding: 12, borderRadius: 12,
          background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--accent) 25%, var(--line))',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <ZIcon name="sparkle" size={14} color="var(--accent)" />
          <span style={{ fontSize: 11, color: 'var(--ink-2)', flex: 1, lineHeight: 1.4 }}>
            Ziggy noticed you usually cool to <span className="z-mono" style={{ color: 'var(--ink)' }}>20°</span> at night.
            <span style={{ color: 'var(--accent)', fontWeight: 600, marginLeft: 4 }}>Make it a routine?</span>
          </span>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
          <button style={{
            flex: 1, padding: '14px', borderRadius: 14,
            background: 'var(--ink)', color: 'var(--bg)', border: 'none',
            fontSize: 14, fontWeight: 600,
          }}>
            On
          </button>
        </div>
      </div>
    </PhoneShell>
  );
}

// ============================================================================
// PHONE — MEDIA / TV REMOTE (Cinema-style)
// ============================================================================
function PhoneRemote({ palette = 'light' }) {
  const isDark = palette === 'dark';
  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 16px' }}>
          <button className="z-icon-btn"><ZIcon name="back" size={16} /></button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Samsung TV</div>
            <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Living Room · IR</div>
          </div>
          <button className="z-icon-btn"><ZIcon name="more" size={16} /></button>
        </div>

        {/* Now playing snapshot */}
        <div style={{
          padding: '12px 14px', borderRadius: 14,
          background: 'var(--surface)', border: '0.5px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)' }}>
            <ZIcon name="tv" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>HDMI 2 · Apple TV</div>
            <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>Last command: vol_up · 12s ago</div>
          </div>
          <span className="z-dot z-dot-on" />
        </div>

        {/* Power / Mute / Input */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 18 }}>
          {[
            { i: 'plug',  l: 'Power', accent: 'var(--err)' },
            { i: 'mute',  l: 'Mute' },
            { i: 'sliders', l: 'Input' },
          ].map(b => (
            <button key={b.l} style={{
              padding: '14px 0', borderRadius: 13,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              color: b.accent || 'var(--ink-2)',
            }}>
              <ZIcon name={b.i} size={16} />
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '0.04em' }}>{b.l}</span>
            </button>
          ))}
        </div>

        {/* D-pad (large circular) */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <div style={{
            width: 220, height: 220, borderRadius: '50%',
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            position: 'relative',
            boxShadow: 'var(--shadow-md)',
          }}>
            {/* Center OK */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 82, height: 82, borderRadius: '50%',
              background: 'var(--ink)', color: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, letterSpacing: '0.02em',
            }}>OK</div>
            {/* Arrows */}
            {[
              { pos: { top: 14, left: '50%', transform: 'translateX(-50%)' }, dir: 'up' },
              { pos: { bottom: 14, left: '50%', transform: 'translateX(-50%)' }, dir: 'down' },
              { pos: { left: 14, top: '50%', transform: 'translateY(-50%)' }, dir: 'back' },
              { pos: { right: 14, top: '50%', transform: 'translateY(-50%)' }, dir: 'fwd' },
            ].map((a, i) => (
              <div key={i} style={{ position: 'absolute', color: 'var(--ink-mute)', ...a.pos }}>
                <ZIcon name={a.dir} size={20} />
              </div>
            ))}
          </div>
        </div>

        {/* Vol / Channel + speak */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          {[
            { l: 'Vol', up: 'up', dn: 'down', val: '24' },
            { mic: true },
            { l: 'Ch',  up: 'up', dn: 'down', val: '12' },
          ].map((b, i) => (
            b.mic ? (
              <button key={i} style={{
                padding: '14px 0', borderRadius: 22,
                background: 'var(--accent)', color: 'var(--bg)',
                border: 'none', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4,
                boxShadow: 'var(--shadow-md)',
              }}>
                <ZIcon name="mic" size={20} color="#fff" />
                <span style={{ fontSize: 10, fontWeight: 600 }}>Speak</span>
              </button>
            ) : (
              <div key={i} style={{
                padding: '8px 0', borderRadius: 14,
                background: 'var(--surface)', border: '0.5px solid var(--line)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}>
                <button style={{ background: 'none', border: 'none', color: 'var(--ink-2)', padding: 2 }}><ZIcon name="up" size={16} /></button>
                <div className="z-mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{b.l} {b.val}</div>
                <button style={{ background: 'none', border: 'none', color: 'var(--ink-2)', padding: 2 }}><ZIcon name="down" size={16} /></button>
              </div>
            )
          ))}
        </div>

        {/* Source row */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {['Netflix', 'YouTube', 'Apple TV', 'HDMI 1', 'Cable'].map((s, i) => (
            <button key={s} style={{
              padding: '8px 12px', borderRadius: 10,
              background: i === 2 ? 'var(--ink)' : 'var(--surface)',
              color: i === 2 ? 'var(--bg)' : 'var(--ink-2)',
              border: '0.5px solid var(--line)',
              fontSize: 11, fontWeight: 500,
              flexShrink: 0,
            }}>{s}</button>
          ))}
        </div>
      </div>
    </PhoneShell>
  );
}

// ============================================================================
// PHONE — AI CHAT (with compound-command hint)
// ============================================================================
function PhoneChat({ palette = 'light' }) {
  const Msg = ({ from, children, hasActions }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: from === 'me' ? 'flex-end' : 'flex-start', marginBottom: 12, gap: 6 }}>
      <div style={{
        maxWidth: '82%',
        padding: '10px 14px',
        borderRadius: 18,
        background: from === 'me' ? 'var(--ink)' : 'var(--surface)',
        color: from === 'me' ? 'var(--bg)' : 'var(--ink)',
        border: from === 'me' ? 'none' : '0.5px solid var(--line)',
        fontSize: 13, lineHeight: 1.5,
        borderTopRightRadius: from === 'me' ? 6 : 18,
        borderTopLeftRadius:  from !== 'me' ? 6 : 18,
      }}>{children}</div>
      {hasActions}
    </div>
  );

  const ActionRow = ({ items }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: '82%' }}>
      {items.map((it, i) => (
        <div key={i} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 999,
          background: 'color-mix(in srgb, var(--ok) 10%, var(--surface))',
          border: '0.5px solid color-mix(in srgb, var(--ok) 35%, var(--line))',
          fontSize: 11, color: 'var(--ink-2)',
        }}>
          <ZIcon name="check" size={11} color="var(--ok)" />
          {it}
        </div>
      ))}
    </div>
  );

  return (
    <PhoneShell height={820}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          padding: '8px 20px 14px',
          borderBottom: '0.5px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button className="z-icon-btn"><ZIcon name="back" size={16} /></button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Ziggy</div>
              <span className="z-dot z-dot-on" />
              <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>local</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Knows 47 devices · 12 rooms</div>
          </div>
          <button className="z-icon-btn"><ZIcon name="more" size={16} /></button>
        </div>

        {/* Conversation */}
        <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>
          {/* Day divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, color: 'var(--ink-faint)' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            <span className="z-mono" style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Today, 19:42</span>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>

          <Msg from="me">dim living room lights and play bon iver</Msg>

          <Msg from="z" hasActions={<ActionRow items={['Ceiling 30%', 'Lamp 30%', 'Bon Iver — Holocene']} />}>
            Done — set the mood. <span style={{ color: 'var(--ink-mute)' }}>Want me to lower the AC too?</span>
          </Msg>

          <Msg from="me">yeah, 20</Msg>

          <Msg from="z" hasActions={<ActionRow items={['AC → 20°']} />}>
            Cooling to 20°.
          </Msg>

          {/* Suggestion card */}
          <div style={{
            marginTop: 6,
            padding: 14, borderRadius: 14,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            maxWidth: '92%',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <ZIcon name="sparkle" size={13} color="var(--accent)" />
              <span className="z-mono" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: '0.12em' }}>PATTERN DETECTED</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 10, lineHeight: 1.45 }}>
              You've done this <span className="z-mono" style={{ fontWeight: 600 }}>4 evenings this week</span>. Save as a routine called "Wind down"?
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={{ padding: '7px 14px', borderRadius: 10, background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontSize: 12, fontWeight: 600 }}>Save routine</button>
              <button style={{ padding: '7px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '0.5px solid var(--line)', color: 'var(--ink-2)', fontSize: 12, fontWeight: 500 }}>Not now</button>
            </div>
          </div>
        </div>

        {/* Suggestion chips above input */}
        <div style={{ padding: '8px 20px 0', display: 'flex', gap: 6, overflowX: 'auto' }}>
          {['Goodnight', 'Movie time', 'Who is home?'].map(s => (
            <div key={s} style={{
              padding: '6px 12px', borderRadius: 999, flexShrink: 0,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              fontSize: 11, color: 'var(--ink-2)', fontWeight: 500,
            }}>{s}</div>
          ))}
        </div>

        {/* Input row */}
        <div style={{ padding: '10px 16px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            flex: 1, padding: '12px 16px', borderRadius: 22,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--ink-faint)', fontSize: 13,
          }}>
            <ZIcon name="sparkle" size={13} color="var(--accent)" />
            Try: "open shades and start coffee"
          </div>
          <button style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'var(--accent)', color: '#fff', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--shadow-md)',
          }}>
            <ZIcon name="mic" size={18} color="#fff" />
          </button>
        </div>
      </div>
    </PhoneShell>
  );
}

// ============================================================================
// PHONE — AUTOMATIONS (3 tabs)
// ============================================================================
function PhoneAutomations({ palette = 'light' }) {
  return (
    <PhoneShell height={820}>
      <div style={{ padding: '4px 20px 80px', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '10px 0 14px' }}>
          <Eyebrow>Your home</Eyebrow>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: '4px 0 0' }}>Routines</h1>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 12, marginBottom: 18 }}>
          {[
            { l: 'Active',    n: 12, active: true },
            { l: 'Suggested', n: 3, sparkle: true },
          ].map(t => (
            <button key={t.l} style={{
              flex: 1, padding: '8px 0', borderRadius: 9,
              background: t.active ? 'var(--surface)' : 'transparent',
              border: 'none', fontSize: 12, fontWeight: 600,
              color: t.active ? 'var(--ink)' : 'var(--ink-mute)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: t.active ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
            }}>
              {t.sparkle && <ZIcon name="sparkle" size={11} color="var(--accent)" />}
              {t.l}
              <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t.n}</span>
            </button>
          ))}
        </div>

        {/* Active routines */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { i: 'sunrise', name: 'Good morning',     trig: '6:30am · weekdays',     next: 'Tomorrow', on: true,  tint: 'var(--gold)' },
            { i: 'sun',     name: 'Daytime away',     trig: 'When all leave',         next: 'Standby',  on: true,  tint: 'var(--info)' },
            { i: 'sunset',  name: 'Wind down',        trig: 'Sunset + 1h',            next: 'Today 19:32', on: true, tint: 'var(--accent)' },
            { i: 'moon',    name: 'Goodnight',        trig: 'Voice or 23:30',         next: 'Today 23:30', on: true, tint: 'var(--info)' },
            { i: 'leaf',    name: 'Vacation mode',    trig: 'Manual',                  next: 'Off',      on: false, tint: 'var(--ok)' },
            { i: 'family',  name: 'Kids bedtime',     trig: '20:30 · school nights', next: 'Today 20:30', on: true, tint: 'var(--accent)' },
          ].map(r => (
            <div key={r.name} style={{
              padding: 14, borderRadius: 14,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 12,
              opacity: r.on ? 1 : 0.6,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 11,
                background: 'color-mix(in srgb, ' + r.tint + ' 12%, var(--surface-2))',
                color: r.tint,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}><ZIcon name={r.i} size={17} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{r.name}</div>
                <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>{r.trig}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="z-mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 4 }}>{r.next}</div>
                <span style={{
                  width: 28, height: 16, borderRadius: 999, display: 'inline-block', position: 'relative',
                  background: r.on ? 'var(--ok)' : 'var(--line-2)',
                }}>
                  <span style={{
                    position: 'absolute', top: 2, left: r.on ? 14 : 2,
                    width: 12, height: 12, borderRadius: '50%', background: '#fff',
                  }} />
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Create button */}
        <button style={{
          marginTop: 16, width: '100%', padding: '13px',
          borderRadius: 14, background: 'var(--surface)',
          border: '1px dashed var(--line-2)',
          color: 'var(--ink-2)', fontSize: 13, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <ZIcon name="plus" size={14} />
          New routine
        </button>
      </div>
      <BottomNav active="auto" />
    </PhoneShell>
  );
}

Object.assign(window, { PhoneLightControl, PhoneClimateControl, PhoneRemote, PhoneChat, PhoneAutomations });
