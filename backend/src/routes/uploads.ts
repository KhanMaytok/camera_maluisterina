import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { requireCamera, verifyAccess } from '../auth.js';
import { config } from '../config.js';
import { nowIso } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { notifyEvent } from '../push.js';
import {
  clipKey,
  devMediaDelete,
  devMediaExists,
  devMediaPath,
  devMediaSave,
  newEventId,
  presignPut,
  snapshotKey,
  thumbKey,
} from '../storage.js';
import type { EventRow } from '../types.js';

export function uploadRoutes(app: FastifyInstance, db: Database.Database): void {
  const cameraAuth = requireCamera(db);

  app.addContentTypeParser(
    ['video/mp4', 'image/jpeg', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.post('/api/uploads/presign', { preHandler: cameraAuth }, async (request) => {
    const cameraId = (request as typeof request & { cameraId: string }).cameraId;
    const body = request.body as {
      kind?: 'clip' | 'snapshot';
      started_at?: string;
      ended_at?: string;
      duration_sec?: number;
      motion_level?: number;
      content_type?: string;
    };
    const kind = body.kind === 'snapshot' ? 'snapshot' : 'clip';
    const started = body.started_at ? new Date(body.started_at).toISOString() : nowIso();
    const ended = body.ended_at ? new Date(body.ended_at).toISOString() : started;
    const eventId = newEventId();
    const videoKey = kind === 'clip' ? clipKey(cameraId, eventId) : null;
    const thumb = kind === 'clip' ? thumbKey(cameraId, eventId) : snapshotKey(cameraId, eventId);
    db.prepare(
      `INSERT INTO events (id, camera_id, kind, started_at, ended_at, duration_sec, motion_level, thumb_key, video_key, upload_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      eventId,
      cameraId,
      kind,
      started,
      ended,
      Math.max(0, Math.round(body.duration_sec ?? 0)),
      Math.min(1, Math.max(0, body.motion_level ?? 0)),
      thumb,
      videoKey,
      nowIso(),
    );
    const dev = !config.storage.enabled;
    const video = videoKey
      ? {
          key: videoKey,
          put_url: dev
            ? `${config.publicBaseUrl}/api/uploads/dev/${encodeURIComponent(videoKey)}`
            : await presignPut(videoKey, body.content_type ?? 'video/mp4'),
        }
      : null;
    const thumbnail = {
      key: thumb,
      put_url: dev
        ? `${config.publicBaseUrl}/api/uploads/dev/${encodeURIComponent(thumb)}`
        : await presignPut(thumb, 'image/jpeg'),
    };
    return { event_id: eventId, kind, video, thumbnail };
  });

  app.post('/api/uploads/complete', { preHandler: cameraAuth }, async (request, reply) => {
    const cameraId = (request as typeof request & { cameraId: string }).cameraId;
    const { event_id, size_bytes } = request.body as { event_id?: string; size_bytes?: number };
    if (!event_id) throw new AppError(400, 'VALIDATION', 'event_id requerido');
    const row = db
      .prepare("SELECT * FROM events WHERE id = ? AND camera_id = ? AND upload_status = 'pending'")
      .get(event_id, cameraId) as EventRow | undefined;
    if (!row) throw notFound();
    db.prepare("UPDATE events SET upload_status = 'uploaded', size_bytes = ? WHERE id = ?").run(
      Math.max(0, Math.round(size_bytes ?? 0)),
      event_id,
    );
    await notifyEvent(db, { id: row.id, camera_id: cameraId, thumb_key: row.thumb_key });
    reply.send({ ok: true });
  });

  app.put('/api/uploads/dev/*', { preHandler: cameraAuth }, async (request, reply) => {
    const key = decodeURIComponent((request.params as { '*': string })['*']);
    if (!key.includes('/')) throw new AppError(400, 'VALIDATION', 'Clave inválida');
    devMediaSave(key, request.body as Buffer);
    reply.send({ ok: true });
  });

  app.get('/api/uploads/dev/*', async (request, reply) => {
    const token = (request.query as { token?: string }).token;
    if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Falta token');
    verifyAccess(token);
    const key = decodeURIComponent((request.params as { '*': string })['*']);
    if (!devMediaExists(key)) throw notFound();
    const ext = key.endsWith('.jpg')
      ? 'image/jpeg'
      : key.endsWith('.mp4')
        ? 'video/mp4'
        : 'application/octet-stream';
    reply.type(ext);
    return createReadStream(devMediaPath(key));
  });

  app.delete('/api/uploads/dev/*', { preHandler: cameraAuth }, async (request, reply) => {
    const key = decodeURIComponent((request.params as { '*': string })['*']);
    devMediaDelete(key);
    reply.send({ ok: true });
  });
}
