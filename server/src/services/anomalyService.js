// Threshold-based anomaly detection over telemetry packets (MongoDB).
// One anomaly document per (satellite, metric) episode: while an anomaly is
// open/acknowledged, further breaches update it instead of creating new ones.
import { ObjectId } from 'mongodb';
import { getPath } from './telemetryModel.js';

const ACTIVE = ['open', 'acknowledged'];

export function ruleApplies(rule, meta) {
  if (rule.enabled === false) return false;
  const s = rule.scope || {};
  return Boolean(
    s.all ||
      (s.family && s.family === meta.family) ||
      (s.model && s.model === meta.model) ||
      (s.satId !== undefined && Number(s.satId) === Number(meta.satId)),
  );
}

export function breaches(rule, value) {
  switch (rule.op) {
    case '>': return value > rule.threshold;
    case '>=': return value >= rule.threshold;
    case '<': return value < rule.threshold;
    case '<=': return value <= rule.threshold;
    default: return false;
  }
}

export function loadRules(db) {
  return db.collection('alert_rules').find({ enabled: { $ne: false } }).toArray();
}

/** Check packets against rules and upsert anomaly episodes. Returns number of breaches. */
export async function evaluatePackets(db, packets, rules) {
  const ops = [];
  for (const p of packets) {
    for (const rule of rules) {
      if (!ruleApplies(rule, p.meta)) continue;
      const value = getPath(p, rule.metric);
      if (typeof value !== 'number' || !breaches(rule, value)) continue;
      ops.push({
        updateOne: {
          filter: { satId: p.meta.satId, metric: rule.metric, status: { $in: ACTIVE } },
          update: {
            $setOnInsert: {
              satId: p.meta.satId,
              model: p.meta.model,
              family: p.meta.family,
              metric: rule.metric,
              ruleId: rule._id,
              op: rule.op,
              threshold: rule.threshold,
              severity: rule.severity,
              description: rule.description,
              status: 'open',
              firstSeen: p.ts,
              history: [{ status: 'open', at: p.ts, by: 'system' }],
            },
            $max: { lastSeen: p.ts },
            $inc: { occurrences: 1 },
            $set: { lastValue: value },
            $push: { samples: { $each: [{ ts: p.ts, value }], $slice: -20 } },
          },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await db.collection('anomalies').bulkWrite(ops, { ordered: true });
  return ops.length;
}

export async function listAnomalies(db, { status, satId, severity, limit = 100 } = {}) {
  const q = {};
  if (status) q.status = { $in: String(status).split(',') };
  if (satId) q.satId = { $in: [].concat(satId).map(Number) };
  if (severity) q.severity = severity;
  return db
    .collection('anomalies')
    .find(q, { projection: { samples: 0 } })
    .sort({ status: 1, lastSeen: -1 })
    .limit(Math.min(Number(limit) || 100, 500))
    .toArray();
}

export function getAnomaly(db, id) {
  return db.collection('anomalies').findOne({ _id: new ObjectId(id) });
}

const TRANSITIONS = { open: ['acknowledged', 'resolved'], acknowledged: ['resolved'], resolved: [] };

export async function changeStatus(db, id, nextStatus, userName, note) {
  const current = await getAnomaly(db, id);
  if (!current) return { error: 'NOT_FOUND', message: 'Anomaly not found' };
  if (!TRANSITIONS[current.status]?.includes(nextStatus)) {
    return { error: 'INVALID_STATE', message: `Cannot move anomaly from ${current.status} to ${nextStatus}` };
  }
  const now = new Date();
  const set = { status: nextStatus };
  if (nextStatus === 'acknowledged') set.acknowledgedAt = now;
  if (nextStatus === 'resolved') set.resolvedAt = now;
  await db.collection('anomalies').updateOne(
    { _id: current._id, status: current.status },   // optimistic concurrency guard
    { $set: set, $push: { history: { status: nextStatus, at: now, by: userName, note: note || null } } },
  );
  return { anomaly: await getAnomaly(db, id) };
}

/** Counts by status x severity, plus open anomalies per satellite — one round trip with $facet. */
export async function anomalyStats(db, satIds = null) {
  const match = satIds ? { satId: { $in: satIds } } : {};
  const [res] = await db
    .collection('anomalies')
    .aggregate([
      { $match: match },
      {
        $facet: {
          byStatus: [{ $group: { _id: { status: '$status', severity: '$severity' }, count: { $sum: 1 } } }],
          openBySatellite: [
            { $match: { status: { $in: ACTIVE } } },
            { $group: { _id: '$satId', open: { $sum: 1 }, critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } } } },
          ],
          last7Days: [
            { $match: { firstSeen: { $gte: new Date(Date.now() - 7 * 864e5) } } },
            { $group: { _id: { $dateTrunc: { date: '$firstSeen', unit: 'day' } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ])
    .toArray();
  return res;
}
