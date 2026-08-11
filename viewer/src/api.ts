import { idbSet } from './idb';
import type { Camera, EventItem, User } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

let accessToken = localStorage.getItem('token') ?? '';
let refreshToken = localStorage.getItem('refresh') ?? '';

export function getToken(): string {
  return accessToken;
}

export function isLoggedIn(): boolean {
  return Boolean(accessToken);
}

export function logout(): void {
  accessToken = '';
  refreshToken = '';
  localStorage.removeItem('token');
  localStorage.removeItem('refresh');
  void idbSet('token', '');
}

export async function login(username: string, password: string): Promise<User> {
  const data = await rawFetch<{ access_token: string; refresh_token: string; user: User }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ username, password }) },
  );
  setTokens(data.access_token, data.refresh_token);
  return data.user;
}

export async function register(username: string, password: string): Promise<void> {
  await rawFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('token', access);
  localStorage.setItem('refresh', refresh);
  void idbSet('token', access);
}

async function rawFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function refreshAccess(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const data = await rawFetch<{ accessToken: string; refreshToken: string }>(
      '/api/auth/refresh',
      {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    logout();
    return false;
  }
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  try {
    return await rawFetch<T>(path, init);
  } catch (err) {
    if (retry && accessToken && (await refreshAccess())) {
      return rawFetch<T>(path, init);
    }
    throw err;
  }
}

export const fetchCameras = (): Promise<Camera[]> => api<Camera[]>('/api/cameras');
export const fetchEvents = (
  params: { camera_id?: string; from?: string; to?: string; page?: number } = {},
): Promise<{ items: EventItem[]; page: number; page_size: number; total: number }> => {
  const qs = new URLSearchParams();
  if (params.camera_id) qs.set('camera_id', params.camera_id);
  if (params.from) qs.set('from', new Date(params.from).toISOString());
  if (params.to) qs.set('to', new Date(params.to).toISOString());
  if (params.page) qs.set('page', String(params.page));
  return api(`/api/events?${qs.toString()}`);
};
export const deleteEvent = (id: string): Promise<{ ok: boolean }> =>
  api(`/api/events/${id}`, { method: 'DELETE' });
export const sendCommand = (
  cameraId: string,
  type: 'snapshot' | 'pause_detection' | 'resume_detection',
): Promise<{ ok: boolean }> =>
  api(`/api/cameras/${cameraId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
export const updateCamera = (
  cameraId: string,
  body: { name?: string; zone?: string; config?: Record<string, unknown> },
): Promise<Camera> =>
  api(`/api/cameras/${cameraId}`, { method: 'PATCH', body: JSON.stringify(body) });
export const pairCamera = (body: {
  pairing_token: string;
  name: string;
  zone: string;
}): Promise<Camera> => api('/api/cameras/pair', { method: 'POST', body: JSON.stringify(body) });

export async function authMedia(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`Media error ${res.status}`);
  return URL.createObjectURL(await res.blob());
}
