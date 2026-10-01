import { useMemo, useState } from 'react';
import { get, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { Badge, Card, DataTable, ErrorBanner, Field, Loader, Meter, Modal, PageHeader, Tabs, useFetch, useFlash } from '../components/ui.jsx';
import { fmtDateTime, fmtNum, toLocalInput } from '../format.js';

export default function Bandwidth() {
  const { isStaff } = useAuth();
  const [tab, setTab] = useState(isStaff ? 'transponders' : 'allocations');
  const transponders = useFetch(() => (isStaff ? get('/transponders') : Promise.resolve([])), []);
  const allocations = useFetch(() => get('/allocations'), []);
  const [creating, setCreating] = useState(null);
  const [toast, flash] = useFlash();

  const release = async (a) => {
    if (!window.confirm(`Release ${a.allocated_mhz} MHz on ${a.satellite} ${a.transponder}?`)) return;
    try {
      await post(`/allocations/${a.allocation_id}/release`);
      flash('Allocation released');
      allocations.reload(true); transponders.reload(true);
    } catch (e) { flash(e.message, 'bad'); }
  };

  const payload = (transponders.data || []).filter((t) => t.label !== 'TTC');

  return (
    <>
      <PageHeader
        title="Bandwidth"
        subtitle={isStaff ? 'Transponder capacity and leases. Over-allocation is blocked by trg_alloc_bi.' : 'Transponder capacity leased under your contracts'}
        actions={isStaff && <button className="btn btn-primary" onClick={() => setCreating({})}><Icon name="plus" /> New allocation</button>}
      />
      {isStaff && (
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'transponders', label: 'Transponder utilisation', count: payload.length },
          { value: 'allocations', label: 'Allocations', count: allocations.data?.length },
        ]} />
      )}
      {tab === 'transponders' && isStaff && (
        <Card pad={false}>
          <Loader state={transponders}>
            {() => (
              <DataTable rows={payload} rowKey={(r) => r.transponder_id} initialSort={{ key: 'utilization_pct', dir: 'desc' }} columns={[
                { key: 'satellite', label: 'Satellite' },
                { key: 'label', label: 'Transponder', render: (r) => <strong>{r.label}</strong> },
                { key: 'band', label: 'Band', render: (r) => <Badge tone="info" value={r.band}>{r.band}</Badge> },
                { key: 'bandwidth_mhz', label: 'Capacity', align: 'right', render: (r) => `${fmtNum(r.bandwidth_mhz)} MHz` },
                { key: 'peak_allocated_mhz', label: 'Peak leased', align: 'right', render: (r) => `${fmtNum(r.peak_allocated_mhz)} MHz` },
                { key: 'free', label: 'Free at peak', align: 'right', sort: (r) => r.bandwidth_mhz - r.peak_allocated_mhz, render: (r) => `${fmtNum(r.bandwidth_mhz - r.peak_allocated_mhz)} MHz` },
                { key: 'utilization_pct', label: 'Utilisation (30 d)', width: 220, render: (r) => <div className="row"><Meter value={r.utilization_pct} /><span className="small">{fmtNum(r.utilization_pct, 1)}%</span></div> },
                { key: 'x', label: '', nosort: true, render: (r) => <button className="btn btn-sm" onClick={() => setCreating({ transponder: r })}>Lease</button> },
              ]} />
            )}
          </Loader>
        </Card>
      )}
      {tab === 'allocations' && (
        <Card pad={false}>
          <Loader state={allocations}>
            {(rows) => (
              <DataTable rows={rows} rowKey={(r) => r.allocation_id} empty="No bandwidth allocations." columns={[
                { key: 'allocation_id', label: '#', render: (r) => <span className="mono">{r.allocation_id}</span> },
                { key: 'satellite', label: 'Satellite' },
                { key: 'transponder', label: 'Transponder', render: (r) => `${r.transponder} (${r.band})` },
                ...(isStaff ? [{ key: 'client', label: 'Client' }] : []),
                { key: 'contract_code', label: 'Contract', render: (r) => <span className="mono">{r.contract_code}</span> },
                { key: 'allocated_mhz', label: 'MHz', align: 'right', render: (r) => `${fmtNum(r.allocated_mhz)} / ${fmtNum(r.bandwidth_mhz)}` },
                { key: 'start_ts', label: 'From', render: (r) => fmtDateTime(r.start_ts) },
                { key: 'end_ts', label: 'To', render: (r) => fmtDateTime(r.end_ts) },
                { key: 'mhz_hours', label: 'MHz·h', align: 'right', render: (r) => fmtNum(r.mhz_hours) },
                { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
                ...(isStaff ? [{ key: 'x', label: '', nosort: true, render: (r) => r.status === 'active' ? <button className="btn btn-sm btn-danger" onClick={() => release(r)}>Release</button> : null }] : []),
              ]} />
            )}
          </Loader>
        </Card>
      )}
      {creating && (
        <AllocationModal preset={creating} transponders={payload} onClose={() => setCreating(null)}
                         onDone={() => { setCreating(null); flash('Bandwidth allocated'); allocations.reload(true); transponders.reload(true); }} />
      )}
      {toast}
    </>
  );
}

function AllocationModal({ preset, transponders, onClose, onDone }) {
  const contracts = useFetch(() => get('/contracts'), []);
  const now = new Date();
  const [f, setF] = useState({
    transponder_id: preset.transponder?.transponder_id ?? transponders[0]?.transponder_id ?? '',
    contract_id: '',
    allocated_mhz: 10,
    start_ts: toLocalInput(new Date(now.getTime() + 3.6e6)),
    end_ts: toLocalInput(new Date(now.getTime() + 7 * 864e5)),
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const active = useMemo(() => (contracts.data || []).filter((c) => c.status === 'active'), [contracts.data]);
  const tp = transponders.find((t) => String(t.transponder_id) === String(f.transponder_id));
  const contractId = f.contract_id || active[0]?.contract_id || '';

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await post('/allocations', { ...f, contract_id: contractId });
      onDone();
    } catch (e) { setError(e); setBusy(false); }
  };

  return (
    <Modal title="Lease transponder bandwidth" onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Allocating…' : 'Allocate'}</button></>}>
      {error && <ErrorBanner error={error} />}
      <div className="form-grid">
        <Field label="Transponder" hint={tp ? `${fmtNum(tp.bandwidth_mhz - tp.peak_allocated_mhz)} of ${fmtNum(tp.bandwidth_mhz)} MHz free at 30-day peak` : undefined}>
          <select value={f.transponder_id} onChange={set('transponder_id')}>
            {transponders.map((t) => <option key={t.transponder_id} value={t.transponder_id}>{t.satellite} · {t.label} ({t.band})</option>)}
          </select>
        </Field>
        <Field label="Contract">
          <select value={contractId} onChange={set('contract_id')}>
            {active.map((c) => <option key={c.contract_id} value={c.contract_id}>{c.contract_code} · {c.client}</option>)}
          </select>
        </Field>
        <Field label="Bandwidth (MHz)"><input type="number" min="1" step="1" value={f.allocated_mhz} onChange={set('allocated_mhz')} /></Field>
        <span />
        <Field label="From"><input type="datetime-local" value={f.start_ts} onChange={set('start_ts')} /></Field>
        <Field label="To"><input type="datetime-local" value={f.end_ts} onChange={set('end_ts')} /></Field>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Calls <code>sp_allocate_bandwidth</code>. The transponder row is locked, and the trigger computes the peak concurrent load (<code>fn_allocated_mhz_at_peak</code>) before accepting.
      </p>
    </Modal>
  );
}
