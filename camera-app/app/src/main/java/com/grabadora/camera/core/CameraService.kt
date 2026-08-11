package com.grabadora.camera.core

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.YuvImage
import android.os.BatteryManager
import android.os.IBinder
import android.os.PowerManager
import android.os.StatFs
import android.view.Surface
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import com.grabadora.camera.MainActivity
import com.grabadora.camera.R
import com.grabadora.camera.api.ApiClient
import com.grabadora.camera.api.SignalingListener
import com.grabadora.camera.media.ClipRecorder
import com.grabadora.camera.media.UploadDb
import com.grabadora.camera.vision.FrameProcessor
import com.grabadora.camera.vision.MotionDetector
import com.grabadora.camera.webrtc.SignalingPeer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.WebSocket
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import java.time.LocalTime

class CameraService : LifecycleService() {
    companion object {
        const val ACTION_START = "com.grabadora.camera.START"
        const val ACTION_STOP = "com.grabadora.camera.STOP"
        const val ACTION_STATUS = "com.grabadora.camera.STATUS"
        const val EXTRA_STATUS = "status"
        private const val CHANNEL_ID = "grabadora"
        private const val NOTIFICATION_ID = 1
        private const val MAX_SNAPSHOT_AGE_MS = 5000L
    }

    private lateinit var configStore: ConfigStore
    private lateinit var api: ApiClient
    private lateinit var uploadDb: UploadDb
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var wakeLock: PowerManager.WakeLock? = null
    private var cameraExecutor = Executors.newSingleThreadExecutor()
    private var frameProcessor: FrameProcessor? = null
    private var motionDetector: MotionDetector? = null
    private var recorder: ClipRecorder? = null
    private var peer: SignalingPeer? = null
    private var signalingSocket: WebSocket? = null
    private var config = CameraConfig()
    private var cameraProvider: ProcessCameraProvider? = null
    private var eventStartedAt: Long = 0
    private var snapshotRequestedAt: Long = 0
    private var thermalEnabled = true
    private var thermalDegraded = false
    private var clockOffsetMs = 0L
    private var eventActive = false
    private var lastMotionLevel = 0f

    override fun onCreate() {
        super.onCreate()
        configStore = ConfigStore(this)
        api = ApiClient(configStore.serverUrl)
        uploadDb = UploadDb(this)
        createChannel()
        startForegroundWithNotification()
        acquireWakeLock()
        config = configStore.loadConfig()
        startCamera()
        scope.launch { heartbeatLoop() }
        scope.launch { uploadLoop() }
        scope.launch { signalingLoop() }
        scope.launch { snapshotLoop() }
        scope.launch { thermalLoop() }
        publishStatus("Servicio iniciado")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        signalingSocket?.close(1000, "stop")
        peer?.stop()
        recorder?.stop()
        scope.cancel()
        cameraExecutor.shutdown()
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent): IBinder? = null

    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener(
            {
                try {
                    val provider = providerFuture.get()
                    cameraProvider = provider
                    val (w, h) = config.resolutionPair()
                    val detector = MotionDetector(160, 90)
                    detector.enabled = config.detectionEnabled && withinActiveHours()
                    detector.zone = config.motionZone?.toRectF()
                    motionDetector = detector

                    val processor = FrameProcessor(
                        onGray = { gray ->
                            val level = detector.analyze(gray)
                            lastMotionLevel = level
                            val r = recorder
                            if (r != null &&
                                level > thresholdFor(config.motionSensitivity) &&
                                !eventActive &&
                                withinActiveHours()
                            ) {
                                eventActive = true
                                eventStartedAt = System.currentTimeMillis()
                                r.startEvent(config.postRollSec * 1000L)
                            }
                        },
                        onFrame = { frame ->
                            recorder?.pushFrame(frame.y, frame.ptsNs)
                            peer?.pushFrame(frame)
                        },
                    )
                    processor.detectionZone = null
                    frameProcessor = processor

                    val analysis = ImageAnalysis.Builder()
                        .setTargetResolution(android.util.Size(w, h))
                        .setTargetRotation(Surface.ROTATION_0)
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(cameraExecutor, processor)

                    provider.unbindAll()
                    provider.bindToLifecycle(
                        this,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        analysis,
                    )
                    startRecorder(w, h)
                    publishStatus("Cámara activa ${config.resolution}")
                } catch (e: Exception) {
                    publishStatus("Error de cámara: ${e.message}")
                }
            },
            ContextCompat.getMainExecutor(this),
        )
    }

    private fun startRecorder(
        width: Int,
        height: Int,
        bitrateKbps: Int = config.bitrateKbps,
        fps: Int = config.fps,
    ) {
        val dir = File(getExternalFilesDir(null), "segments").apply { mkdirs() }
        recorder = ClipRecorder(
            width = width,
            height = height,
            fps = fps,
            bitrateKbps = bitrateKbps,
            preRollSec = config.preRollSec,
            segmentDir = dir,
        ).also { r ->
            r.onSegmentRotated = { file -> cleanupSegments(dir, file) }
            r.onClipFinished = { result ->
                eventActive = false
                val started = eventStartedAt
                val ended = System.currentTimeMillis()
                uploadClip(result.file, started, ended, result.durationMs)
            }
            r.start()
        }
    }

    private fun cleanupSegments(dir: File, latest: File) {
        val freeMb = StatFs(dir.absolutePath).availableBytes / (1024 * 1024)
        val retentionDays = if (freeMb < 2048) 1 else config.localRetentionDays
        val cutoff = System.currentTimeMillis() - retentionDays * 86_400_000L
        dir.listFiles()?.forEach { file ->
            if (file != latest && file.lastModified() < cutoff) file.delete()
        }
    }

    private fun MotionZone.toRectF(): RectF = RectF(
        x / 100f,
        y / 100f,
        (x + w) / 100f,
        (y + h) / 100f,
    )

    private fun withinActiveHours(): Boolean {
        val from = config.activeFrom ?: return true
        val to = config.activeTo ?: return true
        return try {
            val now = LocalTime.now()
            val start = LocalTime.parse(from)
            val end = LocalTime.parse(to)
            if (start <= end) !now.isBefore(start) && now.isBefore(end)
            else !now.isBefore(start) || now.isBefore(end)
        } catch (_: Exception) {
            true
        }
    }

    private fun thresholdFor(sensitivity: Float): Float = (1f - sensitivity) * 0.2f + 0.02f

    private fun uploadClip(file: File, startedMs: Long, endedMs: Long, durationMs: Long) {
        val cameraId = configStore.cameraId
        val secret = configStore.cameraSecret
        if (cameraId.isEmpty() || secret.isEmpty()) return
        scope.launch(Dispatchers.IO) {
            try {
                val thumb = buildThumbnail()
                val res = api.presign(
                    cameraId,
                    secret,
                    "clip",
                    iso(startedMs),
                    iso(endedMs),
                    (durationMs / 1000).toInt(),
                    lastMotionLevel,
                )
                res.videoPutUrl?.let { api.upload(it, file.readBytes(), "video/mp4") }
                if (thumb != null) api.upload(res.thumbPutUrl, thumb, "image/jpeg")
                api.completeUpload(cameraId, secret, res.eventId, file.length())
                file.delete()
                publishStatus("Clip subido")
            } catch (e: Exception) {
                uploadDb.insert(
                    "clip_${file.name}",
                    file.absolutePath,
                    null,
                    file.length(),
                )
            }
        }
    }

    private fun buildThumbnail(): ByteArray? {
        val nv21 = frameProcessor?.consumeNv21() ?: return null
        val (w, h) = frameProcessor?.latestDimensions() ?: return null
        val out = ByteArrayOutputStream()
        YuvImage(nv21, ImageFormat.NV21, w, h, null).compressToJpeg(Rect(0, 0, w, h), 70, out)
        return out.toByteArray()
    }

    private suspend fun heartbeatLoop() {
        while (true) {
            val cameraId = configStore.cameraId
            val secret = configStore.cameraSecret
            if (cameraId.isNotEmpty() && secret.isNotEmpty()) {
                try {
                    val res = api.heartbeat(cameraId, secret)
                    clockOffsetMs = try {
                        Date.parse(res.now) - System.currentTimeMillis()
                    } catch (_: Exception) {
                        clockOffsetMs
                    }
                    val remoteConfig = CameraConfig.fromJson(res.config)
                    if (remoteConfig != configStore.loadConfig()) {
                        configStore.saveConfig(remoteConfig)
                        applyConfig(remoteConfig)
                    }
                    for (i in 0 until res.commands.length()) {
                        val command = res.commands.getJSONObject(i)
                        val id = command.getString("id")
                        handleCommand(command.getString("type"))
                        api.ackCommand(cameraId, secret, id)
                    }
                } catch (e: Exception) {
                    publishStatus("Sin conexión al backend")
                }
            }
            delay(30_000)
        }
    }

    private fun applyConfig(newConfig: CameraConfig) {
        config = newConfig
        motionDetector?.enabled = newConfig.detectionEnabled && thermalEnabled && withinActiveHours()
        motionDetector?.zone = newConfig.motionZone?.toRectF()
    }

    private fun handleCommand(type: String) {
        when (type) {
            "snapshot" -> {
                snapshotRequestedAt = System.currentTimeMillis()
                frameProcessor?.snapshotRequested = true
            }
            "pause_detection" -> motionDetector?.enabled = false
            "resume_detection" -> motionDetector?.enabled = thermalEnabled
            "reconfigure" -> {
                config = configStore.loadConfig()
                motionDetector?.enabled = config.detectionEnabled && thermalEnabled && withinActiveHours()
                motionDetector?.zone = config.motionZone?.toRectF()
            }
        }
    }

    private suspend fun uploadLoop() {
        while (true) {
            val cameraId = configStore.cameraId
            val secret = configStore.cameraSecret
            if (cameraId.isNotEmpty() && secret.isNotEmpty()) {
                for (pending in uploadDb.due(System.currentTimeMillis())) {
                    try {
                        val file = pending.videoPath?.let { File(it) }
                        if (file?.exists() == true) {
                            val res = api.presign(
                                cameraId,
                                secret,
                                "clip",
                                iso(file.lastModified() - 60_000),
                                iso(file.lastModified()),
                                60,
                                0f,
                            )
                            res.videoPutUrl?.let { api.upload(it, file.readBytes(), "video/mp4") }
                            api.completeUpload(cameraId, secret, res.eventId, file.length())
                            file.delete()
                        }
                        uploadDb.remove(pending.eventId)
                    } catch (e: Exception) {
                        if (pending.retries > 100) uploadDb.remove(pending.eventId)
                        else uploadDb.scheduleRetry(pending.eventId, pending.retries + 1)
                    }
                }
            }
            delay(15_000)
        }
    }

    private suspend fun snapshotLoop() {
        while (true) {
            if (snapshotRequestedAt > 0 &&
                System.currentTimeMillis() - snapshotRequestedAt < MAX_SNAPSHOT_AGE_MS &&
                frameProcessor?.snapshotRequested == false
            ) {
                snapshotRequestedAt = 0
                val cameraId = configStore.cameraId
                val secret = configStore.cameraSecret
                if (cameraId.isNotEmpty() && secret.isNotEmpty()) {
                    try {
                        val jpeg = buildThumbnail()
                        if (jpeg != null) {
                            val res = api.presign(
                                cameraId,
                                secret,
                                "snapshot",
                                iso(System.currentTimeMillis()),
                                iso(System.currentTimeMillis()),
                                0,
                                0f,
                            )
                            api.upload(res.thumbPutUrl, jpeg, "image/jpeg")
                            api.completeUpload(cameraId, secret, res.eventId, jpeg.size.toLong())
                            publishStatus("Snapshot enviado")
                        }
                    } catch (e: Exception) {
                        publishStatus("Snapshot fallido")
                    }
                }
            }
            delay(2_000)
        }
    }

    private suspend fun thermalLoop() {
        while (true) {
            val sticky = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val tempC = (sticky?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10f
            thermalEnabled = tempC < 45f
            if (tempC >= 42f && !thermalDegraded) {
                thermalDegraded = true
                restartRecorder(halfBitrate = true, lowerFps = tempC >= 45f)
                publishStatus("Térmica ${tempC}°C: calidad reducida")
            } else if (thermalDegraded && tempC < 40f) {
                thermalDegraded = false
                restartRecorder(halfBitrate = false, lowerFps = false)
                publishStatus("Térmica normal: calidad restaurada")
            }
            motionDetector?.enabled = config.detectionEnabled && thermalEnabled && withinActiveHours()
            delay(60_000)
        }
    }

    private fun restartRecorder(halfBitrate: Boolean, lowerFps: Boolean) {
        val (w, h) = config.resolutionPair()
        val bitrate = if (halfBitrate) config.bitrateKbps / 2 else config.bitrateKbps
        val fps = if (lowerFps) 15 else config.fps
        recorder?.stop()
        recorder = null
        startRecorder(w, h, bitrate, fps)
    }

    private suspend fun signalingLoop() {
        var backoff = 2_000L
        while (true) {
            val cameraId = configStore.cameraId
            val secret = configStore.cameraSecret
            if (cameraId.isNotEmpty() && secret.isNotEmpty()) {
                var connected = false
                signalingSocket = api.signalingSocket(
                    cameraId,
                    secret,
                    object : SignalingListener {
                        override fun onReady(iceServers: org.json.JSONArray) {
                            connected = true
                            peer = SignalingPeer(
                                this@CameraService,
                                onSendSdp = { sdp -> signalingSocket?.send(JSONObject().put("type", "answer").put("sdp", sdp.description).toString()) },
                                onSendIce = { candidate -> signalingSocket?.send(candidate.toString()) },
                                onDisconnected = { _ -> },
                            ).also { it.start(iceServers) }
                        }

                        override fun onMessage(message: JSONObject) {
                            when (message.optString("type")) {
                                "offer" -> peer?.handleOffer(message.optString("sdp"))
                                "ice" -> peer?.handleIce(message)
                            }
                        }

                        override fun onClosed(code: Int, reason: String) {
                            peer?.stop()
                        }

                        override fun onFailure(message: String) {
                            peer?.stop()
                        }
                    },
                )
                var waitMs = backoff
                while (waitMs > 0 && connected.not()) {
                    delay(500)
                    waitMs -= 500
                }
                if (!connected) {
                    publishStatus("Señalización desconectada")
                    delay(backoff)
                    backoff = (backoff * 2).coerceAtMost(30_000)
                } else {
                    backoff = 2_000L
                }
            } else {
                delay(5_000)
            }
        }
    }

    private fun iso(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(ms + clockOffsetMs))

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun startForegroundWithNotification() {
        val intent = Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setSmallIcon(R.drawable.ic_stat_camera)
            .setOngoing(true)
            .setContentIntent(pending)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "grabadora:camera").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.release()
        wakeLock = null
    }

    private fun publishStatus(text: String) {
        sendBroadcast(
            Intent(ACTION_STATUS).putExtra(EXTRA_STATUS, text),
        )
    }
}
