import type Database from 'better-sqlite3';
import { config } from './config.js';
import { nowIso } from './db.js';
import { deleteObject } from './storage.js';
import { DEFAULT_CAMERA_CONFIG } from './types.js';

export function runRetention(db: Database.Database): void {
  const cameras = db.prepare('SELECT id, config FROM cameras').all() as {
    id: string;
    config: string;
  }[];
  for (const camera of cameras) {
    const cameraConfig = { ...DEFAULT_CAMERA_CONFIG, ...JSON.parse(camera.config) };
    const cutoff = new Date(Date.now() - cameraConfig.cloudRetentionDays * 86400000).toISOString();
    const expired = db
      .prepare(
        "SELECT id, thumb_key, video_key FROM events WHERE camera_id = ? AND ended_at < ? AND upload_status = 'uploaded'",
      )
      .all(camera.id, cutoff) as {
      id: string;
      thumb_key: string | null;
      video_key: string | null;
    }[];
    for (const event of expired) {
      if (event.thumb_key) void deleteObject(event.thumb_key);
      if (event.video_key) void deleteObject(event.video_key);
      db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
    }
  }
  db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(nowIso());
}

export function startRetention(db: Database.Database): NodeJS.Timeout {
  const ms = Math.max(5, config.retentionCheckMinutes) * 60000;
  const timer = setInterval(() => {
    try {
      runRetention(db);
    } catch (err) {
      console.error('Retención fallida', err);
    }
  }, ms);
  timer.unref();
  return timer;
}
