// ── Ziggy redesign canvas — main composition ────────────────────────────

const { DesignCanvas, DCSection, DCArtboard } = window;

// Returns an ARRAY (not a Component) so DCSection sees the DCArtboards directly.
// Wrapping these in a Pair component would hide them from React.Children walk.
function pair({ id, label, h = 820, w = 380, render }) {
  return [
    <DCArtboard key={`${id}-light`} id={`${id}-light`} label={`${label} · warm light`} width={w} height={h}>
      <div className="z-art" data-palette="light" style={{ width: w, height: h, background: 'var(--bg)' }}>
        {render('light')}
      </div>
    </DCArtboard>,
    <DCArtboard key={`${id}-dark`} id={`${id}-dark`} label={`${label} · premium dark`} width={w} height={h}>
      <div className="z-art" data-palette="dark" style={{ width: w, height: h, background: 'var(--bg)' }}>
        {render('dark')}
      </div>
    </DCArtboard>,
  ];
}

function App() {
  return (
    <DesignCanvas
      title="Ziggy · redesigned"
      subtitle="Phase 3 — opinionated. Two palettes (warm light · premium dark). Phone-first, tablet & desktop variants, RTL parity, onboarding. Drag to pan, scroll to zoom, double-click any artboard to focus."
    >
      {/* ── Section 0: Information architecture ───────────────────────── */}
      <DCSection id="ia" title="0. Information architecture — brutally pruned">
        <DCArtboard id="ia-warm" label="From 21 routes to 6" width={980} height={780}>
          <div className="z-art" data-palette="light" style={{ width: 980, height: 780, background: 'var(--bg)' }}>
            <IAArtboard />
          </div>
        </DCArtboard>
      </DCSection>

      {/* ── Section 1: Dashboard (phone) ──────────────────────────────── */}
      <DCSection id="dash" title="1. Home dashboard — phone">
        {pair({ id: 'dash', label: 'Dashboard', render: p => <PhoneDashboard palette={p} /> })}
      </DCSection>

      {/* ── Section 2: Rooms ──────────────────────────────────────────── */}
      <DCSection id="rooms" title="2. Rooms — photo-first">
        {pair({ id: 'rlist', label: 'Rooms list', render: p => <PhoneRoomsList palette={p} /> })}
        {pair({ id: 'rdet',  label: 'Room detail', render: p => <PhoneRoomDetail palette={p} /> })}
      </DCSection>

      {/* ── Section 2b: Devices ───────────────────────────────────────── */}
      <DCSection id="devices" title="2b. Devices — grouped by room (bidirectional with Rooms)">
        {pair({ id: 'devs', label: 'Devices · grouped', render: p => <PhoneDevices palette={p} /> })}
      </DCSection>

      {/* ── Section 3: Device controls ────────────────────────────────── */}
      <DCSection id="controls" title="3. Device controls — opinionated, dial-first">
        {pair({ id: 'light',   label: 'Light control',   render: p => <PhoneLightControl palette={p} /> })}
        {pair({ id: 'climate', label: 'Climate control', render: p => <PhoneClimateControl palette={p} /> })}
        {pair({ id: 'remote',  label: 'TV / IR remote',  render: p => <PhoneRemote palette={p} /> })}
      </DCSection>

      {/* ── Section 4: AI Ask + Automations ───────────────────────────── */}
      <DCSection id="brain" title="4. Ask (chat) & Automations">
        {pair({ id: 'chat', label: 'AI Chat', render: p => <PhoneChat palette={p} /> })}
        {pair({ id: 'auto', label: 'Automations (Active · Suggested)', render: p => <PhoneAutomations palette={p} /> })}
      </DCSection>

      {/* ── Section 4b: Tasks ─────────────────────────────────────────── */}
      <DCSection id="tasks" title="4b. Tasks — family list with AI suggestions">
        {pair({ id: 'tasks', label: 'Tasks', render: p => <PhoneTasks palette={p} /> })}
      </DCSection>

      {/* ── Section 5: Alerts ─────────────────────────────────────────── */}
      <DCSection id="alerts" title="5. Alerts — unified inbox (replaces Anomalies + sensor pushes + offline)">
        {pair({ id: 'alerts', label: 'Alerts inbox', render: p => <PhoneAlerts palette={p} /> })}
      </DCSection>

      {/* ── Section 5b: Settings ──────────────────────────────────────── */}
      <DCSection id="settings" title="5b. Settings — absorbs Quick Asks + Memory as panels">
        {pair({ id: 'settings', label: 'Settings', render: p => <PhoneSettings palette={p} /> })}
      </DCSection>

      {/* ── Section 6: Tablet wall display ────────────────────────────── */}
      <DCSection id="wall" title="6. Tablet wall display — 10-inch in-room control surface">
        <DCArtboard id="wall-light" label="Wall display · warm light" width={920} height={600}>
          <div className="z-art" data-palette="light" style={{ width: 920, height: 600 }}>
            <TabletWallDisplay palette="light" />
          </div>
        </DCArtboard>
        <DCArtboard id="wall-dark" label="Wall display · premium dark" width={920} height={600}>
          <div className="z-art" data-palette="dark" style={{ width: 920, height: 600 }}>
            <TabletWallDisplay palette="dark" />
          </div>
        </DCArtboard>
      </DCSection>

      {/* ── Section 7: Desktop ────────────────────────────────────────── */}
      <DCSection id="desktop" title="7. Desktop — full web dashboard">
        <DCArtboard id="desktop-light" label="Desktop · warm light" width={1280} height={800}>
          <div className="z-art" data-palette="light" style={{ width: 1280, height: 800 }}>
            <DesktopDashboard palette="light" />
          </div>
        </DCArtboard>
        <DCArtboard id="desktop-dark" label="Desktop · premium dark" width={1280} height={800}>
          <div className="z-art" data-palette="dark" style={{ width: 1280, height: 800 }}>
            <DesktopDashboard palette="dark" />
          </div>
        </DCArtboard>
      </DCSection>

      {/* ── Section 8: Onboarding ─────────────────────────────────────── */}
      <DCSection id="onb" title="8. Onboarding — first run">
        <DCArtboard id="onb-light" label="Onboarding · warm light" width={1230} height={780}>
          <div className="z-art" data-palette="light" style={{ width: 1230, height: 780, padding: 24, background: 'var(--bg)' }}>
            <OnboardingTrio palette="light" />
          </div>
        </DCArtboard>
        <DCArtboard id="onb-dark" label="Onboarding · premium dark" width={1230} height={780}>
          <div className="z-art" data-palette="dark" style={{ width: 1230, height: 780, padding: 24, background: 'var(--bg)' }}>
            <OnboardingTrio palette="dark" />
          </div>
        </DCArtboard>
      </DCSection>

      {/* ── Section 9: Hebrew / RTL parity ────────────────────────────── */}
      <DCSection id="rtl" title="9. Hebrew · RTL parity — every screen mirrors cleanly">
        {pair({ id: 'rtl-dash', label: 'Dashboard · עברית', render: p => <PhoneDashboardRTL palette={p} /> })}
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
