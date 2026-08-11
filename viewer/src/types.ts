export interface CameraConfig {
  resolution: '480p' | '720p' | '1080p';
  fps: number;
  bitrateKbps: number;
  motionSensitivity: number;
  motionZone: { x: number; y: number; w: number; h: number } | null;
  detectionEnabled: boolean;
  preRollSec: number;
  postRollSec: number;
  localRetentionDays: number;
  cloudRetentionDays: number;
  activeFrom: string | null;
  activeTo: string | null;
  muted: boolean;
  mutedFrom: string | null;
  mutedTo: string | null;
}

export interface Camera {
  id: string;
  name: string;
  zone: string;
  status: 'offline' | 'online' | 'degraded';
  last_seen_at: string | null;
  config: CameraConfig;
  pairing_pending: boolean;
  created_at: string;
}

export interface EventItem {
  id: string;
  camera_id: string;
  kind: 'clip' | 'snapshot';
  started_at: string;
  ended_at: string;
  duration_sec: number;
  motion_level: number;
  thumb_key: string | null;
  video_key: string | null;
  size_bytes: number;
  upload_status: 'pending' | 'uploaded' | 'failed';
  created_at: string;
}

export interface User {
  id: number;
  username: string;
}
