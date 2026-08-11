package com.grabadora.camera.core

import java.security.SecureRandom

object Pairing {
    private const val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    private val random = SecureRandom()

    fun generateToken(): String {
        fun group(): String = (1..4).map { ALPHABET[random.nextInt(ALPHABET.length)] }.joinToString("")
        return "${group()}-${group()}"
    }
}

