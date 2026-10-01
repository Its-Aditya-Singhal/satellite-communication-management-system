import { useState } from 'react';
import { get, patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Card, DataTable, ErrorBanner, Field, Loader, Modal, PageHeader, Tabs, useFetch, useFlash } from '../components/ui.jsx';
import { fmtDate, fmtMoney, titleCase } from '../format.js';

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState('users');
  const users = useFetch(() => get('/users'), []);
  const clients = useFetch(() => get('/clients'), []);
  const [modal, setModal] = useState(null);
  const [toast, flash] = useFlash();

  const toggleUser = async (u) => {
    try {
      await patch(`/users/${u.user_id}`, { is_active: !u.is_active });
      flash(`${u.full_name} ${u.is_active ? 'deactivated' : 'activated'}`);
      users.reload(true);
    } catch (e) { flash(e.message, 'bad'); }
  };

  return (
    <>
      <PageHeader title="Administration" subtitle="Application users and client organisations"
                  actions={<button className="btn btn-primary" onClick={() => setModal(tab)}>{tab === 'users' ? 'Add user' : 'Add client'}</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'users', label: 'Users', count: users.data?.length },
        { value: 'clients', label: 'Clients', count: clients.data?.length },
      ]} />
      {tab === 'users' && (
        <Card pad={false}>
          <Loader state={users}>
            {(rows) => (
              <DataTable rows={rows} rowKey={(r) => r.user_id} columns={[
                { key: 'full_name', label: 'Name', render: (r) => <strong>{r.full_name}</strong> },
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Role', render: (r) => <Badge tone={r.role === 'admin' ? 'bad' : r.role === 'operator' ? 'info' : 'neutral'} value={r.role} /> },
                { key: 'client_name', label: 'Client' },
                { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) },
                { key: 'is_active', label: 'Status', render: (r) => <Badge tone={r.is_active ? 'ok' : 'neutral'} value="x">{r.is_active ? 'Active' : 'Disabled'}</Badge> },
                { key: 'x', label: '', nosort: true, render: (r) => r.user_id !== user.user_id && (
                  <button className="btn btn-sm" onClick={() => toggleUser(r)}>{r.is_active ? 'Disable' : 'Enable'}</button>
                ) },
              ]} />
            )}
          </Loader>
        </Card>
      )}
      {tab === 'clients' && (
        <Card pad={false}>
          <Loader state={clients}>
            {(rows) => (
              <DataTable rows={rows} rowKey={(r) => r.client_id} columns={[
                { key: 'name', label: 'Organisation', render: (r) => <strong>{r.name}</strong> },
                { key: 'org_type', label: 'Type', render: (r) => titleCase(r.org_type) },
                { key: 'country', label: 'Country' },
                { key: 'contact_email', label: 'Contact' },
                { key: 'active_contracts', label: 'Active contracts', align: 'right' },
                { key: 'total_billed', label: 'Billed', align: 'right', render: (r) => fmtMoney(r.total_billed) },
                { key: 'outstanding', label: 'Outstanding', align: 'right', render: (r) => fmtMoney(r.outstanding) },
              ]} />
            )}
          </Loader>
        </Card>
      )}
      {modal === 'users' && <UserModal clients={clients.data || []} onClose={() => setModal(null)} onDone={() => { setModal(null); flash('User created'); users.reload(true); }} />}
      {modal === 'clients' && <ClientModal onClose={() => setModal(null)} onDone={() => { setModal(null); flash('Client created'); clients.reload(true); }} />}
      {toast}
    </>
  );
}

function UserModal({ clients, onClose, onDone }) {
  const [f, setF] = useState({ role: 'operator', client_id: clients[0]?.client_id ?? '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    try { await post('/users', f); onDone(); } catch (e) { setError(e); }
  };
  return (
    <Modal title="Add user" onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Create</button></>}>
      {error && <ErrorBanner error={error} />}
      <div className="form-grid">
        <Field label="Full name"><input value={f.full_name || ''} onChange={set('full_name')} /></Field>
        <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Role">
          <select value={f.role} onChange={set('role')}>{['admin', 'operator', 'client'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</select>
        </Field>
        {f.role === 'client' ? (
          <Field label="Client organisation">
            <select value={f.client_id} onChange={set('client_id')}>{clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}</select>
          </Field>
        ) : <span />}
        <Field label="Initial password" hint="At least 8 characters; stored as a bcrypt hash"><input type="password" value={f.password || ''} onChange={set('password')} /></Field>
      </div>
    </Modal>
  );
}

function ClientModal({ onClose, onDone }) {
  const [f, setF] = useState({ org_type: 'commercial' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    try { await post('/clients', f); onDone(); } catch (e) { setError(e); }
  };
  return (
    <Modal title="Add client organisation" onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Create</button></>}>
      {error && <ErrorBanner error={error} />}
      <div className="form-grid">
        <Field label="Name"><input value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Type">
          <select value={f.org_type} onChange={set('org_type')}>{['government', 'commercial', 'research', 'defense', 'ngo'].map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}</select>
        </Field>
        <Field label="Country"><input value={f.country || ''} onChange={set('country')} /></Field>
        <Field label="Contact email"><input type="email" value={f.contact_email || ''} onChange={set('contact_email')} /></Field>
      </div>
    </Modal>
  );
}
