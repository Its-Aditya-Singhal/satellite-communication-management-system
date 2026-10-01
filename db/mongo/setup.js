// MongoDB collections, validators and indexes for SCMS.
// Called by server/scripts/init-db.js with a connected `db` handle.
// (No bare imports here: this file lives outside server/node_modules' reach.)

const DAY = 24 * 60 * 60;

export async function setupMongo(db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of ['telemetry', 'telemetry_hourly', 'alert_rules', 'anomalies', 'event_logs']) {
    if (existing.has(name)) await db.collection(name).drop();
  }

  // 1. Raw telemetry: native time-series collection, bucketed by satellite.
  //    Raw packets expire after 30 days; hourly roll-ups are kept.
  await db.createCollection('telemetry', {
    timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'seconds' },
    expireAfterSeconds: 30 * DAY,
  });
  await db.collection('telemetry').createIndex({ 'meta.satId': 1, ts: -1 });

  // 2. Hourly roll-ups written by $merge. _id = { satId, hour }.
  await db.createCollection('telemetry_hourly');
  await db.collection('telemetry_hourly').createIndex({ '_id.satId': 1, '_id.hour': -1 });
  await db.collection('telemetry_hourly').createIndex({ '_id.hour': -1 });

  // 3. Alert rules, with schema validation.
  await db.createCollection('alert_rules', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['scope', 'metric', 'op', 'threshold', 'severity'],
        properties: {
          scope: {
            bsonType: 'object',
            description: 'which satellites the rule applies to: {all}, {family}, {model} or {satId}',
            minProperties: 1,
          },
          metric: { bsonType: 'string', pattern: '^[A-Za-z0-9_.]+$' },
          op: { enum: ['>', '>=', '<', '<='] },
          threshold: { bsonType: ['double', 'int', 'long', 'decimal'] },
          severity: { enum: ['info', 'warning', 'critical'] },
          description: { bsonType: 'string' },
          enabled: { bsonType: 'bool' },
        },
      },
    },
    validationAction: 'error',
  });
  await db.collection('alert_rules').createIndex({ 'scope.family': 1 });

  // 4. Anomaly episodes, with schema validation and a status workflow.
  await db.createCollection('anomalies', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['satId', 'metric', 'severity', 'status', 'firstSeen'],
        properties: {
          satId: { bsonType: ['int', 'long'] },
          metric: { bsonType: 'string' },
          severity: { enum: ['info', 'warning', 'critical'] },
          status: { enum: ['open', 'acknowledged', 'resolved'] },
          firstSeen: { bsonType: 'date' },
          lastSeen: { bsonType: 'date' },
          occurrences: { bsonType: ['int', 'long'], minimum: 1 },
          history: { bsonType: 'array' },
        },
      },
    },
    validationAction: 'error',
  });
  await db.collection('anomalies').createIndex({ satId: 1, status: 1, lastSeen: -1 });
  await db.collection('anomalies').createIndex({ status: 1, severity: 1 });
  await db.collection('anomalies').createIndex({ firstSeen: -1 });

  // 5. Free-form operational event log (shape of `details` varies by type).
  await db.createCollection('event_logs');
  await db.collection('event_logs').createIndex({ satId: 1, ts: -1 });
  await db.collection('event_logs').createIndex({ type: 1, ts: -1 });
  await db.collection('event_logs').createIndex({ message: 'text' });

  console.log('Mongo  collections, validators and indexes ... ok');
}
