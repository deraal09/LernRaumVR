package com.bbzrdeck.lernraumvr.core

import java.io.File
import java.io.IOException

/** Plattformabhängiges: wohin Dateien gehören, wie viel Platz frei ist, was nach dem Ablegen passiert. */
interface Placement {
    fun targetDir(typ: String): File
    fun freeBytes(): Long
    /** Z. B. Medien-Scan, damit die Datei im Pico-Player/Galerie erscheint. */
    fun afterPlaced(file: File)
}

enum class RunResult {
    /** Fertig gemeldet. */
    DONE,
    /** Browser hat den Auftrag abgebrochen. */
    CANCELLED,
    /** Fehlgeschlagen und dem Server gemeldet. */
    FAILED,
    /** Vorübergehendes Problem (Netz): Teildatei bleibt, später erneut versuchen. */
    RETRY,
}

/** Reserve für Dateisystem und Medien-Scan: 10 % der Datei, mindestens 100 MB (wie auf dem Server). */
fun reserveFor(size: Long): Long = maxOf(size / 10, 100L * 1024 * 1024)

/** Bearbeitet einen einzelnen Auftrag von „wartend“ bis „fertig“ und meldet den Fortschritt. */
class TransferRunner(
    private val api: ApiClient,
    private val downloader: Downloader,
    private val placement: Placement,
    private val log: (String) -> Unit = {},
    private val now: () -> Long = System::currentTimeMillis,
    private val maxNetworkFailures: Int = 5,
) {
    private val failures = HashMap<Long, Int>()

    fun run(t: RemoteTransfer): RunResult {
        if (t.kind != "send" || t.file == null) {
            // install/remove/play folgen in späteren Phasen
            report(t.id, "failed", errorCode = "UNSUPPORTED_KIND", errorText = "Auftragsart ${t.kind} wird von dieser App-Version nicht unterstützt")
            return RunResult.FAILED
        }
        val file = t.file
        var cancelled = false

        try {
            // Freien Platz vor dem Laden prüfen (abzüglich dessen, was schon liegt).
            val needed = file.size - downloader.bytesOnDisk(t.id) + reserveFor(file.size)
            if (placement.freeBytes() < needed) {
                downloader.discard(t.id)
                report(t.id, "failed", errorCode = "NO_SPACE", errorText = "Zu wenig freier Speicher auf der Brille")
                return RunResult.FAILED
            }

            if (patch(t.id, "downloading", bytesDone = downloader.bytesOnDisk(t.id)) == PatchOutcome.Cancelled) {
                downloader.discard(t.id)
                return RunResult.CANCELLED
            }

            var lastReport = now() // die erste Fortschrittsmeldung kam gerade mit „downloading“
            val part = downloader.download(t.id, file, isCancelled = { cancelled }, onProgress = { bytes ->
                val time = now()
                if (time - lastReport >= 2_000) {
                    lastReport = time
                    if (patch(t.id, "downloading", bytesDone = bytes) == PatchOutcome.Cancelled) cancelled = true
                }
            })

            if (patch(t.id, "verified", bytesDone = file.size) == PatchOutcome.Cancelled) {
                downloader.discard(t.id)
                return RunResult.CANCELLED
            }
            val placed = FilePlacer.place(part, placement.targetDir(file.typ), file.name, file.sha256)
            placement.afterPlaced(placed)
            patch(t.id, "done", bytesDone = file.size)
            failures.remove(t.id)
            log("Fertig: ${placed.path}")
            return RunResult.DONE
        } catch (e: CancelledException) {
            downloader.discard(t.id)
            return RunResult.CANCELLED
        } catch (e: HashMismatchException) {
            report(t.id, "failed", errorCode = "HASH_MISMATCH", errorText = "Prüfsumme stimmt nicht, Datei verworfen")
            return RunResult.FAILED
        } catch (e: RemoteGoneException) {
            downloader.discard(t.id)
            report(t.id, "failed", errorCode = "GONE", errorText = "Datei ist auf dem Server nicht mehr verfügbar")
            return RunResult.FAILED
        } catch (e: AuthException) {
            throw e
        } catch (e: SecurityException) {
            report(t.id, "failed", errorCode = "NO_PERMISSION", errorText = "Keine Berechtigung zum Speichern")
            return RunResult.FAILED
        } catch (e: IOException) {
            return networkProblem(t, e)
        } catch (e: ApiException) {
            if (!e.isTemporary) {
                report(t.id, "failed", errorCode = "SERVER_ERROR", errorText = e.message)
                return RunResult.FAILED
            }
            return networkProblem(t, e)
        }
    }

    private fun networkProblem(t: RemoteTransfer, e: Exception): RunResult {
        val count = (failures[t.id] ?: 0) + 1
        failures[t.id] = count
        log("Auftrag ${t.id}: ${e.message} (Versuch $count)")
        if (count >= maxNetworkFailures) {
            failures.remove(t.id)
            report(t.id, "failed", errorCode = "NETWORK", errorText = "Download nach $count Versuchen fehlgeschlagen: ${e.message}")
            return RunResult.FAILED
        }
        return RunResult.RETRY
    }

    private fun patch(id: Long, status: String, bytesDone: Long? = null): PatchOutcome =
        api.patchTransfer(id, status, bytesDone = bytesDone)

    /** Fehler melden; scheitert die Meldung selbst (kein Netz), bleibt es beim nächsten Abgleich beim Alten. */
    private fun report(id: Long, status: String, errorCode: String?, errorText: String?) {
        try {
            api.patchTransfer(id, status, errorCode = errorCode, errorText = errorText)
        } catch (e: AuthException) {
            throw e
        } catch (e: Exception) {
            log("Meldung an den Server fehlgeschlagen: ${e.message}")
        }
    }
}
