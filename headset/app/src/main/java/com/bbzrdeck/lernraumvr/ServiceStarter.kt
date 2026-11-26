package com.bbzrdeck.lernraumvr

import android.content.Context
import android.content.Intent
import android.os.Build

/** Startet den Hintergrunddienst; ab Android 8 muss das ein Foreground-Service sein. */
object ServiceStarter {
    fun start(context: Context) {
        val intent = Intent(context, SyncService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }
}
