// Seeds MongoDB with 7 days of telemetry history, alert rules, anomaly
// episodes (detected by the same rule engine the API uses), event logs and
// hourly roll-ups. `satellites` comes from MySQL so satId values line up.
import { generatePacket, DEFAULT_ALERT_RULES } from '../../server/src/services/telemetryModel.js';
import { evaluatePackets } from '../../server/src/services/anomalyService.js';
import { rollupHourly } from '../../server/src/services/telemetryService.js';

const HOUR = 3.6e6;
const STEP_MIN = 10;
const HISTORY_DAYS = 7;

// Injected fault episodes: [satellite name, fault, starts N hours ago, lasts H hours]
const EPISODES = [
  ['Landsat 9', 'link_fade', 140, 1],
  ['Sentinel-2A', 'camera_overheat', 100, 2],
  ['ISS (ZARYA)', 'co2_high', 70, 1],
  ['GSAT-31', 'payload_overheat', 50, 2],
  ['Intelsat 39', 'pointing_drift', 30, 1.5],
  ['Cartosat-3', 'recorder_full', 20, 3],
  ['SES-12', 'link_fade', 6, 1],
  ['GPS III SV05', 'clock_jump', 3, 3.1],
  ['RISAT-2B', 'battery_low', 1.5, 1.6],
];

const EVENT_TYPES = [
  ['command_uplink', (s) => `Command sequence uplinked to ${s.name}`, () => ({ commands: 3 + Math.floor(Math.random() * 20), station: ['BLR', 'HSN', 'LKO', 'MRU', 'SVB'][Math.floor(Math.random() * 5)] })],
  ['downlink_complete', (s) => `Payload data downlink completed for ${s.name}`, () => ({ volumeGb: Math.round(Math.random() * 400) / 10, durationMin: 5 + Math.floor(Math.random() * 10) })],
  ['orbit_maneuver', (s) => `Station-keeping manoeuvre executed by ${s.name}`, () => ({ deltaVms: Math.round(Math.random() * 30) / 100, burnSec: 20 + Math.floor(Math.random() * 90), thruster: 'LAM-1' })],
  ['software_update', (s) => `On-board software patch applied on ${s.name}`, () => ({ component: ['AOCS', 'OBC', 'EPS'][Math.floor(Math.random() * 3)], version: `4.${Math.floor(Math.random() * 9)}.${Math.floor(Math.random() * 20)}` })],
  ['eclipse_entry', (s) => `${s.name} entered eclipse season`, () => ({ predictedDurationMin: 30 + Math.floor(Math.random() * 40) })],
];

export async function seedMongo(db, satellites) {
  const now = Date.now();
  const byName = new Map(satellites.map((s) => [s.name, s]));

  // --- alert rules -----------------------------------------------------
  const rules = DEFAULT_ALERT_RULES.map((r) => ({ ...r, enabled: true, createdAt: new Date() }));
  const { insertedIds } = await db.collection('alert_rules').insertMany(rules);
  rules.forEach((r, i) => { r._id = insertedIds[i]; });

  // --- telemetry history ----------------------------------------------
  const faultWindows = EPISODES.map(([name, fault, startH, durH]) => ({
    satId: byName.get(name)?.sat_id,
    fault,
    from: now - startH * HOUR,
    to: now - startH * HOUR + durH * HOUR,
  })).filter((e) => e.satId);

  const start = now - HISTORY_DAYS * 24 * HOUR;
  const packets = [];
  for (const sat of satellites) {
    if (sat.status === 'decommissioned') continue;
    for (let t = start; t <= now; t += STEP_MIN * 60000) {
      const ts = new Date(t + Math.floor(Math.random() * 20000));
      const fw = faultWindows.find((f) => f.satId === sat.sat_id && t >= f.from && t <= f.to);
      packets.push(generatePacket(sat, ts, fw?.fault));
    }
  }
  packets.sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < packets.length; i += 5000) {
    await db.collection('telemetry').insertMany(packets.slice(i, i + 5000), { ordered: false });
  }
  console.log(`Mongo  telemetry: ${packets.length} packets over ${HISTORY_DAYS} days`);

  // --- anomalies: replay history through the rule engine ---------------
  await evaluatePackets(db, packets, rules);
  // Older episodes were handled by operators: acknowledged, then resolved.
  const anomalies = await db.collection('anomalies').find().toArray();
  for (const a of anomalies) {
    const ageH = (now - a.lastSeen.getTime()) / HOUR;
    if (ageH > 12) {
      const ack = new Date(a.firstSeen.getTime() + 15 * 60000);
      const res = new Date(a.lastSeen.getTime() + 40 * 60000);
      await db.collection('anomalies').updateOne({ _id: a._id }, {
        $set: { status: 'resolved', acknowledgedAt: ack, resolvedAt: res },
        $push: { history: { $each: [
          { status: 'acknowledged', at: ack, by: 'Priya Raman', note: 'Investigating' },
          { status: 'resolved', at: res, by: 'Arjun Mehta', note: 'Back within limits after corrective action' },
        ] } },
      });
    } else if (a.metric === 'linkMarginDb') {
      const ack = new Date(a.firstSeen.getTime() + 10 * 60000);
      await db.collection('anomalies').updateOne({ _id: a._id }, {
        $set: { status: 'acknowledged', acknowledgedAt: ack },
        $push: { history: { status: 'acknowledged', at: ack, by: 'Priya Raman', note: 'Rain fade at gateway, monitoring' } },
      });
    }
  }
  console.log(`Mongo  anomalies: ${anomalies.length} episodes detected`);

  // --- operational event log ------------------------------------------
  const events = [];
  for (const sat of satellites) {
    for (let d = 0; d < HISTORY_DAYS; d++) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const [type, msg, details] = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
        events.push({
          ts: new Date(now - d * 24 * HOUR - Math.random() * 24 * HOUR),
          satId: sat.sat_id,
          type,
          message: msg(sat),
          details: details(),
          operator: Math.random() < 0.5 ? 'Priya Raman' : 'Arjun Mehta',
        });
      }
    }
  }
  for (const f of faultWindows) {
    events.push({ ts: new Date(f.from + 5 * 60000), satId: f.satId, type: 'anomaly_note', message: `Fault signature "${f.fault}" observed in telemetry`, details: { fault: f.fault }, operator: 'system' });
  }
  await db.collection('event_logs').insertMany(events);
  console.log(`Mongo  event_logs: ${events.length} events`);

  // --- hourly roll-ups ------------------------------------------------
  const buckets = await rollupHourly(db, new Date(start - HOUR));
  console.log(`Mongo  telemetry_hourly: ${buckets} hourly buckets`);
}
