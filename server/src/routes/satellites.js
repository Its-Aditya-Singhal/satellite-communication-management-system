import { Router } from 'express';
import { pool, query } from '../db/mysql.js';
import { getMongo } from '../db/mongo.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { visibleSatelliteIds, assertSatelliteVisible } from '../services/scope.js';
import * as telemetry from '../services/telemetryService.js';
import { familyOf, CHART_METRICS } from '../services/telemetryModel.js';
import { requireFields, toInt, oneOf, toSqlDate } from '../util.js';

const router = Router();
const STATUSES = ['active', 'standby', 'maintenance', 'decommissioned'];

// Best-effort MongoDB enrichment: MySQL data is still served if Mongo is down.
async function mongoOrNull(fn) {
  try { return await fn(await getMongo()); } catch { return null; }
}

router.get('/', async (req, res) => {
  const ids = await visibleSatelliteIds(req);
  if (ids && ids.length === 0) return res.json([]);
  const rows = await query(
    `SELECT s.*, o.altitude_km, o.inclination_deg, o.period_min, o.geo_longitude,
            (SELECT COUNT(*) FROM transponders t WHERE t.sat_id = s.sat_id) AS transponders,
            (SELECT COUNT(*) FROM bookings b WHERE b.sat_id = s.sat_id
                AND b.status = 'confirmed' AND b.start_ts >= NOW()) AS upcoming_sessions
       FROM satellites s JOIN orbits o ON o.sat_id = s.sat_id
      ${ids ? 'WHERE s.sat_id IN (?)' : ''}
      ORDER BY FIELD(s.orbit_type,'GEO','MEO','HEO','LEO'), s.name`,
    ids ? [ids] : [],
  );

  // Fuse in live health from MongoDB (application-level join on sat_id)
  const health = await mongoOrNull(async (db) => {
    const [latest, anomalies] = await Promise.all([
      telemetry.fleetLatest(db, 120),
      db.collection('anomalies').aggregate([
        { $match: { status: { $in: ['open', 'acknowledged'] } } },
        { $group: { _id: '$satId', open: { $sum: 1 }, critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } } } },
      ]).toArray(),
    ]);
    return {
      latest: new Map(latest.map((l) => [l._id, l.latest])),
      anomalies: new Map(anomalies.map((a) => [a._id, a])),
    };
  });

  res.json(rows.map((s) => {
    if (!health) return { ...s, health: null };
    const l = health.latest.get(s.sat_id);
    const a = health.anomalies.get(s.sat_id);
    return {
      ...s,
      health: {
        lastContact: l?.ts ?? null,
        batterySoC: l?.power?.batterySoC ?? null,
        linkMarginDb: l?.linkMarginDb ?? null,
        openAnomalies: a?.open ?? 0,
        criticalAnomalies: a?.critical ?? 0,
      },
    };
  }));
});

router.get('/:id', async (req, res) => {
  const id = toInt(req.params.id);
  await assertSatelliteVisible(req, id);
  const [sat] = await query(
    `SELECT s.*, o.altitude_km, o.inclination_deg, o.period_min, o.geo_longitude, o.epoch
       FROM satellites s JOIN orbits o ON o.sat_id = s.sat_id WHERE s.sat_id = ?`,
    [id],
  );
  if (!sat) throw new HttpError(404, 'NOT_FOUND', 'Satellite not found');

  const [transponders, schedule] = await Promise.all([
    query('SELECT * FROM v_transponder_utilization WHERE sat_id = ? ORDER BY band, label', [id]),
    query(
      `SELECT booking_id, station_code, station, transponder, band, client, purpose, start_ts, end_ts, duration_min
         FROM v_booking_details
        WHERE sat_id = ? AND status = 'confirmed' AND end_ts >= NOW()
          ${req.user.role === 'client' ? 'AND client_id = ?' : ''}
        ORDER BY start_ts LIMIT 15`,
      req.user.role === 'client' ? [id, req.user.clientId] : [id],
    ),
  ]);

  const mongo = await mongoOrNull(async (db) => {
    const [latest, anomalies, events, hourly] = await Promise.all([
      telemetry.latest(db, id),
      db.collection('anomalies').find({ satId: id }, { projection: { samples: 0 } }).sort({ lastSeen: -1 }).limit(10).toArray(),
      db.collection('event_logs').find({ satId: id }).sort({ ts: -1 }).limit(15).toArray(),
      telemetry.hourlyForSatellite(db, id, 48),
    ]);
    return { latest, anomalies, events, hourly };
  });

  res.json({
    ...sat,
    family: familyOf(sat.model),
    chartMetrics: CHART_METRICS[familyOf(sat.model)],
    transponders,
    schedule,
    telemetry: mongo,
  });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const b = req.body;
  requireFields(b, ['norad_id', 'name', 'model', 'orbit_type', 'operator_org', 'launch_date', 'mass_kg',
    'altitude_km', 'inclination_deg', 'period_min']);
  oneOf(b.orbit_type, ['LEO', 'MEO', 'GEO', 'HEO'], 'orbit_type');

  // satellite + orbit are written atomically
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO satellites (norad_id, name, model, orbit_type, operator_org, launch_date, mass_kg, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.norad_id, b.name, b.model, b.orbit_type, b.operator_org, toSqlDate(b.launch_date), b.mass_kg, b.status || 'active'],
    );
    await conn.query(
      `INSERT INTO orbits (sat_id, altitude_km, inclination_deg, period_min, geo_longitude, epoch)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [r.insertId, b.altitude_km, b.inclination_deg, b.period_min, b.geo_longitude ?? null],
    );
    await conn.commit();
    res.status(201).json({ sat_id: r.insertId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.patch('/:id', requireRole('admin', 'operator'), async (req, res) => {
  const id = toInt(req.params.id);
  oneOf(req.body.status, STATUSES, 'status');
  const r = await query('UPDATE satellites SET status = ? WHERE sat_id = ?', [req.body.status, id]);
  if (!r.affectedRows) throw new HttpError(404, 'NOT_FOUND', 'Satellite not found');
  res.json({ sat_id: id, status: req.body.status });
});

export default router;
