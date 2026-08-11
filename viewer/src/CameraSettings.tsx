import { useState } from 'react';
import { sendCommand, updateCamera } from './api';
import { clamp } from './lib';
import type { Camera } from './types';

export function CameraSettings({ camera, onSaved }: { camera: Camera; onSaved: () => void }) {
  const [config, setConfig] = useState({ ...camera.config });
  const [name, setName] = useState(camera.name);
  const [zone, setZone] = useState(camera.zone);
  const [saving, setSaving] = useState(false);

  const save = (): void => {
    setSaving(true);
    void updateCamera(camera.id, {
      name,
      zone,
      config: { ...config, motionSensitivity: clamp(config.motionSensitivity, 0, 1) },
    })
      .then(onSaved)
      .catch((e) => alert(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <section className="settings">
      <h3>Configuración</h3>
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Zona
        <input value={zone} onChange={(e) => setZone(e.target.value)} />
      </label>
      <label>
        Resolución
        <select
          value={config.resolution}
          onChange={(e) =>
            setConfig({ ...config, resolution: e.target.value as '480p' | '720p' | '1080p' })
          }
        >
          <option value="480p">480p</option>
          <option value="720p">720p</option>
          <option value="1080p">1080p</option>
        </select>
      </label>
      <label>
        FPS
        <select
          value={config.fps}
          onChange={(e) => setConfig({ ...config, fps: Number(e.target.value) })}
        >
          {[15, 24, 30].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sensibilidad de movimiento ({Math.round(config.motionSensitivity * 100)}%)
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(config.motionSensitivity * 100)}
          onChange={(e) =>
            setConfig({ ...config, motionSensitivity: Number(e.target.value) / 100 })
          }
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={config.detectionEnabled}
          onChange={(e) => setConfig({ ...config, detectionEnabled: e.target.checked })}
        />
        Detección de movimiento activa
      </label>
      <div className="row">
        <label>
          Retención local (días)
          <input
            type="number"
            min="1"
            value={config.localRetentionDays}
            onChange={(e) => setConfig({ ...config, localRetentionDays: Number(e.target.value) })}
          />
        </label>
        <label>
          Retención nube (días)
          <input
            type="number"
            min="1"
            value={config.cloudRetentionDays}
            onChange={(e) => setConfig({ ...config, cloudRetentionDays: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="row">
        <button onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          onClick={() =>
            void sendCommand(
              camera.id,
              config.detectionEnabled ? 'pause_detection' : 'resume_detection',
            ).catch((e) => alert(e.message))
          }
        >
          {config.detectionEnabled ? 'Pausar detección' : 'Reanudar detección'}
        </button>
      </div>
    </section>
  );
}
