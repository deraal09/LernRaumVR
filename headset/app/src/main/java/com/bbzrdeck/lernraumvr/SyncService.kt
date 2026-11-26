package com.bbzrdeck.lernraumvr

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import com.bbzrdeck.lernraumvr.core.ApiClient
import com.bbzrdeck.lernraumvr.core.AuthException
import com.bbzrdeck.lernraumvr.core.Downloader
import com.bbzrdeck.lernraumvr.core.PairingFlow
import com.bbzrdeck.lernraumvr.core.SyncEngine
import com.bbzrdeck.lernraumvr.core.TransferRunner
import java.io.File
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Hintergrunddienst der Brille (Foreground-Service mit Benachrichtigung).
 *
 * Ablauf: ohne Token koppeln (Code anzeigen), danach in Abständen mit dem Server abgleichen
 * (Heartbeat, Aufträge holen, laden, prüfen, ablegen). Die eigentliche Logik liegt im
 * plattformunabhängigen Kern (`core`) und ist dort getestet.
 */
class SyncService : Service() {
    @Volatile private var stopped = false
    private var worker: Thread? = null
    private val wakeups = LinkedBlockingQueue<Unit>()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        if (worker?.isAlive != true) {
            stopped = false
            worker = Thread({ loop() }, "lernraumvr-sync").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        wakeups.offer(Unit)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Wartet `ms` Millisekunden oder bis der Dienst beendet wird. */
    private fun pause(ms: Long) {
        if (!stopped) wakeups.poll(ms, TimeUnit.MILLISECONDS)
    }

    private fun hasStoragePermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

    private fun loop() {
        val state = SyncHolder.state
        val log = { message: String -> Log.i(TAG, message) }
        val tokens = PrefsTokenStore(this)
        val api = ApiClient(Config.SERVER_URL, tokens)
        val partDir = File(getExternalFilesDir(null) ?: filesDir, "part")
        val downloader = Downloader(api, partDir)
        val deviceStatus = AndroidDeviceStatus(this)
        val runner = TransferRunner(api, downloader, AndroidPlacement(this), log)
        val engine = SyncEngine(api, runner, downloader, deviceStatus, state, log)

        while (!stopped) {
            try {
                if (!hasStoragePermission()) {
                    state.phase = "no_permission"
                    pause(3_000)
                    continue
                }
                if (tokens.get() == null) {
                    PairingFlow(api, tokens, deviceStatus.deviceInfo(), state, sleep = { pause(it) }, log = log)
                        .run { stopped }
                    continue
                }
                val delay = withLocks { engine.cycle() }
                pause(delay)
            } catch (e: AuthException) {
                // Brille wurde im Browser gesperrt: Token verwerfen und neu koppeln.
                log("Token ungültig, Kopplung wird zurückgesetzt")
                tokens.set(null)
                state.deviceName = null
                state.phase = "start"
            } catch (e: Exception) {
                log("Fehler im Abgleich: ${e.message}")
                state.message = "Fehler: ${e.message}"
                pause(15_000)
            }
        }
    }

    /** Während des Abgleichs CPU und WLAN wachhalten (Downloads laufen auch bei ausgeschaltetem Display). */
    private fun <T> withLocks(block: () -> T): T {
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val wake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lernraumvr:sync")
        val wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "lernraumvr:wifi")
        wake.acquire(2 * 60 * 60 * 1000L)
        wifiLock.acquire()
        try {
            return block()
        } finally {
            if (wifiLock.isHeld) wifiLock.release()
            if (wake.isHeld) wake.release()
        }
    }

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_LOW),
            )
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle(getString(R.string.notification_title))
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .build()
    }

    private companion object {
        const val TAG = "SyncService"
        const val CHANNEL_ID = "sync"
        const val NOTIFICATION_ID = 1
    }
}
