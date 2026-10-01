import { Router } from 'express';
import { pool, query } from '../db/mysql.js';
import { requireRole, isClient } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { requireFields, toInt, oneOf } from '../util.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(await query('SELECT * FROM v_station_overview ORDER BY code'));
});

router.get('/:id', async (req, res) => {
  const id = toInt(req.params.id);
  const [station] = await query('SELECT * FROM v_station_overview WHERE station_id = ?', [id]);
  if (!station) throw new HttpError(404, 'NOT_FOUND', 'Ground station not found');

  const [load, schedule] = await Promise.all([
    // daily utilisation for the past 14 and next 7 days (recursive CTE + stored function)
    query(
      `WITH RECURSIVE d(day) AS (
           SELECT CURDATE() - INTERVAL 14 DAY
           UNION ALL SELECT day + INTERVAL 1 DAY FROM d WHERE day < CURDATE() + INTERVAL 7 DAY)
       SELECT day, fn_station_load(?, day) AS load_pct FROM d`,
      [id],
    ),
    query(
      `SELECT booking_id, satellite, transponder, band, ${isClient(req) ? '' : 'client,'} purpose, start_ts, end_ts, duration_min
         FROM v_booking_details
        WHERE station_id = ? AND status = 'confirmed' AND end_ts >= NOW()
          ${isClient(req) ? 'AND client_id = ?' : ''}
        ORDER BY start_ts LIMIT 25`,
      isClient(req) ? [id, req.user.clientId] : [id],
    ),
  ]);
  res.json({ ...station, load, schedule });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const b = req.body;
  requireFields(b, ['code', 'name', 'city', 'country', 'latitude', 'longitude', 'antenna_diameter_m']);
  const bands = Array.isArray(b.band_ids) ? b.band_ids.map((x) => toInt(x, 'band_id')) : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO ground_stations (code, name, city, country, latitude, longitude, antenna_diameter_m, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.code.toUpperCase(), b.name, b.city, b.country, b.latitude, b.longitude, b.antenna_diameter_m, b.status || 'online'],
    );
    if (bands.length) {
      await conn.query('INSERT INTO station_bands (station_id, band_id) VALUES ?', [bands.map((bid) => [r.insertId, bid])]);
    }
    await conn.commit();
    res.status(201).json({ station_id: r.insertId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.patch('/:id', requireRole('admin', 'operator'), async (req, res) => {
  const id = toInt(req.params.id);
  oneOf(req.body.status, ['online', 'offline', 'maintenance'], 'status');
  const r = await query('UPDATE ground_stations SET status = ? WHERE station_id = ?', [req.body.status, id]);
  if (!r.affectedRows) throw new HttpError(404, 'NOT_FOUND', 'Ground station not found');
  res.json({ station_id: id, status: req.body.status });
});

export default router;
