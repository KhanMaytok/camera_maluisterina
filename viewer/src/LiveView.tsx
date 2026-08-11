import { useEffect, useRef, useState } from 'react';
import { getToken, sendCommand } from './api';
import type { Camera } from './types';
import { SignalingClient, type SignalMessage } from './ws';

type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export function LiveView({ camera }: { camera: Camera }) {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioOn, setAudioOn] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let pc: RTCPeerConnection | null = null;
    let client: SignalingClient | null = null;
    let disposed = false;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/api/signaling?camera_id=${camera.id}&role=viewer&token=${encodeURIComponent(getToken())}`;

    const startCall = (): void => {
      if (disposed || pc) return;
      pc = new RTCPeerConnection({ iceServers: client?.iceServers ?? [] });
      pc.onicecandidate = (event) => {
        if (event.candidate) client?.send({ type: 'ice', candidate: event.candidate.toJSON() });
      };
      pc.ontrack = (event) => {
        if (disposed) return;
        const stream = event.streams[0];
        if (stream) {
          setStream(stream);
          setStatus('live');
        }
      };
      pc.createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .then(() => client?.send({ type: 'offer', sdp: pc?.localDescription?.sdp }))
        .catch(() => setStatus('reconnecting'));
    };

    client = new SignalingClient(url, {
      onReady: startCall,
      onMessage: async (message: SignalMessage) => {
        if (!pc) return;
        if (message.type === 'answer') {
          await pc.setRemoteDescription({
            type: 'answer',
            sdp: message.sdp as string,
          });
        } else if (message.type === 'ice') {
          await pc.addIceCandidate(message.candidate as RTCIceCandidateInit);
        } else if (message.type === 'camera_left') {
          setStatus('offline');
        }
      },
      onStatus: (s) => setStatus(s),
    });
    client.connect();

    return () => {
      disposed = true;
      client?.close();
      pc?.close();
      setStream(null);
    };
  }, [camera.id]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !audioOn;
  }, [audioOn, stream]);

  const statusLabel: Record<LiveStatus, string> = {
    connecting: 'Conectando…',
    live: 'En vivo',
    reconnecting: 'Reconectando…',
    offline: 'Sin conexión',
  };

  return (
    <section className="live">
      <div className="live-header">
        <h2>
          {camera.name} <span className={`dot ${status}`} /> {statusLabel[status]}
        </h2>
        <div className="row">
          <button onClick={() => setAudioOn((v) => !v)} disabled={status !== 'live'}>
            {audioOn ? 'Silenciar' : 'Audio'}
          </button>
          <button
            onClick={() => void sendCommand(camera.id, 'snapshot').catch((e) => alert(e.message))}
          >
            Capturar
          </button>
        </div>
      </div>
      <video ref={videoRef} autoPlay playsInline className="live-video" />
    </section>
  );
}
