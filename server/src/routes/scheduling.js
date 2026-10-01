// Visibility windows and bookings. Writes go through the transactional stored
// procedures; conflict rules are enforced inside MySQL (triggers + row locks).
import { Router } from 'express';
import { query, asUser, callWithOutId } from '../db/mysql.js';
import { requireRole, isClient } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { requireFields, toInt, toSqlDateTime, oneOf } from '../util.js';

const router = Router();
const PURPOSES = ['telemetry', 'command', 'data_downlink', 'broadcast', 'ranging'];

router.get('/windows', requireRole('admin', 'operator'), async (req, res) => {
  const where = ['w.aos_ts < ?', 'w.los_ts > ?'];
  const from = req.query.from ? toSqlDateTime(req.query.from, 'from') : null;
  const to = req.query.to ? toSqlDateTime(req.query.to, 'to') : null;
  const params = [to ?? new Date(Date.now() + 2 * 864e5), from ?? new Date()];
  if (req.query.satId) { where.push('w.sat_id = ?'); params.push(toInt(req.query.satId, 'satId')); }
  if (req.query.stationId) { where.push('w.station_id = ?'); params.push(toInt(req.query.stationId, 'stationId')); }

  const rows = await query(
    `SELECT w.window_id, w.sat_id, s.name AS satellite, s.orbit_type, s.status AS sat_status,
            w.station_id, g.code AS station_code, g.name AS station, g.status AS station_status,
            w.aos_ts, w.los_ts, TIMESTAMPDIFF(MINUTE, w.aos_ts, w.los_ts) AS duration_min, w.max_elevation_deg,
            (SELECT JSON_ARRAYAGG(JSON_OBJECT('transponder_id', t.transponder_id, 'label', t.label, 'band', fb.code))
               FROM transponders t
               JOIN frequency_bands fb ON fb.band_id = t.band_id
               JOIN station_bands sb   ON sb.band_id = t.band_id AND sb.station_id = w.station_id
              WHERE t.sat_id = w.sat_id AND t.status = 'active')              AS compatible_transponders,
            (SELECT JSON_ARRAYAGG(JSON_OBJECT('booking_id', b.booking_id, 'start_ts', b.start_ts, 'end_ts', b.end_ts,
                                              'satellite', bs.name, 'station_code', bg.code,
                                              'same_station', b.station_id = w.station_id))
               FROM bookings b
               JOIN satellites bs      ON bs.sat_id = b.sat_id
               JOIN ground_stations bg ON bg.station_id = b.station_id
              WHERE b.status <> 'cancelled'
                AND (b.station_id = w.station_id OR b.sat_id = w.sat_id)
                AND b.start_ts < w.los_ts AND b.end_ts > w.aos_ts)            AS busy
       FROM comm_windows w
       JOIN satellites s      ON s.sat_id = w.sat_id
       JOIN ground_stations g ON g.station_id = w.station_id
      WHERE ${where.join(' AND ')}
      ORDER BY w.aos_ts
      LIMIT 300`,
    params,
  );
  res.json(rows.map((r) => ({ ...r, compatible_transponders: r.compatible_transponders ?? [], busy: r.busy ?? [] })));
});

router.get('/bookings', async (req, res) => {
  const client = isClient(req);
  const where = [];
  const params = [];
  if (client) { where.push('client_id = ?'); params.push(req.user.clientId); }
  if (req.query.status) { where.push('status IN (?)'); params.push(String(req.query.status).split(',')); }
  if (req.query.from) { where.push('end_ts >= ?'); params.push(toSqlDateTime(req.query.from, 'from')); }
  if (req.query.to) { where.push('start_ts < ?'); params.push(toSqlDateTime(req.query.to, 'to')); }
  if (!client) {
    if (req.query.satId) { where.push('sat_id = ?'); params.push(toInt(req.query.satId, 'satId')); }
    if (req.query.stationId) { where.push('station_id = ?'); params.push(toInt(req.query.stationId, 'stationId')); }
    if (req.query.clientId) { where.push('client_id = ?'); params.push(toInt(req.query.clientId, 'clientId')); }
  }
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const view = client ? 'v_client_bookings' : 'v_booking_details';
  const order = req.query.order === 'desc' ? 'DESC' : 'ASC';
  res.json(await query(
    `SELECT * FROM ${view} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY start_ts ${order} LIMIT ${limit}`,
    params,
  ));
});

router.post('/bookings', requireRole('admin', 'operator'), async (req, res) => {
  const b = req.body;
  requireFields(b, ['window_id', 'transponder_id', 'contract_id', 'start_ts', 'end_ts', 'purpose']);
  oneOf(b.purpose, PURPOSES, 'purpose');
  const bookingId = await asUser(req.user.id, (conn) =>
    callWithOutId(conn, 'sp_book_window', [
      toInt(b.window_id, 'window_id'), toInt(b.transponder_id, 'transponder_id'), toInt(b.contract_id, 'contract_id'),
      req.user.id, toSqlDateTime(b.start_ts, 'start_ts'), toSqlDateTime(b.end_ts, 'end_ts'), b.purpose,
    ]),
  );
  const [booking] = await query('SELECT * FROM v_booking_details WHERE booking_id = ?', [bookingId]);
  res.status(201).json(booking);
});

router.post('/bookings/:id/cancel', async (req, res) => {
  const id = toInt(req.params.id);
  if (isClient(req)) {
    const [own] = await query('SELECT 1 FROM v_client_bookings WHERE booking_id = ? AND client_id = ?', [id, req.user.clientId]);
    if (!own) throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
  }
  await asUser(req.user.id, (conn) => conn.query('CALL sp_cancel_booking(?)', [id]));
  const [booking] = await query('SELECT * FROM v_booking_details WHERE booking_id = ?', [id]);
  res.json(booking);
});

export default router;
