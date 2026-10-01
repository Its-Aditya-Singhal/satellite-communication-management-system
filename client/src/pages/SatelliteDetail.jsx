import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get, patch } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { Badge, Card, CHART, DataTable, Loader, Meter, PageHeader, Tabs, useFetch, useFlash } from '../components/ui.jsx';
import { fmtDate, fmtDateTime, fmtNum, fmtRelative, fmtTime, titleCase } from '../format.js';

const RANGES = [{ value: 6, label: '6 h' }, { value: 24, label: '24 h' }, { value: 72, label: '3 d' }, { value: 168, label: '7 d' }];

export default function SatelliteDetail() {
  const { id } = useParams();
  const { isStaff } = useAuth();
  const state = useFetch(() => get(`/satellites/${id}`), [id]);
  const [toast, flash] = useFlash();

  const setStatus = async (status) => {
    try {
      await patch(`/satellites/${id}`, { status });
      flash(`Status changed to ${status}`);
      state.reload(true);
    } catch (e) { flash(e.message, 'bad'); }
  };

  return (
    <Loader state={state}>
      {(s) => (
        <>
          <PageHeader
            title={<span className="row"><Link to="/satellites" className="btn btn-ghost btn-icon" aria-label="Back"><Icon name="back" /></Link>{s.name} <Badge value={s.status} /></span>}
            subtitle={`NORAD ${s.norad_id} · ${s.model} bus · ${s.operator_org}`}
            actions={isStaff && (
              <select value={s.status} onChange={(e) => setStatus(e.target.value)} aria-label="Change status">
                {['active', 'standby', 'maintenance', 'decommissioned'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
              </select>
            )}
          />
          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            <Card title="Orbit">
              <dl className="kv">
                <dt>Class</dt><dd>{s.orbit_type}</dd>
                <dt>Altitude</dt><dd>{fmtNum(s.altitude_km)} km</dd>
                <dt>Inclination</dt><dd>{fmtNum(s.inclination_deg, 2)}°</dd>
                <dt>Period</dt><dd>{fmtNum(s.period_min, 1)} min</dd>
                {s.geo_longitude != null && <><dt>Slot</dt><dd>{fmtNum(s.geo_longitude, 1)}° E</dd></>}
                <dt>Epoch</dt><dd>{fmtDateTime(s.epoch)}</dd>
              </dl>
            </Card>
            <Card title="Spacecraft">
              <dl className="kv">
                <dt>Launched</dt><dd>{fmtDate(s.launch_date)}</dd>
                <dt>Mass</dt><dd>{fmtNum(s.mass_kg)} kg</dd>
                <dt>Bus family</dt><dd>{titleCase(s.family)}</dd>
                <dt>Transponders</dt><dd>{s.transponders.length}</dd>
              </dl>
            </Card>
            <Card title="Latest telemetry" subtitle={s.telemetry?.latest ? `received ${fmtRelative(s.telemetry.latest.ts)}` : undefined}>
              {s.telemetry?.latest ? (
                <dl className="kv">
                  {s.chartMetrics.map(([path, label, unit]) => {
                    const v = path.split('.').reduce((o, k) => o?.[k], s.telemetry.latest);
                    return <FragmentKV key={path} label={label} value={v != null ? `${fmtNum(v, 2)} ${unit}` : '—'} />;
                  })}
                </dl>
              ) : <div className="muted">{s.telemetry ? 'No packets received yet.' : 'Telemetry store offline.'}</div>}
            </Card>
          </div>

          {s.telemetry && <TelemetryCharts satId={s.sat_id} metrics={s.chartMetrics} />}

          <DetailTabs s={s} />
          {toast}
        </>
      )}
    </Loader>
  );
}

const FragmentKV = ({ label, value }) => (<><dt>{label}</dt><dd>{value}</dd></>);

function TelemetryCharts({ satId, metrics }) {
  const [hours, setHours] = useState(24);
  const state = useFetch(() => get(`/telemetry/${satId}/series`, { hours }), [satId, hours], { interval: 30000 });
  const colors = [CHART.blue, CHART.teal, CHART.amber, CHART.violet];

  return (
    <Card title="Telemetry" subtitle="MongoDB time-series, bucketed with $dateTrunc (avg line, min–max band)"
          actions={<div className="row">{RANGES.map((r) => (
            <button key={r.value} className={`btn btn-sm ${hours === r.value ? 'btn-primary' : ''}`} onClick={() => setHours(r.value)}>{r.label}</button>
          ))}</div>}>
      <Loader state={state} empty="No telemetry in this range.">
        {(d) => (
          <div className="grid grid-2">
            {metrics.map(([path, label, unit], i) => {
              const key = path.replace(/\./g, '_');
              const data = d.points.map((p) => ({ t: p.t, avg: p[`${key}_avg`], band: [p[`${key}_min`], p[`${key}_max`]] }));
              return (
                <div key={path}>
                  <div className="spread"><h3>{label}</h3><span className="muted small">{unit} · {d.bucketMinutes}-min buckets</span></div>
                  <div className="chart chart-sm">
                    <ResponsiveContainer>
                      <ComposedChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="t" tickFormatter={(t) => (hours > 48 ? fmtDate(t).slice(0, 6) : fmtTime(t))} minTickGap={28} />
                        <YAxis domain={['auto', 'auto']} width={48} />
                        <Tooltip labelFormatter={fmtDateTime} formatter={(v) => (Array.isArray(v) ? v.map((x) => fmtNum(x, 2)).join(' – ') : fmtNum(v, 2))} />
                        <Area dataKey="band" name="min–max" stroke="none" fill={colors[i]} fillOpacity={0.15} isAnimationActive={false} />
                        <Line dataKey="avg" name="avg" stroke={colors[i]} dot={false} strokeWidth={2} isAnimationActive={false} />
                        {path === 'linkMarginDb' && <ReferenceLine y={3} stroke={CHART.red} strokeDasharray="4 3" />}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Loader>
    </Card>
  );
}

function DetailTabs({ s }) {
  const [tab, setTab] = useState('transponders');
  const t = s.telemetry;
  return (
    <div style={{ marginTop: 16 }}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'transponders', label: 'Transponders', count: s.transponders.length },
        { value: 'schedule', label: 'Upcoming sessions', count: s.schedule.length },
        { value: 'anomalies', label: 'Anomalies', count: t?.anomalies?.length },
        { value: 'events', label: 'Event log', count: t?.events?.length },
        { value: 'packet', label: 'Raw packet' },
      ]} />
      {tab === 'transponders' && (
        <Card pad={false}>
          <DataTable rows={s.transponders} rowKey={(r) => r.transponder_id} columns={[
            { key: 'label', label: 'Transponder', render: (r) => <strong>{r.label}</strong> },
            { key: 'band', label: 'Band', render: (r) => <Badge tone="info" value={r.band}>{r.band}</Badge> },
            { key: 'bandwidth_mhz', label: 'Bandwidth', align: 'right', render: (r) => `${fmtNum(r.bandwidth_mhz)} MHz` },
            { key: 'peak_allocated_mhz', label: 'Peak leased (30 d)', align: 'right', render: (r) => `${fmtNum(r.peak_allocated_mhz)} MHz` },
            { key: 'utilization_pct', label: 'Utilisation', width: 200, render: (r) => <div className="row"><Meter value={r.utilization_pct} /><span className="small">{fmtNum(r.utilization_pct, 1)}%</span></div> },
            { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
          ]} />
        </Card>
      )}
      {tab === 'schedule' && (
        <Card pad={false}>
          <DataTable rows={s.schedule} rowKey={(r) => r.booking_id} empty="No upcoming sessions." columns={[
            { key: 'start_ts', label: 'Start', render: (r) => fmtDateTime(r.start_ts) },
            { key: 'duration_min', label: 'Duration', align: 'right', render: (r) => `${r.duration_min} min` },
            { key: 'station', label: 'Station', render: (r) => `${r.station_code} · ${r.station}` },
            { key: 'transponder', label: 'Transponder', render: (r) => `${r.transponder} (${r.band})` },
            { key: 'client', label: 'Client' },
            { key: 'purpose', label: 'Purpose', render: (r) => titleCase(r.purpose) },
          ]} />
        </Card>
      )}
      {tab === 'anomalies' && (
        <Card pad={false}>
          {t ? <DataTable rows={t.anomalies} rowKey={(r) => r._id} empty="No anomalies recorded." columns={[
            { key: 'severity', label: 'Severity', render: (r) => <Badge value={r.severity} /> },
            { key: 'description', label: 'Description' },
            { key: 'lastValue', label: 'Last value', align: 'right', render: (r) => `${fmtNum(r.lastValue, 2)} (${r.op} ${r.threshold})` },
            { key: 'firstSeen', label: 'First seen', render: (r) => fmtDateTime(r.firstSeen) },
            { key: 'occurrences', label: 'Packets', align: 'right' },
            { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
          ]} /> : <div className="empty">Telemetry store offline.</div>}
        </Card>
      )}
      {tab === 'events' && (
        <Card pad={false}>
          {t ? <DataTable rows={t.events} rowKey={(r) => r._id} empty="No events." columns={[
            { key: 'ts', label: 'Time', render: (r) => <span className="nowrap">{fmtDateTime(r.ts)}</span> },
            { key: 'type', label: 'Type', render: (r) => <Badge tone={r.type === 'anomaly_note' ? 'warn' : 'neutral'} value={r.type} /> },
            { key: 'message', label: 'Message' },
            { key: 'details', label: 'Details', nosort: true, render: (r) => <code className="small">{Object.entries(r.details || {}).map(([k, v]) => `${k}=${v}`).join('  ')}</code> },
            { key: 'operator', label: 'By' },
          ]} /> : <div className="empty">Telemetry store offline.</div>}
        </Card>
      )}
      {tab === 'packet' && (
        <Card title="Latest raw telemetry document" subtitle="Schema varies by satellite bus, which is why telemetry is stored in MongoDB">
          {t?.latest ? <pre className="json">{JSON.stringify(t.latest, null, 2)}</pre> : <div className="muted">No packet available.</div>}
        </Card>
      )}
    </div>
  );
}
