// Connections to BOTH databases + small shared helpers
const mysql = require('mysql2/promise');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

// ---------- SQL: MySQL ----------
const sql = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',          // put your MySQL password here if you have one
  database: 'scms',
  dateStrings: true,
});

// ---------- NoSQL: MongoDB ----------
const mongoClient = new MongoClient('mongodb://127.0.0.1:27017');
const mongo = mongoClient.db('scms');

// MongoDB collections (documents, no fixed schema):
//   profiles  - extra details of each user, different fields per role
//   details   - technical details of satellites AND stations (two shapes, one collection)
//   requests  - approval workflow: who asked, what, status history (array)
//   sessions  - login tokens, auto-deleted after 8 hours by a TTL index
//   activity  - log of everything users do
async function connectMongo() {
  await mongoClient.connect();
  await mongo.collection('sessions').createIndex({ created_at: 1 }, { expireAfterSeconds: 8 * 60 * 60 }); // TTL
  await mongo.collection('sessions').createIndex({ token: 1 }, { unique: true });
  await mongo.collection('profiles').createIndex({ user_id: 1 }, { unique: true });
  await mongo.collection('details').createIndex({ kind: 1, ref_id: 1 }, { unique: true });
  await mongo.collection('requests').createIndex({ status: 1, created_at: -1 });
}

// ---------- password hashing (built-in crypto, no extra library) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}
function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.scryptSync(password, salt, 64).toString('hex') === hash;
}

// write one line to the activity log (MongoDB)
function log(user, action) {
  return mongo.collection('activity').insertOne({
    user_id: user.user_id, name: user.name, role: user.role, action, at: new Date(),
  });
}

module.exports = { sql, mongo, mongoClient, connectMongo, hashPassword, checkPassword, log };
