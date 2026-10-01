import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { Badge, Card, DataTable, Field, Loader, Modal, PageHeader, useFetch, useFlash } from '../components/ui.jsx';
import { fmtNum, fmtRelative } from '../format.js';

function healthTone(h) {
  if (!h || !h.lastContact) return 'none';
  if (h.criticalAnomalies) return 'bad';
  if (h.openAnomalies) return 'warn';
  return 'ok';
}

export default function Satellites() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const state = useFetch(() => get('/satellites'), [], { interval: 60000 });
  const [orbit, setOrbit] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [toast, flash] = useFlash();

  const rows = useMemo(() => (state.data || []).filter((s) =>
    (!orbit || s.orbit_type === orbit) &&
    (!q || `${s.name} ${s.norad_id} ${s.operator_org} ${s.model}`.toLowerCase().includes(q.toLowerCase()))), [state.data, orbit, q]);

  return (
    <>
      <PageHeader
        title="Satellites"
        subtitle="Space segment registry with live health from the telemetry store"
        actions={isAdmin && <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> Add satellite</button>}
      />
      <Card pad={false}>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="filters">
            <input placeholder="Search name, NORAD id, operator…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
            <select value={orbit} onChange={(e) => setOrbit(e.target.value)} aria-label="Orbit filter">
              <option value="">All orbits</option>
              {['LEO', 'MEO', 'GEO', 'HEO'].map((o) => <option key={o}>{o}</option>)}
            </select>
            <span className="muted small">{rows.length} satellites</span>
          </div>
        </div>
        <Loader state={state}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.sat_id}
              onRowClick={(r) => navigate(`/satellites/${r.sat_id}`)}
              columns={[
                { key: 'name', label: 'Satellite', render: (r) => <span className="nowrap"><span className={`health-dot health-${healthTone(r.health)}`} /><strong>{r.name}</strong></span> },
                { key: 'norad_id', label: 'NORAD', render: (r) => <span className="mono">{r.norad_id}</span> },
                { key: 'orbit_type', label: 'Orbit', render: (r) => <Badge tone="info" value={r.orbit_type}>{r.orbit_type}</Badge> },
                { key: 'altitude_km', label: 'Altitude', align: 'right', render: (r) => `${fmtNum(r.altitude_km)} km` },
                { key: 'model', label: 'Bus' },
                { key: 'operator_org', label: 'Operator' },
                { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
                { key: 'battery', label: 'Battery', align: 'right', sort: (r) => r.health?.batterySoC, render: (r) => (r.health?.batterySoC != null ? `${fmtNum(r.health.batterySoC, 0)}%` : '—') },
                { key: 'contact', label: 'Last contact', sort: (r) => r.health?.lastContact, render: (r) => <span className="muted nowrap">{r.health?.lastContact ? fmtRelative(r.health.lastContact) : '—'}</span> },
                { key: 'anoms', label: 'Anomalies', align: 'right', sort: (r) => r.health?.openAnomalies, render: (r) => (r.health?.openAnomalies ? <Badge tone={r.health.criticalAnomalies ? 'bad' : 'warn'} value="x">{r.health.openAnomalies} open</Badge> : <span className="muted">—</span>) },
                { key: 'upcoming_sessions', label: 'Upcoming', align: 'right' },
              ]}
            />
          )}
        </Loader>
      </Card>
      {adding && <AddSatellite onClose={() => setAdding(false)} onDone={(name) => { setAdding(false); flash(`${name} added to the registry`); state.reload(); }} />}
      {toast}
    </>
  );
}

function AddSatellite({ onClose, onDone }) {
  const [f, setF] = useState({ orbit_type: 'LEO', status: 'active', launch_date: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await post('/satellites', { ...f, geo_longitude: f.orbit_type === 'GEO' ? f.geo_longitude : null });
      onDone(f.name);
    } catch (e) { setError(e); setBusy(false); }
  };

  return (
    <Modal title="Add satellite" onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={submit}>Save</button></>}>
      {error && <div className="banner banner-bad">{error.message}</div>}
      <div className="form-grid">
        <Field label="Name"><input value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="NORAD id"><input type="number" value={f.norad_id || ''} onChange={set('norad_id')} /></Field>
        <Field label="Bus / model"><input value={f.model || ''} onChange={set('model')} placeholder="e.g. I-2K" /></Field>
        <Field label="Operator"><input value={f.operator_org || ''} onChange={set('operator_org')} /></Field>
        <Field label="Orbit">
          <select value={f.orbit_type} onChange={set('orbit_type')}>{['LEO', 'MEO', 'GEO', 'HEO'].map((o) => <option key={o}>{o}</option>)}</select>
        </Field>
        <Field label="Launch date"><input type="date" value={f.launch_date} onChange={set('launch_date')} /></Field>
        <Field label="Mass (kg)"><input type="number" value={f.mass_kg || ''} onChange={set('mass_kg')} /></Field>
        <Field label="Altitude (km)"><input type="number" value={f.altitude_km || ''} onChange={set('altitude_km')} /></Field>
        <Field label="Inclination (°)"><input type="number" value={f.inclination_deg || ''} onChange={set('inclination_deg')} /></Field>
        <Field label="Period (min)"><input type="number" value={f.period_min || ''} onChange={set('period_min')} /></Field>
        {f.orbit_type === 'GEO' && <Field label="GEO longitude (°E)"><input type="number" value={f.geo_longitude || ''} onChange={set('geo_longitude')} /></Field>}
      </div>
      <p className="muted small">Satellite and orbit rows are inserted in one transaction; CHECK constraints validate the orbital values.</p>
    </Modal>
  );
}
