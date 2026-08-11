package com.grabadora.camera.vision

import android.graphics.Bitmap
import android.graphics.RectF
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import java.nio.ByteBuffer

data class I420Frame(
    val y: ByteArray,
    val u: ByteArray,
    val v: ByteArray,
    val width: Int,
    val height: Int,
    val rotationDegrees: Int,
    val ptsNs: Long,
)

/**
 * Convierte cada frame de CameraX en tres consumidores: luminancia reducida
 * para el detector, I420 completo para el grabador/WebRTC y un fotograma
 * reducido para thumbnails y snapshots.
 */
class FrameProcessor(
    private val grayWidth: Int = 160,
    private val grayHeight: Int = 90,
    private val onGray: (ByteArray) -> Unit,
    private val onFrame: (I420Frame) -> Unit,
) : ImageAnalysis.Analyzer {
    @Volatile
    var snapshotRequested = false

    @Volatile
    var detectionZone: RectF? = null

    @Volatile
    private var latestGray: ByteArray? = null

    @Volatile
    private var latestY: ByteArray? = null

    @Volatile
    private var latestU: ByteArray? = null

    @Volatile
    private var latestV: ByteArray? = null

    @Volatile
    private var latestWidth = 0

    @Volatile
    private var latestHeight = 0

    fun consumeSnapshot(): Bitmap? {
        val gray = latestGray ?: return null
        val pixels = IntArray(gray.size)
        for (i in gray.indices) {
            val v = gray[i].toInt() and 0xff
            pixels[i] = (0xff shl 24) or (v shl 16) or (v shl 8) or v
        }
        return Bitmap.createBitmap(pixels, grayWidth, grayHeight, Bitmap.Config.ARGB_8888)
    }

    fun consumeNv21(): ByteArray? {
        val y = latestY ?: return null
        val u = latestU ?: return null
        val v = latestV ?: return null
        val w = latestWidth
        val h = latestHeight
        val nv21 = ByteArray(w * h * 3 / 2)
        System.arraycopy(y, 0, nv21, 0, w * h)
        var idx = w * h
        val uvCount = w * h / 4
        for (i in 0 until uvCount) {
            nv21[idx++] = v[i]
            nv21[idx++] = u[i]
        }
        return nv21
    }

    fun latestDimensions(): Pair<Int, Int> = latestWidth to latestHeight

    override fun analyze(image: ImageProxy) {
        val planes = image.planes
        if (planes.size < 3) {
            image.close()
            return
        }
        val width = image.width
        val height = image.height
        val yPlane = planes[0]
        val uPlane = planes[1]
        val vPlane = planes[2]

        val y = readPlane(yPlane, width, height)
        val u = readPlane(uPlane, width / 2, height / 2)
        val v = readPlane(vPlane, width / 2, height / 2)

        val gray = downscaleGray(yPlane.buffer, yPlane.rowStride, yPlane.pixelStride, width, height)
        latestGray = gray
        latestY = y
        latestU = u
        latestV = v
        latestWidth = width
        latestHeight = height

        onGray(gray)
        onFrame(
            I420Frame(
                y = y,
                u = u,
                v = v,
                width = width,
                height = height,
                rotationDegrees = image.imageInfo.rotationDegrees,
                ptsNs = image.imageInfo.timestamp,
            ),
        )
        snapshotRequested = false
        image.close()
    }

    private fun readPlane(plane: ImageProxy.PlaneProxy, w: Int, h: Int): ByteArray {
        val buffer = plane.buffer
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        val out = ByteArray(w * h)
        var idx = 0
        for (row in 0 until h) {
            var col = 0
            for (p in 0 until w) {
                out[idx++] = buffer.get(row * rowStride + col)
                col += pixelStride
            }
        }
        return out
    }

    private fun downscaleGray(
        buffer: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        width: Int,
        height: Int,
    ): ByteArray {
        val out = ByteArray(grayWidth * grayHeight)
        for (gy in 0 until grayHeight) {
            val sy = gy * height / grayHeight
            for (gx in 0 until grayWidth) {
                val sx = gx * width / grayWidth
                out[gy * grayWidth + gx] = buffer.get(sy * rowStride + sx * pixelStride)
            }
        }
        return out
    }
}
