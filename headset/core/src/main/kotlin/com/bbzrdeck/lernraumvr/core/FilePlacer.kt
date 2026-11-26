package com.bbzrdeck.lernraumvr.core

import java.io.File
import java.io.IOException

/** Legt eine fertig geladene und geprüfte Datei im Zielordner ab. */
object FilePlacer {
    /** Dateiname ohne Pfad und Sonderzeichen, die Android-Dateisysteme nicht mögen. */
    fun safeName(name: String): String {
        val base = name.substringAfterLast('/').substringAfterLast('\\')
        val cleaned = base.replace(Regex("""[\u0000-\u001f\u007f:*?"<>|]"""), "_").trim().trimStart('.')
        return cleaned.take(200).ifEmpty { "datei" }
    }

    private fun candidate(dir: File, name: String, n: Int): File {
        if (n <= 1) return File(dir, name)
        val dot = name.lastIndexOf('.')
        return if (dot > 0) File(dir, "${name.substring(0, dot)} ($n)${name.substring(dot)}") else File(dir, "$name ($n)")
    }

    /**
     * Verschiebt `part` nach `dir/name`. Gibt es die Datei schon mit gleichem Inhalt, bleibt sie
     * bestehen; sonst wird ein Name mit Zähler vergeben, damit nichts überschrieben wird.
     */
    fun place(part: File, dir: File, name: String, expectedSha256: String?): File {
        if (!dir.exists() && !dir.mkdirs() && !dir.exists()) throw IOException("Ordner ${dir.path} nicht anlegbar")
        val safe = safeName(name)
        var n = 1
        while (true) {
            val target = candidate(dir, safe, n)
            if (!target.exists()) {
                move(part, target)
                return target
            }
            // Nur bei bekannter Prüfsumme als gleich behandeln; sonst lieber einen neuen Namen vergeben.
            val same = expectedSha256 != null && target.length() == part.length() &&
                sha256Hex(target).equals(expectedSha256, ignoreCase = true)
            if (same) {
                part.delete()
                return target
            }
            n += 1
        }
    }

    private fun move(from: File, to: File) {
        if (from.renameTo(to)) return
        // andere Partition: kopieren und Quelle löschen
        try {
            from.inputStream().use { input -> to.outputStream().use { out -> input.copyTo(out, 256 * 1024) } }
        } catch (e: IOException) {
            to.delete()
            throw e
        }
        from.delete()
    }
}
