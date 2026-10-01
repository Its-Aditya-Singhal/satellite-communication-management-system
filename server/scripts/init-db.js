// Builds both databases from scratch:
//   1. runs db/mysql/01..08_*.sql in order (as the MySQL admin user)
//   2. runs db/mongo/setup.js and db/mongo/seed.js against Atlas
// Usage:  npm run init-db            (both)
//         npm run init-db -- --mysql (MySQL only)
//         npm run init-db -- --mongo (MongoDB only)
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

const args = process.argv.slice(2);
const runMysql = !args.includes('--mongo');
const runMongo = !args.includes('--mysql');

// The mysql CLI understands DELIMITER; drivers do not, so split here.
function splitSql(sql) {
  const statements = [];
  let delimiter = ';';
  let buffer = '';
  for (const line of sql.split('\n')) {
    const d = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (d) { delimiter = d[1]; continue; }
    buffer += line + '\n';
    if (buffer.trimEnd().endsWith(delimiter)) {
      const stmt = buffer.trimEnd().slice(0, -delimiter.length).trim();
      if (stmt.replace(/--.*$/gm, '').trim()) statements.push(stmt);
      buffer = '';
    }
  }
  if (buffer.replace(/--.*$/gm, '').trim()) statements.push(buffer.trim());
  return statements;
}

async function initMysql() {
  const dir = path.join(config.rootDir, 'db', 'mysql');
  const files = fs.readdirSync(dir).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort();
  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.adminUser,
    password: config.mysql.adminPassword,
    dateStrings: true,
  });
  try {
    for (const file of files) {
      const statements = splitSql(fs.readFileSync(path.join(dir, file), 'utf8'));
      process.stdout.write(`MySQL  ${file.padEnd(22)} ${String(statements.length).padStart(3)} statements ... `);
      for (const stmt of statements) {
        const [result] = await conn.query(stmt);
        // surface the seed procedure's summary row
        if (Array.isArray(result) && Array.isArray(result[0]) && result[0][0]?.bookings_created !== undefined) {
          process.stdout.write(`\n       seed: ${JSON.stringify(result[0][0])}\n       `);
        }
      }
      console.log('ok');
    }
  } finally {
    await conn.end();
  }
}

const appConnectionOptions = () => ({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
});

async function initMongo() {
  if (!config.mongo.uri) {
    console.log('MongoDB skipped: set MONGODB_URI in server/.env');
    return;
  }
  const { setupMongo } = await import('../../db/mongo/setup.js');
  const { seedMongo } = await import('../../db/mongo/seed.js');
  const { MongoClient } = await import('mongodb');
  // satellite ids/models come from MySQL so both stores share the same keys
  const conn = await mysql.createConnection({ ...appConnectionOptions() });
  const [satellites] = await conn.query(
    `SELECT s.sat_id, s.name, s.model, s.orbit_type, s.status, o.period_min + 0 AS period_min, o.altitude_km + 0 AS altitude_km
       FROM satellites s JOIN orbits o USING (sat_id)`,
  );
  await conn.end();

  const client = new MongoClient(config.mongo.uri);
  await client.connect();
  try {
    const db = client.db(config.mongo.db);
    await setupMongo(db);
    await seedMongo(db, satellites);
  } finally {
    await client.close();
  }
}

try {
  if (runMysql) await initMysql();
  if (runMongo) await initMongo();
  console.log('Done.');
} catch (err) {
  console.error('\nInit failed:', err.sqlMessage || err.message);
  process.exit(1);
}
