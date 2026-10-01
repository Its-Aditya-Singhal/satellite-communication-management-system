import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../api.js';
import { Badge, Card, CHART, DataTable, Loader, Meter, PageHeader, useFetch } from '../components/ui.jsx';
import { fmtDay, fmtMoney, fmtNum, titleCase } from '../format.js';

const STATION_COLORS = [CHART.blue, CHART.teal, CHART.amber, CHART.violet, CHART.red, CHART.slate];

export default function Reports() {
  const revenue = useFetch(() => get('/reports/revenue'), []);
  const util = useFetch(() => get('/reports/utilization'), []);
  const activity = useFetch(() => get('/reports/station-activity', { days: 14 }), []);
  const summary = useFetch(() => get('/reports/sessions-summary'), []);
  const top = useFetch(() => get('/reports/top-satellites'), []);
  const trend = useFetch(() => get('/telemetry/trend', { days: 7 }), []);

  return (
    <>
      <PageHeader title="Reports" subtitle="Analytical SQL (views, CTEs, window functions, ROLLUP) and MongoDB aggregations" />
      <div className="stack">
        <div className="grid grid-2">
          <Card title="Revenue by client" subtitle="RANK() and share of total via SUM() OVER ()" pad={false}>
            <Loader state={revenue}>
              {(d) => (
                <DataTable rows={d.ranking} rowKey={(r) => r.client} columns={[
                  { key: 'revenue_rank', label: '#', align: 'right' },
                  { key: 'client', label: 'Client' },
                  { key: 'org_type', label: 'Type', render: (r) => titleCase(r.org_type) },
                  { key: 'total_billed', label: 'Billed', align: 'right', render: (r) => fmtMoney(r.total_billed) },
                  { key: 'share_pct', label: 'Share', width: 140, render: (r) => <div className="row"><Meter value={r.share_pct} tone="ok" /><span className="small">{fmtNum(r.share_pct, 1)}%</span></div> },
                  { key: 'outstanding', label: 'Outstanding', align: 'right', render: (r) => fmtMoney(r.outstanding) },
                ]} />
              )}
            </Loader>
          </Card>
          <Card title="Monthly billing" subtitle="Cumulative total and month-on-month growth (LAG)">
            <Loader state={revenue}>
              {(d) => (
                <>
                  <div className="chart chart-sm">
                    <ResponsiveContainer>
                      <ComposedChart data={d.monthly} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="month" />
                        <YAxis tickFormatter={(v) => `$${fmtNum(v / 1000)}k`} />
                        <Tooltip formatter={(v) => fmtMoney(v)} cursor={{ fillOpacity: 0.08 }} />
                        <Bar dataKey="billed" name="Billed" fill={CHART.blue} radius={[3, 3, 0, 0]} />
                        <Line dataKey="cumulative" name="Cumulative" stroke={CHART.amber} strokeWidth={2} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <DataTable rows={d.monthly} rowKey={(r) => r.month} columns={[
                    { key: 'month', label: 'Month' },
                    { key: 'billed', label: 'Billed', align: 'right', render: (r) => fmtMoney(r.billed) },
                    { key: 'cumulative', label: 'Cumulative', align: 'right', render: (r) => fmtMoney(r.cumulative) },
                    { key: 'growth_pct', label: 'Growth', align: 'right', render: (r) => (r.growth_pct == null ? '—' : `${r.growth_pct > 0 ? '+' : ''}${fmtNum(r.growth_pct, 1)}%`) },
                  ]} />
                </>
              )}
            </Loader>
          </Card>
        </div>

        <Card title="Ground-station activity" subtitle="Daily booked minutes per station, 7-day moving average (AVG() OVER window frame)">
          <Loader state={activity} empty="No activity.">
            {(rows) => <StationActivity rows={rows} />}
          </Loader>
        </Card>

        <div className="grid grid-2">
          <Card title="Capacity by band" subtitle="Aggregated over v_transponder_utilization">
            <Loader state={util}>
              {(d) => (
                <div className="chart">
                  <ResponsiveContainer>
                    <BarChart data={d.byBand} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="band" />
                      <YAxis unit=" MHz" width={70} />
                      <Tooltip formatter={(v) => `${fmtNum(v)} MHz`} cursor={{ fillOpacity: 0.08 }} />
                      <Bar dataKey="capacity_mhz" name="Capacity" fill={CHART.slate} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="peak_allocated_mhz" name="Peak leased" fill={CHART.teal} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Loader>
          </Card>
          <Card title="Fleet health trend" subtitle="MongoDB: daily aggregation over the telemetry_hourly roll-ups">
            <Loader state={trend} empty="No roll-up data yet.">
              {(rows) => (
                <div className="chart">
                  <ResponsiveContainer>
                    <LineChart data={rows} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="_id" tickFormatter={fmtDay} />
                      <YAxis yAxisId="soc" domain={[60, 100]} unit="%" />
                      <YAxis yAxisId="lm" orientation="right" domain={[0, 12]} unit=" dB" />
                      <Tooltip labelFormatter={fmtDay} formatter={(v) => fmtNum(v, 2)} />
                      <Line yAxisId="soc" dataKey="avgBatterySoc" name="Avg battery SoC" stroke={CHART.blue} strokeWidth={2} />
                      <Line yAxisId="lm" dataKey="minLinkMargin" name="Min link margin" stroke={CHART.red} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Loader>
          </Card>
        </div>

        <div className="grid grid-2">
          <Card title="Sessions by orbit and purpose (30 days)" subtitle="GROUP BY … WITH ROLLUP gives subtotals and a grand total" pad={false}>
            <Loader state={summary}>
              {(rows) => (
                <DataTable rows={rows} rowKey={(r) => r.orbit_type + r.purpose} columns={[
                  { key: 'orbit_type', label: 'Orbit', nosort: true, render: (r) => (r.orbit_type === 'ALL ORBITS' ? <strong>All orbits</strong> : r.orbit_type) },
                  { key: 'purpose', label: 'Purpose', nosort: true, render: (r) => (r.purpose === 'All purposes' ? <Badge tone="info" value="x">Subtotal</Badge> : titleCase(r.purpose)) },
                  { key: 'sessions', label: 'Sessions', align: 'right', nosort: true, render: (r) => (r.purpose === 'All purposes' ? <strong>{r.sessions}</strong> : r.sessions) },
                  { key: 'minutes', label: 'Minutes', align: 'right', nosort: true, render: (r) => fmtNum(r.minutes) },
                ]} />
              )}
            </Loader>
          </Card>
          <Card title="Busiest satellites per orbit" subtitle="ROW_NUMBER() OVER (PARTITION BY orbit_type)" pad={false}>
            <Loader state={top}>
              {(rows) => (
                <DataTable rows={rows} rowKey={(r) => r.name} columns={[
                  { key: 'orbit_type', label: 'Orbit', render: (r) => <Badge tone="info" value={r.orbit_type}>{r.orbit_type}</Badge> },
                  { key: 'rank_in_orbit', label: 'Rank', align: 'right' },
                  { key: 'name', label: 'Satellite' },
                  { key: 'sessions', label: 'Sessions', align: 'right' },
                  { key: 'minutes', label: 'Minutes', align: 'right', render: (r) => fmtNum(r.minutes) },
                ]} />
              )}
            </Loader>
          </Card>
        </div>
      </div>
    </>
  );
}

function StationActivity({ rows }) {
  const [metric, setMetric] = useState('moving_avg_7d');
  const { data, stations } = useMemo(() => {
    const stationList = [...new Set(rows.map((r) => r.station_code))];
    const byDay = new Map();
    for (const r of rows) {
      if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day });
      byDay.get(r.day)[r.station_code] = r[metric];
    }
    return { data: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)), stations: stationList };
  }, [rows, metric]);

  return (
    <>
      <div className="spread" style={{ marginBottom: 8 }}>
        <div className="legend">{stations.map((s, i) => <span key={s}><i style={{ background: STATION_COLORS[i % 6] }} />{s}</span>)}</div>
        <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric">
          <option value="moving_avg_7d">7-day moving average</option>
          <option value="minutes">Daily minutes</option>
          <option value="change_vs_prev_day">Change vs previous day</option>
        </select>
      </div>
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={16} />
            <YAxis />
            <Tooltip labelFormatter={fmtDay} formatter={(v) => `${fmtNum(v, 1)} min`} />
            {stations.map((s, i) => <Line key={s} dataKey={s} stroke={STATION_COLORS[i % 6]} dot={false} strokeWidth={2} connectNulls />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
