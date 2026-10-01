// Reference data and account administration: bands, clients, users.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/mysql.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { requireFields, oneOf } from '../util.js';

const router = Router();

router.get('/bands', async (req, res) => {
  res.json(await query(
    `SELECT fb.*, (SELECT COUNT(*) FROM transponders t WHERE t.band_id = fb.band_id) AS transponders,
            (SELECT COUNT(*) FROM station_bands sb WHERE sb.band_id = fb.band_id) AS stations
       FROM frequency_bands fb ORDER BY min_mhz`,
  ));
});

router.get('/clients', requireRole('admin', 'operator'), async (req, res) => {
  res.json(await query(
    `SELECT cl.*, r.contracts, r.total_billed, r.outstanding,
            (SELECT COUNT(*) FROM contracts c WHERE c.client_id = cl.client_id AND c.status = 'active') AS active_contracts
       FROM clients cl JOIN v_revenue_by_client r ON r.client_id = cl.client_id
      ORDER BY cl.name`,
  ));
});

router.post('/clients', requireRole('admin'), async (req, res) => {
  requireFields(req.body, ['name', 'org_type', 'country', 'contact_email']);
  oneOf(req.body.org_type, ['government', 'commercial', 'research', 'defense', 'ngo'], 'org_type');
  const r = await query(
    'INSERT INTO clients (name, org_type, country, contact_email) VALUES (?, ?, ?, ?)',
    [req.body.name, req.body.org_type, req.body.country, req.body.contact_email],
  );
  res.status(201).json({ client_id: r.insertId });
});

router.get('/users', requireRole('admin'), async (req, res) => {
  res.json(await query(
    `SELECT u.user_id, u.full_name, u.email, u.role, u.client_id, c.name AS client_name, u.is_active, u.created_at
       FROM users u LEFT JOIN clients c ON c.client_id = u.client_id ORDER BY u.role, u.full_name`,
  ));
});

router.post('/users', requireRole('admin'), async (req, res) => {
  const b = req.body;
  requireFields(b, ['full_name', 'email', 'password', 'role']);
  oneOf(b.role, ['admin', 'operator', 'client'], 'role');
  if (String(b.password).length < 8) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters');
  const r = await query(
    'INSERT INTO users (full_name, email, password_hash, role, client_id) VALUES (?, ?, ?, ?, ?)',
    [b.full_name, String(b.email).toLowerCase(), await bcrypt.hash(String(b.password), 10), b.role,
      b.role === 'client' ? b.client_id : null],
  );
  res.status(201).json({ user_id: r.insertId });
});

router.patch('/users/:id', requireRole('admin'), async (req, res) => {
  if (Number(req.params.id) === req.user.id && req.body.is_active === false) {
    throw new HttpError(409, 'INVALID_STATE', 'You cannot deactivate your own account');
  }
  await query('UPDATE users SET is_active = ? WHERE user_id = ?', [Boolean(req.body.is_active), req.params.id]);
  res.json({ user_id: Number(req.params.id), is_active: Boolean(req.body.is_active) });
});

export default router;
