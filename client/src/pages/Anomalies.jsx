import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, DataTable, ErrorBanner, Field, Loader, Modal, PageHeader, Tabs, useFetch, useFlash } from '../components/ui.jsx';
import { fmtDateTime, fmtNum, fmtRelative, titleCase } from '../format.js';

export default function Anomalies() {
  const { isStaff, isAdmin } = useAuth();
  const [tab, setTab] = useState('active');
  const [toast, flash] = useFlash();

  return (
    <>
      <PageHeader title="Health & anomalies" subtitle="Threshold breaches detected in incoming telemetry (MongoDB anomalies collection)" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'active', label: 'Active' },
        { value: 'resolved', label: 'Resolved' },
        { value: 'fleet', label: 'Fleet health' },
        { value: 'events', label: 'Event log' },
        ...(isStaff ? [{ value: 'rules', label: 'Alert rules' }] : []),
      ]} />
      {(tab === 'active' || tab === 'resolved') && <AnomalyList key={tab} status={tab === 'active' ? 'open,acknowledged' : 'resolved'} canAct={isStaff} flash={flash} />}
      {tab === 'fleet' && <FleetHealth />}
      {tab === 'events' && <EventLog />}
      {tab === 'rules' && <Rules canEdit={isAdmin} flash={flash} />}
      {toast}
    </>
  );
}

function AnomalyList({ status, canAct, flash }) {
  const state = useFetch(() => get('/anomalies', { status }), [status], { interval: 20000 });
  const [acting, setActing] = useState(null);

  return (
    <>
      <Card pad={false}>
        <Loader state={state} empty={status === 'resolved' ? 'No resolved anomalies.' : 'All clear: no active anomalies.'}>
          {(rows) => (
            <DataTable rows={rows} rowKey={(r) => r._id} columns={[
              { key: 'severity', label: 'Severity', render: (r) => <Badge value={r.severity} /> },
              { key: 'satellite', label: 'Satellite', render: (r) => <Link to={`/satellites/${r.satId}`} onClick={(e) => e.stopPropagation()}>{r.satellite}</Link> },
              { key: 'description', label: 'Issue' },
              { key: 'metric', label: 'Metric', render: (r) => <code className="small">{r.metric}</code> },
              { key: 'lastValue', label: 'Last / limit', align: 'right', render: (r) => <span className="nowrap">{fmtNum(r.lastValue, 2)} <span className="muted">{r.op} {r.threshold}</span></span> },
              { key: 'occurrences', label: 'Packets', align: 'right' },
              { key: 'firstSeen', label: 'First seen', render: (r) => <span className="nowrap">{fmtDateTime(r.firstSeen)}</span> },
              { key: 'lastSeen', label: 'Last seen', render: (r) => <span className="muted nowrap">{fmtRelative(r.lastSeen)}</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              ...(canAct && status !== 'resolved' ? [{ key: 'x', label: '', nosort: true, render: (r) => (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  {r.status === 'open' && <button className="btn btn-sm" onClick={() => setActing({ a: r, to: 'acknowledged' })}>Acknowledge</button>}
                  <button className="btn btn-sm" onClick={() => setActing({ a: r, to: 'resolved' })}>Resolve</button>
                </div>
              ) }] : []),
              ...(status === 'resolved' ? [{ key: 'resolvedAt', label: 'Resolved', render: (r) => fmtDateTime(r.resolvedAt) }] : []),
            ]} />
          )}
        </Loader>
      </Card>
      {acting && (
        <StatusModal {...acting} onClose={() => setActing(null)}
                     onDone={() => { flash(`Anomaly ${acting.to}`); setActing(null); state.reload(true); }} />
      )}
    </>
  );
}

function StatusModal({ a, to, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const submit = async () => {
    try { await patch(`/anomalies/${a._id}`, { status: to, note }); onDone(); } catch (e) { setError(e); }
  };
  return (
    <Modal title={`${titleCase(to === 'acknowledged' ? 'acknowledge' : 'resolve')} anomaly`} onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Confirm</button></>}>
      {error && <ErrorBanner error={error} />}
      <p style={{ marginTop: 0 }}><strong>{a.satellite}</strong>: {a.description}</p>
      <Field label="Note (stored in the anomaly's history array)">
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Switched to redundant TWTA" />
      </Field>
      {a.history?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="field-label">History</div>
          <ul className="small" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
            {a.history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} · {h.status} by {h.by}{h.note ? `: ${h.note}` : ''}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function FleetHealth() {
  const state = useFetch(() => get('/telemetry/fleet', { minutes: 120 }), [], { interval: 20000 });
  return (
    <Card pad={false} title="Latest packet per satellite" subtitle="$sort + $group/$first over the telemetry time-series (last 2 h)">
      <Loader state={state} empty="No telemetry received in the last 2 hours. Start the simulator to stream packets.">
        {(rows) => (
          <DataTable rows={rows} rowKey={(r) => r.satId} columns={[
            { key: 'name', label: 'Satellite', render: (r) => <Link to={`/satellites/${r.satId}`}>{r.name}</Link> },
            { key: 'family', label: 'Bus family', sort: (r) => r.latest.meta.family, render: (r) => titleCase(r.latest.meta.family) },
            { key: 'ts', label: 'Last packet', sort: (r) => r.latest.ts, render: (r) => fmtRelative(r.latest.ts) },
            { key: 'packets', label: 'Packets (2 h)', align: 'right' },
            { key: 'soc', label: 'Battery', align: 'right', sort: (r) => r.latest.power?.batterySoC, render: (r) => (r.latest.power?.batterySoC != null ? `${fmtNum(r.latest.power.batterySoC, 1)}%` : '—') },
            { key: 'link', label: 'Link margin', align: 'right', sort: (r) => r.latest.linkMarginDb, render: (r) => `${fmtNum(r.latest.linkMarginDb, 1)} dB` },
          ]} />
        )}
      </Loader>
    </Card>
  );
}

function EventLog() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const state = useFetch(() => get('/events', { q: search, limit: 200 }), [search]);
  return (
    <Card pad={false}>
      <div className="card-body" style={{ paddingBottom: 0 }}>
        <form className="filters" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
          <input placeholder="Full-text search (MongoDB $text index)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 320 }} />
          <button className="btn btn-sm">Search</button>
          {search && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setQ(''); setSearch(''); }}>Clear</button>}
        </form>
      </div>
      <Loader state={state} empty="No matching events.">
        {(rows) => (
          <DataTable rows={rows} rowKey={(r) => r._id} maxHeight={560} columns={[
            { key: 'ts', label: 'Time', render: (r) => <span className="nowrap">{fmtDateTime(r.ts)}</span> },
            { key: 'satellite', label: 'Satellite' },
            { key: 'type', label: 'Type', render: (r) => <Badge tone={r.type === 'anomaly_note' ? 'warn' : 'neutral'} value={r.type} /> },
            { key: 'message', label: 'Message' },
            { key: 'details', label: 'Details', nosort: true, render: (r) => <code className="small">{Object.entries(r.details || {}).map(([k, v]) => `${k}=${v}`).join('  ')}</code> },
            { key: 'operator', label: 'By' },
          ]} />
        )}
      </Loader>
    </Card>
  );
}

function Rules({ canEdit, flash }) {
  const state = useFetch(() => get('/alert-rules'), []);
  const [adding, setAdding] = useState(false);
  const toggle = async (r) => {
    try { await patch(`/alert-rules/${r._id}`, { enabled: !r.enabled }); state.reload(true); } catch (e) { flash(e.message, 'bad'); }
  };
  const editThreshold = async (r) => {
    const v = window.prompt(`New threshold for ${r.metric} (${r.op})`, r.threshold);
    if (v == null || v === '' || Number.isNaN(Number(v))) return;
    try { await patch(`/alert-rules/${r._id}`, { threshold: Number(v) }); flash('Threshold updated'); state.reload(true); } catch (e) { flash(e.message, 'bad'); }
  };
  const scopeText = (s) => (s.all ? 'All satellites' : s.family ? titleCase(s.family) : s.model ? `Model ${s.model}` : `Satellite #${s.satId}`);

  return (
    <>
      <Card pad={false} title="Alert rules" subtitle="Evaluated on every telemetry packet at ingest"
            actions={canEdit && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>Add rule</button>}>
        <Loader state={state}>
          {(rows) => (
            <DataTable rows={rows} rowKey={(r) => r._id} columns={[
              { key: 'scope', label: 'Applies to', sort: (r) => scopeText(r.scope), render: (r) => scopeText(r.scope) },
              { key: 'metric', label: 'Metric', render: (r) => <code className="small">{r.metric}</code> },
              { key: 'cond', label: 'Condition', nosort: true, render: (r) => <strong className="mono">{r.op} {r.threshold}</strong> },
              { key: 'severity', label: 'Severity', render: (r) => <Badge value={r.severity} /> },
              { key: 'description', label: 'Description' },
              { key: 'enabled', label: 'Enabled', render: (r) => <Badge tone={r.enabled ? 'ok' : 'neutral'} value="x">{r.enabled ? 'On' : 'Off'}</Badge> },
              ...(canEdit ? [{ key: 'x', label: '', nosort: true, render: (r) => (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => editThreshold(r)}>Threshold</button>
                  <button className="btn btn-sm" onClick={() => toggle(r)}>{r.enabled ? 'Disable' : 'Enable'}</button>
                </div>
              ) }] : []),
            ]} />
          )}
        </Loader>
      </Card>
      {adding && <RuleModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); flash('Rule added'); state.reload(true); }} />}
    </>
  );
}

function RuleModal({ onClose, onDone }) {
  const [f, setF] = useState({ scopeType: 'family', scopeValue: 'comsat', metric: 'power.batterySoC', op: '<', threshold: 35, severity: 'warning', description: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    const scope = f.scopeType === 'all' ? { all: true } : f.scopeType === 'satId' ? { satId: Number(f.scopeValue) } : { [f.scopeType]: f.scopeValue };
    try {
      await post('/alert-rules', { scope, metric: f.metric, op: f.op, threshold: Number(f.threshold), severity: f.severity, description: f.description || undefined });
      onDone();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title="Add alert rule" onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Save</button></>}>
      {error && <ErrorBanner error={error} />}
      <div className="form-grid">
        <Field label="Scope">
          <select value={f.scopeType} onChange={set('scopeType')}>
            <option value="all">All satellites</option><option value="family">Bus family</option><option value="model">Model</option><option value="satId">Satellite id</option>
          </select>
        </Field>
        {f.scopeType !== 'all' ? <Field label="Scope value"><input value={f.scopeValue} onChange={set('scopeValue')} /></Field> : <span />}
        <Field label="Metric path" hint="Dot path inside the telemetry document"><input value={f.metric} onChange={set('metric')} /></Field>
        <Field label="Operator">
          <select value={f.op} onChange={set('op')}>{['>', '>=', '<', '<='].map((o) => <option key={o}>{o}</option>)}</select>
        </Field>
        <Field label="Threshold"><input type="number" value={f.threshold} onChange={set('threshold')} /></Field>
        <Field label="Severity">
          <select value={f.severity} onChange={set('severity')}>{['info', 'warning', 'critical'].map((o) => <option key={o}>{o}</option>)}</select>
        </Field>
        <div className="span-2"><Field label="Description"><input value={f.description} onChange={set('description')} /></Field></div>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>The collection's <code>$jsonSchema</code> validator rejects malformed rules.</p>
    </Modal>
  );
}
