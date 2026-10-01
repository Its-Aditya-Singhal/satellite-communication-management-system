import mysql from 'mysql2/promise';
import { config } from '../config.js';

// DATETIMEs are kept as 'YYYY-MM-DD HH:MM:SS' strings end to end (server and
// DB share a timezone), which avoids silent UTC shifts in the driver.
export const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  connectionLimit: 10,
  dateStrings: true,
  decimalNumbers: true,
});

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Run work on a dedicated connection with @app_user_id set, so the audit
 * triggers record which application user made the change.
 */
export async function asUser(userId, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @app_user_id = ?', [userId ?? null]);
    return await fn(conn);
  } finally {
    await conn.query('SET @app_user_id = NULL').catch(() => {});
    conn.release();
  }
}

/** CALL a procedure whose last parameter is an OUT id; returns that id. */
export async function callWithOutId(conn, procName, inParams) {
  const placeholders = inParams.map(() => '?').join(', ');
  await conn.query(`CALL ${procName}(${placeholders}, @out_id)`, inParams);
  const [[row]] = await conn.query('SELECT @out_id AS id');
  return row.id;
}
