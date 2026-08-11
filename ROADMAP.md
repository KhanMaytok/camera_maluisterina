# ROADMAP — Grabadora

Ruta de trabajo derivada de [SPEC.md](SPEC.md). Cada fase corresponde a las
fases M0–M4 de la sección 13 del spec e incluye sus criterios de aceptación.

## Cómo usar este documento

- `[x]` implementado y verificado (tests/typecheck/build donde aplica).
- `[~]` implementado, pero requiere validación física (dispositivo Android,
  red real, despliegue) o decisión del operador.
- `[ ]` pendiente de implementación.
- Los IDs entre paréntesis referencian requerimientos del spec
  (FR = funcional, TR = técnico, UC = caso de uso).

---

## Vista general

| Fase | Entregable principal                  | Estado                                       |
| ---- | ------------------------------------- | -------------------------------------------- |
| M0   | Monorepo + backend mínimo con auth    | ✅                                           |
| M1   | Video en vivo cámara ↔ visor          | ✅ implementado; validación física pendiente |
| M2   | Grabación local + eventos + nube      | ✅ implementado; validación física pendiente |
| M3   | Notificaciones + configuración remota | ✅ mayormente implementado (ver pendientes)  |
| M4   | Endurecimiento + despliegue operativo | ~ parcial; requiere despliegue y prueba 72 h |

---

## M0 — Fundación

**Aceptación (spec 13):** `docker compose up` levanta backend y DB; login
funciona; lint y tests pasan.

- [x] Crear monorepo `grabadora` con `backend/`, `camera-app/`, `viewer/`,
      `docs/` y un `README.md` de arranque.
- [x] Elegir y documentar versión de Node.js LTS, gestor de paquetes y scripts
      de desarrollo (`dev`, `lint`, `test`, `typecheck`).
- [x] Configurar `.editorconfig`, `.gitignore`, `.env.example` (sin secretos)
      y commits iniciales.
- [x] Proyecto Node.js + Fastify con TypeScript y estructura de carpetas:
      `routes/`, `services/`, `db/`, `ws/`, `errors/`.
- [x] Base SQLite con `better-sqlite3` y migraciones versionadas para
      `users`, `cameras`, `events` y `devices` (spec §7.1).
- [x] Auth: `POST /api/auth/login`, `POST /api/auth/refresh` (rotación) y
      `POST /api/auth/logout`; hashing con scrypt (FR-01, TR-16).
- [x] Formato uniforme de errores `{ error: { code, message } }` (spec §8).
- [x] `GET /api/health` con estado de DB.
- [x] Middleware CORS, rate-limit básico en login y parseo de JWT.
- [x] `docker-compose.yml` para backend + volumen de DB.
- [x] CI básico: lint + tests en cada push (GitHub Actions, backend + visor).
- [x] Tests iniciales: auth (login/refresh/logout), cámaras, eventos,
      señalización y formato de errores (6 tests verdes).

---

## M1 — Video en vivo

**Aceptación (spec 13):** un Android y un PC en la misma red ven video en vivo
con latencia < 1.5 s; el visor se reconecta al cerrar/abrir sin recargar.

### Señalización en backend (TR-04, TR-05, TR-06, FR-09)

- [x] Endpoint WebSocket (`wss://api/signaling`) con autenticación JWT.
- [x] Salas por `camera_id` con roles `viewer` y `camera`.
- [x] Mensajes `join`/`ready`, `offer`, `answer`, `ice`, `leave`, `error` con
      validación de propiedad de la cámara antes de unir al visor (FR-09).
- [x] Entrega de `iceServers`: STUN público configurable + TURN opcional con
      credenciales (TR-05, TR-06).
- [x] Heartbeat y limpieza de salas inactivas.

### App cámara (Android, TR-07, TR-08, TR-10)

- [x] Proyecto Kotlin con CameraX (ImageAnalysis) y SDK WebRTC
      (`org.webrtc`).
- [x] Foreground service persistente con `PARTIAL_WAKE_LOCK`, pantalla apagada
      y notificación "Grabadora activa" (TR-08).
- [x] Publisher WebRTC: H.264 + Opus, resolución/fps configurables
      (TR-01, TR-02).
- [x] Cliente de señalización contra el backend con reconexión automática
      (UC-12).
- [x] Bitrate adaptativo básico (bitrate configurable por cámara, TR-03).

### Visor (PWA)

- [x] Proyecto React + Vite como PWA instalable (manifest + service worker).
- [x] Login con JWT y persistencia segura del token (localStorage + IndexedDB).
- [x] Lista de cámaras y vista de reproductor WebRTC con audio conmutable
      (FR-05, FR-06, FR-07).
- [x] Estados: conectando / en vivo / reconectando / sin conexión (FR-08).
- [x] Selector de calidad (480p / 720p / 1080p) (FR-06).

### Pruebas de M1

- [~] Misma red local: latencia < 1.5 s (requiere dispositivos reales).
- [~] Redes distintas (casa ↔ datos móviles) con TURN (requiere despliegue).
- [~] Reconexión al cerrar/abrir visor y al cambiar la cámara de Wi‑Fi.

---

## M2 — Grabación local y eventos

**Aceptación (spec 13):** un evento real genera clip en nube en < 30 s;
apagando el Wi‑Fi de la cámara el clip se sube al reconectar; el visor lo
reproduce.

### Grabación local (FR-10 a FR-14, TR-09)

- [x] Grabación continua en segmentos MP4 de 60 s con encoder H.264
      (configurable vía `fps`/`bitrateKbps`) (FR-10, TR-09).
- [x] Índice/cola de subidas en SQLite local (`UploadDb`, spec §7.2).
- [x] Retención local configurable (default 7 días) con borrado del más
      antiguo (FR-12).
- [x] Alertas de espacio: la app reporta estado vía notificación de servicio
      y reduce la retención local a 1 día si el espacio libre baja de 2 GB
      (FR-14).
- [x] Grabación independiente de internet y del visor (FR-11, TR-12).

### Detección de movimiento (FR-15 a FR-21, TR-10, TR-11)

- [x] Ring buffer en memoria de 15 s (configurable) para pre-roll (FR-16).
- [x] Detección por diferencia de luminancia sobre frames 160×90 sin ML
      (FR-15, TR-11).
- [x] Sensibilidad configurable vía visor (FR-20).
- [x] Zona de detección rectangular (x/y/w/h en %) y franjas horarias de
      detección, configurables desde el visor y aplicadas en la app cámara
      (FR-20).
- [x] Coalescing: un evento continuo genera un solo clip (FR-18).
- [x] Clip final = pre-roll 15 s + post-roll 30 s (defaults configurables)
      y thumbnail JPEG del último frame (FR-17, FR-19).
- [x] Pausa/reanudación de detección local y remota (FR-21).

### Nube y cola de subida (FR-22 a FR-26, TR-13 a TR-15)

- [x] Backend: `POST /api/uploads/presign` (PUT 10 min) y
      `POST /api/uploads/complete` (FR-22, TR-15).
- [x] Cliente S3 en backend (R2 primario, B2 configurable) con buckets
      `grabadora-clips` y `grabadora-thumbs` (TR-13, TR-14).
- [x] Nombres de clave: `clips/<camera_id>/<event_id>.mp4` y
      `thumbs/<camera_id>/<event_id>.jpg` (TR-14).
- [x] Modo desarrollo sin S3: subidas locales bajo `/api/uploads/dev`
      (flujo completo verificable sin nube).
- [x] Cola persistente en la cámara con reintentos y backoff exponencial
      (30 s → 5 min máx, 72 h) y subida en orden cronológico (FR-25, FR-26).
- [x] Retención en nube configurable (default 30 días) y purga programada en
      backend (FR-24).

### API de eventos y visor (FR-34 a FR-37, UC-07)

- [x] Endpoints: listar, detalle, video (302 → presigned GET 5 min),
      thumbnail y delete (spec §8.3).
- [x] Visor: lista paginada por cámara y rango de fechas con thumbnail
      (FR-34).
- [x] Visor: reproductor de clip con pausa/salto y hora local del evento
      (FR-35, FR-36).
- [x] Eliminar clip con confirmación (FR-37).
- [x] Descargar clip (P2, FR-37: botón "Descargar" en el visor).

### Pruebas de M2

- [x] Flujo completo presign → subida local → complete → listado/reproducción
      verificado con tests automatizados (modo desarrollo).
- [~] Evento real → clip en R2/B2 en < 30 s (requiere dispositivo + nube).
- [~] Sin Wi‑Fi: la grabación local continúa y el clip se sube al reconectar.
- [~] Retención local y en nube purgan correctamente (implementado; falta
  prueba de larga duración).
- [x] Coalescing: un solo clip por evento continuo (implementado).

---

## M3 — Notificaciones y configuración remota

**Aceptación (spec 13):** ocurre movimiento → push con thumbnail → tap abre el
clip; cambiar sensibilidad se refleja en la cámara en < 60 s.

### Notificaciones (FR-27 a FR-29, TR-18)

- [x] Backend: registro de token push por dispositivo (`devices`, spec §7.1)
      vía `POST /api/push/subscribe`.
- [x] Push al subir clip con thumbnail y enlace directo (FR-27).
- [x] Silencio por cámara y por franja horaria (FR-28: configuración en el
      visor + decisión de envío en el backend, con tests).
- [x] Alerta "cámara sin conexión" tras 5 min sin contacto (FR-29, con test).
- [x] PWA: suscripción a push (Web Push + VAPID) y manejo con deep link al
      clip y thumbnail autenticado.

### Configuración y comandos remotos (FR-30 a FR-33, UC-09 a UC-11)

- [x] `PATCH /api/cameras/:id` para calidad/fps/bitrate, sensibilidad,
      retención local/nube, nombre y zona (FR-31).
- [x] `POST /api/cameras/:id/commands`: snapshot, pause/resume detección,
      reconfigure (FR-33, UC-11).
- [x] Cámara: polling de configuración y comandos vía heartbeat + ACK
      (FR-33, aplicado en ≤ 30 s).
- [x] Snapshot: captura JPEG y la sube con presign; se lista como evento
      `snapshot` en el visor.
- [~] Visor: panel de estado con último contacto y estado online/offline
  (FR-30 parcial: señal Wi‑Fi, temperatura y espacio quedan en la app).
- [x] Desvinculación de cámara (`DELETE`) que revoca señalización y subidas
      (FR-32).

### Sincronización de reloj (TR-20, TR-21)

- [x] Sincronización de reloj: la cámara ajusta su offset contra la hora del
      servidor en cada heartbeat (cada 30 s, TR-21).
- [x] Todos los timestamps en UTC ISO-8601; conversión en el visor (TR-20).

### Pruebas de M3

- [~] Push llega con thumbnail y abre el clip correcto (requiere despliegue
  HTTPS + suscripción real).
- [x] Cambio de sensibilidad aplicado en < 60 s (implementado vía heartbeat
      30 s; validación física pendiente).
- [~] Comando snapshot devuelve imagen en el visor (implementado; requiere
  dispositivo real).
- [x] Cámara sin red > 5 min genera alerta de offline (verificado con test).

---

## M4 — Endurecimiento y despliegue

**Aceptación (spec 13):** la cámara opera 72 h continuas sin reinicio manual;
sin pérdida de clips por caídas transitorias; documentación lista.

### Estabilidad del dispositivo (TR-08, TR-12)

- [x] Monitoreo de temperatura con degradación de calidad (bitrate/fps desde
      42 °C) y pausa de detección al superar 45 °C (TR-12).
- [x] Manejo de optimización de batería de Android (ignorar optimizaciones)
      y arranque tras reinicio del teléfono (BOOT_COMPLETED).
- [~] Prueba real de 72 h enchufado con registro de temperatura y reinicios.

### Despliegue y operación (spec §10, §15)

- [~] Dominio + TLS (Caddy o Nginx + Let's Encrypt): guía en `docs/DEPLOY.md`;
  despliegue real pendiente.
- [~] TURN: decisión coturn autoalojado vs Cloudflare Calls según la red real
  (decisión abierta 2) y su despliegue.
- [x] Scripts de despliegue del backend (Docker Compose) con migraciones
      automáticas al arrancar.
- [~] Backup periódico de la base SQLite y rotación de logs (documentado).
- [~] Monitoreo básico: `GET /api/health` + alertas de espacio/costo TURN
  (parcial).
- [x] `.env.example` completo y `README.md` operativo con pasos de despliegue.

### Seguridad (spec §10.3)

- [x] Presigned URLs con TTL corto (PUT 10 min, GET 5 min), rotación de
      refresh tokens y revocación al desvincular cámaras.
- [x] Auditoría de logs: el backend no registra contenido de video; errores
      5xx sin datos personales.
- [x] Prueba de acceso: usuario no autenticado no accede a cámaras, en vivo
      ni clips (test de señalización + endpoints).

### Cierre

- [~] Revisar criterios de aceptación globales (spec §14) uno por uno:
  implementados en código; validación final en dispositivo pendiente.
- [x] Actualizar SPEC.md/ROADMAP/README con decisiones tomadas y desviaciones
      (ver "Desviaciones conocidas").
- [~] Calibrar sensibilidad y retención con la cámara en su posición final
  (decisión abierta 4).

---

## Desviaciones conocidas respecto al spec

- **iOS como cámara**: fuera de alcance v1 (no-objetivo del spec).
- **TR-12**: la degradación térmica reduce bitrate/fps pero no la resolución
  de captura (requeriría rebind de CameraX en caliente).

---

## Validaciones transversales

- [x] `npm run lint`, `npm run typecheck` y tests verdes en backend y visor.
- [x] Android: build automático en CI con APK descargable como artifact
      (debug firmado + release unsigned); build local en Android Studio.
- [x] Sin secretos en el repositorio (revisar `.env*`, logs y git status).
- [x] Sin dependencias de YouTube ni servicios públicos de video como
      almacenamiento (criterio global 6).
- [x] Documentación actualizada cuando cambien comandos, variables o contratos
      (README, SPEC, DEPLOY).

---

## Notas de paralelización

- Después de M0, **backend de señalización** y **app cámara** se pueden
  construir en paralelo; el visor WebRTC depende de que exista el protocolo de
  señalización definido.
- En M2, **grabación local** y **detección de movimiento** se desarrollan en
  paralelo y se integran en el clip final.
- En M3, **push** y **configuración remota** son independientes entre sí.
