# Estado del proyecto — sesión 2026-08-11 (pausa)

## Dónde estamos

El flujo completo está funcionando **excepto el video en vivo**, que quedó a un
paso. Resumen verificado con logs reales (backend CapRover, logcat del teléfono
y Playwright):

### Funciona (verificado)

- Backend desplegado en CapRover, estable y con datos persistentes
  (`DATABASE_PATH=/data/grabadora.db`, `MEDIA_DIR=/data/media`, volumen
  `grabadora-data:/data`).
- Fix de crash por S3 (certificado autofirmado de MinIO): `safeDeleteObject` +
  `S3_TLS_INSECURE=true`. Eliminar cámaras/eventos ya no tumba el proceso.
- Cuenta, login, emparejamiento y heartbeat (cámara pasa a `online`).
- Subida de clips a MinIO funcionando (`POST /api/uploads/presign -> 200`).
- Señalización WebSocket **completa**: visor envía `offer`, cámara responde
  `answer`, hay `ping` keep-alive cada 20 s (ya no se caen a los 60 s por el
  timeout de Nginx).
- ICE: los candidatos de la cámara ya se aceptan en el visor (fix del formato
  `RTCIceCandidateInit`).

### El único pendiente (casi resuelto)

- El SDP de la cámara responde con `m=video 0 ... a=inactive` (rechaza video;
  el audio sí negocia opus). Causa: la factory de WebRTC de la cámara no
  negociaba códecs de video.
- **Fix ya aplicado y compilado**: `SignalingPeer` ahora configura
  `DefaultVideoEncoderFactory`/`DefaultVideoDecoderFactory` con el contexto EGL
  (commit `89147ee`). El APK está **descargado pero NO instalado** en el
  teléfono.

## Pasos para mañana (en orden)

1. **Instalar el APK nuevo** (build `31547107619`, ya descargado en
   `downloads/grabandora-debug-apk/app-debug.apk`):
   - `adb -s huwsqc8lkr8xambu uninstall com.grabadora.camera`
   - `adb -s huwsqc8lkr8xambu install -r downloads\grabandora-debug-apk\app-debug.apk`
   - Si da `INSTALL_FAILED_USER_RESTRICTED`: el toggle *Instalar vía USB* de
     MIUI está apagado → `adb push ... /sdcard/Download/grabadora.apk` y
     `adb shell am start -a android.intent.action.VIEW -d file:///sdcard/Download/grabadora.apk -t application/vnd.android.package-archive`
     y tocar **Instalar** en el teléfono.
2. **Restaurar prefs si se desinstaló**:
   `Get-Content -Raw downloads\grabadora-prefs-backup.xml | adb -s huwsqc8lkr8xambu shell "run-as com.grabadora.camera sh -c 'mkdir -p shared_prefs && cat > shared_prefs/grabadora.xml'"`
   - ⚠️ El último snapshot de prefs muestra la cámara `e488ed01` (ya borrada del
     backend). Si el teléfono sigue con esa cámara, **re-emparejar**:
     app → Emparejar (una vez) → código nuevo → visor → Agregar cámara.
3. **Abrir la app** y tocar **Iniciar vigilancia** (o por adb:
   `adb shell input tap 540 755`).
4. **Verificar logs**: `adb logcat -d -s Grabadora` → debe verse
   `Señalización lista, creando peer`, `Heartbeat OK` y sin `Señalización falló`.
5. **Probar el visor con Playwright**:
   `cd downloads\pw; node viewer-test.mjs`
   - Éxito = SDP de respuesta con `m=video 9 ... a=sendonly ... msid:- camera0`
     y `STATUS: ... En vivo` con `videoWidth > 0`.
   - Si el video sigue `inactive`: probar forzar VP8 en el encoder o revisar
     logs `org.webrtc` del teléfono.

## Datos útiles

- Teléfono: serial `huwsqc8lkr8xambu` (Xiaomi/Redmi, Android 16, arm64).
- Backend: `https://grabadora-backend.captain.artecosac.com` (health OK).
- Visor: `https://grabadora-viewer.captain.artecosac.com`.
- CapRover: CLI logueado en `captain-01` (`caprover api -n captain-01 ...`).
- El token de sesión del visor extraído de los logs expira; para renovarlo,
  sacar el `token=` más reciente de
  `caprover api -n captain-01 -t /user/apps/appData/grabadora-viewer/logs -m GET -d '{}'`
  e inyectarlo en `downloads/pw/viewer-test.mjs`.
- Cámara actual (si sigue válida): `79f6a49c28c369c6e6e87709` — pero el
  snapshot de prefs más reciente muestra `e488ed01`; alinear antes de probar.

## Bugs ya resueltos en esta sesión

1. `wss://https//...` (esquema duplicado en el visor).
2. Bucle de señalización de la cámara que mataba el peer (una sola conexión).
3. Heartbeat roto (POST sin body en OkHttp).
4. Crash del backend por S3 autofirmado.
5. Base de datos perdida en cada redeploy (faltaba `DATABASE_PATH`).
6. Timeout de Nginx 60 s (keep-alive).
7. Oferta WebRTC sin transceivers (`recvonly`).
8. Candidatos ICE mal formateados en el visor.

Todo el código está commiteado y pusheado en `master` (ver `git log`).
