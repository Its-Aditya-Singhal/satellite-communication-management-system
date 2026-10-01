import { useState } from 'react';
import { get, post } from '../api.js';
import { Badge, Card, DataTable, Loader, PageHeader, Tabs, useFetch, useFlash } from '../components/ui.jsx';
import { fmtDateTime, fmtRelative, titleCase, toDate, toLocalInput } from '../format.js';

// Client view of their own sessions (served from the v_client_bookings view).
export default function Sessions() {
  const [tab, setTab] = useState('upcoming');
  const now = toLocalInput(new Date());
  const state = useFetch(
    () => get('/bookings', tab === 'upcoming'
      ? { from: now, status: 'confirmed', limit: 300 }
      : { to: now, order: 'desc', limit: 300 }),
    [tab],
  );
  const [toast, flash] = useFlash();

  const cancel = async (b) => {
    if (!window.confirm(`Cancel the ${b.satellite} session on ${fmtDateTime(b.start_ts)}?`)) return;
    try {
      await post(`/bookings/${b.booking_id}/cancel`);
      flash('Session cancelled');
      state.reload(true);
    } catch (e) { flash(e.message, 'bad'); }
  };

  return (
    <>
      <PageHeader title="My sessions" subtitle="Ground-station sessions booked under your contracts" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'History' }]} />
      <Card pad={false}>
        <Loader state={state}>
          {(rows) => (
            <DataTable rows={rows} rowKey={(r) => r.booking_id} empty="No sessions." columns={[
              { key: 'start_ts', label: 'Start', render: (r) => <span className="nowrap">{fmtDateTime(r.start_ts)} <span className="muted small">{fmtRelative(r.start_ts)}</span></span> },
              { key: 'duration_min', label: 'Duration', align: 'right', render: (r) => `${r.duration_min} min` },
              { key: 'satellite', label: 'Satellite' },
              { key: 'station', label: 'Ground station' },
              { key: 'band', label: 'Band', render: (r) => <Badge tone="info" value={r.band}>{r.band}</Badge> },
              { key: 'purpose', label: 'Purpose', render: (r) => titleCase(r.purpose) },
              { key: 'contract_code', label: 'Contract', render: (r) => <span className="mono">{r.contract_code}</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              { key: 'x', label: '', nosort: true, render: (r) => r.status === 'confirmed' && toDate(r.start_ts) > new Date()
                ? <button className="btn btn-sm btn-danger" onClick={() => cancel(r)}>Cancel</button> : null },
            ]} />
          )}
        </Loader>
      </Card>
      {toast}
    </>
  );
}
