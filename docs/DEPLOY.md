# Guía de despliegue — Grabadora

Guía operativa para poner el sistema en producción. Asume un VPS con Docker y
un dominio propio (ej. `grabadora.midominio.com`).

## 1. Requisitos

- VPS (1 CPU / 1 GB RAM es suficiente para uso personal) con Docker y
  Compose.
- Dominio con DNS apuntando al VPS.
- Cuenta en Cloudflare R2 o Backblaze B2 (opcional: en desarrollo se puede
  usar el almacenamiento local del backend).
- Un teléfono Android 8+ para la app cámara y cualquier navegador moderno
  para el visor.

## 2. Almacenamiento en la nube (R2 o B2)

1. Crea dos buckets:
   - `grabadora-clips` (videos MP4)
   - `grabadora-thumbs` (thumbnails JPEG y snapshots)
2. Genera credenciales de acceso con permiso `PutObject`, `GetObject` y
   `DeleteObject` sobre ambos buckets.
3. En R2 copia el `S3 endpoint` de la cuenta:
   `https://<account_id>.r2.cloudflarestorage.com`.
4. Anota `Access Key ID` y `Secret Access Key`.

> El backend nunca guarda estas credenciales en el teléfono: genera URLs
> firmadas de corta duración para cada subida/descarga.

## 3. Backend

```bash
git clone <repo> grabadora && cd grabadora
cp backend/.env.example .env
```

Edita `.env` con valores reales (genera secretos largos con
`openssl rand -hex 32`). Valores clave:

```env
JWT_SECRET=<secreto largo>
REFRESH_SECRET=<otro secreto largo>
STORAGE_ENABLED=true
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET_CLIPS=grabadora-clips
S3_BUCKET_THUMBS=grabadora-thumbs
PUSH_ENABLED=true
STUN_URLS=stun:stun.l.google.com:19302
TURN_URL=turn:turn.midominio.com:3478
TURN_USERNAME=...
TURN_PASSWORD=...
```

Levanta el backend:

```bash
docker compose up -d backend
```

### TLS (Caddy recomendado)

Ejemplo con Caddy:

```caddyfile
grabadora.midominio.com {
    reverse_proxy localhost:3000
}
```

Si prefieres Nginx + Let's Encrypt, usa certbot y proxy inverso con soporte
WebSocket:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Actualiza `PUBLIC_BASE_URL` a `https://grabadora.midominio.com`.

## 4. Visor (PWA)

Compila y sirve con Nginx (docker-compose ya incluye el servicio `viewer`):

```bash
docker compose up -d viewer
```

El visor queda en `http://<ip>:8080` (o detrás de Caddy en el mismo dominio).
Al abrirlo por HTTPS, el navegador permite instalar la PWA y activar
notificaciones push.

Si despliegas el visor en un dominio distinto al backend, configura
`VITE_API_BASE` en el build y ajusta `CORS_ORIGINS` en el backend.

## 5. TURN (opcional pero recomendado)

Si el teléfono viejo está detrás de CGNAT, el video en vivo necesita relay:

```bash
docker run -d --restart=always --name coturn \
  -p 3478:3478 -p 3478:3478/udp -p 49152-65535:49152-65535/udp \
  -e TURN_SERVER_NAME=grabadora.midominio.com \
  -e TURN_REALM=grabadora.midominio.com \
  -e TURN_USERNAME=usuario -e TURN_PASSWORD=clave \
  coturn/coturn
```

Registra las credenciales en el `.env` del backend (`TURN_URL`,
`TURN_USERNAME`, `TURN_PASSWORD`) y reinicia el contenedor.

## 6. App cámara (Android)

1. Abre `camera-app/` en Android Studio (Android SDK 35).
2. Compila el APK (`Build > Build APK`).
3. Instala el APK en el teléfono viejo.
4. Configura el servidor (`https://grabadora.midominio.com`) y pulsa
   **Emparejar**: la app muestra un código de 8 caracteres.
5. En el visor, pulsa **Agregar cámara**, ingresa el código, nombre y zona.
6. Pulsa **Iniciar vigilancia** y permite los permisos.
7. Concede "ignorar optimización de batería" y activa el arranque automático
   si tu fabricante lo permite.

## 7. Operación

- **Retención**: el backend purga clips de la nube según
  `cloudRetentionDays` (default 30). La cámara purga segmentos locales según
  `localRetentionDays` (default 7). Ajusta por cámara desde el visor.
- **Backup**: copia `backend/data/grabadora.db` (volumen `backend-data`) de
  forma periódica; contiene metadatos de eventos y dispositivos.
- **Monitoreo**: `GET /api/health` responde el estado del backend. La app
  cámara notifica "sin conexión" si no contacta el backend por más de 5
  minutos (vía notificación del visor si el push está activo).
- **Costos**: con 1 cámara y ~50 eventos/día (~12 GB/mes) el storage R2/B2
  cuesta centavos; el VPS es el costo principal.

## 8. Checklist de seguridad antes de producción

- [ ] `DEBUG`/`STORAGE_ENABLED=false` fuera de producción (usar S3 real).
- [ ] `JWT_SECRET` y `REFRESH_SECRET` generados y rotados.
- [ ] `CORS_ORIGINS` con los dominios exactos del visor.
- [ ] HTTPS/WSS en el dominio (Caddy o Nginx + Let's Encrypt).
- [ ] Buckets privados; verificar que una URL sin firma no descargue clips.
- [ ] Credenciales TURN rotadas y no comprometidas en repositorios.
- [ ] Sin secretos en `git` (revisar `git status` y el historial).

## 9. Solución de problemas

| Síntoma                       | Causa probable                            | Solución                                          |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------- |
| El visor no ve video en vivo  | NAT estricto sin TURN                     | Configurar TURN en el backend                     |
| Los clips no llegan a la nube | `STORAGE_ENABLED=false` o credenciales S3 | Revisar `.env` y el bucket                        |
| La app cámara se detiene      | Optimización de batería                   | Ignorar optimizaciones y usar arranque automático |
| Push no llega                 | `PUSH_ENABLED=false` o VAPID ausente      | Activar push y suscribirse desde el visor         |
| Timestamps incorrectos        | Reloj del teléfono desviado               | Ajustar hora automática en el teléfono            |
