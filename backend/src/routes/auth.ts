import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import {
  hashPassword,
  verifyPassword,
  signAccess,
  issueRefresh,
  rotateRefresh,
  revokeRefresh,
} from '../auth.js';
import { nowIso } from '../db.js';
import { AppError } from '../errors.js';

export function authRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { username, password } = request.body as { username?: string; password?: string };
      if (!username || !password || password.length < 8) {
        throw new AppError(
          400,
          'VALIDATION',
          'Usuario y contraseña (mín. 8 caracteres) requeridos',
        );
      }
      const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
      if (count > 0) throw new AppError(403, 'REGISTER_DISABLED', 'La cuenta ya existe');
      db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(
        username,
        hashPassword(password),
        nowIso(),
      );
      reply.status(201).send({ ok: true });
    },
  );

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { username, password } = request.body as { username?: string; password?: string };
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
        { id: number; username: string; password_hash: string } | undefined;
      if (!row || !verifyPassword(password ?? '', row.password_hash)) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
      }
      const user = { id: row.id, username: row.username };
      const { token: refreshToken } = issueRefresh(db, user);
      reply.send({ access_token: signAccess(user), refresh_token: refreshToken, user });
    },
  );

  app.post('/api/auth/refresh', async (request, reply) => {
    const { refresh_token } = request.body as { refresh_token?: string };
    if (!refresh_token) throw new AppError(400, 'VALIDATION', 'refresh_token requerido');
    reply.send(rotateRefresh(db, refresh_token));
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const { refresh_token } = request.body as { refresh_token?: string };
    if (refresh_token) revokeRefresh(db, refresh_token);
    reply.send({ ok: true });
  });
}
