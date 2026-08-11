import 'dotenv/config';

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  databasePath: process.env.DATABASE_PATH ?? './data/grabadora.db',
  mediaDir: process.env.MEDIA_DIR ?? './data/media',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  refreshSecret: process.env.REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
  accessTtl: process.env.ACCESS_TTL ?? '1h',
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  storage: {
    enabled: bool(process.env.STORAGE_ENABLED),
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    bucketClips: process.env.S3_BUCKET_CLIPS ?? 'grabadora-clips',
    bucketThumbs: process.env.S3_BUCKET_THUMBS ?? 'grabadora-thumbs',
  },
  iceServers: [
    ...(process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
      .split(',')
      .map((url) => ({ urls: url.trim() })),
    ...(process.env.TURN_URL
      ? [
          {
            urls: process.env.TURN_URL,
            username: process.env.TURN_USERNAME,
            credential: process.env.TURN_PASSWORD,
          },
        ]
      : []),
  ],
  push: {
    enabled: bool(process.env.PUSH_ENABLED),
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@grabadora.local',
    fcmProject: process.env.FCM_PROJECT,
    fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT,
  },
  retentionCheckMinutes: Number(process.env.RETENTION_CHECK_MINUTES ?? 60),
};
