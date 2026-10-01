import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get, patch } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { Badge, Card, CHART, DataTable, Loader, PageHeader, useFetch, useFlash } from '../components/ui.jsx';
import { fmtDateTime, fmtDay, fmtNum, fmtRelative, titleCase, toLocalDateInput } from '../format.js';

export default function StationDetail() {
  const { id } = useParams();
  const { isStaff } = useAuth();
  const state = useFetch(() => get(`/stations/${id}`), [id]);
  const [toast, flash] = useFlash();
  const today = toLocalDateInput(new Date());

  const setStatus = async (status) => {
    try {
      await patch(`/stations/${id}`, { status });
      flash(`Station marked ${status}`);
      state.reload(true);
    } catch (e) { flash(e.message, 'bad'); }
  };

  return (
    <Loader state={state}>
      {(s) => (
        <>
          <PageHeader
            title={<span className="row"><Link to="/stations" className="btn btn-ghost btn-icon" aria-label="Back"><Icon name="back" /></Link>{s.code} · {s.name} <Badge value={s.status} /></span>}
            subtitle={`${s.city}, ${s.country} · ${fmtNum(s.latitude, 3)}°, ${fmtNum(s.longitude, 3)}° · ${fmtNum(s.antenna_diameter_m, 1)} m dish · bands ${s.bands}`}
            actions={isStaff && (
              <select value={s.status} onChange={(e) => setStatus(e.target.value)} aria-label="Change status">
                {['online', 'maintenance', 'offline'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
              </select>
            )}
          />
          {s.status !== 'online' && (
            <div className="banner banner-warn">This station is {s.status}; new bookings are rejected by <code>sp_book_window</code>.</div>
          )}
          <div className="grid grid-2-1">
            <Card title="Daily antenna load" subtitle="Share of each day booked: past 14 days and next 7 (recursive CTE over fn_station_load)">
              <div className="chart">
                <ResponsiveContainer>
                  <BarChart data={s.load} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={14} />
                    <YAxis unit="%" />
                    <Tooltip labelFormatter={fmtDay} formatter={(v) => [`${fmtNum(v, 1)}%`, 'Load']} cursor={{ fillOpacity: 0.08 }} />
                    <Bar dataKey="load_pct" radius={[3, 3, 0, 0]}>
                      {s.load.map((d) => <Cell key={d.day} fill={d.day > today ? CHART.slate : d.day === today ? CHART.amber : CHART.blue} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="legend"><span><i style={{ background: CHART.blue }} />Past</span><span><i style={{ background: CHART.amber }} />Today</span><span><i style={{ background: CHART.slate }} />Booked ahead</span></div>
            </Card>
            <Card title="Summary">
              <dl className="kv">
                <dt>Load today</dt><dd>{fmtNum(s.load_today_pct, 1)}%</dd>
                <dt>Upcoming sessions</dt><dd>{s.upcoming_sessions}</dd>
                <dt>Supported bands</dt><dd>{s.bands}</dd>
                <dt>Next session</dt><dd>{s.schedule[0] ? fmtRelative(s.schedule[0].start_ts) : '—'}</dd>
              </dl>
            </Card>
          </div>
          <div style={{ marginTop: 16 }}>
            <Card title="Upcoming sessions" pad={false}>
              <DataTable rows={s.schedule} rowKey={(r) => r.booking_id} empty="Nothing scheduled." columns={[
                { key: 'start_ts', label: 'Start', render: (r) => fmtDateTime(r.start_ts) },
                { key: 'duration_min', label: 'Duration', align: 'right', render: (r) => `${r.duration_min} min` },
                { key: 'satellite', label: 'Satellite' },
                { key: 'transponder', label: 'Transponder', render: (r) => `${r.transponder} (${r.band})` },
                ...(isStaff ? [{ key: 'client', label: 'Client' }] : []),
                { key: 'purpose', label: 'Purpose', render: (r) => titleCase(r.purpose) },
              ]} />
            </Card>
          </div>
          {toast}
        </>
      )}
    </Loader>
  );
}
