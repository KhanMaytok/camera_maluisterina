import type { FastifyInstance, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { AppError, notFound } from '../errors.js';
import { presignGet, safeDeleteObject } from '../storage.js';
import type { EventRow } from '../types.js';

export function eventRoutes(app: FastifyInstance, db: Database.Database): void {
  const auth = requireAuth(db);

  app.get('/api/events', { preHandler: auth }, async (request) => {
    const user = (request as typeof request & { user: { id: number } }).user;
    const query = request.query as {
      camera_id?: string;
      from?: string;
      to?: string;
      kind?: string;
      page?: string;
      page_size?: string;
    };
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size ?? 20)));
    const conditions: string[] = ['c.id = e.camera_id', 'c.user_id = ?'];
    const params: unknown[] = [user.id];
    if (query.camera_id) {
      conditions.push('e.camera_id = ?');
      params.push(query.camera_id);
    }
    if (query.kind) {
      conditions.push('e.kind = ?');
      params.push(query.kind);
    }
    if (query.from) {
      conditions.push('e.started_at >= ?');
      params.push(new Date(query.from).toISOString());
    }
    if (query.to) {
      conditions.push('e.started_at <= ?');
      params.push(new Date(query.to).toISOString());
    }
    const where = conditions.join(' AND ');
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM events e JOIN cameras c ON ${where}`)
        .get(...params) as { n: number }
    ).n;
    const items = db
      .prepare(
        `SELECT e.* FROM events e JOIN cameras c ON ${where}
         ORDER BY e.started_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as EventRow[];
    return { items, page, page_size: pageSize, total };
  });

  app.get('/api/events/:id', { preHandler: auth }, async (request) => {
    const user = (request as typeof request & { user: { id: number } }).user;
    const { id } = request.params as { id: string };
    const event = db
      .prepare(
        'SELECT e.* FROM events e JOIN cameras c ON c.id = e.camera_id WHERE e.id = ? AND c.user_id = ?',
      )
      .get(id, user.id) as EventRow | undefined;
    if (!event) throw notFound();
    return event;
  });

  app.get('/api/events/:id/video', { preHandler: auth }, async (request, reply) => {
    const event = await getOwnedEvent(request, db);
    if (!event.video_key) throw new AppError(404, 'NO_VIDEO', 'El evento no tiene video');
    return reply.redirect(await mediaUrl(request, event.video_key));
  });

  app.get('/api/events/:id/thumbnail', { preHandler: auth }, async (request, reply) => {
    const event = await getOwnedEvent(request, db);
    if (!event.thumb_key) throw new AppError(404, 'NO_THUMBNAIL', 'El evento no tiene thumbnail');
    return reply.redirect(await mediaUrl(request, event.thumb_key));
  });

  app.delete('/api/events/:id', { preHandler: auth }, async (request, reply) => {
    const event = await getOwnedEvent(request, db);
    if (event.thumb_key) safeDeleteObject(event.thumb_key);
    if (event.video_key) safeDeleteObject(event.video_key);
    db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
    reply.send({ ok: true });
  });
}

async function mediaUrl(request: FastifyRequest, key: string): Promise<string> {
  if (config.storage.enabled) return presignGet(key);
  const token = encodeURIComponent(request.headers.authorization?.slice(7) ?? '');
  return `${config.publicBaseUrl}/api/uploads/dev/${encodeURIComponent(key)}?token=${token}`;
}

async function getOwnedEvent(request: FastifyRequest, db: Database.Database): Promise<EventRow> {
  const user = (request as typeof request & { user: { id: number } }).user;
  const { id } = request.params as { id: string };
  const event = db
    .prepare(
      'SELECT e.* FROM events e JOIN cameras c ON c.id = e.camera_id WHERE e.id = ? AND c.user_id = ?',
    )
    .get(id, user.id) as EventRow | undefined;
  if (!event) throw notFound();
  return event;
}
