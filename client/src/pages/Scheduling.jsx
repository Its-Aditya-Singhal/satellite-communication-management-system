import { useMemo, useState } from 'react';
import { get, post } from '../api.js';
import { Badge, Card, DataTable, ErrorBanner, Field, Loader, Modal, PageHeader, Spinner, useFetch, useFlash } from '../components/ui.jsx';
import { fmtDateTime, fmtNum, fmtTime, titleCase, toDate, toLocalDateInput, toLocalInput } from '../format.js';

const PURPOSES = ['telemetry', 'command', 'data_downlink', 'broadcast', 'ranging'];
const HOURS = 24;

export default function Scheduling() {
  const stations = useFetch(() => get('/stations'), []);
  const [stationId, setStationId] = useState('');
  const [day, setDay] = useState(toLocalDateInput(new Date()));
  const [selected, setSelected] = useState(null);
  const [toast, flash] = useFlash();

  const station = stationId || stations.data?.[0]?.station_id;
  const from = useMemo(() => new Date(`${day}T00:00`), [day]);
  const to = useMemo(() => new Date(from.getTime() + HOURS * 3.6e6), [from]);

  const data = useFetch(async () => {
    if (!station) return null;
    const q = { stationId: station, from: toLocalInput(from), to: toLocalInput(to) };
    const [windows, bookings] = await Promise.all([
      get('/windows', q),
      get('/bookings', { ...q, status: 'confirmed,completed' }),
    ]);
    return { windows, bookings };
  }, [station, day]);

  const cancel = async (b) => {
    if (!window.confirm(`Cancel ${b.satellite} session at ${fmtTime(b.start_ts)}?`)) return;
    try {
      await post(`/bookings/${b.booking_id}/cancel`);
      flash(`Booking #${b.booking_id} cancelled`);
      data.reload(true);
    } catch (e) { flash(e.message, 'bad'); }
  };

  const shiftDay = (n) => {
    const d = new Date(`${day}T12:00`);
    d.setDate(d.getDate() + n);
    setDay(toLocalDateInput(d));
  };

  return (
    <>
      <PageHeader title="Scheduling" subtitle="Visibility windows per ground station. Pick a pass to book a session; conflicts are enforced by MySQL triggers and row locks." />
      <Loader state={stations}>
        {(list) => (
          <Card>
            <div className="filters">
              <select value={station} onChange={(e) => setStationId(e.target.value)} aria-label="Ground station">
                {list.map((s) => <option key={s.station_id} value={s.station_id}>{s.code} · {s.name}{s.status !== 'online' ? ` (${s.status})` : ''}</option>)}
              </select>
              <button className="btn btn-sm" onClick={() => shiftDay(-1)} aria-label="Previous day">‹</button>
              <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
              <button className="btn btn-sm" onClick={() => shiftDay(1)} aria-label="Next day">›</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setDay(toLocalDateInput(new Date()))}>Today</button>
              <div className="legend" style={{ marginLeft: 'auto' }}>
                <span><i style={{ background: 'var(--ok-soft)', border: '1px solid var(--ok)' }} />Free pass</span>
                <span><i style={{ background: 'var(--neutral-soft)', border: '1px solid var(--border)' }} />Pass with conflicts</span>
                <span><i style={{ background: 'var(--accent)' }} />Booked session</span>
              </div>
            </div>
            {data.loading && !data.data ? <Spinner /> : data.error ? <ErrorBanner error={data.error} onRetry={data.reload} /> : data.data && (
              <Timeline from={from} to={to} windows={data.data.windows} bookings={data.data.bookings} onPick={setSelected} />
            )}
          </Card>
        )}
      </Loader>

      {data.data && (
        <div style={{ marginTop: 16 }}>
          <Card title="Sessions at this station" subtitle={`${fmtDateTime(from)} – ${fmtDateTime(to)}`} pad={false}>
            <DataTable rows={data.data.bookings} rowKey={(r) => r.booking_id} empty="No sessions in this period." columns={[
              { key: 'booking_id', label: '#', render: (r) => <span className="mono">{r.booking_id}</span> },
              { key: 'start_ts', label: 'Time', render: (r) => <span className="nowrap">{fmtTime(r.start_ts)}–{fmtTime(r.end_ts)}</span> },
              { key: 'satellite', label: 'Satellite' },
              { key: 'transponder', label: 'Transponder', render: (r) => `${r.transponder} (${r.band})` },
              { key: 'client', label: 'Client' },
              { key: 'purpose', label: 'Purpose', render: (r) => titleCase(r.purpose) },
              { key: 'booked_by', label: 'Booked by' },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              { key: 'actions', label: '', nosort: true, render: (r) => r.status === 'confirmed' && toDate(r.start_ts) > new Date()
                ? <button className="btn btn-sm btn-danger" onClick={() => cancel(r)}>Cancel</button> : null },
            ]} />
          </Card>
        </div>
      )}

      {selected && (
        <BookingModal window={selected} onClose={() => setSelected(null)}
                      onBooked={(b) => { setSelected(null); flash(`Booked #${b.booking_id}: ${b.satellite} ${fmtTime(b.start_ts)}–${fmtTime(b.end_ts)}`); data.reload(true); }} />
      )}
      {toast}
    </>
  );
}

function Timeline({ from, to, windows, bookings, onPick }) {
  const span = to - from;
  const pos = (v) => Math.max(0, Math.min(100, ((toDate(v) - from) / span) * 100));
  const rows = useMemo(() => {
    const m = new Map();
    for (const w of windows) {
      if (!m.has(w.sat_id)) m.set(w.sat_id, { satellite: w.satellite, orbit: w.orbit_type, windows: [], bookings: [] });
      m.get(w.sat_id).windows.push(w);
    }
    for (const b of bookings) m.get(b.sat_id)?.bookings.push(b);
    return [...m.values()].sort((a, b) => a.orbit.localeCompare(b.orbit) || a.satellite.localeCompare(b.satellite));
  }, [windows, bookings]);
  const now = new Date();
  const ticks = Array.from({ length: 9 }, (_, i) => new Date(from.getTime() + (i * span) / 8));

  if (!rows.length) return <div className="empty">No visibility windows for this station in the selected period.</div>;
  return (
    <div className="timeline" style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 720 }}>
        <div className="tl-axis">
          <span />
          <div className="tl-ticks">{ticks.map((t, i) => <span key={i} style={{ left: `${(i / 8) * 100}%` }}>{fmtTime(t)}</span>)}</div>
        </div>
        {rows.map((r) => (
          <div className="tl-row" key={r.satellite}>
            <div className="tl-label" title={r.satellite}>{r.satellite} <span className="muted small">{r.orbit}</span></div>
            <div className="tl-track">
              {r.windows.map((w) => (
                <div key={w.window_id}
                     className={`tl-bar ${w.busy.length ? 'busy' : 'free'}`}
                     style={{ left: `${pos(w.aos_ts)}%`, width: `${pos(w.los_ts) - pos(w.aos_ts)}%` }}
                     title={`${fmtTime(w.aos_ts)}–${fmtTime(w.los_ts)} · max el ${fmtNum(w.max_elevation_deg, 0)}°${w.busy.length ? ` · ${w.busy.length} conflicting session(s)` : ' · free'}`}
                     onClick={() => onPick(w)} />
              ))}
              {r.bookings.map((b) => (
                <div key={b.booking_id} className="tl-bar booked"
                     style={{ left: `${pos(b.start_ts)}%`, width: `${pos(b.end_ts) - pos(b.start_ts)}%`, top: 7, height: 8, pointerEvents: 'none' }}
                     title={`#${b.booking_id} ${b.client}`} />
              ))}
              {now > from && now < to && <div className="tl-now" style={{ left: `${pos(now)}%` }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingModal({ window: w, onClose, onBooked }) {
  const contracts = useFetch(() => get('/contracts'), []);
  const aos = toDate(w.aos_ts);
  const los = toDate(w.los_ts);
  const defaultEnd = new Date(Math.min(los.getTime(), aos.getTime() + 30 * 60000));
  const [f, setF] = useState({
    transponder_id: w.compatible_transponders.find((t) => t.label !== 'TTC')?.transponder_id ?? w.compatible_transponders[0]?.transponder_id ?? '',
    contract_id: '',
    start_ts: toLocalInput(aos),
    end_ts: toLocalInput(defaultEnd),
    purpose: 'telemetry',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const active = (contracts.data || []).filter((c) => c.status === 'active');
  const contractId = f.contract_id || active[0]?.contract_id || '';

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      onBooked(await post('/bookings', { ...f, contract_id: contractId, window_id: w.window_id }));
    } catch (e) { setError(e); setBusy(false); }
  };

  return (
    <Modal title={`Book ${w.satellite} → ${w.station_code}`} onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={submit} disabled={busy || !f.transponder_id}>{busy ? 'Booking…' : 'Book session'}</button></>}>
      <dl className="kv" style={{ marginBottom: 14 }}>
        <dt>Window</dt><dd>{fmtDateTime(w.aos_ts)} – {fmtTime(w.los_ts)} ({w.duration_min} min)</dd>
        <dt>Max elevation</dt><dd>{fmtNum(w.max_elevation_deg, 1)}°</dd>
        <dt>Satellite / station</dt><dd><Badge value={w.sat_status} /> <Badge value={w.station_status} /></dd>
      </dl>
      {w.busy.length > 0 && (
        <div className="banner banner-warn" style={{ display: 'block' }}>
          <strong>Existing sessions overlap this window:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {w.busy.map((b) => <li key={b.booking_id}>#{b.booking_id} {b.satellite} @ {b.station_code} {fmtTime(b.start_ts)}–{fmtTime(b.end_ts)}{b.same_station ? ' (same station)' : ' (same satellite)'}</li>)}
          </ul>
          <div className="small" style={{ marginTop: 6 }}>Pick a free slot, or submit anyway to see the database reject it.</div>
        </div>
      )}
      {error && <ErrorBanner error={error} />}
      <div className="form-grid">
        <Field label="Transponder" hint={w.compatible_transponders.length ? 'Only bands this station supports are listed' : 'No compatible transponder'}>
          <select value={f.transponder_id} onChange={set('transponder_id')}>
            {w.compatible_transponders.map((t) => <option key={t.transponder_id} value={t.transponder_id}>{t.label} ({t.band})</option>)}
          </select>
        </Field>
        <Field label="Contract">
          <select value={contractId} onChange={set('contract_id')}>
            {active.map((c) => <option key={c.contract_id} value={c.contract_id}>{c.contract_code} · {c.client}</option>)}
          </select>
        </Field>
        <Field label="Start"><input type="datetime-local" value={f.start_ts} onChange={set('start_ts')} /></Field>
        <Field label="End"><input type="datetime-local" value={f.end_ts} onChange={set('end_ts')} /></Field>
        <Field label="Purpose">
          <select value={f.purpose} onChange={set('purpose')}>{PURPOSES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</select>
        </Field>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Calls <code>sp_book_window</code>: locks the station and satellite rows (<code>SELECT … FOR UPDATE</code>), validates the contract, then inserts. Triggers check overlap, band compatibility and AOS/LOS bounds.
      </p>
    </Modal>
  );
}
