# ROADMAP — Grabadora

Ruta de trabajo derivada de [SPEC.md](SPEC.md). Cada fase corresponde a las
fases M0–M4 de la sección 13 del spec e incluye sus criterios de aceptación.

## Cómo usar este documento

- Marca `[x]` cuando una tarea esté completada y verificada (no solo iniciada).
- Marca `[~]` para tareas en progreso.
- Los IDs entre paréntesis referencian requerimientos del spec
  (FR = funcional, TR = técnico, UC = caso de uso) para trazabilidad.
- Orden recomendado: M0 → M1 → M2 → M3 → M4. Dentro de cada fase, las tareas
  agrupadas bajo "puede ir en paralelo" se pueden trabajar simultáneamente.
- Una fase solo se da por terminada cuando cumplen sus criterios de aceptación
  y las validaciones transversales aplicables.

---

## Vista general

| Fase | Entregable principal | Depende de |
|------|----------------------|------------|
| M0 | Monorepo + backend mínimo con auth | — |
| M1 | Video en vivo cámara ↔ visor | M0 |
| M2 | Grabación local + eventos + nube | M1 |
| M3 | Notificaciones + configuración remota | M2 |
| M4 | Endurecimiento + despliegue operativo | M3 |

---

## M0 — Fundación

**Objetivo:** dejar el repositorio y el backend mínimo funcionando.
**Aceptación (spec 13):** `docker compose up` levanta backend y DB; login
funciona; lint y tests pasan.

### Estructura y repo

- [ ] Crear monorepo `grabadora` con `backend/`, `camera-app/`, `viewer/`,
      `docs/` y un `README.md` de arranque.
- [ ] Elegir y documentar versión de Node.js LTS, gestor de paquetes y scripts
      de desarrollo (`dev`, `lint`, `test`, `typecheck`).
- [ ] Configurar `.editorconfig`, `.gitignore`, `.env.example` (sin secretos)
      y commits iniciales.

### Backend mínimo (FR-01, TR-16, TR-17)

- [ ] Proyecto Node.js + Fastify con TypeScript y estructura de carpetas:
      `routes/`, `services/`, `db/`, `ws/`, `errors/`.
- [ ] Base SQLite con `better-sqlite3` y migraciones versionadas para
      `users`, `cameras`, `events` y `devices` (spec §7.1).
- [ ] Auth: `POST /api/auth/login`, `POST /api/auth/refresh` (rotación) y
      `POST /api/auth/logout`; hashing con argon2/bcrypt (FR-01, TR-16).
- [ ] Formato uniforme de errores `{ error: { code, message } }` (spec §8).
- [ ] `GET /api/health` con estado de DB.
- [ ] Middleware CORS, rate-limit básico en login y parseo de JWT.

### Infraestructura de desarrollo

- [ ] `docker-compose.yml` para backend + volumen de DB.
- [ ] CI básico: lint + tests en cada push (puede ser GitHub Actions).
- [ ] Tests iniciales: auth (login/refresh/logout) y formato de errores.

**Definición de terminado:** login e2e contra la DB en Docker; suite de tests
verde; `npm run lint` y `typecheck` sin errores.

---

## M1 — Video en vivo

**Objetivo:** ver en vivo la cámara desde el visor con latencia < 1.5 s.
**Aceptación (spec 13):** un Android y un PC en la misma red ven video en vivo
con latencia < 1.5 s; el visor se reconecta al cerrar/abrir sin recargar.

### Señalización en backend (TR-04, TR-05, TR-06, FR-09)

- [ ] Endpoint WebSocket (`wss://api/signaling`) con autenticación JWT.
- [ ] Salas por `camera_id` con roles `viewer` y `camera`; un solo visor activo
      por sala en v1 (con cola de espera simple).
- [ ] Mensajes `join`, `offer`, `answer`, `ice`, `leave`, `error` con
      validación de propiedad de la cámara antes de unir al visor (FR-09).
- [ ] Entrega de `iceServers`: STUN público configurable + TURN con
      credenciales efímeras (TR-05, TR-06).
- [ ] Heartbeat y limpieza de salas inactivas.

### App cámara (Android, TR-07, TR-08, TR-10)

- [ ] Proyecto Kotlin con CameraX (preview + captura) y SDK WebRTC
      (`org.webrtc`).
- [ ] Foreground service persistente con `PARTIAL_WAKE_LOCK`, pantalla apagada
      y notificación "Grabadora activa" (TR-08).
- [ ] Publisher WebRTC: H.264 + Opus, 720p/24 fps default (TR-01, TR-02).
- [ ] Cliente de señalización contra el backend con reconexión automática
      (UC-12).
- [ ] Bitrate adaptativo básico según calidad de red (TR-03).

### Visor (PWA)

- [ ] Proyecto React + Vite como PWA instalable.
- [ ] Login y persistencia segura del token (storage cifrado o HttpOnly vía
      cookie según decisión de despliegue).
- [ ] Lista de cámaras y vista de reproductor WebRTC con audio conmutable
      (FR-05, FR-06, FR-07).
- [ ] Estados: conectando / en vivo / reconectando / sin conexión (FR-08).
- [ ] Selector de calidad (auto, 480p, 720p, 1080p) (FR-06).

### Pruebas de M1

- [ ] Misma red local: latencia < 1.5 s.
- [ ] Redes distintas (casa ↔ datos móviles) con TURN.
- [ ] Reconexión al cerrar/abrir visor y al cambiar la cámara de Wi‑Fi.

---

## M2 — Grabación local y eventos

**Objetivo:** grabar continuo en el dispositivo y subir clips de movimiento a
la nube.
**Aceptación (spec 13):** un evento real genera clip en nube en < 30 s;
apagando el Wi‑Fi de la cámara el clip se sube al reconectar; el visor lo
reproduce.

### Grabación local (FR-10 a FR-14, TR-09)

- [ ] Grabación continua en segmentos MP4 de 60 s con `MediaRecorder`
      (configurable 30–300 s) (FR-10, TR-09).
- [ ] Índice de segmentos en SQLite local: `path`, timestamps, tamaño,
      estado de subida (spec §7.2).
- [ ] Retención local configurable (default 7 días) con borrado del más
      antiguo (FR-12).
- [ ] Alerta y degradación automática cuando el espacio libre cae bajo 2 GB
      (FR-14).
- [ ] Grabación independiente de internet y del visor (FR-11, TR-12).

### Detección de movimiento (FR-15 a FR-21, TR-10, TR-11)

- [ ] Ring buffer en memoria de 15 s (configurable) para pre-roll (FR-16).
- [ ] Detección por diferencia de luminancia sobre frames 160×90 sin ML
      (FR-15, TR-11).
- [ ] Sensibilidad configurable, zona de detección rectangular y franjas
      horarias (FR-20).
- [ ] Coalescing: un evento continuo genera un solo clip con cortes si hay
      actividad cada < 10 s (FR-18).
- [ ] Clip final = pre-roll 15 s + post-roll 30 s (defaults configurables)
      y thumbnail JPEG del primer frame (FR-17, FR-19).
- [ ] Pausa/reanudación de detección local (para FR-21 vía comando remoto en
      M3).

### Nube y cola de subida (FR-22 a FR-26, TR-13 a TR-15)

- [ ] Backend: `POST /api/uploads/presign` (PUT 10 min) y
      `POST /api/uploads/complete` (FR-22, TR-15).
- [ ] Cliente S3 en backend (R2 primario, B2 configurable) con buckets
      `grabadora-clips` y `grabadora-thumbs` (TR-13, TR-14).
- [ ] Nombres de clave: `clips/<camera_id>/<event_id>.mp4` y
      `thumbs/<camera_id>/<event_id>.jpg` (TR-14).
- [ ] Cola persistente en la cámara con reintentos y backoff exponencial
      (30 s → 5 min máx, 72 h) y subida en orden cronológico (FR-25, FR-26).
- [ ] Retención en nube configurable (default 30 días) y purga programada en
      backend (FR-24).

### API de eventos y visor (FR-34 a FR-37, UC-07)

- [ ] Endpoints: listar, detalle, video (302 → presigned GET 5 min),
      thumbnail y delete (spec §8.3).
- [ ] Visor: lista paginada por cámara y rango de fechas con thumbnail
      (FR-34).
- [ ] Visor: reproductor de clip con pausa/salto y hora local del evento
      (FR-35, FR-36).
- [ ] Eliminar clip con confirmación (FR-37); descargar clip (P2, FR-37).

### Pruebas de M2

- [ ] Evento real → clip en R2/B2 en < 30 s.
- [ ] Sin Wi‑Fi: la grabación local continúa y el clip se sube al reconectar.
- [ ] Retención local y en nube purgan correctamente.
- [ ] Coalescing: un solo clip por evento continuo.

---

## M3 — Notificaciones y configuración remota

**Objetivo:** alertas push y control de la cámara desde el visor.
**Aceptación (spec 13):** ocurre movimiento → push con thumbnail → tap abre el
clip; cambiar sensibilidad se refleja en la cámara en < 60 s.

### Notificaciones (FR-27 a FR-29, TR-18)

- [ ] Backend: registro de token FCM por dispositivo (`devices`, spec §7.1).
- [ ] Push al subir clip con thumbnail y enlace directo (FR-27).
- [ ] Silencio por cámara y por franja horaria (FR-28).
- [ ] Alerta "cámara sin conexión" tras 5 min sin contacto (FR-29).
- [ ] PWA: suscripción y manejo de push con deep link al clip.

### Configuración y comandos remotos (FR-30 a FR-33, UC-09 a UC-11)

- [ ] `PATCH /api/cameras/:id` para calidad/fps/bitrate, sensibilidad, zona,
      retención local/nube, nombre y zona (FR-31).
- [ ] `POST /api/cameras/:id/commands`: snapshot, pause/resume detección,
      reconfigure (FR-33, UC-11).
- [ ] Cámara: suscripción a cambios de configuración y ACK de comandos
      (FR-33).
- [ ] Snapshot: captura JPEG y la sube con presign; el visor la muestra.
- [ ] Visor: panel de estado con último contacto, señal Wi‑Fi, temperatura,
      espacio libre y calidad activa (FR-30).
- [ ] Desvinculación de cámara (`DELETE`) que revoca señalización y subidas
      (FR-32).

### Sincronización de reloj (TR-20, TR-21)

- [ ] Ajuste de reloj de la cámara al emparejar y cada 6 h.
- [ ] Todos los timestamps en UTC ISO-8601; conversión en el visor.

### Pruebas de M3

- [ ] Push llega con thumbnail y abre el clip correcto.
- [ ] Cambio de sensibilidad aplicado en < 60 s.
- [ ] Comando snapshot devuelve imagen en el visor.
- [ ] Cámara sin red > 5 min genera alerta de offline.

---

## M4 — Endurecimiento y despliegue

**Objetivo:** operación estable 24/7 y despliegue documentado.
**Aceptación (spec 13):** la cámara opera 72 h continuas sin reinicio manual;
sin pérdida de clips por caídas transitorias; documentación lista.

### Estabilidad del dispositivo (TR-08, TR-12)

- [ ] Monitoreo de temperatura y CPU con degradación automática (resolución,
      fps, pausa de detección; nunca la grabación local) (TR-12).
- [ ] Manejo de optimización de batería de Android (ignorar optimizaciones)
      y arranque tras reinicio del teléfono (BOOT_COMPLETED).
- [ ] Prueba real de 72 h enchufado con registro de temperatura y reinicios.

### Despliegue y operación (spec §10, §15)

- [ ] Dominio + TLS (Caddy o Nginx + Let's Encrypt) para API y visor
      (decisión abierta 1).
- [ ] TURN: decisión coturn autoalojado vs Cloudflare Calls según la red real
      (decisión abierta 2) y su despliegue.
- [ ] Scripts de despliegue del backend (Docker) con migraciones automáticas.
- [ ] Backup periódico de la base SQLite y rotación de logs.
- [ ] Monitoreo básico: healthcheck, alertas de espacio en nube y umbral de
      datos TURN (riesgo de costo, spec §12).
- [ ] `.env.example` completo y `README.md` operativo con pasos de despliegue.

### Seguridad (spec §10.3)

- [ ] Revisión de presigned URLs (TTL), rotación de refresh tokens y revocación
      al desvincular cámaras.
- [ ] Auditoría de logs: sin datos personales ni contenido de video.
- [ ] Prueba de acceso: usuario no autenticado no accede a cámaras, en vivo
      ni clips.

### Cierre

- [ ] Revisar criterios de aceptación globales (spec §14) uno por uno.
- [ ] Actualizar SPEC.md y ROADMAP.md con decisiones tomadas y desviaciones.
- [ ] Calibrar sensibilidad y retención con la cámara en su posición final
      (decisión abierta 4).

---

## Validaciones transversales

Antes de dar por terminada cualquier fase, verificar:

- [ ] `npm run lint`, `npm run typecheck` y tests verdes en backend y visor.
- [ ] Android: build de release sin errores y permisos declarados correctos.
- [ ] Sin secretos en el repositorio (revisar `.env*`, logs y git status).
- [ ] Sin dependencias de YouTube ni servicios públicos de video como
      almacenamiento (criterio global 6).
- [ ] Documentación actualizada cuando cambien comandos, variables o contratos.

---

## Notas de paralelización

- Después de M0, **backend de señalización** y **app cámara** se pueden
  construir en paralelo; el visor WebRTC depende de que exista el protocolo de
  señalización definido.
- En M2, **grabación local** y **detección de movimiento** se desarrollan en
  paralelo y se integran en el clip final.
- En M3, **push** y **configuración remota** son independientes entre sí.
