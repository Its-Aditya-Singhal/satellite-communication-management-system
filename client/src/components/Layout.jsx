import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icon } from './Icon.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/satellites', label: 'Satellites', icon: 'satellite' },
  { to: '/stations', label: 'Ground Stations', icon: 'antenna' },
  { to: '/scheduling', label: 'Scheduling', icon: 'calendar', staff: true },
  { to: '/sessions', label: 'My Sessions', icon: 'calendar', client: true },
  { to: '/bandwidth', label: 'Bandwidth', icon: 'bars' },
  { to: '/contracts', label: 'Contracts & Billing', icon: 'file' },
  { to: '/anomalies', label: 'Health & Anomalies', icon: 'pulse' },
  { to: '/reports', label: 'Reports', icon: 'chart', staff: true },
  { to: '/admin', label: 'Administration', icon: 'users', admin: true },
  { to: '/audit', label: 'Audit Log', icon: 'shield', admin: true },
];

export default function Layout() {
  const { user, logout, isStaff, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const items = NAV.filter((n) => (!n.staff || isStaff) && (!n.client || !isStaff) && (!n.admin || isAdmin));

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <Icon name="logo" size={26} />
          <div>
            <div className="brand-name">SCMS</div>
            <div className="brand-sub">Satellite Comms Mgmt</div>
          </div>
        </div>
        <nav onClick={() => setOpen(false)}>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="avatar">{user.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
            <div className="user-meta">
              <div className="user-name">{user.full_name}</div>
              <div className="user-role">{user.role}{user.client_name ? ` · ${user.client_name}` : ''}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-block" onClick={logout}><Icon name="logout" /> Sign out</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="btn btn-ghost btn-icon" onClick={() => setOpen((o) => !o)} aria-label="Toggle navigation"><Icon name="menu" /></button>
          <span className="topbar-title">SCMS</span>
        </div>
        <main className="content" key={location.pathname}>
          <Outlet />
        </main>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
    </div>
  );
}
