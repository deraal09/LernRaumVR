package com.bbzrdeck.lernraumvr

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log

/**
 * Hintergrunddienst der Brille (Foreground-Service mit Benachrichtigung).
 *
 * Gerüst: hält den Dienst am Leben. In Phase 2 kommen WebSocket, Abfrage der Aufträge,
 * Download mit Fortsetzen und Prüfsumme dazu (docs/PLAN.md, Abschnitt 7).
 */
class SyncService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            Log.d(TAG, "Abfrage der Aufträge (noch nicht umgesetzt), Server: ${Config.SERVER_URL}")
            handler.postDelayed(this, Config.POLL_INTERVAL_MS)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.notification_channel_name),
                    NotificationManager.IMPORTANCE_LOW,
                ),
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
