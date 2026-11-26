package com.bbzrdeck.lernraumvr.core

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.security.MessageDigest

fun sha256Hex(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> feed(input, digest) }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

private fun feed(input: InputStream, digest: MessageDigest) {
    val buffer = ByteArray(256 * 1024)
    while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
    }
}

/**
 * Lädt eine Datei in eine Teildatei (`<Auftrag>.part`), setzt nach Abbrüchen per Range fort und
 * prüft zum Schluss die SHA-256-Prüfsumme.
 */
class Downloader(
    private val api: ApiClient,
    private val partDir: File,
) {
    fun partFile(transferId: Long): File = File(partDir, "$transferId.part")

    /** Bereits geladene Bytes (Größe der Teildatei). */
    fun bytesOnDisk(transferId: Long): Long = partFile(transferId).let { if (it.exists()) it.length() else 0L }

    fun discard(transferId: Long) {
        partFile(transferId).delete()
    }

    /**
     * Lädt die Datei vollständig und liefert die geprüfte Teildatei.
     *
     * @throws CancelledException wenn `isCancelled` wahr wird (Teildatei bleibt liegen)
     * @throws HashMismatchException bei falscher Prüfsumme (Teildatei wird gelöscht)
     * @throws IOException bei Netzwerkfehlern oder zu früh beendeter Verbindung (Teildatei bleibt für Fortsetzen)
     */
    fun download(
        transferId: Long,
        file: RemoteFile,
        isCancelled: () -> Boolean,
        onProgress: (Long) -> Unit,
    ): File {
        partDir.mkdirs()
        val part = partFile(transferId)
        if (part.exists() && part.length() > file.size) part.delete()

        var restartedAfter416 = false
        while (!part.exists() || part.length() < file.size) {
            val offset = if (part.exists()) part.length() else 0L
            if (!fetch(file, part, offset, isCancelled, onProgress)) {
                // 416: Teildatei passt nicht zur Datei auf dem Server (gelöscht), einmal von vorn beginnen.
                if (restartedAfter416) throw IOException("Server lehnt den Download ab (416)")
                restartedAfter416 = true
                continue
            }
            if (!part.exists() || part.length() < file.size) {
                if (isCancelled()) throw CancelledException()
                throw IOException("Verbindung vorzeitig beendet (${if (part.exists()) part.length() else 0} von ${file.size} Bytes)")
            }
        }

        if (part.length() != file.size) {
            part.delete()
            throw IOException("Dateigröße stimmt nicht (${part.length()} statt ${file.size})")
        }
        val expected = file.sha256
        if (expected != null) {
            val actual = sha256Hex(part)
            if (!actual.equals(expected, ignoreCase = true)) {
                part.delete()
                throw HashMismatchException(expected, actual)
            }
        }
        return part
    }

    /** Ein Abruf ab `offset`. `false` bei 416 (Teildatei wurde gelöscht). */
    private fun fetch(
        file: RemoteFile,
        part: File,
        offset: Long,
        isCancelled: () -> Boolean,
        onProgress: (Long) -> Unit,
    ): Boolean {
        api.download(file.downloadUrl, offset).use { response ->
            if (response.status == 416) {
                part.delete()
                return false
            }
            val body = response.body ?: throw IOException("Leere Antwort")
            // Ignoriert der Server den Range-Header (200 statt 206), wird von vorn geschrieben.
            val writeFrom = if (response.status == 206) response.startOffset else 0L
            if (response.status == 206 && writeFrom != offset) {
                part.delete()
                throw IOException("Unerwarteter Startpunkt $writeFrom, erwartet $offset")
            }
            RandomAccessFile(part, "rw").use { out ->
                out.setLength(writeFrom)
                out.seek(writeFrom)
                val buffer = ByteArray(64 * 1024)
                var written = writeFrom
                while (true) {
                    if (isCancelled()) throw CancelledException()
                    val n = body.read(buffer)
                    if (n < 0) break
                    out.write(buffer, 0, n)
                    written += n
                    onProgress(written)
                }
            }
        }
        return true
    }
}
