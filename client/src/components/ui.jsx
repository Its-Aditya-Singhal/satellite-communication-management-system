import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { titleCase } from '../format.js';

/** Load data on mount / when deps change; returns {data, error, loading, reload}. */
export function useFetch(loader, deps = [], { interval } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await loaderRef.current();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    reload();
    if (!interval) return undefined;
    const t = setInterval(() => reload(true), interval);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload };
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className={`stat ${tone ? 'stat-' + tone : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

const TONE = {
  active: 'ok', online: 'ok', confirmed: 'info', completed: 'neutral', paid: 'ok', resolved: 'neutral',
  standby: 'warn', maintenance: 'warn', acknowledged: 'warn', issued: 'info', draft: 'neutral', released: 'neutral',
  decommissioned: 'neutral', offline: 'bad', cancelled: 'neutral', expired: 'neutral', terminated: 'bad', overdue: 'bad',
  open: 'bad', critical: 'bad', warning: 'warn', info: 'info', faulty: 'bad', reserved: 'warn',
  INSERT: 'ok', UPDATE: 'info', DELETE: 'bad',
};

export function Badge({ value, tone, children }) {
  const t = tone || TONE[value] || 'neutral';
  return <span className={`badge badge-${t}`}>{children ?? titleCase(value)}</span>;
}

export function Spinner({ label = 'Loading' }) {
  return <div className="spinner" role="status"><span className="spinner-dot" />{label}…</div>;
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="banner banner-bad" role="alert">
      <strong>{error.code ? titleCase(error.code.toLowerCase()) : 'Error'}:</strong> {error.message}
      {onRetry && <button className="btn btn-sm btn-ghost" onClick={() => onRetry()}>Retry</button>}
    </div>
  );
}

export function Empty({ children = 'Nothing to show yet.' }) {
  return <div className="empty">{children}</div>;
}

/** Loading/error/empty wrapper for a useFetch result. */
export function Loader({ state, children, empty }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error && !state.data) {
    if (state.error.code === 'MONGO_UNAVAILABLE') {
      return <div className="banner banner-warn">Live telemetry is offline: {state.error.message}</div>;
    }
    return <ErrorBanner error={state.error} onRetry={state.reload} />;
  }
  if (empty && (!state.data || (Array.isArray(state.data) && state.data.length === 0))) return <Empty>{empty}</Empty>;
  return children(state.data);
}

/**
 * Sortable table. columns: [{key, label, render?, sort?: (row)=>value, align?, width?}]
 */
export function DataTable({ columns, rows, rowKey, onRowClick, initialSort, empty = 'No records.', maxHeight }) {
  const [sort, setSort] = useState(initialSort || null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = col?.sort || ((r) => r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = val(a); const y = val(b);
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);

  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align }}
                  className={c.nosort ? '' : 'sortable'}
                  onClick={c.nosort ? undefined : () => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'asc' ? 'desc' : 'asc' }))}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align }}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value}
                className={`tab ${value === t.value ? 'tab-active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}{t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Meter({ value, max = 100, tone }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  const t = tone || (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok');
  return (
    <div className="meter" title={`${Number(value).toFixed(1)}%`}>
      <div className={`meter-fill meter-${t}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Toast-style message used after mutations. */
export function useFlash() {
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), flash.tone === 'bad' ? 9000 : 4000);
    return () => clearTimeout(t);
  }, [flash]);
  const node = flash ? (
    <div className={`toast toast-${flash.tone || 'ok'}`} role="status" onClick={() => setFlash(null)}>{flash.text}</div>
  ) : null;
  return [node, (text, tone) => setFlash({ text, tone })];
}

// Shared chart palette (validated for both light and dark surfaces)
export const CHART = {
  blue: '#4c8dff', teal: '#22b39a', amber: '#e7a33e', violet: '#9b7cf0', red: '#e5484d', slate: '#8b97ab',
};
