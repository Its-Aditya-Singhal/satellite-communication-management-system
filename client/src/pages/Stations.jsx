import { useNavigate } from 'react-router-dom';
import { get } from '../api.js';
import { Badge, Card, DataTable, Loader, Meter, PageHeader, useFetch } from '../components/ui.jsx';
import { fmtNum } from '../format.js';

// Equirectangular projection of station coordinates onto a simple world frame.
function StationMap({ stations, onPick }) {
  const W = 720, H = 300;
  const x = (lon) => ((Number(lon) + 180) / 360) * W;
  const y = (lat) => ((90 - Number(lat)) / 180) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Ground station locations">
      <rect width={W} height={H} rx="8" fill="var(--surface-2)" />
      {[-60, -30, 0, 30, 60].map((lat) => <line key={lat} x1="0" x2={W} y1={y(lat)} y2={y(lat)} stroke="var(--grid)" strokeDasharray={lat === 0 ? '' : '3 4'} />)}
      {[-120, -60, 0, 60, 120].map((lon) => <line key={lon} y1="0" y2={H} x1={x(lon)} x2={x(lon)} stroke="var(--grid)" strokeDasharray="3 4" />)}
      <text x="6" y={y(0) - 4} fontSize="10" fill="var(--muted)">Equator</text>
      {stations.map((s) => {
        const tone = s.status === 'online' ? 'var(--ok)' : s.status === 'maintenance' ? 'var(--warn)' : 'var(--bad)';
        return (
          <g key={s.station_id} transform={`translate(${x(s.longitude)} ${y(s.latitude)})`} style={{ cursor: 'pointer' }} onClick={() => onPick(s)}>
            <circle r="14" fill={tone} opacity=".18" />
            <circle r="5" fill={tone} stroke="var(--surface)" strokeWidth="1.5" />
            <text x="9" y="-8" fontSize="11.5" fontWeight="600" fill="var(--text)">{s.code}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Stations() {
  const navigate = useNavigate();
  const state = useFetch(() => get('/stations'), []);
  const open = (s) => navigate(`/stations/${s.station_id}`);

  return (
    <>
      <PageHeader title="Ground stations" subtitle="Ground segment, supported bands and today's antenna load (fn_station_load)" />
      <Loader state={state}>
        {(stations) => (
          <div className="stack">
            <Card title="Network map" subtitle="Click a station for its schedule">
              <StationMap stations={stations} onPick={open} />
            </Card>
            <Card pad={false}>
              <DataTable rows={stations} rowKey={(r) => r.station_id} onRowClick={open} columns={[
                { key: 'code', label: 'Code', render: (r) => <strong className="mono">{r.code}</strong> },
                { key: 'name', label: 'Name' },
                { key: 'country', label: 'Location', render: (r) => `${r.city}, ${r.country}` },
                { key: 'coords', label: 'Lat / Lon', nosort: true, render: (r) => <span className="mono small">{fmtNum(r.latitude, 2)}, {fmtNum(r.longitude, 2)}</span> },
                { key: 'antenna_diameter_m', label: 'Dish', align: 'right', render: (r) => `${fmtNum(r.antenna_diameter_m, 1)} m` },
                { key: 'bands', label: 'Bands' },
                { key: 'load_today_pct', label: 'Load today', width: 170, render: (r) => <div className="row"><Meter value={r.load_today_pct} max={40} /><span className="small">{fmtNum(r.load_today_pct, 1)}%</span></div> },
                { key: 'upcoming_sessions', label: 'Upcoming', align: 'right' },
                { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              ]} />
            </Card>
          </div>
        )}
      </Loader>
    </>
  );
}
