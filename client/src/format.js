// MySQL DATETIMEs arrive as 'YYYY-MM-DD HH:MM:SS' local-time strings;
// MongoDB dates arrive as ISO strings. Both parse here.
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  return new Date(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(' ', 'T') : s);
}

const dtf = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const tf = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const fmtDateTime = (v) => (toDate(v) ? dtf.format(toDate(v)) : '—');
export const fmtDate = (v) => (toDate(v) ? df.format(toDate(v)) : '—');
export const fmtTime = (v) => (toDate(v) ? tf.format(toDate(v)) : '—');
export const fmtDay = (v) => (toDate(v) ? toDate(v).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '');

export function fmtRelative(v) {
  const d = toDate(v);
  if (!d) return '—';
  const diff = (d.getTime() - Date.now()) / 60000;
  const abs = Math.abs(diff);
  const unit = abs < 60 ? [Math.round(abs), 'min'] : abs < 1440 ? [Math.round(abs / 60), 'h'] : [Math.round(abs / 1440), 'd'];
  return diff >= 0 ? `in ${unit[0]} ${unit[1]}` : `${unit[0]} ${unit[1]} ago`;
}

export const fmtMoney = (v) =>
  v == null ? '—' : Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const fmtNum = (v, d = 0) =>
  v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

// 'YYYY-MM-DDTHH:MM' for <input type="datetime-local">
export function toLocalInput(v) {
  const d = toDate(v);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const toLocalDateInput = (v) => toLocalInput(v).slice(0, 10);

export const titleCase = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
