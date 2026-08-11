import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { migrate, openDatabase } from './db.js';
import { errorHandler } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { cameraRoutes } from './routes/cameras.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';
import { pushRoutes } from './routes/push.js';
import { uploadRoutes } from './routes/uploads.js';
import { signalingRoutes } from './ws/signaling.js';

export interface AppHandle {
  app: ReturnType<typeof Fastify>;
  db: ReturnType<typeof openDatabase>;
}

export async function buildApp(opts: { databasePath?: string } = {}): Promise<AppHandle> {
  const db = openDatabase(opts.databasePath ?? config.databasePath);
  migrate(db);

  const app = Fastify({ bodyLimit: 100 * 1024 * 1024, logger: false });
  app.setErrorHandler(errorHandler);

  await app.register(cors, {
    origin:
      config.corsOrigins.length === 1 && config.corsOrigins[0] === '*' ? true : config.corsOrigins,
  });
  await app.register(rateLimit, { global: false, max: 60, timeWindow: '1 minute' });
  await app.register(websocket);

  healthRoutes(app, db);
  authRoutes(app, db);
  cameraRoutes(app, db);
  eventRoutes(app, db);
  uploadRoutes(app, db);
  pushRoutes(app, db);
  signalingRoutes(app, db);

  app.addHook('onClose', () => db.close());
  return { app, db };
}
