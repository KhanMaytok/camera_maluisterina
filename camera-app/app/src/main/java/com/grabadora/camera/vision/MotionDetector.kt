package com.grabadora.camera.vision

import android.graphics.RectF

/**
 * Detecta movimiento comparando fotogramas en escala de grises reducidos
 * (por defecto 160x90). Devuelve un nivel 0..1 proporcional a los píxeles
 * que cambiaron por encima de un umbral.
 */
class MotionDetector(
    private val width: Int,
    private val height: Int,
) {
    @Volatile
    var enabled = true

    @Volatile
    var zone: RectF? = null

    private var previous: ByteArray? = null

    fun analyze(gray: ByteArray): Float {
        if (!enabled) return 0f
        val prev = previous ?: run {
            previous = gray.copyOf()
            return 0f
        }
        var diff = 0L
        var changed = 0
        for (y in 0 until height) {
            val yNorm = y / height.toFloat()
            for (x in 0 until width) {
                zone?.let { z ->
                    if (!z.contains(x / width.toFloat(), yNorm)) continue
                }
                val idx = y * width + x
                val a = gray[idx].toInt() and 0xff
                val b = prev[idx].toInt() and 0xff
                val d = Math.abs(a - b)
                if (d > 18) {
                    diff += d
                    changed++
                }
            }
        }
        previous = gray.copyOf()
        return (changed.toFloat() / (width * height).toFloat()).coerceIn(0f, 1f)
    }
}

