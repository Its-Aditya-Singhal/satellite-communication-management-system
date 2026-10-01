export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Business-rule codes raised by our procedures/triggers via SIGNAL '45000'.
const SIGNAL_STATUS = {
  NOT_FOUND: 404,
  STATION_CONFLICT: 409,
  SATELLITE_CONFLICT: 409,
  CAPACITY_EXCEEDED: 409,
  INVALID_STATE: 409,
};

// Translate MySQL errors into meaningful HTTP responses.
function fromMysql(err) {
  if (err.sqlState === '45000') {
    const m = String(err.sqlMessage).match(/^([A-Z_]+):\s*(.*)$/);
    const code = m ? m[1] : 'RULE_VIOLATION';
    return new HttpError(SIGNAL_STATUS[code] || 422, code, m ? m[2] : err.sqlMessage);
  }
  switch (err.code) {
    case 'ER_DUP_ENTRY':
      return new HttpError(409, 'DUPLICATE', err.sqlMessage);
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return new HttpError(422, 'CHECK_VIOLATION', err.sqlMessage);
    case 'ER_NO_REFERENCED_ROW_2':
      return new HttpError(422, 'INVALID_REFERENCE', 'A referenced record does not exist');
    case 'ER_ROW_IS_REFERENCED_2':
      return new HttpError(409, 'IN_USE', 'Record is referenced by other data and cannot be deleted');
    case 'ER_TRUNCATED_WRONG_VALUE':
    case 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD':
    case 'WARN_DATA_TRUNCATED':
    case 'ER_BAD_NULL_ERROR':
      return new HttpError(422, 'INVALID_VALUE', err.sqlMessage);
    default:
      return null;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const e = err instanceof HttpError ? err : (err.sqlState || err.sqlMessage ? fromMysql(err) : null);
  if (e) {
    return res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error' } });
}
