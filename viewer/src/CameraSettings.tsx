import { useState } from 'react';
import { deleteCamera, sendCommand, updateCamera } from './api';
import { clamp } from './lib';
import type { Camera } from './types';

export function CameraSettings({ camera, onSaved }: { camera: Camera; onSaved: () => void }) {
  const [config, setConfig] = useState({ ...camera.config });
  const [name, setName] = useState(camera.name);
  const [zone, setZone] = useState(camera.zone);
  const [saving, setSaving] = useState(false);

  const remove = (): void => {
    if (!confirm(`¿Eliminar la cámara "${camera.name}"? Se borrarán sus eventos.`)) return;
    void deleteCamera(camera.id)
      .then(onSaved)
      .catch((e) => alert(e.message));
  };

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
      <fieldset>
        <legend>Zona de detección (%)</legend>
        <div className="row">
          {(
            [
              ['x', 'X'],
              ['y', 'Y'],
              ['w', 'Ancho'],
              ['h', 'Alto'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min="0"
                max="100"
                value={config.motionZone?.[key] ?? (key === 'w' || key === 'h' ? 100 : 0)}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    motionZone: {
                      x: config.motionZone?.x ?? 0,
                      y: config.motionZone?.y ?? 0,
                      w: config.motionZone?.w ?? 100,
                      h: config.motionZone?.h ?? 100,
                      [key]: Number(e.target.value),
                    } as { x: number; y: number; w: number; h: number },
                  })
                }
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => setConfig({ ...config, motionZone: null })}
        >
          Toda la imagen
        </button>
      </fieldset>
      <div className="row">
        <label>
          Detección desde
          <input
            type="time"
            value={config.activeFrom ?? ''}
            onChange={(e) => setConfig({ ...config, activeFrom: e.target.value || null })}
          />
        </label>
        <label>
          Detección hasta
          <input
            type="time"
            value={config.activeTo ?? ''}
            onChange={(e) => setConfig({ ...config, activeTo: e.target.value || null })}
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={config.muted}
          onChange={(e) => setConfig({ ...config, muted: e.target.checked })}
        />
        Silenciar notificaciones de esta cámara
      </label>
      <div className="row">
        <label>
          Silencio desde
          <input
            type="time"
            value={config.mutedFrom ?? ''}
            onChange={(e) => setConfig({ ...config, mutedFrom: e.target.value || null })}
          />
        </label>
        <label>
          Silencio hasta
          <input
            type="time"
            value={config.mutedTo ?? ''}
            onChange={(e) => setConfig({ ...config, mutedTo: e.target.value || null })}
          />
        </label>
      </div>
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
      <button className="danger" onClick={remove}>
        Eliminar cámara
      </button>
    </section>
  );
}
