package com.bbzrdeck.lernraumvr

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Einziger Bildschirm der Brillen-App: später Kopplungscode, Verbindungsstatus und
 * App-Liste (Launcher). Bewusst ohne Texteingabe, die Brille hat keine Tastatur.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
        }
        layout.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 36f
            gravity = Gravity.CENTER
        })
        layout.addView(TextView(this).apply {
            text = "Server: ${Config.SERVER_URL}"
            textSize = 20f
            gravity = Gravity.CENTER
        })
        layout.addView(TextView(this).apply {
            text = "Version ${BuildConfig.VERSION_NAME}"
            textSize = 16f
            gravity = Gravity.CENTER
        })
        setContentView(layout)

        ServiceStarter.start(this)
    }
}
