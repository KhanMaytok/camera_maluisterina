package com.grabadora.camera.webrtc

import android.content.Context
import com.grabadora.camera.vision.I420Frame
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.CapturerObserver
import org.webrtc.EglBase
import org.webrtc.JavaI420Buffer
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame
import org.webrtc.VideoSource

/**
 * Publica video + audio WebRTC. El capturador recibe los frames I420 del
 * mismo ImageAnalysis que alimenta al grabador local.
 */
class SignalingPeer(
    private val context: Context,
    private val onSendSdp: (SessionDescription) -> Unit,
    private val onSendIce: (JSONObject) -> Unit,
    private val onDisconnected: (String) -> Unit,
) {
    private var factory: PeerConnectionFactory? = null
    private var eglBase: EglBase? = null
    private var peer: PeerConnection? = null
    private var capturer: FrameCapturer? = null
    private var audioSource: AudioSource? = null

    fun start(iceServers: JSONArray) {
        initFactory()
        val factory = factory ?: return
        val pc = factory.createPeerConnection(
            PeerConnection.RTCConfiguration(buildIceServers(iceServers)),
            observer,
        ) ?: return
        peer = pc
        eglBase = EglBase.create()
        val helper = SurfaceTextureHelper.create("grabadora-capturer", eglBase?.eglBaseContext)
        val source = factory.createVideoSource(false)
        capturer = FrameCapturer(source)
        capturer?.initialize(helper, context, source.getCapturerObserver())
        pc.addTrack(factory.createVideoTrack("camera0", source), emptyList())
        audioSource = factory.createAudioSource(
            MediaConstraints().apply {
                mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
                mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
            },
        )
        pc.addTrack(factory.createAudioTrack("audio0", audioSource), emptyList())
    }

    fun pushFrame(frame: I420Frame) {
        capturer?.onFrame(frame)
    }

    fun handleOffer(sdp: String) {
        val pc = peer ?: return
        pc.setRemoteDescription(
            object : SdpObserver {
                override fun onCreateSuccess(desc: SessionDescription) = Unit
                override fun onCreateFailure(error: String) = onDisconnected("Oferta inválida: $error")
                override fun onSetSuccess() {
                    pc.createAnswer(answerObserver, MediaConstraints())
                }
                override fun onSetFailure(error: String) = onDisconnected("SDP remoto inválido: $error")
            },
            SessionDescription(SessionDescription.Type.OFFER, sdp),
        )
    }

    fun handleIce(candidate: JSONObject) {
        val pc = peer ?: return
        pc.addIceCandidate(
            org.webrtc.IceCandidate(
                candidate.optString("sdpMid"),
                candidate.optInt("sdpMLineIndex"),
                candidate.optString("candidate"),
            ),
        )
    }

    fun stop() {
        peer?.close()
        peer = null
        capturer?.dispose()
        capturer = null
        audioSource?.dispose()
        audioSource = null
        eglBase?.release()
        eglBase = null
        factory?.dispose()
        factory = null
    }

    private val answerObserver = object : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription) {
            peer?.setLocalDescription(localObserver, desc)
            onSendSdp(desc)
        }

        override fun onCreateFailure(error: String) = onDisconnected("Respuesta inválida: $error")
        override fun onSetSuccess() = Unit
        override fun onSetFailure(error: String) = onDisconnected("Local SDP inválido: $error")
    }

    private val localObserver = object : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription) = Unit
        override fun onCreateFailure(error: String) = Unit
        override fun onSetSuccess() = Unit
        override fun onSetFailure(error: String) = Unit
    }

    private val observer = object : PeerConnection.Observer {
        override fun onIceCandidate(candidate: org.webrtc.IceCandidate) {
            onSendIce(
                JSONObject()
                    .put("type", "ice")
                    .put("candidate", candidate.sdp)
                    .put("sdpMid", candidate.sdpMid)
                    .put("sdpMLineIndex", candidate.sdpMLineIndex),
            )
        }

        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
            if (state == PeerConnection.IceConnectionState.FAILED ||
                state == PeerConnection.IceConnectionState.CLOSED
            ) {
                onDisconnected("Conexión WebRTC $state")
            }
        }

        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onAddStream(stream: org.webrtc.MediaStream) = Unit
        override fun onRemoveStream(stream: org.webrtc.MediaStream) = Unit
        override fun onDataChannel(channel: org.webrtc.DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onIceCandidatesRemoved(candidates: Array<org.webrtc.IceCandidate>) = Unit
    }

    private fun initFactory() {
        if (factory != null) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                .createInitializationOptions(),
        )
        factory = PeerConnectionFactory.builder().createPeerConnectionFactory()
    }

    private fun buildIceServers(json: JSONArray): List<PeerConnection.IceServer> {
        val servers = mutableListOf<PeerConnection.IceServer>()
        for (i in 0 until json.length()) {
            val o = json.getJSONObject(i)
            val builder = PeerConnection.IceServer.builder(o.getString("urls"))
            if (o.has("username")) builder.setUsername(o.getString("username"))
            if (o.has("credential")) builder.setPassword(o.getString("credential"))
            servers += builder.createIceServer()
        }
        return servers
    }

    private class FrameCapturer(private val source: VideoSource?) : VideoCapturer {
        private var observer: CapturerObserver? = null

        override fun initialize(
            surfaceTextureHelper: SurfaceTextureHelper,
            context: Context,
            capturerObserver: CapturerObserver,
        ) {
            observer = capturerObserver
            capturerObserver.onCapturerStarted(true)
        }

        override fun startCapture(width: Int, height: Int, fps: Int) = Unit
        override fun stopCapture() = Unit
        override fun changeCaptureFormat(width: Int, height: Int, fps: Int) = Unit
        override fun dispose() = Unit
        override fun isScreencast() = false

        fun onFrame(frame: I420Frame) {
            val source = source ?: return
            val observer = observer ?: return
            val buffer = JavaI420Buffer.allocate(frame.width, frame.height)
            buffer.dataY.put(frame.y)
            buffer.dataU.put(frame.u)
            buffer.dataV.put(frame.v)
            val videoFrame = VideoFrame(buffer, frame.rotationDegrees, frame.ptsNs)
            source.getCapturerObserver().onFrameCaptured(videoFrame)
            videoFrame.release()
        }
    }
}
