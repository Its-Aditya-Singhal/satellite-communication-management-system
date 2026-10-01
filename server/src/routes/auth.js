import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/mysql.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { requireFields } from '../util.js';

const router = Router();

router.post('/login', async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const [user] = await query(
    `SELECT u.user_id, u.full_name, u.email, u.password_hash, u.role, u.client_id, u.is_active, c.name AS client_name
       FROM users u LEFT JOIN clients c ON c.client_id = u.client_id
      WHERE u.email = ?`,
    [String(req.body.email).trim().toLowerCase()],
  );
  if (!user || !user.is_active || !(await bcrypt.compare(String(req.body.password), user.password_hash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  const { password_hash, ...safe } = user;
  res.json({ token: signToken(user), user: safe });
});

router.get('/me', requireAuth, async (req, res) => {
  const [user] = await query(
    `SELECT u.user_id, u.full_name, u.email, u.role, u.client_id, c.name AS client_name
       FROM users u LEFT JOIN clients c ON c.client_id = u.client_id WHERE u.user_id = ?`,
    [req.user.id],
  );
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'User no longer exists');
  res.json(user);
});

export default router;
