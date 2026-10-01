// MongoDB-backed monitoring: telemetry, anomalies, alert rules, event log.
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getMongo } from '../db/mongo.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { visibleSatelliteIds, assertSatelliteVisible, satellitesById } from '../services/scope.js';
import * as telemetry from '../services/telemetryService.js';
import * as anomalies from '../services/anomalyService.js';
import { toInt, requireFields, oneOf } from '../util.js';

const router = Router();
const staff = requireRole('admin', 'operator');

const asObjectId = (id) => {
  if (!ObjectId.isValid(id)) throw new HttpError(400, 'INVALID_ID', 'Invalid id');
  return new ObjectId(id);
};

// ---------------------------------------------------------------- telemetry
router.post('/telemetry', staff, async (req, res) => {
  const packets = Array.isArray(req.body) ? req.body : [req.body];
  if (!packets.length || packets.length > 1000) throw new HttpError(400, 'BAD_BATCH', 'Send 1-1000 packets per request');
  const result = await telemetry.ingest(await getMongo(), packets, await satellitesById());
  res.status(result.stored ? 201 : 422).json(result);
});

router.get('/telemetry/fleet', async (req, res) => {
  const [db, sats, visible] = await Promise.all([getMongo(), satellitesById(), visibleSatelliteIds(req)]);
  const latest = await telemetry.fleetLatest(db, Number(req.query.minutes) || 120);
  res.json(latest
    .filter((l) => !visible || visible.includes(l._id))
    .map((l) => ({ satId: l._id, name: sats.get(l._id)?.name, packets: l.packets, latest: l.latest }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name))));
});

router.get('/telemetry/trend', async (req, res) => {
  res.json(await telemetry.dailyHealthTrend(await getMongo(), Number(req.query.days) || 7));
});

router.get('/telemetry/:satId/latest', async (req, res) => {
  const satId = toInt(req.params.satId, 'satId');
  await assertSatelliteVisible(req, satId);
  res.json(await telemetry.latest(await getMongo(), satId));
});

router.get('/telemetry/:satId/series', async (req, res) => {
  const satId = toInt(req.params.satId, 'satId');
  await assertSatelliteVisible(req, satId);
  const sat = (await satellitesById()).get(satId);
  if (!sat) throw new HttpError(404, 'NOT_FOUND', 'Satellite not found');
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 30);
  // ~120 points per chart regardless of range
  const bucketMinutes = Math.max(1, Math.round((hours * 60) / 120));
  const metrics = req.query.metrics ? String(req.query.metrics).split(',') : undefined;
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3.6e6);
  res.json({
    satId, hours, bucketMinutes,
    points: await telemetry.series(await getMongo(), satId, { from, to, bucketMinutes, metrics, model: sat.model }),
  });
});

router.post('/telemetry/rollup', requireRole('admin'), async (req, res) => {
  const hours = Number(req.body?.hours) || 48;
  const buckets = await telemetry.rollupHourly(await getMongo(), new Date(Date.now() - hours * 3.6e6));
  res.json({ hours, buckets });
});

// ---------------------------------------------------------------- anomalies
router.get('/anomalies', async (req, res) => {
  const visible = await visibleSatelliteIds(req);
  const filter = { ...req.query };
  if (visible) filter.satId = filter.satId ? [].concat(filter.satId).map(Number).filter((id) => visible.includes(id)) : visible;
  const sats = await satellitesById();
  const list = await anomalies.listAnomalies(await getMongo(), filter);
  res.json(list.map((a) => ({ ...a, satellite: sats.get(a.satId)?.name })));
});

router.get('/anomalies/stats', async (req, res) => {
  res.json(await anomalies.anomalyStats(await getMongo(), await visibleSatelliteIds(req)));
});

router.get('/anomalies/:id', async (req, res) => {
  const a = await anomalies.getAnomaly(await getMongo(), asObjectId(req.params.id));
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Anomaly not found');
  await assertSatelliteVisible(req, a.satId);
  res.json({ ...a, satellite: (await satellitesById()).get(a.satId)?.name });
});

router.patch('/anomalies/:id', staff, async (req, res) => {
  oneOf(req.body.status, ['acknowledged', 'resolved'], 'status');
  const r = await anomalies.changeStatus(await getMongo(), asObjectId(req.params.id), req.body.status, req.user.name, req.body.note);
  if (r.error) throw new HttpError(r.error === 'NOT_FOUND' ? 404 : 409, r.error, r.message);
  res.json(r.anomaly);
});

// -------------------------------------------------------------- alert rules
router.get('/alert-rules', async (req, res) => {
  res.json(await (await getMongo()).collection('alert_rules').find().sort({ 'scope.family': 1, metric: 1 }).toArray());
});

router.post('/alert-rules', requireRole('admin'), async (req, res) => {
  const b = req.body;
  requireFields(b, ['scope', 'metric', 'op', 'threshold', 'severity']);
  const doc = {
    scope: b.scope, metric: b.metric, op: b.op, threshold: Number(b.threshold), severity: b.severity,
    description: b.description || `${b.metric} ${b.op} ${b.threshold}`, enabled: true, createdAt: new Date(),
  };
  try {
    const r = await (await getMongo()).collection('alert_rules').insertOne(doc);
    res.status(201).json({ ...doc, _id: r.insertedId });
  } catch (err) {
    // MongoDB $jsonSchema validator rejection
    if (err.code === 121) throw new HttpError(422, 'VALIDATION_FAILED', 'Rule rejected by the collection schema validator', err.errInfo);
    throw err;
  }
});

router.patch('/alert-rules/:id', requireRole('admin'), async (req, res) => {
  const set = {};
  if (req.body.enabled !== undefined) set.enabled = Boolean(req.body.enabled);
  if (req.body.threshold !== undefined) set.threshold = Number(req.body.threshold);
  if (!Object.keys(set).length) throw new HttpError(400, 'NOTHING_TO_UPDATE', 'Send enabled and/or threshold');
  const r = await (await getMongo()).collection('alert_rules').findOneAndUpdate(
    { _id: asObjectId(req.params.id) }, { $set: set }, { returnDocument: 'after' });
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Rule not found');
  res.json(r);
});

// ---------------------------------------------------------------- event log
router.get('/events', async (req, res) => {
  const visible = await visibleSatelliteIds(req);
  const q = {};
  if (req.query.satId) q.satId = toInt(req.query.satId, 'satId');
  if (visible) q.satId = q.satId && visible.includes(q.satId) ? q.satId : { $in: visible };
  if (req.query.type) q.type = req.query.type;
  if (req.query.q) q.$text = { $search: String(req.query.q) };
  const sats = await satellitesById();
  const events = await (await getMongo()).collection('event_logs')
    .find(q).sort({ ts: -1 }).limit(Math.min(Number(req.query.limit) || 100, 500)).toArray();
  res.json(events.map((e) => ({ ...e, satellite: sats.get(e.satId)?.name })));
});

export default router;
