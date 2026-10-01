// Contracts, bandwidth allocations and invoices.
import { Router } from 'express';
import { query, asUser, callWithOutId } from '../db/mysql.js';
import { requireRole, isClient } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { requireFields, toInt, toSqlDate, toSqlDateTime, oneOf, pickDefined } from '../util.js';

const router = Router();
const staff = requireRole('admin', 'operator');

// ---------------------------------------------------------------- contracts
router.get('/contracts', async (req, res) => {
  const client = isClient(req);
  res.json(await query(
    `SELECT c.*, cl.name AS client,
            DATEDIFF(c.end_date, CURDATE())                                         AS days_remaining,
            (SELECT COUNT(*) FROM bookings b WHERE b.contract_id = c.contract_id AND b.status <> 'cancelled') AS sessions,
            (SELECT COALESCE(SUM(a.allocated_mhz), 0) FROM bandwidth_allocations a
              WHERE a.contract_id = c.contract_id AND a.status = 'active'
                AND a.start_ts <= NOW() AND a.end_ts > NOW())                       AS leased_mhz_now,
            (SELECT COALESCE(SUM(i.amount), 0) FROM invoices i WHERE i.contract_id = c.contract_id) AS billed
       FROM contracts c JOIN clients cl ON cl.client_id = c.client_id
      ${client ? 'WHERE c.client_id = ?' : ''}
      ORDER BY c.status = 'active' DESC, c.start_date DESC`,
    client ? [req.user.clientId] : [],
  ));
});

router.post('/contracts', staff, async (req, res) => {
  const b = req.body;
  requireFields(b, ['client_id', 'start_date', 'end_date', 'rate_per_mhz_hour', 'rate_per_pass_min']);
  const clientId = toInt(b.client_id, 'client_id');
  const id = await asUser(req.user.id, async (conn) => {
    // contract code: <first 3 letters of client>-<year>-<sequence for that client>
    const [[c]] = await conn.query(
      `SELECT UPPER(LEFT(REPLACE(name, ' ', ''), 3)) AS prefix,
              (SELECT COUNT(*) + 1 FROM contracts WHERE client_id = ?) AS seq
         FROM clients WHERE client_id = ?`,
      [clientId, clientId],
    );
    if (!c) throw new HttpError(422, 'INVALID_REFERENCE', 'Client does not exist');
    const start = toSqlDate(b.start_date, 'start_date');
    const code = `${c.prefix}-${start.slice(0, 4)}-${String(c.seq).padStart(2, '0')}`;
    const [r] = await conn.query(
      `INSERT INTO contracts (client_id, contract_code, start_date, end_date, rate_per_mhz_hour, rate_per_pass_min, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [clientId, code, start, toSqlDate(b.end_date, 'end_date'), b.rate_per_mhz_hour, b.rate_per_pass_min, b.status || 'active'],
    );
    return r.insertId;
  });
  res.status(201).json({ contract_id: id });
});

router.patch('/contracts/:id', staff, async (req, res) => {
  const id = toInt(req.params.id);
  const fields = pickDefined(req.body, ['status', 'end_date', 'rate_per_mhz_hour', 'rate_per_pass_min']);
  if (fields.status) oneOf(fields.status, ['draft', 'active', 'expired', 'terminated'], 'status');
  if (fields.end_date) fields.end_date = toSqlDate(fields.end_date, 'end_date');
  if (!Object.keys(fields).length) throw new HttpError(400, 'NOTHING_TO_UPDATE', 'No updatable fields supplied');
  const r = await asUser(req.user.id, (conn) => conn.query('UPDATE contracts SET ? WHERE contract_id = ?', [fields, id]));
  if (!r[0].affectedRows) throw new HttpError(404, 'NOT_FOUND', 'Contract not found');
  res.json({ contract_id: id, ...fields });
});

// -------------------------------------------------------------- allocations
router.get('/allocations', async (req, res) => {
  const where = [];
  const params = [];
  if (isClient(req)) { where.push('c.client_id = ?'); params.push(req.user.clientId); }
  if (req.query.transponderId) { where.push('a.transponder_id = ?'); params.push(toInt(req.query.transponderId)); }
  if (req.query.contractId) { where.push('a.contract_id = ?'); params.push(toInt(req.query.contractId)); }
  if (req.query.status) { where.push('a.status = ?'); params.push(req.query.status); }
  res.json(await query(
    `SELECT a.*, c.contract_code, cl.client_id, cl.name AS client,
            t.label AS transponder, t.bandwidth_mhz, fb.code AS band, s.sat_id, s.name AS satellite,
            ROUND(a.allocated_mhz * TIMESTAMPDIFF(MINUTE, a.start_ts, a.end_ts) / 60, 1) AS mhz_hours
       FROM bandwidth_allocations a
       JOIN contracts c        ON c.contract_id = a.contract_id
       JOIN clients cl         ON cl.client_id = c.client_id
       JOIN transponders t     ON t.transponder_id = a.transponder_id
       JOIN frequency_bands fb ON fb.band_id = t.band_id
       JOIN satellites s       ON s.sat_id = t.sat_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.status, s.name, t.label, a.start_ts`,
    params,
  ));
});

router.get('/transponders', async (req, res) => {
  const where = req.query.satId ? 'WHERE sat_id = ?' : '';
  res.json(await query(`SELECT * FROM v_transponder_utilization ${where} ORDER BY satellite, label`,
    req.query.satId ? [toInt(req.query.satId)] : []));
});

router.post('/allocations', staff, async (req, res) => {
  const b = req.body;
  requireFields(b, ['contract_id', 'transponder_id', 'allocated_mhz', 'start_ts', 'end_ts']);
  const id = await asUser(req.user.id, (conn) =>
    callWithOutId(conn, 'sp_allocate_bandwidth', [
      toInt(b.contract_id, 'contract_id'), toInt(b.transponder_id, 'transponder_id'), Number(b.allocated_mhz),
      toSqlDateTime(b.start_ts, 'start_ts'), toSqlDateTime(b.end_ts, 'end_ts'),
    ]),
  );
  res.status(201).json({ allocation_id: id });
});

router.post('/allocations/:id/release', staff, async (req, res) => {
  const id = toInt(req.params.id);
  const [r] = await asUser(req.user.id, (conn) =>
    conn.query(`UPDATE bandwidth_allocations SET status = 'released' WHERE allocation_id = ? AND status = 'active'`, [id]));
  if (!r.affectedRows) throw new HttpError(409, 'INVALID_STATE', 'Allocation is not active');
  res.json({ allocation_id: id, status: 'released' });
});

// ----------------------------------------------------------------- invoices
router.get('/invoices', async (req, res) => {
  const client = isClient(req);
  res.json(await query(
    `SELECT i.*, c.contract_code, cl.client_id, cl.name AS client, c.rate_per_mhz_hour, c.rate_per_pass_min
       FROM invoices i
       JOIN contracts c ON c.contract_id = i.contract_id
       JOIN clients cl  ON cl.client_id = c.client_id
      ${client ? 'WHERE cl.client_id = ?' : ''}
      ORDER BY i.period_end DESC, cl.name`,
    client ? [req.user.clientId] : [],
  ));
});

router.post('/invoices/generate', staff, async (req, res) => {
  requireFields(req.body, ['contract_id', 'period_start', 'period_end']);
  const id = await asUser(req.user.id, (conn) =>
    callWithOutId(conn, 'sp_generate_invoice', [
      toInt(req.body.contract_id, 'contract_id'),
      toSqlDate(req.body.period_start, 'period_start'),
      toSqlDate(req.body.period_end, 'period_end'),
    ]),
  );
  const [invoice] = await query('SELECT * FROM invoices WHERE invoice_id = ?', [id]);
  res.status(201).json(invoice);
});

router.patch('/invoices/:id', staff, async (req, res) => {
  oneOf(req.body.status, ['issued', 'paid', 'overdue'], 'status');
  const r = await query('UPDATE invoices SET status = ? WHERE invoice_id = ?', [req.body.status, toInt(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  res.json({ invoice_id: Number(req.params.id), status: req.body.status });
});

export default router;
