import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.user_id, role: user.role, clientId: user.client_id, name: user.full_name },
    config.jwtSecret,
    { expiresIn: '12h' },
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'UNAUTHENTICATED', 'Login required'));
  try {
    const p = jwt.verify(token, config.jwtSecret);
    req.user = { id: p.sub, role: p.role, clientId: p.clientId, name: p.name };
    next();
  } catch {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Session expired, please log in again'));
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role)
    ? next()
    : next(new HttpError(403, 'FORBIDDEN', `Requires role: ${roles.join(' or ')}`));

export const isClient = (req) => req.user?.role === 'client';
export const isStaff = (req) => req.user?.role === 'admin' || req.user?.role === 'operator';
