// Telemetry storage and analytics on the MongoDB time-series collection.
import { familyOf, CHART_METRICS } from './telemetryModel.js';
import { evaluatePackets, loadRules } from './anomalyService.js';

const keyOf = (path) => path.replace(/\./g, '_');

/** Validate/normalise incoming packets, store them, run anomaly detection. */
export async function ingest(db, packets, satellitesById) {
  const docs = [];
  const rejected = [];
  for (const raw of packets) {
    const sat = satellitesById.get(Number(raw?.meta?.satId ?? raw?.satId));
    if (!sat) { rejected.push({ reason: 'unknown satId', packet: raw }); continue; }
    const ts = raw.ts ? new Date(raw.ts) : new Date();
    if (Number.isNaN(ts.getTime())) { rejected.push({ reason: 'bad ts', packet: raw }); continue; }
    const { satId: _s, meta: _m, ts: _t, _id, ...body } = raw;
    docs.push({ ...body, ts, meta: { satId: sat.sat_id, model: sat.model, family: familyOf(sat.model) } });
  }
  if (docs.length) await db.collection('telemetry').insertMany(docs, { ordered: false });
  const breaches = docs.length ? await evaluatePackets(db, docs, await loadRules(db)) : 0;
  return { stored: docs.length, rejected, breaches };
}

/** Latest packet for one satellite. */
export function latest(db, satId) {
  return db.collection('telemetry').find({ 'meta.satId': Number(satId) }).sort({ ts: -1 }).limit(1).next();
}

/**
 * Down-sampled series for charting: $dateTrunc buckets with avg/min/max per metric.
 */
export async function series(db, satId, { from, to, bucketMinutes, metrics, model }) {
  const metricList = metrics?.length ? metrics : (CHART_METRICS[familyOf(model)] || []).map((m) => m[0]);
  const group = { _id: { $dateTrunc: { date: '$ts', unit: 'minute', binSize: bucketMinutes } }, n: { $sum: 1 } };
  for (const m of metricList) {
    group[`${keyOf(m)}_avg`] = { $avg: `$${m}` };
    group[`${keyOf(m)}_min`] = { $min: `$${m}` };
    group[`${keyOf(m)}_max`] = { $max: `$${m}` };
  }
  const rows = await db
    .collection('telemetry')
    .aggregate([
      { $match: { 'meta.satId': Number(satId), ts: { $gte: from, $lt: to } } },
      { $group: group },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  return rows.map(({ _id, n, ...rest }) => {
    const row = { t: _id, n };
    for (const [k, v] of Object.entries(rest)) row[k] = v == null ? null : Math.round(v * 1000) / 1000;
    return row;
  });
}

/** Latest packet per satellite in the last `minutes` (fleet health board). */
export function fleetLatest(db, minutes = 60) {
  return db
    .collection('telemetry')
    .aggregate([
      { $match: { ts: { $gte: new Date(Date.now() - minutes * 60000) } } },
      { $sort: { ts: -1 } },
      { $group: { _id: '$meta.satId', latest: { $first: '$$ROOT' }, packets: { $sum: 1 } } },
    ])
    .toArray();
}

/**
 * Hourly roll-ups into `telemetry_hourly` with $merge (materialised view).
 * Re-running for the same hours replaces those buckets, so it is idempotent.
 */
export async function rollupHourly(db, since) {
  await db
    .collection('telemetry')
    .aggregate([
      { $match: { ts: { $gte: since } } },
      {
        $group: {
          _id: { satId: '$meta.satId', hour: { $dateTrunc: { date: '$ts', unit: 'hour' } } },
          family: { $first: '$meta.family' },
          packets: { $sum: 1 },
          batterySocAvg: { $avg: '$power.batterySoC' },
          batterySocMin: { $min: '$power.batterySoC' },
          linkMarginAvg: { $avg: '$linkMarginDb' },
          linkMarginMin: { $min: '$linkMarginDb' },
          tempMax: { $max: { $ifNull: ['$thermal.payloadTempC', '$thermal.cameraTempC', '$cabin.tempC', '$thermal.clockTempC', '$thermal.busTempC'] } },
        },
      },
      { $set: { updatedAt: '$$NOW' } },
      { $merge: { into: 'telemetry_hourly', on: '_id', whenMatched: 'replace', whenNotMatched: 'insert' } },
    ])
    .toArray();
  return db.collection('telemetry_hourly').countDocuments({ '_id.hour': { $gte: since } });
}

/** Fleet-wide daily health trend from the roll-up collection. */
export function dailyHealthTrend(db, days = 7) {
  return db
    .collection('telemetry_hourly')
    .aggregate([
      { $match: { '_id.hour': { $gte: new Date(Date.now() - days * 864e5) } } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$_id.hour', unit: 'day' } },
          packets: { $sum: '$packets' },
          avgBatterySoc: { $avg: '$batterySocAvg' },
          minLinkMargin: { $min: '$linkMarginMin' },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
}

export function hourlyForSatellite(db, satId, hours = 48) {
  return db
    .collection('telemetry_hourly')
    .find({ '_id.satId': Number(satId), '_id.hour': { $gte: new Date(Date.now() - hours * 3.6e6) } })
    .sort({ '_id.hour': 1 })
    .toArray();
}
