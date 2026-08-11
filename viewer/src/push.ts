import { api } from './api';
import { urlBase64ToUint8Array } from './lib';

export async function subscribeToPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push no soportado en este navegador');
  }
  const { public_key } = await api<{ public_key: string }>('/api/push/vapid-public-key');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(public_key),
  });
  const pushData = subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ name: navigator.userAgent.slice(0, 80), push_data: pushData }),
  });
}
