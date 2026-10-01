import { MongoClient } from 'mongodb';
import { config } from '../config.js';
import { HttpError } from '../middleware/errors.js';

let client;
let dbPromise;

export function mongoConfigured() {
  return Boolean(config.mongo.uri);
}

/** Lazily connected MongoDB handle. The API still runs (MySQL features) without it. */
export function getMongo() {
  if (!mongoConfigured()) {
    return Promise.reject(new HttpError(503, 'MONGO_UNAVAILABLE', 'MongoDB is not configured (set MONGODB_URI)'));
  }
  if (!dbPromise) {
    client = new MongoClient(config.mongo.uri, { serverSelectionTimeoutMS: 8000 });
    dbPromise = client.connect().then(() => client.db(config.mongo.db)).catch((err) => {
      dbPromise = null;
      throw new HttpError(503, 'MONGO_UNAVAILABLE', `MongoDB connection failed: ${err.message}`);
    });
  }
  return dbPromise;
}

export async function closeMongo() {
  if (client) await client.close();
}
