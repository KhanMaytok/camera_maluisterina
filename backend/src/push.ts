import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import { config } from './config.js';
import { nowIso } from './db.js';
import { AppError } from './errors.js';
import { DEFAULT_CAMERA_CONFIG, type CameraConfig } from './types.js';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function ensureVapid(): VapidKeys {
  const file = join(config.databasePath, '..', 'vapid.json');
  const existing =
    config.push.vapidPublicKey && config.push.vapidPrivateKey
      ? { publicKey: config.push.vapidPublicKey, privateKey: config.push.vapidPrivateKey }
      : null;
  if (existing) return existing;
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8')) as VapidKeys;
  }
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(keys, null, 2));
  return keys;
}

interface PushData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscribeDevice(
  db: Database.Database,
  userId: number,
  kind: 'viewer' | 'camera',
  name: string | undefined,
  pushData: PushData | null,
): void {
  if (pushData) {
    const existing = db
      .prepare('SELECT id FROM devices WHERE user_id = ? AND push_data = ?')
      .get(userId, JSON.stringify(pushData));
    if (existing) return;
  }
  db.prepare(
    'INSERT INTO devices (user_id, kind, name, push_data, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(userId, kind, name, pushData ? JSON.stringify(pushData) : null, nowIso());
}

export async function notifyEvent(
  db: Database.Database,
  event: { id: string; camera_id: string; thumb_key: string | null },
): Promise<void> {
  if (!config.push.enabled) return;
  const camera = db
    .prepare('SELECT name, config FROM cameras WHERE id = ?')
    .get(event.camera_id) as { name: string; config: string } | undefined;
  if (!camera) return;
  const cameraConfig = { ...DEFAULT_CAMERA_CONFIG, ...JSON.parse(camera.config) };
  if (!shouldNotify(cameraConfig, new Date())) return;
  const devices = db
    .prepare(
      "SELECT id, user_id, push_data FROM devices WHERE kind = 'viewer' AND push_data IS NOT NULL",
    )
    .all() as { id: number; user_id: number; push_data: string }[];
  const vapid = ensureVapid();
  const thumbUrl = event.thumb_key
    ? `${config.publicBaseUrl}/api/events/${event.id}/thumbnail`
    : undefined;
  const payload = JSON.stringify({
    title: 'Movimiento detectado',
    body: camera.name,
    data: { event_id: event.id, camera_id: event.camera_id, camera_name: camera.name },
    image: thumbUrl,
    icon: thumbUrl,
  });
  for (const device of devices) {
    const pushData = JSON.parse(device.push_data) as PushData;
    try {
      await webpush.sendNotification(
        { endpoint: pushData.endpoint, keys: pushData.keys },
        payload,
        {
          vapidDetails: {
            subject: config.push.vapidSubject,
            publicKey: vapid.publicKey,
            privateKey: vapid.privateKey,
          },
          TTL: 86400,
        },
      );
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        db.prepare('DELETE FROM devices WHERE id = ?').run(device.id);
      }
    }
  }
}

/**
 * Decide si una notificación debe enviarse según el silencio configurado:
 * `muted` silencia siempre; si `mutedFrom`/`mutedTo` definen una franja
 * (HH:mm en hora local del servidor), se silencia dentro de esa franja.
 */
export function shouldNotify(config: CameraConfig, now: Date): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const from = parseHm(config.mutedFrom);
  const to = parseHm(config.mutedTo);
  if (config.muted && (from === null || to === null)) return false;
  if (from !== null && to !== null) {
    if (from <= to) {
      if (minutes >= from && minutes < to) return false;
    } else if (minutes >= from || minutes < to) {
      return false;
    }
  }
  return true;
}

function parseHm(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export async function notifyCameraOffline(
  db: Database.Database,
  camera: { id: string; name: string; user_id: number },
): Promise<void> {
  if (!config.push.enabled) return;
  const devices = db
    .prepare(
      "SELECT id, push_data FROM devices WHERE user_id = ? AND kind = 'viewer' AND push_data IS NOT NULL",
    )
    .all(camera.user_id) as { id: number; push_data: string }[];
  const vapid = ensureVapid();
  const payload = JSON.stringify({
    title: 'Cámara sin conexión',
    body: camera.name,
    data: { type: 'camera_offline', camera_id: camera.id, camera_name: camera.name },
  });
  for (const device of devices) {
    const pushData = JSON.parse(device.push_data) as PushData;
    try {
      await webpush.sendNotification(
        { endpoint: pushData.endpoint, keys: pushData.keys },
        payload,
        {
          vapidDetails: {
            subject: config.push.vapidSubject,
            publicKey: vapid.publicKey,
            privateKey: vapid.privateKey,
          },
          TTL: 86400,
        },
      );
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        db.prepare('DELETE FROM devices WHERE id = ?').run(device.id);
      }
    }
  }
}

// FCM HTTP v1 opcional para apps nativas; no se usa en el visor PWA.
export async function sendFcm(
  project: string,
  serviceAccountJson: string,
  token: string,
  payload: { title: string; body: string; data: Record<string, string> },
): Promise<void> {
  const account = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
    token_uri: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: account.token_uri,
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
    { algorithm: 'RS256' },
  );
  const tokenRes = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!tokenRes.ok) throw new AppError(502, 'FCM_AUTH_FAILED', 'No se pudo autenticar con FCM');
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
      },
    }),
  });
  if (!res.ok) throw new AppError(502, 'FCM_SEND_FAILED', 'Fallo al enviar push FCM');
}
