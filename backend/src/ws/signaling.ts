import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type Database from 'better-sqlite3';
import { verifyAccess, verifyPassword } from '../auth.js';
import { config } from '../config.js';

interface Room {
  camera: WebSocket | null;
  viewers: Set<WebSocket>;
}

const rooms = new Map<string, Room>();

interface SignalMessage {
  type: string;
  [key: string]: unknown;
}

function send(socket: WebSocket, message: SignalMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

export function signalingRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/signaling', { websocket: true }, (socket, request) => {
    const params = new URLSearchParams((request.url ?? '').split('?')[1] ?? '');
    const cameraId = params.get('camera_id') ?? undefined;
    const role = params.get('role') ?? undefined;
    const token = params.get('token') ?? undefined;
    if (!cameraId || (role !== 'viewer' && role !== 'camera')) {
      send(socket, { type: 'error', message: 'Parámetros inválidos' });
      socket.close();
      return;
    }

    try {
      if (role === 'viewer') {
        const user = verifyAccess(token ?? '');
        const owned = db
          .prepare('SELECT id FROM cameras WHERE id = ? AND user_id = ?')
          .get(cameraId, user.id);
        if (!owned) {
          send(socket, { type: 'error', message: 'Cámara no encontrada' });
          socket.close();
          return;
        }
      } else {
        const secret = request.headers['x-camera-secret'] as string | undefined;
        const row = db
          .prepare('SELECT client_secret_hash FROM cameras WHERE id = ?')
          .get(cameraId) as { client_secret_hash: string | null } | undefined;
        if (!row?.client_secret_hash || !verifyPassword(secret ?? '', row.client_secret_hash)) {
          send(socket, { type: 'error', message: 'Credenciales de cámara inválidas' });
          socket.close();
          return;
        }
      }
    } catch {
      send(socket, { type: 'error', message: 'Autenticación fallida' });
      socket.close();
      return;
    }

    let room = rooms.get(cameraId);
    if (!room) {
      room = { camera: null, viewers: new Set() };
      rooms.set(cameraId, room);
    }
    if (role === 'camera') {
      if (room.camera) {
        send(socket, { type: 'error', message: 'La cámara ya tiene una conexión activa' });
        socket.close();
        return;
      }
      room.camera = socket;
      send(socket, { type: 'ready', role: 'camera', iceServers: config.iceServers });
    } else {
      room.viewers.add(socket);
      send(socket, { type: 'ready', role: 'viewer', iceServers: config.iceServers });
    }

    socket.on('message', (data) => {
      let message: SignalMessage;
      try {
        message = JSON.parse(data.toString()) as SignalMessage;
      } catch {
        return;
      }
      const current = rooms.get(cameraId);
      if (!current) return;
      if (role === 'camera') {
        for (const viewer of current.viewers) send(viewer, message);
      } else if (current.camera) {
        send(current.camera, message);
      }
    });

    const cleanup = (): void => {
      const current = rooms.get(cameraId);
      if (!current) return;
      if (role === 'camera') {
        current.camera = null;
        for (const viewer of current.viewers) send(viewer, { type: 'camera_left' });
      } else {
        current.viewers.delete(socket);
      }
      if (!current.camera && current.viewers.size === 0) rooms.delete(cameraId);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
