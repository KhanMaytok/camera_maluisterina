package com.grabadora.camera.api

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class RegisterResponse(val cameraId: String, val clientSecret: String)

data class HeartbeatResponse(val config: JSONObject, val commands: JSONArray, val now: String)

data class PresignResponse(val eventId: String, val kind: String, val videoPutUrl: String?, val thumbPutUrl: String)

interface SignalingListener {
    fun onReady(iceServers: JSONArray)
    fun onMessage(message: JSONObject)
    fun onClosed(code: Int, reason: String)
    fun onFailure(message: String)
}

class ApiClient(serverUrl: String) {
    private val base = serverUrl.trimEnd('/')
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun registerCamera(token: String, deviceName: String): RegisterResponse {
        val body = JSONObject()
            .put("pairing_token", token)
            .put("device_name", deviceName)
            .toString()
        val res = request("POST", "/api/cameras/register", body)
        val json = JSONObject(res)
        return RegisterResponse(json.getString("camera_id"), json.getString("client_secret"))
    }

    suspend fun heartbeat(cameraId: String, secret: String): HeartbeatResponse {
        val res = request("POST", "/api/cameras/$cameraId/heartbeat", null, cameraId, secret)
        val json = JSONObject(res)
        return HeartbeatResponse(
            json.getJSONObject("config"),
            json.getJSONArray("commands"),
            json.optString("now", ""),
        )
    }

    suspend fun ackCommand(cameraId: String, secret: String, commandId: String) {
        val body = JSONObject().put("command_id", commandId).toString()
        request("POST", "/api/cameras/$cameraId/commands/ack", body, cameraId, secret)
    }

    suspend fun presign(
        cameraId: String,
        secret: String,
        kind: String,
        startedAt: String,
        endedAt: String,
        durationSec: Int,
        motionLevel: Float,
    ): PresignResponse {
        val body = JSONObject()
            .put("kind", kind)
            .put("started_at", startedAt)
            .put("ended_at", endedAt)
            .put("duration_sec", durationSec)
            .put("motion_level", motionLevel)
            .put("content_type", if (kind == "snapshot") "image/jpeg" else "video/mp4")
            .toString()
        val res = request("POST", "/api/uploads/presign", body, cameraId, secret)
        val json = JSONObject(res)
        val video = json.optJSONObject("video")
        return PresignResponse(
            eventId = json.getString("event_id"),
            kind = json.getString("kind"),
            videoPutUrl = video?.optString("put_url"),
            thumbPutUrl = json.getJSONObject("thumbnail").getString("put_url"),
        )
    }

    suspend fun upload(url: String, bytes: ByteArray, contentType: String) {
        val req = Request.Builder()
            .url(url)
            .put(bytes.toRequestBody(contentType.toMediaType()))
            .build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IOException("Subida falló: ${res.code}")
        }
    }

    suspend fun completeUpload(cameraId: String, secret: String, eventId: String, sizeBytes: Long) {
        val body = JSONObject().put("event_id", eventId).put("size_bytes", sizeBytes).toString()
        request("POST", "/api/uploads/complete", body, cameraId, secret)
    }

    fun signalingSocket(cameraId: String, secret: String, listener: SignalingListener): WebSocket {
        val wsBase = base.replaceFirst("http", "ws")
        val req = Request.Builder()
            .url("$wsBase/api/signaling?camera_id=$cameraId&role=camera")
            .header("X-Camera-Id", cameraId)
            .header("X-Camera-Secret", secret)
            .build()
        return client.newWebSocket(req, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val json = JSONObject(text)
                if (json.optString("type") == "ready") {
                    listener.onReady(json.optJSONArray("iceServers") ?: JSONArray())
                } else {
                    listener.onMessage(json)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                listener.onClosed(code, reason)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                listener.onFailure(t.message ?: "Error de señalización")
            }
        })
    }

    private suspend fun request(
        method: String,
        path: String,
        body: String?,
        cameraId: String? = null,
        secret: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val requestBody = body?.toRequestBody("application/json".toMediaType())
            ?: if (method == "POST" || method == "PUT" || method == "PATCH") {
                "".toRequestBody(null)
            } else {
                null
            }
        val builder = Request.Builder()
            .url("$base$path")
            .method(method, requestBody)
        if (cameraId != null) builder.header("X-Camera-Id", cameraId)
        if (secret != null) builder.header("X-Camera-Secret", secret)
        client.newCall(builder.build()).execute().use { res ->
            val text = res.body?.string() ?: ""
            android.util.Log.i("Grabadora", "$method $path -> ${res.code}")
            if (!res.isSuccessful) {
                val message = try {
                    JSONObject(text).optJSONObject("error")?.optString("message") ?: "HTTP ${res.code}"
                } catch (_: Exception) {
                    "HTTP ${res.code}"
                }
                throw IOException(message)
            }
            text
        }
    }
}
