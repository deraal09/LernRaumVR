package com.bbzrdeck.lernraumvr

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * Einziger Bildschirm der Brillen-App: zeigt Kopplungscode, Verbindungsstatus und laufende Übertragung.
 * Bewusst ohne Texteingabe, die Brille hat keine Tastatur.
 */
class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var title: TextView
    private lateinit var code: TextView
    private lateinit var hint: TextView
    private lateinit var current: TextView
    private lateinit var progress: ProgressBar
    private lateinit var footer: TextView

    private val refresh = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
        }
        fun text(size: Float, bold: Boolean = false) = TextView(this).apply {
            textSize = size
            gravity = Gravity.CENTER
            if (bold) setTypeface(Typeface.DEFAULT_BOLD)
            layout.addView(this)
        }
        title = text(32f, true)
        code = text(72f, true).apply { setTypeface(Typeface.MONOSPACE, Typeface.BOLD) }
        hint = text(20f)
        current = text(22f)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            layout.addView(this, LinearLayout.LayoutParams(600, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        footer = text(16f)
        setContentView(layout)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQUEST_STORAGE)
        }
        ServiceStarter.start(this)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    private fun render() {
        val s = SyncHolder.state
        title.text = getString(R.string.app_name)
        code.text = ""
        hint.text = ""
        current.text = ""
        progress.visibility = android.view.View.GONE

        when (s.phase) {
            "pairing" -> {
                code.text = s.pairingCode?.chunked(3)?.joinToString(" ") ?: ""
                hint.text = "Diesen Code in der Weboberfläche unter „Brillen“ eingeben."
            }
            "no_permission" -> hint.text = "Bitte die Speicherberechtigung erlauben, damit Dateien abgelegt werden können."
            "transfer" -> {
                hint.text = "Verbunden"
                current.text = s.currentFile ?: ""
                if (s.currentSize > 0) {
                    progress.visibility = android.view.View.VISIBLE
                    progress.progress = (s.currentBytes * 100 / s.currentSize).toInt()
                }
            }
            "idle", "paired" -> hint.text = "Verbunden" + (s.deviceName?.let { " als $it" } ?: "")
            else -> hint.text = "Starte …"
        }
        val contact = s.lastContactMs
        footer.text = buildString {
            append(Config.SERVER_URL).append(" · Version ").append(BuildConfig.VERSION_NAME)
            if (contact > 0) append(" · letzter Kontakt vor ").append((System.currentTimeMillis() - contact) / 1000).append(" s")
            if (s.message.isNotEmpty()) append("\n").append(s.message)
        }
    }

    private companion object {
        const val REQUEST_STORAGE = 1
    }
}
