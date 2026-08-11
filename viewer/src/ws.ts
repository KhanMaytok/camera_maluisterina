export interface SignalMessage {
  type: string;
  [key: string]: unknown;
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  iceServers: RTCIceServer[] = [];

  constructor(
    private url: string,
    private handlers: {
      onReady?: (message: SignalMessage) => void;
      onMessage: (message: SignalMessage) => void;
      onStatus: (status: 'connecting' | 'live' | 'reconnecting' | 'offline') => void;
    },
  ) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    this.handlers.onStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.handlers.onStatus('connecting');
      // Mantiene la conexión viva: Nginx corta WebSockets inactivos a los 60 s.
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 20_000);
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as SignalMessage;
      if (message.type === 'ready') {
        this.iceServers = (message.iceServers as RTCIceServer[]) ?? [];
        this.handlers.onReady?.(message);
      } else {
        this.handlers.onMessage(message);
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.closed) return;
      this.handlers.onStatus('reconnecting');
      this.reconnectTimer = window.setTimeout(() => this.open(), 2000);
    };
    ws.onerror = () => ws.close();
  }

  send(message: SignalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
