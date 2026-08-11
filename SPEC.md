# Grabadora — Especificación del sistema

**Estado:** Borrador v1 — lista para desarrollo dirigido por especificación
**Última actualización:** 2026-08-11

---

## 1. Resumen ejecutivo

Grabadora es un sistema personal de videovigilancia construido sobre un teléfono
viejo reciclado:

- **Dispositivo cámara:** un Android viejo, siempre enchufado y con Wi‑Fi,
  ejecuta una app que captura video continuamente, lo graba localmente y
  permite verlo en vivo desde otro dispositivo.
- **Visor:** una aplicación web (PWA) en el otro teléfono, que muestra el
  video en vivo con baja latencia y permite consultar y reproducir clips de
  eventos.
- **Backend:** un servicio pequeño que autentica, hace de señalización para el
  video en vivo, guarda metadatos de eventos y envía notificaciones push.
- **Almacenamiento:**
  - **Local (en el teléfono cámara):** grabación continua, se sobrescribe
    después de N días.
  - **Nube (object storage S3-compatible):** solo clips de eventos con
    movimiento, con retención configurable.

### Decisión de diseño clave: descartar YouTube como almacenamiento

Se evaluó usar YouTube como almacenamiento "definitivo" para ahorrar espacio en
servidor y se descartó por:

- Violación de los términos de servicio de YouTube (uso como respaldo/almacenamiento).
- Ausencia de privacidad real y riesgo de borrado o suspensión de cuenta.
- Sin API confiable para leer/descargar/reproducir los propios videos.
- Sin garantías de retención; inaceptable para material de vigilancia.
- Latencia alta (10–30 s) si se transmitiera en vivo a YouTube.
- No ahorra ancho de banda de subida: el teléfono igual debe enviar el video.

En su lugar, la nube se usa solo para clips cortos de eventos (movimiento),
lo que reduce el almacenamiento y el costo a centavos por mes.

---

## 2. Objetivos y no-objetivos

### 2.1 Objetivos

1. Reutilizar un teléfono viejo como cámara de vigilancia 24/7 con costo casi nulo.
2. Ver video en vivo con latencia menor a 1.5 s desde otro teléfono o PC.
3. Grabar en continuo en el propio teléfono cámara sin depender de internet.
4. Detectar movimiento en el dispositivo y subir solo clips relevantes a la nube.
5. Recibir notificaciones push cuando ocurre un evento.
6. Consultar y reproducir clips por fecha y cámara desde el visor.
7. Operar con privacidad y seguridad: solo el propietario accede a las cámaras.
8. Minimizar costos recurrentes: backend pequeño + object storage barato.

### 2.2 No-objetivos (fuera de alcance v1)

- App de cámara en iOS (las restricciones de segundo plano lo dificultan; se
  evalúa en v2).
- Grabación 24/7 en la nube.
- Reconocimiento facial, de personas, placas o IA avanzada (solo detección de
  movimiento simple).
- Multiusuario o compartición pública de cámaras.
- Audio bidireccional (solo audio de la cámara hacia el visor en v1).
- Salida RTSP/ONVIF para integración con NVR de terceros.
- Aplicación nativa del visor en v1 (se usa PWA; la app nativa es v2).

---

## 3. Actores y casos de uso

### 3.1 Actores

- **Propietario (usuario):** persona que ve en vivo, consulta clips y configura
  las cámaras. En v1 es un único usuario administrador.
- **Dispositivo cámara:** el teléfono viejo con la app de cámara instalada.
- **Backend:** servicio central de autenticación, señalización, metadatos y push.
- **Storage local:** tarjeta SD/almacenamiento interno del teléfono cámara.
- **Storage en nube:** bucket S3-compatible (Cloudflare R2 o Backblaze B2).

### 3.2 Casos de uso

| ID | Caso de uso | Actor | Prioridad |
|----|-------------|-------|-----------|
| UC-01 | Emparejar una cámara nueva con la cuenta | Propietario + Cámara | P0 |
| UC-02 | Ver video en vivo de una cámara | Propietario | P0 |
| UC-03 | Grabar continuamente en el dispositivo | Cámara | P0 |
| UC-04 | Detectar movimiento y generar clip | Cámara | P0 |
| UC-05 | Subir clip de evento a la nube | Cámara + Backend | P0 |
| UC-06 | Recibir notificación push de evento | Backend + Propietario | P1 |
| UC-07 | Listar y reproducir clips por fecha/cámara | Propietario | P0 |
| UC-08 | Descargar o eliminar un clip | Propietario | P2 |
| UC-09 | Configurar calidad, sensibilidad y retención por cámara | Propietario | P1 |
| UC-10 | Ver estado en línea y salud del dispositivo | Propietario | P1 |
| UC-11 | Comando de snapshot (foto puntual) | Propietario | P2 |
| UC-12 | Reconexión automática tras caída de red | Cámara + Backend | P0 |

---

## 4. Arquitectura general

```text
                    ┌──────────────────────────────────────────────┐
                    │                 Backend (VPS)                 │
                    │  API REST (auth, eventos, presign, config)    │
                    │  WebSocket de señalización (WebRTC)           │
                    │  Notificaciones push (FCM)                    │
                    │  Base de datos (metadatos)                    │
                    └───────▲───────────────────────▲───────────────┘
                            │ REST/WS (HTTPS/WSS)   │ REST/WS
              ┌─────────────┴──────────┐  ┌─────────┴──────────────┐
              │  Teléfono cámara (viejo)│  │   Visor (PWA / otro    │
              │  Android                │  │   teléfono o PC)       │
              │  ┌────────────────────┐ │  │  WebRTC (reproductor)  │
              │  │ Captura + encode   │ │  │  Lista de clips        │
              │  │ Grabación local    │ │  │  Notificaciones        │
              │  │ Detección mov.     │ │  └───────────▲────────────┘
              │  │ Cola de subida     │ │              │
              │  └─────────┬──────────┘ │              │
              └────────────┼────────────┘              │
                           │ WebRTC (video en vivo)    │
                           ▼                           │
              ┌──────────────────────────┐             │
              │ STUN público / TURN      │             │
              │ (solo si NAT lo exige)   │             │
              └──────────────────────────┘             │
                           │                           │
                           ▼                           │
              ┌──────────────────────────┐             │
              │ Object storage (R2/B2)   │◄────────────┘
              │ buckets: clips, thumbs   │   presigned URL (subida)
              └──────────────────────────┘
```

### 4.1 Comunicaciones

- **Control y metadatos:** HTTPS (API REST) entre los tres componentes.
- **Video en vivo:** WebRTC directo cámara ↔ visor, con señalización a través
  del backend. El backend nunca ve ni retransmite el video.
- **Subida de clips:** el backend genera una URL firmada (presigned PUT); la
  cámara sube el clip directamente al object storage.
- **Notificaciones:** el backend envía push (FCM) al visor cuando llega un clip.

---

## 5. Requerimientos funcionales

### 5.1 Emparejamiento y cuenta (P0)

- FR-01: El sistema tiene un único usuario administrador con login por
  usuario/contraseña y JWT de acceso + refresh.
- FR-02: Para agregar una cámara, la app de cámara muestra un código QR con un
  *pairing token* de un solo uso. El propietario lo escanea desde el visor
  (o lo ingresa manualmente) y el backend vincula cámara ↔ cuenta.
- FR-03: El emparejamiento incluye nombre de cámara, zona/habitación y
  configuración inicial (calidad, sensibilidad, retención).
- FR-04: El pairing token expira a los 10 minutos o al primer uso.

### 5.2 Video en vivo (P0)

- FR-05: El visor puede abrir una cámara y ver video en vivo con latencia
  objetivo < 1.5 s (p95).
- FR-06: El visor muestra calidad ajustable (auto, 480p, 720p, 1080p) y
  botón de captura de snapshot.
- FR-07: El video en vivo incluye audio de la cámara (mutable desde el visor).
- FR-08: Si se pierde la conexión, el visor indica "reconectando" y se
  restablece automáticamente sin recargar la página.
- FR-09: Solo el propietario autenticado puede solicitar una sesión en vivo;
  el backend valida el rol de visor antes de permitir la señalización.

### 5.3 Grabación local continua (P0)

- FR-10: La cámara graba continuamente en segmentos MP4 de 60 s
  (configurable 30–300 s), escritos en almacenamiento local/SD.
- FR-11: La grabación sigue funcionando sin internet y sin sesión del visor.
- FR-12: Retención local configurable (default 7 días); al superarla se
  eliminan los segmentos más antiguos.
- FR-13: Los segmentos se nombran con marca de tiempo UTC
  (`cam_<id>_<yyyyMMdd_HHmmss>_<seq>.mp4`).
- FR-14: Si el espacio disponible cae bajo un umbral (default 2 GB), se
  reduce la retención automáticamente y se registra una alerta.

### 5.4 Detección de movimiento y clips (P0)

- FR-15: La cámara detecta movimiento comparando fotogramas reducidos
  (diferencia de luminancia) con umbral y sensibilidad configurables.
- FR-16: Hay un *ring buffer* en memoria de al menos 15 s de video
  (configurable) para incluir contexto previo al evento.
- FR-17: Al detectar movimiento se genera un clip de `pre-roll + post-roll`
  (default 15 s + 30 s, configurable).
- FR-18: Un mismo evento continuo genera un solo clip: el movimiento
  se "coalesce" si hay actividad cada < 10 s.
- FR-19: Por cada clip se genera un thumbnail (JPEG) del primer frame.
- FR-20: El usuario puede configurar zona de detección (rectángulo dentro del
  frame) y franja horaria de detección por cámara.
- FR-21: La detección se puede pausar/activar remotamente desde el visor.

### 5.5 Clips y nube (P0)

- FR-22: Los clips se suben al object storage mediante presigned URL generada
  por el backend; la cámara nunca guarda credenciales de la nube.
- FR-23: El backend registra metadatos de cada clip: cámara, inicio/fin UTC,
  duración, tamaño, thumbnail, nivel de movimiento, estado de subida.
- FR-24: Retención en nube configurable por cámara (default 30 días); al
  vencer, clips y thumbnails se eliminan.
- FR-25: Si la subida falla, el clip queda en cola local persistente y se
  reintenta con backoff exponencial (30 s → 5 min máx) hasta 72 h.
- FR-26: Los clips se suben en orden cronológico para preservar la secuencia.

### 5.6 Notificaciones (P1)

- FR-27: Al subir un clip nuevo, el backend envía push al visor con thumbnail
  y enlace directo al clip.
- FR-28: El usuario puede silenciar notificaciones por cámara y por franja
  horaria.
- FR-29: Si la cámara queda offline más de 5 minutos, se envía una
  notificación de "cámara sin conexión".

### 5.7 Configuración y estado (P1)

- FR-30: El visor muestra por cámara: estado en línea, último contacto, señal
  Wi‑Fi, temperatura, batería (si aplica), espacio libre, calidad activa.
- FR-31: El propietario puede cambiar desde el visor: resolución/fps, bitrate,
  sensibilidad de movimiento, zona, retención local y en nube, nombre/zona.
- FR-32: El propietario puede eliminar el vínculo de una cámara (deja de subir
  clips y de aceptar señalización).
- FR-33: La cámara confirma comandos remotos con ACK y los aplica en vivo.

### 5.8 Visor: clips y reproducción (P0)

- FR-34: El visor lista clips paginados por cámara y rango de fechas, con
  thumbnail y duración.
- FR-35: La reproducción de un clip usa URL firmada de corta duración (5 min).
- FR-36: El visor permite reproducir, pausar y saltar; se muestra la hora del
  evento en hora local del visor.
- FR-37: El visor permite descargar y eliminar clips individuales (P2 para
  descarga, P0 para eliminar con confirmación).

---

## 6. Requerimientos técnicos

### 6.1 Streaming en vivo (WebRTC)

- TR-01: Video H.264 (baseline/main) y audio Opus.
- TR-02: Resoluciones: 480p, 720p y 1080p a 15/24/30 fps configurables;
  default 720p/24 fps.
- TR-03: Bitrate adaptativo según red (min 500 kbps, max 4 Mbps).
- TR-04: Señalización por WebSocket (`wss://`) con mensajes JSON:
  `join`, `offer`, `answer`, `ice`, `leave`, `error`.
- TR-05: STUN público configurable (default listas estándar) y TURN
  configurable (coturn autoalojado o servicio externo); el backend entrega
  credenciales efímeras de TURN al visor y la cámara.
- TR-06: ICE con `iceServers` inyectados por el backend en cada sesión.

### 6.2 Captura y grabación en el dispositivo

- TR-07: Android 8.0+ (API 26+), en v1 la app de cámara es Android nativo
  (Kotlin) con CameraX + MediaRecorder (segmentación MP4) y SDK WebRTC de
  Google (`org.webrtc`).
- TR-08: Servicio en primer plano con notificación persistente ("Grabadora
  activa"), `PARTIAL_WAKE_LOCK` y pantalla apagada.
- TR-09: Los segmentos se escriben con `MediaMuxer`/`MediaRecorder`; el índice
  de segmentos se guarda en SQLite local.
- TR-10: El ring buffer de pre-roll usa el mismo encoder (grabación circular en
  memoria) o re-encode del buffer; se elige la opción de menor CPU.
- TR-11: Detección de movimiento sobre fotogramas a 160×90 (downscale) en YUV;
  umbral de diferencia configurable; sin dependencias de ML en v1.
- TR-12: El dispositivo monitorea temperatura y CPU; si la temperatura supera
  un umbral (default 42 °C) degrada resolución/fps y, si persiste, pausa la
  detección (nunca la grabación local).

### 6.3 Nube y backend

- TR-13: Object storage S3-compatible; **Cloudflare R2** como primario
  (sin costo de egress) y **Backblaze B2** como alternativa.
- TR-14: Buckets: `grabadora-clips` (video MP4) y `grabadora-thumbs` (JPEG).
  Claves: `clips/<camera_id>/<event_id>.mp4` y
  `thumbs/<camera_id>/<event_id>.jpg`.
- TR-15: Subida y descarga siempre por presigned URL con TTL corto
  (PUT 10 min, GET 5 min).
- TR-16: Backend en Node.js (Fastify) con WebSocket de señalización,
  autenticación JWT (access 1 h, refresh 30 días con rotación).
- TR-17: Base de datos: SQLite (better-sqlite3) para despliegue personal en v1;
  el esquema es portable a PostgreSQL si se requiere multiusuario.
- TR-18: Push con Firebase Cloud Messaging (FCM); el visor PWA registra token.
- TR-19: HTTPS/WSS obligatorio en todo el tráfico salvo el media WebRTC, que ya
  viaja cifrado (DTLS/SRTP).

### 6.4 Tiempo y reloj

- TR-20: Todos los timestamps viajan en UTC ISO-8601; el visor los convierte a
  hora local.
- TR-21: La cámara sincroniza su reloj (NTP o ajuste por respuesta del backend)
  al emparejar y cada 6 h; la deriva se reporta como métrica.

---

## 7. Modelo de datos

### 7.1 Backend (SQLite)

**users**

| Campo | Tipo | Notas |
|-------|------|-------|
| id | INTEGER PK | |
| username | TEXT UNIQUE | |
| password_hash | TEXT | bcrypt/argon2 |
| created_at | TEXT | UTC ISO-8601 |

**cameras**

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | UUID |
| user_id | INTEGER FK | |
| name | TEXT | ej. "Sala" |
| zone | TEXT | ej. "Primer piso" |
| pairing_token_hash | TEXT NULL | hash del token de un solo uso |
| pairing_expires_at | TEXT NULL | |
| status | TEXT | `offline`, `online`, `degraded` |
| last_seen_at | TEXT NULL | |
| config | JSON | calidad, fps, sensibilidad, zona, retención local/nube |
| created_at | TEXT | |

**events**

| Campo | Tipo | Notas |
|-------|------|-------|
| id | TEXT PK | UUID del evento/clip |
| camera_id | TEXT FK | |
| started_at | TEXT | UTC |
| ended_at | TEXT | UTC |
| duration_sec | INTEGER | |
| motion_level | REAL | 0–1 |
| thumb_key | TEXT | clave S3 |
| video_key | TEXT | clave S3 |
| size_bytes | INTEGER | |
| upload_status | TEXT | `pending`, `uploaded`, `failed` |
| created_at | TEXT | |

**devices / push**

| Campo | Tipo | Notas |
|-------|------|-------|
| id | INTEGER PK | |
| user_id | INTEGER FK | |
| kind | TEXT | `viewer`, `camera` |
| push_token | TEXT NULL | FCM |
| created_at | TEXT | |

### 7.2 Dispositivo cámara (SQLite local)

- `config`: configuración activa (espejo de la del backend).
- `segments`: `path`, `started_at`, `ended_at`, `size_bytes`, `uploaded` (0/1).
- `queue_uploads`: clips pendientes: `event_id`, `local_path`, `retry_count`,
  `next_retry_at`.
- `pairing`: estado de emparejamiento y credencial de dispositivo.

---

## 8. API y contratos

Base URL: `https://api.grabadora.local` (dominio real por definir).
Formato de errores uniforme:

```json
{ "error": { "code": "CAMERA_NOT_FOUND", "message": "..." } }
```

### 8.1 Autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | `{username, password}` → `{access_token, refresh_token}` |
| POST | `/api/auth/refresh` | rotación de refresh |
| POST | `/api/auth/logout` | revoca refresh |

### 8.2 Cámaras

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/cameras` | lista del propietario |
| POST | `/api/cameras/pair` | `{pairing_token, name, zone}` → cámara vinculada |
| GET | `/api/cameras/:id` | detalle + estado |
| PATCH | `/api/cameras/:id` | actualiza config |
| DELETE | `/api/cameras/:id` | desvincula cámara |
| POST | `/api/cameras/:id/commands` | `{type: snapshot \| pause_detection \| resume_detection \| reconfigure}` |

### 8.3 Eventos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/events?camera_id&from&to&page` | lista paginada |
| GET | `/api/events/:id` | metadatos |
| GET | `/api/events/:id/video` | 302 → presigned GET (5 min) |
| GET | `/api/events/:id/thumbnail` | 302 → presigned GET |
| DELETE | `/api/events/:id` | elimina clip + thumbnail |

### 8.4 Subida (cámara)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/uploads/presign` | `{camera_id, event_id, content_type, size}` → `{put_url, video_key, thumb_url, thumb_key}` |
| POST | `/api/uploads/complete` | marca evento como `uploaded` con metadatos finales |

### 8.5 Señalización (WebSocket)

- Cliente visor → `{type:"join", camera_id, role:"viewer"}`
- Cliente cámara → `{type:"join", camera_id, role:"camera"}`
- Intercambio: `offer`, `answer`, `ice` (reenviados entre pares).
- El backend autentica el WS con JWT y valida que el visor sea dueño de la cámara.

### 8.6 Push (FCM)

- `notification` con `title`, `body`, `data: {event_id, camera_id, camera_name}`
  y `image` (thumbnail pública de corta duración o presigned).

---

## 9. Flujos principales

### 9.1 Emparejamiento

1. El usuario instala la app de cámara y pulsa "Emparejar".
2. La app genera un pairing token (PKCE-like) y muestra un QR.
3. El usuario escanea el QR desde el visor (logueado) y asigna nombre/zona.
4. El backend crea la cámara y devuelve credenciales de dispositivo
   (client_id/secret de largo plazo o certificado).
5. La cámara confirma y descarga su configuración inicial.
6. El token queda invalidado; la cámara aparece en línea.

### 9.2 Video en vivo

1. El visor abre la cámara; el backend verifica propiedad y entrega
   `iceServers` (STUN + TURN efímero si está configurado).
2. Ambos pares se unen a la sala WebSocket de la cámara.
3. Intercambio offer/answer/ICE hasta establecer el peer WebRTC directo.
4. El video fluye P2P; el backend solo presencia la señalización.
5. Al cerrar el visor se envía `leave` y se libera la sala.

### 9.3 Evento de movimiento

1. La cámara detecta movimiento y mantiene un clip en curso
   (coalesce actividad; pre-roll ya capturado en ring buffer).
2. Al terminar (sin movimiento por 10 s o duración máx 2 min), finaliza el clip
   y genera thumbnail.
3. Pide presign al backend y sube clip + thumbnail al object storage.
4. Notifica `uploads/complete`; el backend guarda el evento.
5. El backend envía push al visor con enlace al clip.

### 9.4 Caída de red / offline

1. La cámara pierde Wi‑Fi: la grabación local continúa; los clips pasan a la
   cola local con estado `pending`.
2. Al recuperar red, la cámara se autentica y sube clips en orden con backoff.
3. El backend marca `last_seen_at`; si pasa > 5 min, envía "cámara sin conexión".
4. El visor muestra estado `offline` y el botón de en vivo deshabilitado.

---

## 10. Requisitos no funcionales

### 10.1 Rendimiento

- Latencia en vivo: **< 1.5 s** p95 (red hogareña razonable).
- Subida de clip: **< 30 s** desde el fin del evento (en línea).
- Carga del backend: soporta 1 usuario, hasta 4 cámaras y ~1 clip/min por
  cámara sin degradación.
- Consumo del teléfono cámara: CPU < 30 % a 720p/24 fps; sin rebasamiento
  térmico en uso continuo enchufado.

### 10.2 Disponibilidad

- Grabación local garantizada incluso con internet caído.
- Reconexión automática con backoff en todos los componentes.
- Clips nunca se pierden por fallos transitorios de red (cola persistente 72 h).

### 10.3 Seguridad

- HTTPS/WSS obligatorio; JWT de corta duración + refresh con rotación.
- Presigned URLs con TTL corto; nunca se exponen credenciales de nube al
  dispositivo.
- El media WebRTC viaja cifrado (DTLS/SRTP) P2P.
- Los pairing tokens son de un solo uso y expiran.
- Logs sin datos personales de video; metadatos mínimos.

### 10.4 Privacidad

- El propietario es el único con acceso (v1, usuario único).
- Los clips en nube son privados por defecto; cualquier enlace es firmado.
- Política de retención por defecto conservadora (local 7 días, nube 30 días).

### 10.5 Costos estimados

- Backend: VPS pequeño (~5 USD/mes) o alternativas serverless para uso personal.
- Storage: R2/B2 solo clips; con 1 cámara y ~50 eventos/día de ~45 s a 720p
  (~8 MB), ≈ 12 GB/mes ≈ **0.08 USD/mes** en R2/B2.
- TURN: autoalojado en el mismo VPS (gratis) o Cloudflare Calls (costo solo si
  se requiere relay).

### 10.6 Portabilidad

- El esquema de backend es portable de SQLite a PostgreSQL.
- El visor PWA funciona en cualquier navegador moderno (Android, iOS, PC).

---

## 11. Stack sugerido

| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| App cámara | Kotlin + CameraX + MediaRecorder + WebRTC Android SDK | Acceso robusto a cámara y segundo plano en Android |
| Visor | React + Vite + PWA + librería WebRTC (adaptador estándar) | Un solo visor para móvil y PC, sin tienda |
| Backend | Node.js + Fastify + `ws` + better-sqlite3 | Pequeño, bajo consumo, WebSocket nativo |
| Señalización | WebSocket con salas por cámara | Simple y suficiente para 1–4 cámaras |
| Object storage | Cloudflare R2 (primario) / Backblaze B2 (alternativa) | Barato, S3-compatible, sin egress (R2) |
| TURN | coturn autoalojado (opcional) | Garantiza conexión en NAT estricto |
| Push | Firebase Cloud Messaging | Estándar en Android y PWA |
| NTP/reloj | Ajuste vía backend | Sincroniza timestamps de eventos |

---

## 12. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Calor/batería del teléfono viejo | Apagado o degradación | Enchufado + monitoreo térmico + degradación automática; límite de calidad por dispositivo |
| Restricciones de Android en segundo plano | Detención de la app | Foreground service + wake lock parcial + guías de batería (ignorar optimizaciones) |
| NAT/CGNAT impide conexión P2P | Sin video en vivo | TURN configurado; el sistema degrada a relay solo cuando es necesario |
| Pérdida de SD/teléfono | Pérdida de grabación local | Clips de eventos en nube; opcional duplicar segmentos recientes |
| Cuenta de nube comprometida | Exposición de clips | Buckets privados, presigned URLs, rotación de credenciales, retención corta |
| Deriva de reloj | Timestamps incorrectos | Sincronización NTP/backend periódica; corrección reportada |
| Costo de egress TURN | Factura inesperada | Límite de bitrate y aviso si el relay supera X GB/mes |

---

## 13. Fases y entregables

### M0 — Fundación (1–2 días)

- Repositorio `grabadora` con estructura monorepo: `backend/`, `camera-app/`,
  `viewer/`, `docs/`.
- Backend mínimo: auth JWT, modelo SQLite, healthcheck.
- Documento de arquitectura validado contra esta spec.

**Aceptación:** `docker compose up` levanta backend y DB; login funciona;
  checks de lint/test pasan.

### M1 — Video en vivo (3–5 días)

- App cámara: preview + WebRTC publisher.
- Backend: señalización WebSocket con salas.
- Visor PWA: login + reproductor WebRTC.
- STUN configurado; TURN opcional.

**Aceptación:** un teléfono Android y un PC en la misma red ven video en vivo
  con latencia < 1.5 s; se reconecta al cerrar/abrir el visor.

### M2 — Grabación y eventos (4–6 días)

- Grabación local en segmentos MP4 con retención.
- Detección de movimiento + ring buffer + clips + thumbnails.
- Presign + subida a R2/B2 + cola offline.
- Endpoints de eventos y reproducción en el visor.

**Aceptación:** un evento real genera clip en nube en < 30 s; apagando el Wi‑Fi
  de la cámara, el clip se sube al reconectar; el visor lo reproduce.

### M3 — Notificaciones y configuración (3–5 días)

- FCM push con thumbnail.
- Config remota (calidad, sensibilidad, zona, retención, franjas).
- Estado de cámara en línea/salud y comandos remotos.

**Aceptación:** ocurre movimiento → push con thumbnail → tap abre el clip;
  cambiar sensibilidad se refleja en la cámara en < 60 s.

### M4 — Endurecimiento (3–5 días)

- Pruebas en condiciones reales: 24 h enchufada, caídas de red, NAT estricto,
  temperatura.
- Retención, purga de clips, copias de seguridad de DB.
- Documentación de operación y despliegue.

**Aceptación:** la cámara opera 72 h continuas sin reinicio manual; sin pérdida
  de clips por caídas transitorias; documentación lista para despliegue propio.

---

## 14. Criterios de aceptación globales

1. Un teléfono Android viejo funciona como cámara 24/7 enchufado, sin
   intervención manual y con degradación automática ante calor.
2. El visor (PWA) muestra video en vivo con latencia < 1.5 s y reproducción de
   clips con búsqueda por fecha/cámara.
3. La grabación local sobrevive caídas de internet; los clips de eventos llegan
   a la nube con reintentos.
4. Solo el propietario autenticado accede a cámaras, en vivo y clips.
5. Los costos recurrentes son predecibles y menores a ~10 USD/mes.
6. No se usa YouTube ni ningún servicio público de video como almacenamiento.

---

## 15. Decisiones abiertas para la implementación

1. **Dominio/TLS del backend:** definir dominio y aprovisionamiento (Caddy,
   Nginx + Let's Encrypt, o plataforma serverless).
2. **TURN:** decidir si el VPS corre coturn o se usa un servicio externo
   (Cloudflare Calls) según la red del hogar real.
3. **Visor PWA vs app nativa:** v1 usa PWA; confirmar si el segundo teléfono
   requiere instalación desde tienda (v2).
4. **Volumen de eventos real:** calibrar sensibilidad y retención con la cámara
   instalada en su posición final.

---

## 16. Glosario

- **P2P:** conexión directa entre dispositivos (peer-to-peer).
- **WebRTC:** estándar de video/audio en tiempo real con cifrado.
- **STUN/TURN:** servidores que ayudan a establecer y, si es necesario,
  retransmitir la conexión P2P.
- **Presigned URL:** URL firmada con permisos limitados y vencimiento.
- **Ring buffer:** buffer circular que conserva los últimos N segundos.
- **PWA:** aplicación web instalable con soporte de notificaciones y offline.
- **Pre-roll/post-roll:** segundos antes y después del inicio del movimiento.
