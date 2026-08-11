package com.grabadora.camera.core

import android.content.Context
import org.json.JSONObject

data class CameraConfig(
    val resolution: String = "720p",
    val fps: Int = 24,
    val bitrateKbps: Int = 1500,
    val motionSensitivity: Float = 0.35f,
    val detectionEnabled: Boolean = true,
    val preRollSec: Int = 15,
    val postRollSec: Int = 30,
    val localRetentionDays: Int = 7,
    val cloudRetentionDays: Int = 30,
) {
    fun resolutionPair(): Pair<Int, Int> = when (resolution) {
        "480p" -> 640 to 480
        "1080p" -> 1920 to 1080
        else -> 1280 to 720
    }

    companion object {
        fun fromJson(o: JSONObject): CameraConfig = CameraConfig(
            resolution = o.optString("resolution", "720p"),
            fps = o.optInt("fps", 24).coerceIn(10, 30),
            bitrateKbps = o.optInt("bitrateKbps", 1500).coerceIn(300, 8000),
            motionSensitivity = o.optDouble("motionSensitivity", 0.35).toFloat().coerceIn(0.05f, 1f),
            detectionEnabled = o.optBoolean("detectionEnabled", true),
            preRollSec = o.optInt("preRollSec", 15).coerceIn(5, 60),
            postRollSec = o.optInt("postRollSec", 30).coerceIn(10, 120),
            localRetentionDays = o.optInt("localRetentionDays", 7).coerceIn(1, 90),
            cloudRetentionDays = o.optInt("cloudRetentionDays", 30).coerceIn(1, 365),
        )
    }
}

class ConfigStore(context: Context) {
    private val prefs = context.getSharedPreferences("grabadora", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", "http://10.0.2.2:3000") ?: "http://10.0.2.2:3000"
        set(value) = prefs.edit().putString("server_url", value.trimEnd('/')).apply()

    var deviceName: String
        get() = prefs.getString("device_name", "Teléfono viejo") ?: "Teléfono viejo"
        set(value) = prefs.edit().putString("device_name", value).apply()

    var pairingToken: String
        get() = prefs.getString("pairing_token", "") ?: ""
        set(value) = prefs.edit().putString("pairing_token", value).apply()

    var cameraId: String
        get() = prefs.getString("camera_id", "") ?: ""
        set(value) = prefs.edit().putString("camera_id", value).apply()

    var cameraSecret: String
        get() = prefs.getString("camera_secret", "") ?: ""
        set(value) = prefs.edit().putString("camera_secret", value).apply()

    var serviceEnabled: Boolean
        get() = prefs.getBoolean("service_enabled", false)
        set(value) = prefs.edit().putBoolean("service_enabled", value).apply()

    fun saveCamera(id: String, secret: String) {
        prefs.edit().putString("camera_id", id).putString("camera_secret", secret).apply()
    }

    fun isPaired(): Boolean = cameraId.isNotEmpty() && cameraSecret.isNotEmpty()

    fun saveConfig(config: CameraConfig) {
        prefs.edit()
            .putString("resolution", config.resolution)
            .putInt("fps", config.fps)
            .putInt("bitrate_kbps", config.bitrateKbps)
            .putFloat("sensitivity", config.motionSensitivity)
            .putBoolean("detection_enabled", config.detectionEnabled)
            .putInt("preroll_sec", config.preRollSec)
            .putInt("postroll_sec", config.postRollSec)
            .putInt("local_retention_days", config.localRetentionDays)
            .apply()
    }

    fun loadConfig(): CameraConfig = CameraConfig(
        resolution = prefs.getString("resolution", "720p") ?: "720p",
        fps = prefs.getInt("fps", 24),
        bitrateKbps = prefs.getInt("bitrate_kbps", 1500),
        motionSensitivity = prefs.getFloat("sensitivity", 0.35f),
        detectionEnabled = prefs.getBoolean("detection_enabled", true),
        preRollSec = prefs.getInt("preroll_sec", 15),
        postRollSec = prefs.getInt("postroll_sec", 30),
        localRetentionDays = prefs.getInt("local_retention_days", 7),
        cloudRetentionDays = prefs.getInt("cloud_retention_days", 30),
    )
}

