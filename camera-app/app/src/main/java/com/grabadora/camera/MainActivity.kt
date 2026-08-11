package com.grabadora.camera

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.grabadora.camera.api.ApiClient
import com.grabadora.camera.core.CameraService
import com.grabadora.camera.core.ConfigStore
import com.grabadora.camera.core.Pairing
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var configStore: ConfigStore
    private lateinit var statusText: TextView
    private lateinit var codeText: TextView

    private val permissions = arrayOf(
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.POST_NOTIFICATIONS,
    )

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            val granted = result.values.all { it }
            Toast.makeText(
                this,
                if (granted) "Permisos concedidos" else "Faltan permisos para grabar",
                Toast.LENGTH_LONG,
            ).show()
            requestBatteryOptimization()
        }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            statusText.text = intent.getStringExtra(CameraService.EXTRA_STATUS) ?: ""
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configStore = ConfigStore(this)
        setContentView(R.layout.activity_main)

        val serverInput = findViewById<EditText>(R.id.serverUrl)
        val nameInput = findViewById<EditText>(R.id.deviceName)
        codeText = findViewById(R.id.pairingCode)
        statusText = findViewById(R.id.status)
        serverInput.setText(configStore.serverUrl)
        nameInput.setText(configStore.deviceName)

        findViewById<Button>(R.id.pair).setOnClickListener {
            val url = serverInput.text.toString().trim()
            val name = nameInput.text.toString().trim()
            if (url.isEmpty() || name.isEmpty()) {
                Toast.makeText(this, "Configura servidor y nombre", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            configStore.serverUrl = url
            configStore.deviceName = name
            pairCamera(url, name)
        }

        findViewById<Button>(R.id.start).setOnClickListener {
            if (!configStore.isPaired()) {
                Toast.makeText(this, "Primero empareja la cámara", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (hasPermissions()) {
                configStore.serviceEnabled = true
                ContextCompat.startForegroundService(
                    this,
                    Intent(this, CameraService::class.java).setAction(CameraService.ACTION_START),
                )
            } else {
                permissionLauncher.launch(permissions)
            }
        }

        findViewById<Button>(R.id.stop).setOnClickListener {
            configStore.serviceEnabled = false
            startService(Intent(this, CameraService::class.java).setAction(CameraService.ACTION_STOP))
        }

        updatePairingUi()
    }

    override fun onResume() {
        super.onResume()
        registerReceiver(statusReceiver, IntentFilter(CameraService.ACTION_STATUS))
        updatePairingUi()
    }

    override fun onPause() {
        super.onPause()
        unregisterReceiver(statusReceiver)
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun pairCamera(url: String, name: String) {
        val token = Pairing.generateToken()
        configStore.pairingToken = token
        codeText.text = "Código: $token"
        scope.launch {
            try {
                val res = withContext(Dispatchers.IO) { ApiClient(url).registerCamera(token, name) }
                configStore.saveCamera(res.cameraId, res.clientSecret)
                configStore.serviceEnabled = true
                Toast.makeText(this@MainActivity, "Cámara registrada", Toast.LENGTH_SHORT).show()
                updatePairingUi()
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Error: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun updatePairingUi() {
        codeText.text = if (configStore.pairingToken.isNotEmpty()) {
            "Código: ${configStore.pairingToken}"
        } else {
            "Pulsa Emparejar para generar un código"
        }
    }

    private fun hasPermissions(): Boolean =
        permissions.all { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }

    private fun requestBatteryOptimization() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !pm.isIgnoringBatteryOptimizations(packageName)) {
            try {
                startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                        .setData(Uri.parse("package:$packageName")),
                )
            } catch (_: Exception) {
            }
        }
    }
}

