import { useState } from 'react';
import { get } from '../api.js';
import { Badge, Card, DataTable, Loader, PageHeader, useFetch } from '../components/ui.jsx';
import { fmtDateTime, titleCase } from '../format.js';

function Diff({ oldV, newV }) {
  const o = oldV || {};
  const n = newV || {};
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])];
  return (
    <div className="small mono" style={{ display: 'grid', gap: 2 }}>
      {keys.map((k) => {
        const changed = oldV && newV && JSON.stringify(o[k]) !== JSON.stringify(n[k]);
        if (oldV && newV && !changed) return null;
        return (
          <div key={k}>
            <span className="diff-key">{k}: </span>
            {k in o && <span className={newV ? 'diff-old' : ''}>{String(o[k])}</span>}
            {k in o && k in n && ' → '}
            {k in n && <span className={oldV ? 'diff-new' : ''}>{String(n[k])}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function Audit() {
  const [table, setTable] = useState('');
  const state = useFetch(() => get('/audit', { table, limit: 300 }), [table], { interval: 15000 });
  return (
    <>
      <PageHeader title="Audit log" subtitle="Written only by AFTER INSERT/UPDATE/DELETE triggers; the API account has no write access to this table" />
      <Card pad={false}>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="filters">
            <select value={table} onChange={(e) => setTable(e.target.value)} aria-label="Table filter">
              <option value="">All tables</option>
              {['bookings', 'bandwidth_allocations', 'contracts'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </div>
        </div>
        <Loader state={state} empty="No audited changes yet. Book, cancel or allocate something to see entries appear.">
          {(rows) => (
            <DataTable rows={rows} rowKey={(r) => r.audit_id} columns={[
              { key: 'audit_id', label: '#', render: (r) => <span className="mono">{r.audit_id}</span> },
              { key: 'changed_at', label: 'When', render: (r) => <span className="nowrap">{fmtDateTime(r.changed_at)}</span> },
              { key: 'changed_by_name', label: 'User', render: (r) => r.changed_by_name || <span className="muted">system</span> },
              { key: 'table_name', label: 'Table', render: (r) => <code className="small">{r.table_name}</code> },
              { key: 'action', label: 'Action', render: (r) => <Badge value={r.action}>{r.action}</Badge> },
              { key: 'record_id', label: 'Record', align: 'right' },
              { key: 'diff', label: 'Change', nosort: true, render: (r) => <Diff oldV={r.old_values} newV={r.new_values} /> },
            ]} />
          )}
        </Loader>
      </Card>
    </>
  );
}
