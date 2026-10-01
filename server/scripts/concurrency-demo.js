// Concurrency-control demonstration for the viva.
//
//  Part A: "check in the application, then insert" race.
//    Two sessions both run the overlap SELECT first (plain consistent reads
//    under REPEATABLE READ) and both conclude the slot is free. Application
//    code alone would now double-book. The second INSERT is still stopped,
//    because the overlap rule lives in the database (BEFORE INSERT trigger).
//
//  Part B: true simultaneous transactions through sp_book_window.
//    T1 holds the ground-station row lock (SELECT ... FOR UPDATE) with an
//    uncommitted booking. T2 calls the procedure for the same slot and BLOCKS
//    on that lock. When T1 commits, T2 resumes, sees the committed booking and
//    is rejected with STATION_CONFLICT: the transactions were serialised.
//
// Usage: npm run concurrency-demo
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

const connect = (user, password) => mysql.createConnection({
  host: config.mysql.host, port: config.mysql.port, database: config.mysql.database,
  user, password, dateStrings: true,
});
const app = () => connect(config.mysql.user, config.mysql.password);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t0 = Date.now();
const log = (who, msg) => console.log(`  [${String(Date.now() - t0).padStart(5)} ms] ${who.padEnd(3)} ${msg}`);

const OVERLAP_SQL = `SELECT COUNT(*) AS n FROM bookings
                      WHERE station_id = ? AND status <> 'cancelled' AND start_ts < ? AND end_ts > ?`;
const INSERT_SQL = `INSERT INTO bookings (window_id, sat_id, station_id, transponder_id, contract_id, booked_by, start_ts, end_ts, purpose)
                    VALUES (?, ?, ?, ?, ?, 2, ?, ?, 'telemetry')`;

async function findFreeWindow(conn, skipIds) {
  const [[w]] = await conn.query(
    `SELECT w.window_id, w.sat_id, w.station_id, w.aos_ts, w.los_ts, s.name AS satellite, g.code AS station,
            (SELECT MIN(t.transponder_id) FROM transponders t JOIN station_bands sb ON sb.band_id = t.band_id
              WHERE t.sat_id = w.sat_id AND sb.station_id = w.station_id AND t.status = 'active') AS tp
       FROM comm_windows w
       JOIN satellites s      ON s.sat_id = w.sat_id AND s.status = 'active'
       JOIN ground_stations g ON g.station_id = w.station_id AND g.status = 'online'
      WHERE w.aos_ts > NOW() + INTERVAL 2 DAY AND w.window_id NOT IN (?)
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.status <> 'cancelled'
                          AND (b.station_id = w.station_id OR b.sat_id = w.sat_id)
                          AND b.start_ts < w.los_ts AND b.end_ts > w.aos_ts)
      ORDER BY w.aos_ts LIMIT 1`,
    [skipIds.length ? skipIds : [0]],
  );
  return w;
}

async function partA(w) {
  console.log(`\nPart A: check-then-insert from application code  (${w.satellite} @ ${w.station}, ${w.aos_ts})`);
  t0 = Date.now();
  const [c1, c2] = await Promise.all([app(), app()]);
  try {
    await c1.query('START TRANSACTION'); await c2.query('START TRANSACTION');
    const [[a]] = await c1.query(OVERLAP_SQL, [w.station_id, w.los_ts, w.aos_ts]);
    log('T1', `SELECT overlapping bookings -> ${a.n} (slot looks free)`);
    const [[b]] = await c2.query(OVERLAP_SQL, [w.station_id, w.los_ts, w.aos_ts]);
    log('T2', `SELECT overlapping bookings -> ${b.n} (slot looks free too: race window)`);
    await c1.query(INSERT_SQL, [w.window_id, w.sat_id, w.station_id, w.tp, 1, w.aos_ts, w.los_ts]);
    await c1.query('COMMIT');
    log('T1', 'INSERT + COMMIT');
    try {
      await c2.query(INSERT_SQL, [w.window_id, w.sat_id, w.station_id, w.tp, 2, w.aos_ts, w.los_ts]);
      log('T2', 'INSERT succeeded: DOUBLE BOOKING');
      await c2.query('COMMIT');
    } catch (e) {
      log('T2', `INSERT rejected by trigger -> ${e.sqlMessage}`);
      await c2.query('ROLLBACK');
    }
    console.log('  => An application-side check alone is not enough; the trigger enforces the rule in the database.');
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
}

async function partB(w) {
  console.log(`\nPart B: concurrent sp_book_window calls  (${w.satellite} @ ${w.station}, ${w.aos_ts})`);
  t0 = Date.now();
  const [c1, c2] = await Promise.all([app(), app()]);
  try {
    // T1 performs the procedure's steps by hand so we can keep its transaction open
    await c1.query('START TRANSACTION');
    await c1.query('SELECT station_id FROM ground_stations WHERE station_id = ? FOR UPDATE', [w.station_id]);
    log('T1', 'BEGIN; SELECT ... FROM ground_stations FOR UPDATE   (row lock acquired)');
    await c1.query('SELECT sat_id FROM satellites WHERE sat_id = ? FOR UPDATE', [w.sat_id]);
    await c1.query(INSERT_SQL, [w.window_id, w.sat_id, w.station_id, w.tp, 1, w.aos_ts, w.los_ts]);
    log('T1', 'INSERT booking (not committed yet)');

    log('T2', 'CALL sp_book_window(...) for the same slot');
    const started = Date.now();
    const t2 = c2.query('CALL sp_book_window(?, ?, 2, 2, ?, ?, ?, @id)', [w.window_id, w.tp, w.aos_ts, w.los_ts, 'command'])
      .then(() => log('T2', 'booked: DOUBLE BOOKING'))
      .catch((e) => log('T2', `resumed after ${Date.now() - started} ms -> ${e.sqlMessage}`));

    await sleep(2000);
    log('T1', 'COMMIT   (T2 has been waiting on the lock all this time)');
    await c1.query('COMMIT');
    await t2;
    const [[{ n }]] = await c1.query(`SELECT COUNT(*) AS n FROM bookings WHERE window_id = ? AND status <> 'cancelled'`, [w.window_id]);
    console.log(`  => ${n} booking in the slot: the row lock serialised the two transactions.`);
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
}

const root = await connect(config.mysql.adminUser, config.mysql.adminPassword);
try {
  const wa = await findFreeWindow(root, []);
  const wb = wa && await findFreeWindow(root, [wa.window_id]);
  if (!wa || !wb) throw new Error('No free future windows found; re-run npm run init-db');
  await partA(wa);
  await partB(wb);
  // remove the demo rows (the app account has no DELETE privilege on bookings)
  await root.query('DELETE FROM bookings WHERE window_id IN (?, ?)', [wa.window_id, wb.window_id]);
  console.log('\nDemo bookings removed.');
} catch (e) {
  console.error(e.sqlMessage || e.message);
  process.exitCode = 1;
} finally {
  await root.end();
}
