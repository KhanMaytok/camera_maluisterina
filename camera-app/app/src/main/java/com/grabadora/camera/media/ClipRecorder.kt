package com.grabadora.camera.media

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentLinkedQueue

data class EncodedFrame(
    val data: ByteArray,
    val ptsUs: Long,
    val isConfig: Boolean,
    val isKey: Boolean,
)

data class ClipResult(
    val file: File,
    val durationMs: Long,
)

/**
 * Codifica H.264 desde frames I420, escribe segmentos MP4 continuos de 60 s y
 * mantiene un ring buffer de pre-roll en memoria para clips de eventos.
 */
class ClipRecorder(
    private val width: Int,
    private val height: Int,
    private val fps: Int,
    private val bitrateKbps: Int,
    private val preRollSec: Int,
    private val segmentDir: File,
    private val segmentDurationMs: Long = 60_000,
) {
    var onSegmentRotated: ((File) -> Unit)? = null
    var onClipFinished: ((ClipResult) -> Unit)? = null

    private val inputFrames = ConcurrentLinkedQueue<Pair<ByteArray, Long>>()
    private val lock = Object()
    private val ring = ArrayDeque<EncodedFrame>()
    private var codec: MediaCodec? = null
    private var thread: Thread? = null
    private var outputFormat: MediaFormat? = null
    private var segmentWriter: MuxWriter? = null
    private var segmentSeq = 0
    private var segmentStartMs = System.currentTimeMillis()
    private var clipWriter: MuxWriter? = null
    private var clipTimer: Thread? = null

    @Volatile
    private var running = false

    @Volatile
    private var eventActive = false

    fun start() {
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height)
        format.setInteger(
            MediaFormat.KEY_COLOR_FORMAT,
            MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible,
        )
        format.setInteger(MediaFormat.KEY_BIT_RATE, bitrateKbps * 1000)
        format.setInteger(MediaFormat.KEY_FRAME_RATE, fps)
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, width * height * 3 / 2)
        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec?.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec?.start()
        running = true
        thread = Thread(::loop, "clip-recorder").also { it.start() }
    }

    fun stop() {
        running = false
        synchronized(lock) { lock.notifyAll() }
        thread?.join(2000)
        clipTimer?.interrupt()
        try {
            codec?.stop()
            codec?.release()
        } catch (_: Exception) {
        }
        segmentWriter?.finish()
        clipWriter?.finish()
    }

    fun pushFrame(i420: ByteArray, ptsNs: Long) {
        inputFrames.add(i420 to ptsNs / 1000)
        synchronized(lock) { lock.notifyAll() }
    }

    fun startEvent(postRollMs: Long) {
        if (eventActive) return
        eventActive = true
        clipWriter = MuxWriter(newClipFile())
        synchronized(this) {
            for (frame in ring) clipWriter?.write(frame)
        }
        clipTimer = Thread {
            try {
                Thread.sleep(postRollMs)
            } catch (_: InterruptedException) {
            }
            endEvent()
        }.also { it.start() }
    }

    fun endEvent() {
        if (!eventActive) return
        eventActive = false
        val writer = clipWriter
        clipWriter = null
        val result = writer?.finish()
        if (result != null) onClipFinished?.invoke(result)
    }

    private fun loop() {
        val codec = codec ?: return
        val info = MediaCodec.BufferInfo()
        while (running) {
            var fed = false
            while (true) {
                val frame = inputFrames.poll() ?: break
                val index = codec.dequeueInputBuffer(5_000)
                if (index < 0) break
                val buffer = codec.getInputBuffer(index) ?: break
                buffer.clear()
                buffer.put(frame.first)
                codec.queueInputBuffer(index, 0, frame.first.size, frame.second, 0)
                fed = true
            }
            val index = codec.dequeueOutputBuffer(info, 5_000)
            if (index >= 0) {
                val buffer = codec.getOutputBuffer(index)
                if (buffer != null) {
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        outputFormat = codec.outputFormat
                        dispatch(EncodedFrame(ByteArray(0), info.presentationTimeUs, true, false))
                    } else {
                        val data = ByteArray(info.size)
                        buffer.position(info.offset)
                        buffer.get(data)
                        dispatch(
                            EncodedFrame(
                                data,
                                info.presentationTimeUs,
                                false,
                                info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0,
                            ),
                        )
                    }
                }
                codec.releaseOutputBuffer(index, false)
            }
            if (!fed && index < 0) {
                synchronized(lock) {
                    if (inputFrames.isEmpty()) lock.wait(20)
                }
            }
        }
    }

    @Synchronized
    private fun dispatch(frame: EncodedFrame) {
        ring.addLast(frame)
        while (ring.size > preRollSec * fps) ring.removeFirst()

        val format = outputFormat
        if (segmentWriter == null) {
            segmentWriter = MuxWriter(newSegmentFile()).also { it.setFormat(format) }
            segmentStartMs = System.currentTimeMillis()
        }
        segmentWriter?.write(frame)
        if (System.currentTimeMillis() - segmentStartMs >= segmentDurationMs) {
            val old = segmentWriter
            segmentWriter = null
            val file = old?.finish()
            if (file != null) onSegmentRotated?.invoke(file)
        }
        if (eventActive) clipWriter?.write(frame)
    }

    private fun newSegmentFile(): File =
        File(segmentDir, "seg_%06d.mp4".format(segmentSeq++)).apply {
            parentFile?.mkdirs()
        }

    private fun newClipFile(): File =
        File(segmentDir, "event_%d.mp4".format(System.currentTimeMillis())).apply {
            parentFile?.mkdirs()
        }

    private class MuxWriter(private val file: File) {
        private val muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        private var trackIndex = -1
        private var firstPts = -1L
        private var lastPts = 0L
        private var started = false

        fun setFormat(format: MediaFormat?) {
            if (started || format == null) return
            trackIndex = muxer.addTrack(format)
            muxer.start()
            started = true
        }

        fun write(frame: EncodedFrame) {
            if (frame.isConfig) return
            if (!started) return
            val buffer = ByteBuffer.wrap(frame.data)
            val info = MediaCodec.BufferInfo()
            info.set(0, frame.data.size, frame.ptsUs, if (frame.isKey) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
            if (firstPts < 0) firstPts = frame.ptsUs
            lastPts = frame.ptsUs
            muxer.writeSampleData(trackIndex, buffer, info)
        }

        fun finish(): ClipResult {
            try {
                if (started) muxer.stop()
            } catch (_: Exception) {
            }
            muxer.release()
            val durationMs = if (firstPts < 0) 0 else (lastPts - firstPts) / 1000
            return ClipResult(file, durationMs)
        }
    }
}
