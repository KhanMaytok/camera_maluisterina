import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import { config } from './config.js';
import { nowIso } from './db.js';
import { AppError } from './errors.js';

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
  cameraName: string,
): Promise<void> {
  if (!config.push.enabled) return;
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
    body: cameraName,
    data: { event_id: event.id, camera_id: event.camera_id, camera_name: cameraName },
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
