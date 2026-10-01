import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { Field } from '../components/ui.jsx';

const DEMO = [
  ['admin@scms.local', 'Administrator'],
  ['priya@scms.local', 'Operator'],
  ['eo@agrisense.example', 'Client · AgriSense'],
  ['uplink@orbitcast.example', 'Client · OrbitCast'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e, creds) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(creds?.email ?? email, creds?.password ?? password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div className="row"><Icon name="logo" size={30} /><strong style={{ color: '#fff', letterSpacing: '.05em' }}>SCMS</strong></div>
        <div>
          <h1>Satellite Communication Management System</h1>
          <p>Schedule ground-station passes, lease transponder bandwidth without conflicts, and watch fleet health in real time.</p>
        </div>
        <p className="small">MySQL for transactional operations · MongoDB for telemetry and anomalies</p>
        <svg className="login-orbit" viewBox="0 0 400 400" aria-hidden="true">
          <circle cx="200" cy="200" r="60" fill="#2f6fe4" opacity=".35" />
          <circle cx="200" cy="200" r="38" fill="#5b93f5" />
          {[110, 150, 190].map((r, i) => (
            <g key={r}>
              <ellipse cx="200" cy="200" rx={r} ry={r * 0.42} fill="none" stroke="#8fb4ff" strokeOpacity=".35" transform={`rotate(${-20 + i * 25} 200 200)`} />
              <circle r="5" fill="#fff">
                <animateMotion dur={`${10 + i * 6}s`} repeatCount="indefinite"
                  path={`M ${200 - r} 200 a ${r} ${r * 0.42} 0 1 0 ${2 * r} 0 a ${r} ${r * 0.42} 0 1 0 ${-2 * r} 0`}
                  rotate="auto" />
              </circle>
            </g>
          ))}
        </svg>
      </div>
      <div className="login-form-side">
        <form className="login-card card card-body stack" onSubmit={submit}>
          <div>
            <h1>Sign in</h1>
            <p className="muted small" style={{ margin: '4px 0 0' }}>Use your SCMS account.</p>
          </div>
          {error && <div className="banner banner-bad">{error}</div>}
          <Field label="Email">
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="demo-accounts">
            <div className="muted small">Demo accounts (password <code>Passw0rd!</code>)</div>
            {DEMO.map(([em, label]) => (
              <button type="button" key={em} className="btn btn-sm" disabled={busy}
                      onClick={() => { setEmail(em); setPassword('Passw0rd!'); submit(null, { email: em, password: 'Passw0rd!' }); }}>
                <span>{label}</span><span className="muted">{em}</span>
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
