import { Router } from 'express';
import { query } from '../db/mysql.js';

const router = Router();

router.get('/', async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.table) { where.push('a.table_name = ?'); params.push(req.query.table); }
  if (req.query.action) { where.push('a.action = ?'); params.push(req.query.action); }
  if (req.query.recordId) { where.push('a.record_id = ?'); params.push(Number(req.query.recordId)); }
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(await query(
    `SELECT a.audit_id, a.table_name, a.action, a.record_id, a.old_values, a.new_values,
            a.changed_at, a.changed_by, u.full_name AS changed_by_name
       FROM audit_log a LEFT JOIN users u ON u.user_id = a.changed_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.audit_id DESC LIMIT ${limit}`,
    params,
  ));
});

export default router;
