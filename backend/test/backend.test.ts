import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { buildApp, type AppHandle } from '../src/app.js';
import { shouldNotify } from '../src/push.js';
import { checkOfflineCameras } from '../src/retention.js';
import { DEFAULT_CAMERA_CONFIG } from '../src/types.js';

let handle: AppHandle;
let dir: string;
let accessToken = '';
let refreshToken = '';
let cameraId = '';
let cameraSecret = '';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'grabadora-test-'));
  handle = await buildApp({ databasePath: join(dir, 'test.db') });
  await handle.app.ready();
  await handle.app.listen({ port: 0, host: '127.0.0.1' });
});

after(async () => {
  await handle.app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function inject(method: string, url: string, opts: Record<string, unknown> = {}) {
  const res = await handle.app.inject({ method, url, ...opts });
  let body: unknown = res.body;
  if (typeof res.body === 'string' && res.body.length > 0) {
    try {
      body = JSON.parse(res.body);
    } catch {
      body = res.body;
    }
  }
  return { status: res.statusCode, body, headers: res.headers };
}

test('registro, login y refresh rotativo', async () => {
  let res = await inject('POST', '/api/auth/register', {
    payload: { username: 'admin', password: 'clave-segura-123' },
  });
  assert.equal(res.status, 201);

  res = await inject('POST', '/api/auth/register', {
    payload: { username: 'otro', password: 'clave-segura-123' },
  });
  assert.equal(res.status, 403);

  res = await inject('POST', '/api/auth/login', {
    payload: { username: 'admin', password: 'clave-segura-123' },
  });
  assert.equal(res.status, 200);
  accessToken = res.body.access_token;
  refreshToken = res.body.refresh_token;
  assert.ok(accessToken && refreshToken);

  res = await inject('POST', '/api/auth/refresh', { payload: { refresh_token: refreshToken } });
  assert.equal(res.status, 200);
  const rotated = refreshToken;
  refreshToken = res.body.refreshToken;
  accessToken = res.body.accessToken;
  assert.notEqual(refreshToken, rotated);

  res = await inject('POST', '/api/auth/refresh', { payload: { refresh_token: rotated } });
  assert.equal(res.status, 401);
});

test('registro y emparejamiento de cámara', async () => {
  let res = await inject('POST', '/api/cameras/register', {
    payload: { pairing_token: 'ABCD-1234-EFGH', device_name: 'Teléfono viejo' },
  });
  assert.equal(res.status, 201);
  cameraId = res.body.camera_id;
  cameraSecret = res.body.client_secret;

  res = await inject('POST', '/api/cameras/pair', {
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { pairing_token: 'ABCD-1234-EFGH', name: 'Sala', zone: 'Primer piso' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Sala');

  res = await inject('GET', '/api/cameras', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].config.resolution, '720p');

  res = await inject('GET', '/api/events', {});
  assert.equal(res.status, 401);
});

test('heartbeat, comandos y ack', async () => {
  let res = await inject('POST', `/api/cameras/${cameraId}/commands`, {
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { type: 'snapshot' },
  });
  assert.equal(res.status, 200);

  const cameraHeaders = {
    'x-camera-id': cameraId,
    'x-camera-secret': cameraSecret,
  };
  res = await inject('POST', `/api/cameras/${cameraId}/heartbeat`, { headers: cameraHeaders });
  assert.equal(res.status, 200);
  assert.equal(res.body.commands.length, 1);
  assert.equal(res.body.commands[0].type, 'snapshot');

  const commandId = res.body.commands[0].id;
  res = await inject('POST', `/api/cameras/${cameraId}/commands/ack`, {
    headers: cameraHeaders,
    payload: { command_id: commandId },
  });
  assert.equal(res.status, 200);

  res = await inject('POST', `/api/cameras/${cameraId}/heartbeat`, { headers: cameraHeaders });
  assert.equal(res.body.commands.length, 0);
  assert.equal(res.body.config.motionSensitivity, 0.35);
});

test('flujo de clip: presign, subida local, complete y consulta', async () => {
  const cameraHeaders = {
    'x-camera-id': cameraId,
    'x-camera-secret': cameraSecret,
  };
  let res = await inject('POST', '/api/uploads/presign', {
    headers: cameraHeaders,
    payload: {
      kind: 'clip',
      started_at: new Date(Date.now() - 60000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_sec: 60,
      motion_level: 0.7,
      content_type: 'video/mp4',
    },
  });
  assert.equal(res.status, 200);
  const eventId = res.body.event_id;
  assert.ok(res.body.video.put_url.includes('/api/uploads/dev/'));
  const videoUrl = res.body.video.put_url.replace('http://localhost:3000', '');
  const thumbUrl = res.body.thumbnail.put_url.replace('http://localhost:3000', '');

  const videoBuffer = Buffer.from('%PDF-GRABADORA-DEV');
  res = await inject('PUT', videoUrl, {
    headers: { ...cameraHeaders, 'content-type': 'video/mp4' },
    payload: videoBuffer,
  });
  assert.equal(res.status, 200);

  res = await inject('PUT', thumbUrl, {
    headers: { ...cameraHeaders, 'content-type': 'image/jpeg' },
    payload: Buffer.from('%JPEG-DEV'),
  });
  assert.equal(res.status, 200);

  res = await inject('POST', '/api/uploads/complete', {
    headers: cameraHeaders,
    payload: { event_id: eventId, size_bytes: videoBuffer.length },
  });
  assert.equal(res.status, 200);

  res = await inject('GET', '/api/events?camera_id=' + cameraId, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].upload_status, 'uploaded');

  res = await inject('GET', `/api/events/${eventId}/video`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.location ?? '', /\/api\/uploads\/dev\//);

  res = await inject('GET', `/api/events/${eventId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(res.status, 200);

  res = await inject('DELETE', `/api/events/${eventId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(res.status, 200);
});

test('configuración remota vía PATCH', async () => {
  const res = await inject('PATCH', `/api/cameras/${cameraId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { config: { motionSensitivity: 0.6, cloudRetentionDays: 15 } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.config.motionSensitivity, 0.6);
  assert.equal(res.body.config.cloudRetentionDays, 15);
});

test('señalización rechaza visor no autenticado', async () => {
  await new Promise<void>((resolve, reject) => {
    const server = handle.app.server;
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Servidor sin dirección'));
      return;
    }
    const ws = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/signaling?camera_id=${cameraId}&role=viewer&token=invalido`,
    );
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      assert.equal(msg.type, 'error');
      ws.close();
      resolve();
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Timeout esperando error de señalización')), 3000);
  });
});

test('cámara sin heartbeat pasa a offline', () => {
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  handle.db
    .prepare("UPDATE cameras SET status = 'online', last_seen_at = ? WHERE id = ?")
    .run(old, cameraId);
  checkOfflineCameras(handle.db);
  const row = handle.db.prepare('SELECT status FROM cameras WHERE id = ?').get(cameraId) as {
    status: string;
  };
  assert.equal(row.status, 'offline');
});

test('silencio de notificaciones por franja horaria', () => {
  const base = { ...DEFAULT_CAMERA_CONFIG, muted: true, mutedFrom: '22:00', mutedTo: '06:00' };
  assert.equal(shouldNotify(base, new Date('2026-08-11T23:30:00')), false);
  assert.equal(shouldNotify(base, new Date('2026-08-11T12:00:00')), true);

  const overnight = { ...DEFAULT_CAMERA_CONFIG, muted: true, mutedFrom: '23:00', mutedTo: '01:00' };
  assert.equal(shouldNotify(overnight, new Date('2026-08-11T00:30:00')), false);

  const alwaysMuted = { ...DEFAULT_CAMERA_CONFIG, muted: true };
  assert.equal(shouldNotify(alwaysMuted, new Date()), false);

  const unmuted = { ...DEFAULT_CAMERA_CONFIG, muted: false };
  assert.equal(shouldNotify(unmuted, new Date()), true);
});
