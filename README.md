# Grabadora

> Vigilancia en casa con un teléfono viejo que ya no usas.

**Grabadora** convierte cualquier Android viejo en una cámara de
videovigilancia 24/7: graba en continuo en su propia memoria, detecta
movimiento y te avisa al instante en tu otro teléfono. El video en vivo se ve
con menos de 1.5 segundos de retraso, y los clips importantes quedan guardados
en la nube por centavos al mes.

> **Nota:** este README describe el producto final (visión). El estado real de
> desarrollo y el plan de trabajo están en [ROADMAP.md](ROADMAP.md), y la
> especificación técnica en [SPEC.md](SPEC.md).

![Estado](https://img.shields.io/badge/estado-en%20desarrollo-orange)
![Visor](https://img.shields.io/badge/visor-PWA-blue)
![Cámara](https://img.shields.io/badge/cámara-Android%208%2B-green)
![Almacenamiento](https://img.shields.io/badge/storage-R2%2FB2-lightgrey)

---

## Características

### Video en vivo

- Transmisión en tiempo real por WebRTC, cifrada y directa entre tu cámara y tu
  teléfono (sin pasar por el servidor).
- Latencia menor a **1.5 segundos**, calidad ajustable (480p / 720p / 1080p) y
  bitrate adaptativo según tu red.
- Audio de la cámara en vivo, conmutable desde el visor.
- Reconexión automática: si el visor o la red se caen, vuelve solo.

### Grabación y eventos

- Grabación continua en segmentos MP4 **dentro del propio teléfono cámara**
  (tarjeta SD o memoria interna), con retención configurable (default 7 días).
- Funciona sin internet: aunque se corte el Wi‑Fi, la grabación no se detiene.
- Detección de movimiento en el dispositivo con sensibilidad, zona de
  detección y franjas horarias configurables.
- Cada evento genera un clip con contexto previo y posterior (15 s + 30 s por
  defecto) y su thumbnail.
- Los clips se suben automáticamente a **Cloudflare R2 / Backblaze B2** con
  reintentos si hay fallas de red; retención en nube configurable
  (default 30 días).

### Alertas y control remoto

- Notificaciones push con thumbnail cuando ocurre un evento.
- Alerta si una cámara queda sin conexión más de 5 minutos.
- Configuración remota de calidad, sensibilidad, retención y horarios desde el
  visor.
- Comandos remotos: captura de snapshot y pausa/reanudación de detección.
- Estado en vivo de cada cámara: señal Wi‑Fi, temperatura, espacio libre y
  última conexión.

### Privacidad y costo

- Acceso exclusivo del propietario: login con JWT, pairing por QR de un solo
  uso y enlaces firmados con vencimiento corto.
- El video en vivo viaja cifrado (DTLS/SRTP) y nunca pasa por el backend.
- Costo recurrente de aproximadamente **5–10 USD/mes** (VPS pequeño + storage
  de centavos); sin suscripciones por cámara.

---

## Cómo se ve

### Visor (PWA, tu otro teléfono o PC)

```text
┌──────────────────────────────────────────────┐
│  Grabadora                        [● Sala]  │
│  ┌────────────────────────────────────────┐ │
│  │                                        │ │
│  │          VIDEO EN VIVO                 │ │
│  │          (720p · 24 fps)               │ │
│  │                                        │ │
│  └────────────────────────────────────────┘ │
│  [Captura] [Audio] [Calidad: Auto ▾]        │
│                                              │
│  Eventos de hoy                              │
│  [thumb] 14:32 Sala  · 45 s   ▶  ⤓  🗑     │
│  [thumb] 09:05 Sala  · 1:02   ▶  ⤓  🗑     │
└──────────────────────────────────────────────┘
```

### App cámara (el teléfono viejo)

```text
┌───────────────────────────────┐
│  ● Grabadora activa           │   ← notificación persistente
│  ┌───────────────────────────┐│
│  │ (preview de la cámara)    ││
│  └───────────────────────────┘│
│  Estado: En línea · 34 °C     │
│  Espacio libre: 24 GB          │
│  Detección: Activa ▾           │
└───────────────────────────────┘
```

> Las capturas reales de pantalla se agregarán en la fase M1 (visor) y M2
> (cámara) según [ROADMAP.md](ROADMAP.md).

---

## Cómo funciona

```text
Teléfono viejo (cámara) ──WebRTC (en vivo)──▶ Tu teléfono (visor)
      │  ▲                                        │
      │  │ señalización (WSS)                     │
      ▼  │                                        ▼
   Backend (auth, eventos, push) ──────────▶ Object storage
      (Node.js + SQLite)                    (R2 / B2: clips + thumbs)
```

1. El teléfono viejo **graba en continuo de forma local** y detecta movimiento.
2. Cuando ocurre un evento, genera un clip corto y lo **sube directo a la
   nube** con una URL firmada (el backend nunca ve el video).
3. El backend registra el evento y te envía una **notificación push** con el
   thumbnail.
4. Para verlo **en vivo**, la cámara y tu teléfono negocian una conexión
   WebRTC directa usando al backend solo como intermediario de señalización.

---

## Stack tecnológico

| Componente | Tecnología |
|------------|------------|
| App cámara | Kotlin, CameraX, MediaRecorder, WebRTC Android SDK |
| Visor | React, Vite, PWA |
| Backend | Node.js, Fastify, WebSocket, better-sqlite3 |
| Storage | Cloudflare R2 (primario) / Backblaze B2 |
| TURN | coturn autoalojado (opcional) |
| Push | Firebase Cloud Messaging |
| Infraestructura | Docker, VPS pequeño con TLS (Caddy/Nginx) |

---

## Empezar (modo desarrollo)

Requisitos: Node.js 20+, Docker, Android Studio, un teléfono Android 8+ y una
cuenta en Cloudflare R2 o Backblaze B2.

```bash
# 1. Backend
cd backend
cp .env.example .env   # completa tus variables (sin secretos en git)
npm install
npm run migrate
npm run dev

# 2. Visor
cd ../viewer
npm install
npm run dev

# 3. App cámara
cd ../camera-app
# abre en Android Studio, compila el APK e instálalo en el teléfono viejo
```

Alternativa para levantar backend + base de datos:

```bash
docker compose up -d
```

### Primera vez

1. Crea tu cuenta de administrador (el backend expone una CLI o endpoint de
   bootstrap en desarrollo).
2. Abre el visor, inicia sesión y pulsa **"Agregar cámara"**.
3. En el teléfono viejo, abre la app y pulsa **"Emparejar"**; escanea el QR
   desde el visor.
4. Asigna nombre y zona (ej. "Sala", "Primer piso") y listo: verás el video
   en vivo y empezarás a recibir eventos.

---

## Estructura del proyecto

```text
grabadora/
├── backend/        # API REST, señalización WebSocket, push, presigned URLs
├── camera-app/     # App Android (Kotlin): captura, grabación, detección
├── viewer/         # PWA: video en vivo, clips, configuración
├── docs/           # Documentación operativa y de despliegue
├── docker-compose.yml
├── SPEC.md         # Especificación técnica
└── ROADMAP.md      # Ruta de trabajo
```

---

## Despliegue (resumen)

1. **Backend:** Docker en un VPS pequeño, con dominio y TLS (Caddy o Nginx +
   Let's Encrypt). Migraciones automáticas al arrancar.
2. **TURN:** coturn en el mismo VPS (o Cloudflare Calls) para garantizar el
   video en vivo detrás de redes estrictas.
3. **Storage:** crea los buckets `grabadora-clips` y `grabadora-thumbs` en R2
   (o B2) y configura las variables en `.env`.
4. **Visor:** compila la PWA y sírvela desde el mismo dominio (o CDN).
5. **Cámara:** instala el APK en el teléfono viejo, conéctalo a la corriente y
   a un Wi‑Fi estable, y actívalo como "cámara de vigilancia" en la app.

Guía detallada paso a paso: `docs/DEPLOY.md` (pendiente, fase M4).

---

## Variables de entorno principales

```env
# Backend
DATABASE_PATH=./data/grabadora.db
JWT_SECRET=...
REFRESH_SECRET=...
PUBLIC_BASE_URL=https://grabadora.ejemplo.com

# Cloudflare R2 / Backblaze B2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_CLIPS=grabadora-clips
R2_BUCKET_THUMBS=grabadora-thumbs

# Firebase Cloud Messaging
FCM_SERVICE_ACCOUNT=...

# TURN (opcional)
TURN_URL=turn:turn.ejemplo.com:3478
TURN_USERNAME=...
TURN_PASSWORD=...
```

> Nunca comprometas estos valores; usa `.env` local y secretos en el
> despliegue.

---

## Costos estimados

| Concepto | Costo mensual aprox. |
|----------|----------------------|
| VPS pequeño (backend + TURN) | 5 USD |
| Storage de clips (≈12 GB/mes) | ~0.08 USD |
| **Total** | **≈ 5–10 USD** |

---

## Seguridad y privacidad

- Autenticación con JWT de corta duración y refresh rotativo.
- Emparejamiento por QR de un solo uso con expiración.
- Buckets privados; todo acceso por URL firmada con vencimiento corto.
- Video en vivo cifrado (DTLS/SRTP) y directo entre dispositivos.
- Retención conservadora por defecto: 7 días local, 30 días en nube.
- Sin servicios públicos de video (p. ej. YouTube) como almacenamiento.

---

## Estado del proyecto

El avance real se controla en [ROADMAP.md](ROADMAP.md):

- [ ] M0 — Fundación y backend mínimo
- [ ] M1 — Video en vivo
- [ ] M2 — Grabación y eventos
- [ ] M3 — Notificaciones y configuración remota
- [ ] M4 — Endurecimiento y despliegue

---

## Licencia

Uso personal y educativo. Licencia por definir en la fase M4.
