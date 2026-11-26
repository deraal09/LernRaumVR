package com.bbzrdeck.lernraumvr

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Startet den Dienst nach dem Hochfahren der Brille. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            ServiceStarter.start(context)
        }
    }
}
