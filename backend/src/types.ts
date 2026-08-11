export interface CameraConfig {
  resolution: '480p' | '720p' | '1080p';
  fps: number;
  bitrateKbps: number;
  motionSensitivity: number; // 0..1
  motionZone: { x: number; y: number; w: number; h: number } | null;
  detectionEnabled: boolean;
  preRollSec: number;
  postRollSec: number;
  localRetentionDays: number;
  cloudRetentionDays: number;
  activeFrom: string | null; // HH:mm
  activeTo: string | null;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  resolution: '720p',
  fps: 24,
  bitrateKbps: 1500,
  motionSensitivity: 0.35,
  motionZone: null,
  detectionEnabled: true,
  preRollSec: 15,
  postRollSec: 30,
  localRetentionDays: 7,
  cloudRetentionDays: 30,
  activeFrom: null,
  activeTo: null,
};

export interface PendingCommand {
  id: string;
  type: 'snapshot' | 'pause_detection' | 'resume_detection' | 'reconfigure';
  at: string;
}

export interface CameraRow {
  id: string;
  user_id: number | null;
  name: string;
  zone: string;
  pairing_token_hash: string | null;
  pairing_expires_at: string | null;
  client_secret_hash: string | null;
  status: string;
  last_seen_at: string | null;
  config: string;
  pending_commands: string;
  created_at: string;
}

export interface EventRow {
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

export interface DeviceRow {
  id: number;
  user_id: number;
  kind: 'viewer' | 'camera';
  name: string | null;
  push_data: string | null;
  created_at: string;
}
