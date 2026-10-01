import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(serverDir, '.env'), quiet: true });

const env = process.env;

export const config = {
  rootDir: path.resolve(serverDir, '..'),
  port: Number(env.PORT || 4000),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret',
  clientOrigin: env.CLIENT_ORIGIN || 'http://localhost:5173',
  mysql: {
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    database: env.MYSQL_DATABASE || 'scms',
    user: env.MYSQL_USER || 'scms_app',
    password: env.MYSQL_PASSWORD || 'scms_app_pw',
    adminUser: env.MYSQL_ADMIN_USER || 'root',
    adminPassword: env.MYSQL_ADMIN_PASSWORD || '',
  },
  mongo: {
    uri: env.MONGODB_URI || '',
    db: env.MONGODB_DB || 'scms',
  },
};
