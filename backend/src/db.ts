import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

const migrations: { version: number; sql: string[] }[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS cameras (
        id TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        zone TEXT NOT NULL DEFAULT '',
        pairing_token_hash TEXT,
        pairing_expires_at TEXT,
        client_secret_hash TEXT,
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen_at TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        pending_commands TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'clip',
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        duration_sec INTEGER NOT NULL DEFAULT 0,
        motion_level REAL NOT NULL DEFAULT 0,
        thumb_key TEXT,
        video_key TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        upload_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT,
        push_data TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cameras_user ON cameras(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_events_camera_start ON events(camera_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)`,
    ],
  },
];

export function openDatabase(path: string = config.databasePath): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const m of migrations) {
    if (m.version > current) {
      db.transaction(() => {
        for (const sql of m.sql) db.exec(sql);
        db.pragma(`user_version = ${m.version}`);
      })();
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
