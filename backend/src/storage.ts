import { mkdirSync, writeFileSync, rmSync, existsSync, createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';
import { AppError } from './errors.js';

export const clipKey = (cameraId: string, eventId: string): string =>
  `clips/${cameraId}/${eventId}.mp4`;
export const thumbKey = (cameraId: string, eventId: string): string =>
  `thumbs/${cameraId}/${eventId}.jpg`;
export const snapshotKey = (cameraId: string, eventId: string): string =>
  `snapshots/${cameraId}/${eventId}.jpg`;

let client: S3Client | null = null;

function s3(): S3Client {
  if (!config.storage.enabled || !config.storage.endpoint) {
    throw new AppError(503, 'STORAGE_DISABLED', 'Storage en la nube no configurado');
  }
  if (!client) {
    client = new S3Client({
      endpoint: config.storage.endpoint,
      region: config.storage.region,
      credentials: {
        accessKeyId: config.storage.accessKeyId ?? '',
        secretAccessKey: config.storage.secretAccessKey ?? '',
      },
    });
  }
  return client;
}

export async function presignPut(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket:
      key.startsWith('thumbs/') || key.startsWith('snapshots/')
        ? config.storage.bucketThumbs
        : config.storage.bucketClips,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3(), command, { expiresIn: 600 });
}

export async function presignGet(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket:
      key.startsWith('thumbs/') || key.startsWith('snapshots/')
        ? config.storage.bucketThumbs
        : config.storage.bucketClips,
    Key: key,
  });
  return getSignedUrl(s3(), command, { expiresIn: 300 });
}

export async function deleteObject(key: string): Promise<void> {
  if (!config.storage.enabled || !config.storage.endpoint) return;
  await s3().send(
    new DeleteObjectCommand({
      Bucket:
        key.startsWith('thumbs/') || key.startsWith('snapshots/')
          ? config.storage.bucketThumbs
          : config.storage.bucketClips,
      Key: key,
    }),
  );
}

// Modo desarrollo: almacenamiento local bajo data/media cuando STORAGE_ENABLED=false.
export function devMediaPath(key: string): string {
  return join(config.mediaDir, key);
}

export function devMediaExists(key: string): boolean {
  return existsSync(devMediaPath(key));
}

export function devMediaSave(key: string, body: Buffer): string {
  const path = devMediaPath(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
}

export function devMediaDelete(key: string): void {
  const path = devMediaPath(key);
  if (existsSync(path)) rmSync(path);
}

export function devMediaStream(key: string) {
  return createReadStream(devMediaPath(key));
}

export function newEventId(): string {
  return randomBytes(16).toString('hex');
}
