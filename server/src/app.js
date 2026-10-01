import { pathToFileURL } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db/mysql.js';
import { mongoConfigured, getMongo, closeMongo } from './db/mongo.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import satelliteRoutes from './routes/satellites.js';
import stationRoutes from './routes/stations.js';
import catalogRoutes from './routes/catalog.js';
import schedulingRoutes from './routes/scheduling.js';
import commercialRoutes from './routes/commercial.js';
import monitoringRoutes from './routes/monitoring.js';
import reportRoutes from './routes/reports.js';
import auditRoutes from './routes/audit.js';

export const app = express();
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (req, res) => {
  const status = { mysql: 'down', mongo: mongoConfigured() ? 'down' : 'not configured' };
  try { await pool.query('SELECT 1'); status.mysql = 'up'; } catch { /* reported below */ }
  if (mongoConfigured()) {
    try { await (await getMongo()).command({ ping: 1 }); status.mongo = 'up'; } catch { /* reported below */ }
  }
  res.status(status.mysql === 'up' ? 200 : 503).json(status);
});

app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.use('/api/satellites', satelliteRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api', catalogRoutes);
app.use('/api', schedulingRoutes);
app.use('/api', commercialRoutes);
app.use('/api', monitoringRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', requireRole('admin'), auditRoutes);

app.use('/api', notFound);
app.use(errorHandler);

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const server = app.listen(config.port, () => {
    console.log(`SCMS API listening on http://localhost:${config.port}`);
    if (!mongoConfigured()) console.log('MongoDB not configured: telemetry/anomaly endpoints will return 503');
  });
  const shutdown = async () => {
    server.close();
    await Promise.allSettled([pool.end(), closeMongo()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
