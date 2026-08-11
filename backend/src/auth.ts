import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import { config } from './config.js';
import { AppError } from './errors.js';
import { nowIso } from './db.js';

export interface AuthUser {
  id: number;
  username: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function sign(payload: object, secret: string, ttl: string | number): string {
  return jwt.sign(payload, secret, { expiresIn: ttl as SignOptions['expiresIn'] });
}

export function signAccess(user: AuthUser): string {
  return sign(
    { sub: String(user.id), username: user.username },
    config.jwtSecret,
    config.accessTtl,
  );
}

export function signRefresh(user: AuthUser, jti: string): string {
  return sign({ sub: String(user.id), jti }, config.refreshSecret, `${config.refreshTtlDays}d`);
}

export function verifyAccess(token: string): AuthUser {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; username: string };
    return { id: Number(payload.sub), username: payload.username };
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Token de acceso inválido o expirado');
  }
}

export function issueRefresh(
  db: Database.Database,
  user: AuthUser,
): { token: string; jti: string } {
  const jti = randomBytes(16).toString('hex');
  const token = signRefresh(user, jti);
  const expires = new Date(Date.now() + config.refreshTtlDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    jti,
    user.id,
    expires,
  );
  return { token, jti };
}

export function rotateRefresh(
  db: Database.Database,
  refreshToken: string,
): { accessToken: string; refreshToken: string } {
  let payload: { sub: string; jti: string };
  try {
    payload = jwt.verify(refreshToken, config.refreshSecret) as { sub: string; jti: string };
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Refresh token inválido o expirado');
  }
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE id = ?').get(payload.jti) as
    { user_id: number; revoked: number; expires_at: string } | undefined;
  if (!row || row.revoked || row.expires_at < nowIso()) {
    throw new AppError(401, 'UNAUTHORIZED', 'Refresh token revocado o expirado');
  }
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(payload.jti);
  const user = db
    .prepare('SELECT id, username FROM users WHERE id = ?')
    .get(row.user_id) as AuthUser;
  const { token } = issueRefresh(db, user);
  return { accessToken: signAccess(user), refreshToken: token };
}

export function revokeRefresh(db: Database.Database, refreshToken: string): void {
  try {
    const payload = jwt.verify(refreshToken, config.refreshSecret) as { jti: string };
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(payload.jti);
  } catch {
    // token inválido: no hay nada que revocar
  }
}

export function requireAuth(db: Database.Database) {
  return (request: FastifyRequest, _reply: FastifyReply, done: (err?: Error) => void): void => {
    try {
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHORIZED', 'Falta token');
      const user = verifyAccess(header.slice(7));
      const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id);
      if (!exists) throw new AppError(401, 'UNAUTHORIZED', 'Usuario inexistente');
      (request as FastifyRequest & { user: AuthUser }).user = user;
      done();
    } catch (err) {
      done(err as Error);
    }
  };
}

export function requireCamera(db: Database.Database) {
  return (request: FastifyRequest, _reply: FastifyReply, done: (err?: Error) => void): void => {
    try {
      const cameraId = request.headers['x-camera-id'] as string | undefined;
      const secret = request.headers['x-camera-secret'] as string | undefined;
      if (!cameraId || !secret)
        throw new AppError(401, 'UNAUTHORIZED', 'Credenciales de cámara faltantes');
      const row = db.prepare('SELECT * FROM cameras WHERE id = ?').get(cameraId) as
        { client_secret_hash: string | null } | undefined;
      if (!row?.client_secret_hash || !verifyPassword(secret, row.client_secret_hash)) {
        throw new AppError(401, 'UNAUTHORIZED', 'Credenciales de cámara inválidas');
      }
      (request as FastifyRequest & { cameraId: string }).cameraId = cameraId;
      done();
    } catch (err) {
      done(err as Error);
    }
  };
}
