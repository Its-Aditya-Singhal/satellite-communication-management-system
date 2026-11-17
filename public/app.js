// Shared helpers used by every page

const HOME = { client: 'client.html', organisation: 'org.html', admin: 'admin.html' };
const me = () => JSON.parse(sessionStorage.getItem('user') || 'null');

// call the API with the login token
async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('token') || '') },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (r.status === 401) { sessionStorage.clear(); location.href = 'index.html'; }
  if (!r.ok) throw new Error(data.error);
  return data;
}

// only let the right role open this page, and fill the header
function guard(role) {
  const u = me();
  if (!u || u.role !== role) { location.href = 'login.html?role=' + role; return; }
  document.getElementById('who').textContent = u.name;
}

async function logout() {
  try { await api('POST', '/api/logout'); } catch (e) {}
  sessionStorage.clear();
  location.href = 'index.html';
}

let toastTimer;
function toast(text, ok) {
  const t = document.getElementById('toast');
  t.className = ok ? 'ok' : 'err';
  t.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 5000);
}

// tabs: { key: { title, sub, render: async () => html } }
let TABS = {};
async function tabs(defs, first) {
  TABS = defs;
  document.getElementById('nav').innerHTML = Object.entries(defs)
    .map(([k, t]) => `<button id="t-${k}" onclick="show('${k}')">${t.title}</button>`).join('');
  await show(first || Object.keys(defs)[0]);
}
async function show(key) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.id === 't-' + key));
  const t = TABS[key];
  document.getElementById('title').textContent = t.title;
  document.getElementById('sub').textContent = t.sub || '';
  try {
    document.getElementById('page').innerHTML = await t.render();
    if (t.after) t.after();
  } catch (e) { toast(e.message, false); }
}

// ---------- formatting ----------
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const badge = (v, cls) => `<span class="badge b-${cls || v}">${esc(v)}</span>`;
const fmt = (d) => d ? new Date(String(d).replace(' ', 'T')).toLocaleString('en-GB',
  { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const days = (list = []) => '<div class="days">' + ALL_DAYS.map((d) => `<span class="${list.includes(d) ? 'on' : ''}">${d}</span>`).join('') + '</div>';

// simple table: cols = [[key, heading, (value,row)=>html?]]
function table(rows, cols, empty = 'Nothing here yet') {
  if (!rows.length) return `<div class="card"><div class="empty">${empty}</div></div>`;
  return '<div class="card"><table><thead><tr>' + cols.map((c) => `<th>${c[1]}</th>`).join('') + '</tr></thead><tbody>' +
    rows.map((r) => '<tr>' + cols.map(([k, , f]) => `<td>${f ? f(r[k], r) : esc(r[k])}</td>`).join('') + '</tr>').join('') +
    '</tbody></table></div>';
}

// one request (stored in MongoDB) with its details and history
function requestCard(r, actions = '') {
  const kv = Object.entries(r.details || {}).map(([k, v]) => `<b>${k.replace(/_/g, ' ')}</b><span>${esc(v)}</span>`).join('');
  const hist = (r.history || []).map((h) =>
    `<div class="${h.status}"><b>${h.status}</b> by ${esc(h.by)} <span class="muted">· ${fmt(h.at)}</span>${h.note ? `<br><span class="muted">${esc(h.note)}</span>` : ''}</div>`).join('');
  return `<div class="card">
    <div class="req-head">${badge(r.type)} <h4>${esc(r.title)}</h4> ${badge(r.status)}
      <span class="when">from <b>${esc(r.from.name)}</b> (${r.from.role}) · ${fmt(r.created_at)}</span></div>
    <div class="req-body"><div class="kv">${kv}</div><div class="timeline">${hist}</div></div>
    ${actions}</div>`;
}

// read a form into an object; checkbox groups become arrays
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { o[el.name] = o[el.name] || []; if (el.checked) o[el.name].push(el.value); }
    else o[el.name] = el.value;
  }
  return o;
}
