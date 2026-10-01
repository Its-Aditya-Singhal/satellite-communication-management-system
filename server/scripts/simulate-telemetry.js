// Streams live telemetry for every non-decommissioned satellite through the
// API (POST /api/telemetry), so packets go through the same validation and
// anomaly-detection path a real ground-station feed would use.
//
// Usage: npm run simulate -- [--interval 10] [--fault-rate 0.03] [--api http://localhost:4000]
import { generatePacket, faultsFor } from '../src/services/telemetryModel.js';
import { config } from '../src/config.js';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const API = arg('api', `http://localhost:${config.port}`);
const INTERVAL = Number(arg('interval', 10)) * 1000;
const FAULT_RATE = Number(arg('fault-rate', 0.03));
const ROLLUP_EVERY = 5 * 60 * 1000;

async function call(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${data?.error?.message || res.status}`);
  return data;
}

const { token } = await call('/auth/login', { body: { email: 'admin@scms.local', password: 'Passw0rd!' } });
const satellites = (await call('/satellites', { token })).filter((s) => s.status !== 'decommissioned');
console.log(`Simulating ${satellites.length} satellites every ${INTERVAL / 1000}s (fault rate ${FAULT_RATE}) -> ${API}`);

// An active fault persists for a few ticks so it shows up as an episode, not a blip
const activeFaults = new Map();   // sat_id -> { fault, ticksLeft }
let lastRollup = Date.now();

async function tick() {
  const now = new Date();
  const packets = satellites.map((s) => {
    let f = activeFaults.get(s.sat_id);
    if (!f && Math.random() < FAULT_RATE) {
      const options = faultsFor(s.model);
      f = { fault: options[Math.floor(Math.random() * options.length)], ticksLeft: 3 + Math.floor(Math.random() * 6) };
      activeFaults.set(s.sat_id, f);
      console.log(`  ! injecting ${f.fault} on ${s.name} for ${f.ticksLeft} ticks`);
    }
    if (f && --f.ticksLeft <= 0) activeFaults.delete(s.sat_id);
    const p = generatePacket(s, now, f?.fault);
    delete p.meta;               // the API derives meta from MySQL; we only send satId
    return { ...p, satId: s.sat_id };
  });
  try {
    const r = await call('/telemetry', { token, body: packets });
    console.log(`${now.toLocaleTimeString()}  stored ${r.stored} packets, ${r.breaches} rule breaches${r.rejected.length ? `, ${r.rejected.length} rejected` : ''}`);
    if (Date.now() - lastRollup > ROLLUP_EVERY) {
      const ru = await call('/telemetry/rollup', { token, body: { hours: 2 } });
      console.log(`  hourly roll-up refreshed (${ru.buckets} buckets)`);
      lastRollup = Date.now();
    }
  } catch (e) {
    console.error(`${now.toLocaleTimeString()}  ${e.message}`);
  }
}

await tick();
setInterval(tick, INTERVAL);
