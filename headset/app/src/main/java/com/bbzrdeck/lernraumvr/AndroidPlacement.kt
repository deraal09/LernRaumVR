package com.bbzrdeck.lernraumvr

import android.content.Context
import android.media.MediaScannerConnection
import android.os.Environment
import android.os.StatFs
import com.bbzrdeck.lernraumvr.core.Placement
import java.io.File

/** Ablage in die öffentlichen Ordner Movies, Pictures und Download (Android 8.1 ohne Scoped Storage). */
class AndroidPlacement(private val context: Context) : Placement {
    override fun targetDir(typ: String): File = Environment.getExternalStoragePublicDirectory(
        when (typ) {
            "video" -> Environment.DIRECTORY_MOVIES
            "image" -> Environment.DIRECTORY_PICTURES
            else -> Environment.DIRECTORY_DOWNLOADS
        },
    )

    override fun freeBytes(): Long = StatFs(Environment.getExternalStorageDirectory().path).availableBytes

    /** Medien-Scan, damit die Datei im Pico-Player und in der Galerie erscheint. */
    override fun afterPlaced(file: File) {
        MediaScannerConnection.scanFile(context.applicationContext, arrayOf(file.absolutePath), null, null)
    }
}
