import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

export function healthRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    return { status: 'ok', time: new Date().toISOString() };
  });
}
