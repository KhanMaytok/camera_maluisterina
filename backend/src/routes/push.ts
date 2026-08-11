import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth.js';
import { ensureVapid, subscribeDevice } from '../push.js';
import { AppError } from '../errors.js';

export function pushRoutes(app: FastifyInstance, db: Database.Database): void {
  const auth = requireAuth(db);

  app.get('/api/push/vapid-public-key', { preHandler: auth }, async () => ({
    public_key: ensureVapid().publicKey,
  }));

  app.post('/api/push/subscribe', { preHandler: auth }, async (request, reply) => {
    const user = (request as typeof request & { user: { id: number } }).user;
    const body = request.body as {
      name?: string;
      push_data?: { endpoint: string; keys: { p256dh: string; auth: string } };
    };
    if (!body.push_data?.endpoint || !body.push_data.keys) {
      throw new AppError(400, 'VALIDATION', 'push_data con endpoint y keys requerido');
    }
    subscribeDevice(db, user.id, 'viewer', body.name, body.push_data);
    reply.send({ ok: true });
  });
}
