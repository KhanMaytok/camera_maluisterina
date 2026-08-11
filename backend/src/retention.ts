import type Database from 'better-sqlite3';
import { config } from './config.js';
import { nowIso } from './db.js';
import { notifyCameraOffline } from './push.js';
import { safeDeleteObject } from './storage.js';
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
      if (event.thumb_key) safeDeleteObject(event.thumb_key);
      if (event.video_key) safeDeleteObject(event.video_key);
      db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
    }
  }
  db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(nowIso());
}

export function checkOfflineCameras(db: Database.Database): void {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const cameras = db
    .prepare(
      "SELECT id, name, user_id FROM cameras WHERE user_id IS NOT NULL AND status = 'online' AND (last_seen_at IS NULL OR last_seen_at < ?)",
    )
    .all(cutoff) as { id: string; name: string; user_id: number }[];
  for (const camera of cameras) {
    db.prepare("UPDATE cameras SET status = 'offline' WHERE id = ?").run(camera.id);
    void notifyCameraOffline(db, camera);
  }
}

export function startRetention(db: Database.Database): NodeJS.Timeout {
  const ms = Math.max(5, config.retentionCheckMinutes) * 60000;
  const retentionTimer = setInterval(() => {
    try {
      runRetention(db);
    } catch (err) {
      console.error('Retención fallida', err);
    }
  }, ms);
  retentionTimer.unref();
  const offlineTimer = setInterval(() => {
    try {
      checkOfflineCameras(db);
    } catch (err) {
      console.error('Chequeo offline fallido', err);
    }
  }, 60_000);
  offlineTimer.unref();
  return retentionTimer;
}
