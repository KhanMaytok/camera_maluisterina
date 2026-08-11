import { useCallback, useEffect, useState } from 'react';
import { authMedia, deleteEvent, fetchEvents } from './api';
import { formatDateTime, formatDuration } from './lib';
import type { Camera, EventItem } from './types';

function Thumb({ event }: { event: EventItem }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    void authMedia(`/api/events/${event.id}/thumbnail`)
      .then((u) => {
        url = u;
        setSrc(u);
      })
      .catch(() => setSrc(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [event.id]);
  return src ? <img src={src} alt="" /> : <div className="thumb-empty" />;
}

export function EventsView({ cameras }: { cameras: Camera[] }) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [playing, setPlaying] = useState<EventItem | null>(null);

  const load = useCallback(() => {
    void fetchEvents({
      camera_id: cameraId || undefined,
      from: from || undefined,
      to: to || undefined,
    })
      .then((res) => setEvents(res.items))
      .catch((err) => alert(err.message));
  }, [cameraId, from, to]);

  useEffect(load, [load]);

  const play = (event: EventItem): void => {
    void authMedia(`/api/events/${event.id}/video`).then((url) =>
      setPlaying({ ...event, blob: url } as EventItem & { blob?: string }),
    );
  };

  return (
    <section>
      <div className="filters">
        <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
          <option value="">Todas las cámaras</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        <button onClick={load}>Buscar</button>
      </div>
      <ul className="events">
        {events.map((event) => (
          <li key={event.id} className="event">
            <Thumb event={event} />
            <div>
              <strong>{formatDateTime(event.started_at)}</strong>
              <span>
                {formatDuration(event.duration_sec)} · movimiento{' '}
                {Math.round(event.motion_level * 100)}%
              </span>
            </div>
            <div className="row">
              {event.kind === 'clip' && event.upload_status === 'uploaded' && (
                <button onClick={() => play(event)}>Ver</button>
              )}
              <button
                onClick={() =>
                  void deleteEvent(event.id)
                    .then(load)
                    .catch((e) => alert(e.message))
                }
              >
                Eliminar
              </button>
            </div>
          </li>
        ))}
        {events.length === 0 && <li className="empty">Sin eventos en el rango seleccionado</li>}
      </ul>
      {playing && (
        <div className="modal" onClick={() => setPlaying(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <video controls autoPlay src={(playing as EventItem & { blob?: string }).blob} />
            <button onClick={() => setPlaying(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </section>
  );
}
