package com.grabadora.camera.core

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val config = ConfigStore(context)
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && config.serviceEnabled && config.isPaired()) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, CameraService::class.java).setAction(CameraService.ACTION_START),
            )
        }
    }
}

