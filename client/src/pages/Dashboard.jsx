import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, CHART, DataTable, Loader, PageHeader, Stat, useFetch } from '../components/ui.jsx';
import { fmtDay, fmtMoney, fmtNum, fmtRelative, fmtTime, titleCase, toLocalDateInput } from '../format.js';

function anomalyCounts(stats) {
  const c = { open: 0, acknowledged: 0, critical: 0 };
  for (const s of stats?.byStatus || []) {
    if (s._id.status === 'open') c.open += s.count;
    if (s._id.status === 'acknowledged') c.acknowledged += s.count;
    if (s._id.status !== 'resolved' && s._id.severity === 'critical') c.critical += s.count;
  }
  return c;
}

export default function Dashboard() {
  const { user, isStaff } = useAuth();
  const state = useFetch(() => get('/reports/dashboard'), [], { interval: 30000 });
  const today = toLocalDateInput(new Date());

  return (
    <>
      <PageHeader
        title={isStaff ? 'Operations overview' : `Welcome, ${user.client_name}`}
        subtitle={isStaff ? 'Fleet, ground network and commercial status at a glance' : 'Your contracted sessions, bandwidth and billing'}
      />
      <Loader state={state}>
        {(d) => {
          const a = anomalyCounts(d.anomalies);
          const k = d.kpi;
          return (
            <>
              <div className="stats">
                {isStaff ? (
                  <>
                    <Stat label="Active satellites" value={`${k.active_satellites} / ${k.total_satellites}`} />
                    <Stat label="Ground stations online" value={`${k.stations_online} / ${k.total_stations}`} tone={k.stations_online < k.total_stations ? 'warn' : undefined} />
                    <Stat label="Sessions next 24 h" value={k.sessions_next_24h} />
                    <Stat label="Payload utilisation" value={`${fmtNum(k.avg_payload_utilization, 1)}%`} hint="avg leased, next 30 days" />
                    <Stat label="Billed last month" value={fmtMoney(k.billed_last_month)} hint={`${fmtMoney(k.outstanding)} outstanding`} />
                  </>
                ) : (
                  <>
                    <Stat label="Active contracts" value={k.active_contracts} />
                    <Stat label="Sessions next 24 h" value={k.sessions_next_24h} />
                    <Stat label="Sessions this month" value={k.sessions_this_month} />
                    <Stat label="Bandwidth leased now" value={`${fmtNum(k.leased_mhz_now)} MHz`} />
                    <Stat label="Outstanding" value={fmtMoney(k.outstanding)} />
                  </>
                )}
                {d.anomalies ? (
                  <Stat label="Open anomalies" value={a.open + a.acknowledged} tone={a.critical ? 'bad' : a.open ? 'warn' : 'ok'}
                        hint={a.critical ? `${a.critical} critical` : 'none critical'} />
                ) : (
                  <Stat label="Open anomalies" value="—" hint="telemetry store offline" />
                )}
              </div>

              <div className="grid grid-2-1">
                <Card title="Sessions per day" subtitle="Past 14 days and the next 7, by orbit class">
                  <div className="legend" style={{ marginBottom: 8 }}>
                    <span><i style={{ background: CHART.blue }} />LEO</span>
                    <span><i style={{ background: CHART.teal }} />GEO</span>
                    <span><i style={{ background: CHART.violet }} />MEO / HEO</span>
                  </div>
                  <div className="chart">
                    <ResponsiveContainer>
                      <BarChart data={d.sessionsByDay} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={16} />
                        <YAxis allowDecimals={false} />
                        <Tooltip labelFormatter={fmtDay} cursor={{ fillOpacity: 0.08 }} />
                        <ReferenceLine x={today} stroke={CHART.red} strokeDasharray="3 3" label={{ value: 'today', position: 'top', fontSize: 11 }} />
                        <Bar dataKey="LEO" stackId="a" fill={CHART.blue} />
                        <Bar dataKey="GEO" stackId="a" fill={CHART.teal} />
                        <Bar dataKey="MEO_HEO" name="MEO / HEO" stackId="a" fill={CHART.violet} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Anomalies" subtitle="From the MongoDB telemetry pipeline"
                      actions={<Link to="/anomalies" className="btn btn-sm">View all</Link>}>
                  {d.anomalies ? (
                    <div className="stack">
                      <div className="grid grid-3" style={{ gap: 8 }}>
                        <Stat label="Open" value={a.open} tone={a.open ? 'bad' : undefined} />
                        <Stat label="Acknowledged" value={a.acknowledged} tone={a.acknowledged ? 'warn' : undefined} />
                        <Stat label="Critical" value={a.critical} tone={a.critical ? 'bad' : 'ok'} />
                      </div>
                      <div className="chart chart-sm">
                        <ResponsiveContainer>
                          <BarChart data={d.anomalies.last7Days} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="_id" tickFormatter={fmtDay} />
                            <YAxis allowDecimals={false} />
                            <Tooltip labelFormatter={fmtDay} cursor={{ fillOpacity: 0.08 }} />
                            <Bar dataKey="count" name="New anomalies" fill={CHART.amber} radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ) : (
                    <div className="banner banner-warn">MongoDB is not connected, so live health data is unavailable.</div>
                  )}
                </Card>
              </div>

              <div style={{ marginTop: 16 }}>
                <Card title="Next sessions" pad={false}
                      actions={<Link to={isStaff ? '/scheduling' : '/sessions'} className="btn btn-sm">{isStaff ? 'Open scheduler' : 'All sessions'}</Link>}>
                  <DataTable
                    rows={d.upcoming}
                    rowKey={(r) => r.booking_id}
                    columns={[
                      { key: 'start_ts', label: 'Start', render: (r) => <span className="nowrap">{fmtTime(r.start_ts)} <span className="muted small">{fmtRelative(r.start_ts)}</span></span> },
                      { key: 'satellite', label: 'Satellite' },
                      { key: 'station_code', label: 'Station' },
                      { key: 'band', label: 'Band', render: (r) => <Badge tone="info" value={r.band}>{r.band}</Badge> },
                      ...(isStaff ? [{ key: 'client', label: 'Client' }] : []),
                      { key: 'purpose', label: 'Purpose', render: (r) => titleCase(r.purpose) },
                      { key: 'duration_min', label: 'Duration', align: 'right', render: (r) => `${r.duration_min} min` },
                    ]}
                    empty="No upcoming sessions."
                  />
                </Card>
              </div>
            </>
          );
        }}
      </Loader>
    </>
  );
}
