import { HttpError } from './middleware/errors.js';

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === '');
  if (missing.length) throw new HttpError(400, 'MISSING_FIELDS', `Missing required field(s): ${missing.join(', ')}`);
}

/** Accepts 'YYYY-MM-DD HH:MM[:SS]' or 'YYYY-MM-DDTHH:MM[:SS]' (local time) → MySQL DATETIME string. */
export function toSqlDateTime(value, field = 'datetime') {
  const m = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/);
  if (!m) throw new HttpError(400, 'INVALID_DATETIME', `${field} must look like YYYY-MM-DD HH:MM`);
  return `${m[1]} ${m[2]}${m[3] || ':00'}`;
}

export function toSqlDate(value, field = 'date') {
  const m = String(value ?? '').match(/^\d{4}-\d{2}-\d{2}/);
  if (!m) throw new HttpError(400, 'INVALID_DATE', `${field} must look like YYYY-MM-DD`);
  return m[0];
}

export function toInt(value, field = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'INVALID_ID', `${field} must be a positive integer`);
  return n;
}

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new HttpError(400, 'INVALID_VALUE', `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

export const pickDefined = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
