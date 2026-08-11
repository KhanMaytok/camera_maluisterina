import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { hashPassword, requireAuth, requireCamera, verifyPassword } from '../auth.js';
import { nowIso } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { safeDeleteObject } from '../storage.js';
import {
  DEFAULT_CAMERA_CONFIG,
  type CameraConfig,
  type CameraRow,
  type PendingCommand,
} from '../types.js';

function parseConfig(row: CameraRow): CameraConfig {
  return { ...DEFAULT_CAMERA_CONFIG, ...JSON.parse(row.config) };
}

function getCamera(db: Database.Database, id: string): CameraRow {
  const row = db.prepare('SELECT * FROM cameras WHERE id = ?').get(id) as CameraRow | undefined;
  if (!row) throw notFound();
  return row;
}

function requireOwner(db: Database.Database, userId: number, id: string): CameraRow {
  const row = getCamera(db, id);
  if (row.user_id !== userId) throw new AppError(403, 'FORBIDDEN', 'No eres dueño de esta cámara');
  return row;
}

function toPublic(row: CameraRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    zone: row.zone,
    status: row.status,
    last_seen_at: row.last_seen_at,
    config: parseConfig(row),
    pairing_pending: Boolean(row.pairing_token_hash),
    created_at: row.created_at,
  };
}

export function cameraRoutes(app: FastifyInstance, db: Database.Database): void {
  const auth = requireAuth(db);

  app.post('/api/cameras/register', async (request, reply) => {
    const { pairing_token, device_name } = request.body as {
      pairing_token?: string;
      device_name?: string;
    };
    if (!pairing_token || pairing_token.length < 8 || !device_name) {
      throw new AppError(400, 'VALIDATION', 'pairing_token y device_name requeridos');
    }
    const id = randomBytes(12).toString('hex');
    const clientSecret = randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO cameras (id, name, pairing_token_hash, pairing_expires_at, client_secret_hash, config, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      device_name,
      hashPassword(pairing_token),
      expires,
      hashPassword(clientSecret),
      JSON.stringify(DEFAULT_CAMERA_CONFIG),
      nowIso(),
    );
    reply.status(201).send({ camera_id: id, client_secret: clientSecret, expires_in: 600 });
  });

  app.post('/api/cameras/pair', { preHandler: auth }, async (request, reply) => {
    const user = (request as typeof request & { user: { id: number } }).user;
    const { pairing_token, name, zone } = request.body as {
      pairing_token?: string;
      name?: string;
      zone?: string;
    };
    if (!pairing_token) throw new AppError(400, 'VALIDATION', 'pairing_token requerido');
    const rows = db
      .prepare('SELECT * FROM cameras WHERE pairing_expires_at > ?')
      .all(nowIso()) as CameraRow[];
    const row = rows.find(
      (r) => r.pairing_token_hash && verifyPassword(pairing_token, r.pairing_token_hash),
    );
    if (!row)
      throw new AppError(400, 'INVALID_PAIRING', 'Código de emparejamiento inválido o expirado');
    db.prepare(
      'UPDATE cameras SET user_id = ?, name = ?, zone = ?, pairing_token_hash = NULL, pairing_expires_at = NULL WHERE id = ?',
    ).run(user.id, name || row.name, zone || '', row.id);
    reply.send(toPublic(getCamera(db, row.id)));
  });

  app.get('/api/cameras', { preHandler: auth }, async (request) => {
    const user = (request as typeof request & { user: { id: number } }).user;
    const rows = db
      .prepare('SELECT * FROM cameras WHERE user_id = ? ORDER BY created_at')
      .all(user.id) as CameraRow[];
    return rows.map(toPublic);
  });

  app.get('/api/cameras/:id', { preHandler: auth }, async (request) => {
    const user = (request as typeof request & { user: { id: number } }).user;
    const { id } = request.params as { id: string };
    return toPublic(requireOwner(db, user.id, id));
  });

  app.patch('/api/cameras/:id', { preHandler: auth }, async (request) => {
    const user = (request as typeof request & { user: { id: number } }).user;
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; zone?: string; config?: Partial<CameraConfig> };
    const row = requireOwner(db, user.id, id);
    const config = body.config ? { ...parseConfig(row), ...body.config } : parseConfig(row);
    db.prepare('UPDATE cameras SET name = ?, zone = ?, config = ? WHERE id = ?').run(
      body.name ?? row.name,
      body.zone ?? row.zone,
      JSON.stringify(config),
      id,
    );
    return toPublic(getCamera(db, id));
  });

  app.delete('/api/cameras/:id', { preHandler: auth }, async (request, reply) => {
    const user = (request as typeof request & { user: { id: number } }).user;
    const { id } = request.params as { id: string };
    requireOwner(db, user.id, id);
    const events = db
      .prepare('SELECT thumb_key, video_key FROM events WHERE camera_id = ?')
      .all(id) as { thumb_key: string | null; video_key: string | null }[];
    for (const event of events) {
      if (event.thumb_key) safeDeleteObject(event.thumb_key);
      if (event.video_key) safeDeleteObject(event.video_key);
    }
    db.prepare('DELETE FROM cameras WHERE id = ?').run(id);
    reply.send({ ok: true });
  });

  app.post('/api/cameras/:id/commands', { preHandler: auth }, async (request) => {
    const user = (request as typeof request & { user: { id: number } }).user;
    const { id } = request.params as { id: string };
    const { type } = request.body as { type?: PendingCommand['type'] };
    const allowed: PendingCommand['type'][] = [
      'snapshot',
      'pause_detection',
      'resume_detection',
      'reconfigure',
    ];
    if (!type || !allowed.includes(type)) {
      throw new AppError(400, 'VALIDATION', 'Tipo de comando inválido');
    }
    requireOwner(db, user.id, id);
    const row = getCamera(db, id);
    const commands = JSON.parse(row.pending_commands) as PendingCommand[];
    commands.push({ id: randomBytes(8).toString('hex'), type, at: nowIso() });
    db.prepare('UPDATE cameras SET pending_commands = ? WHERE id = ?').run(
      JSON.stringify(commands),
      id,
    );
    return { ok: true };
  });

  const cameraAuth = requireCamera(db);

  app.post('/api/cameras/:id/heartbeat', { preHandler: cameraAuth }, async (request) => {
    const cameraId = (request as typeof request & { cameraId: string }).cameraId;
    const row = getCamera(db, cameraId);
    const commands = JSON.parse(row.pending_commands) as PendingCommand[];
    db.prepare(
      "UPDATE cameras SET status = 'online', last_seen_at = ?, pending_commands = '[]' WHERE id = ?",
    ).run(nowIso(), cameraId);
    return { config: parseConfig(row), commands, now: nowIso() };
  });

  app.post('/api/cameras/:id/commands/ack', { preHandler: cameraAuth }, async (request, reply) => {
    const cameraId = (request as typeof request & { cameraId: string }).cameraId;
    const { command_id } = request.body as { command_id?: string };
    if (!command_id) throw new AppError(400, 'VALIDATION', 'command_id requerido');
    const row = getCamera(db, cameraId);
    const commands = (JSON.parse(row.pending_commands) as PendingCommand[]).filter(
      (c) => c.id !== command_id,
    );
    db.prepare('UPDATE cameras SET pending_commands = ? WHERE id = ?').run(
      JSON.stringify(commands),
      cameraId,
    );
    reply.send({ ok: true });
  });
}
