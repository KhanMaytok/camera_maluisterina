# Despliegue con CapRover

Guía para desplegar Grabadora en CapRover. Se crean **dos apps**:
`grabadora-backend` (API) y `grabadora-viewer` (PWA con Nginx). El visor
proxea `/api` hacia el backend por la red interna de CapRover, así el
navegador solo habla con el dominio del visor (sin CORS y con WebSocket en el
mismo origen).

## 1. Requisitos previos

```bash
npm install -g caprover
caprover login   # contra tu servidor (https://captain.midominio.com)
```

`caprover login` guarda las credenciales en `~/.captain/config`; es el único
paso interactivo. Después, todo el despliegue se puede hacer con:

```powershell
.\deploy.ps1              # backend + viewer
.\deploy.ps1 -App backend
.\deploy.ps1 -App viewer
```

El repositorio no necesita cambios: los Dockerfiles de `backend/` y `viewer/`
ya están preparados para el deploy por tar de CapRover, y cada carpeta incluye
su propio `captain-definition` apuntando a su Dockerfile.

## 2. Crear las apps

En el panel de CapRover (o con `caprover apps`):

1. **`grabadora-backend`**
   - HTTP Port: `3000`
   - Health Check URL: `/api/health`
   - Persistent Directories: `/data` (aquí vive SQLite, media de desarrollo
     y las claves VAPID auto-generadas).
2. **`grabadora-viewer`**
   - HTTP Port: `80`
   - Environment: `BACKEND_UPSTREAM=srv-captain--grabadora-backend:3000`

> El nombre interno de una app en CapRover es `srv-captain--<app>`; si nombras
> las apps distinto, ajusta `BACKEND_UPSTREAM` en consecuencia.

## 3. Variables de entorno del backend

En la app `grabadora-backend` (Secrets/Env), al menos:

```env
JWT_SECRET=<openssl rand -hex 32>
REFRESH_SECRET=<openssl rand -hex 32>
PUBLIC_BASE_URL=https://backend.midominio.com
CORS_ORIGINS=https://viewer.midominio.com

STORAGE_ENABLED=true
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET_CLIPS=grabadora-clips
S3_BUCKET_THUMBS=grabadora-thumbs

PUSH_ENABLED=true
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@grabadora.local

STUN_URLS=stun:stun.l.google.com:19302
TURN_URL=turn:...:3478
TURN_USERNAME=...
TURN_PASSWORD=...

RETENTION_CHECK_MINUTES=60
```

`VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` se pueden generar con
`npx web-push generate-vapid-keys`; si no las defines, el backend las crea y
las persiste en `/data/vapid.json` (por eso el volumen persistente es
importante).

## 4. Dominios y TLS

- En `grabadora-backend` agrega el dominio del backend (ej.
  `backend.midominio.com`); CapRover emite Let's Encrypt automáticamente.
- En `grabadora-viewer` agrega el dominio del visor (ej.
  `viewer.midominio.com`).
- En la app cámara Android se configura **la URL del backend**
  (`https://backend.midominio.com`), porque la cámara habla directo con la API
  (registro, heartbeat, subidas y señalización WebSocket).

## 5. Desplegar

### Opción A (recomendada): CLI con tar por carpeta

Desde la raíz del repositorio (el CLI empaqueta la carpeta actual por sí solo;
**no** uses `-t` con una carpeta, ese flag espera un archivo `.tar`):

```bash
# Backend
cd backend
caprover deploy -a grabadora-backend

# Visor
cd ../viewer
caprover deploy -a grabadora-viewer
```

El CLI empaqueta la carpeta (excluye `node_modules` y `.git`) y CapRover
construye con el `captain-definition` de cada carpeta (contexto = la carpeta,
por eso los `COPY` relativos del Dockerfile funcionan). En cada despliegue
posterior, vuelve a ejecutar el mismo comando.

Si prefieres pasar un tar explícito, créalo primero y apunta `-t` al archivo:

```bash
cd backend
tar -czf ../grabadora-backend.tar .
caprover deploy -a grabadora-backend -t ../grabadora-backend.tar
```

> Windows 10/11 incluye `tar` (bsdtar) en el sistema, así que no necesitas
> WinRAR ni 7-Zip para este paso; el comando anterior funciona tal cual.

> Error típico: `form-data: EISDIR: illegal operation on a directory` aparece
> cuando se ejecuta `caprover deploy -a <app> -t .` (carpeta en `-t`). La
> solución es omitir `-t` y desplegar desde dentro de la carpeta.

### Opción B: imágenes de registro (la más robusta para CI)

Si prefieres builds en CI, sube las imágenes a Docker Hub/GHCR (por ejemplo
desde GitHub Actions) y configura cada app de CapRover con
**Deployment Method: Image** y el nombre de la imagen. Para GHCR, registra las
credenciales del registry en la app.

### Opción C: git push (soporte oficial de monorepo, con salvedad)

CapRover soporta monorepos por git: crea `captain-definition-backend` y
`captain-definition-viewer` en la raíz y en cada app configura
**Deployment → Captain Definition Path** apuntando al archivo correspondiente
(o usa el ajuste _captain-definition Relative Path_ por app).

**Salvedad importante:** en el deploy por git el build context es siempre la
raíz del repo, así que los `COPY` del Dockerfile deben ser relativos a la raíz
(ej. `COPY ./backend/package*.json ./`). Nuestros Dockerfiles actuales asumen
contexto = carpeta (para la Opción A), por lo que la Opción C requiere
Dockerfiles alternativos con rutas `./backend/...` o usar `dockerfileLines`
en el `captain-definition` raíz. Por eso se recomienda la Opción A o B.

## 6. Verificación post-despliegue

1. `https://backend.midominio.com/api/health` → `{"status":"ok"}`.
2. Abre el visor, crea la cuenta (primer registro) e inicia sesión.
3. Desde el teléfono viejo: configura el servidor con
   `https://backend.midominio.com`, empareja y pulsa **Iniciar vigilancia**.
4. En el visor: agrega la cámara con el código, verifica el video en vivo
   (WebRTC) y la pestaña de eventos.
5. Activa las notificaciones en el visor (botón de push) y verifica que llega
   un push al generar un clip.

## 7. Operación y respaldo

- El volumen `/data` persiste SQLite y media; CapRover lo respalda con sus
  snapshots, pero conviene copiar `grabadora.db` aparte de forma periódica.
- Para re-desplegar sin perder datos, no borres la app ni el volumen.
- Si el video en vivo no conecta detrás de CGNAT, configura TURN
  (`TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`) y reinicia el backend.
