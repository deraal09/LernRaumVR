package com.bbzrdeck.lernraumvr.core

/** Gerätezustand für den Heartbeat. */
interface DeviceStatus {
    fun freeBytes(): Long?
    fun batteryPercent(): Int?
    fun appVersion(): String?
    fun androidVersion(): String?
}

/** Beobachtbarer Zustand für die Anzeige (wird von einem Hintergrund-Thread geschrieben). */
class SyncState {
    @Volatile var phase: String = "start"
    @Volatile var pairingCode: String? = null
    @Volatile var deviceName: String? = null
    @Volatile var message: String = ""
    @Volatile var lastContactMs: Long = 0
    @Volatile var currentFile: String? = null
    @Volatile var currentBytes: Long = 0
    @Volatile var currentSize: Long = 0
}

/**
 * Ein Abgleich mit dem Server: Heartbeat, offene Aufträge holen, nacheinander abarbeiten.
 * Läuft in einem Hintergrund-Thread; `cycle()` liefert die Wartezeit bis zum nächsten Abgleich.
 */
class SyncEngine(
    private val api: ApiClient,
    private val runner: TransferRunner,
    private val downloader: Downloader,
    private val status: DeviceStatus,
    private val state: SyncState = SyncState(),
    private val log: (String) -> Unit = {},
    private val now: () -> Long = System::currentTimeMillis,
) {
    /** Aufträge, die zuletzt bearbeitet wurden und noch nicht abgeschlossen sind (für `known`). */
    private val inProgress = LinkedHashSet<Long>()

    /** @throws AuthException wenn die Brille gesperrt wurde (neu koppeln). */
    fun cycle(): Long {
        var pollSec = 15
        try {
            pollSec = api.heartbeat(status.freeBytes(), status.batteryPercent(), status.appVersion(), status.androidVersion())
            state.lastContactMs = now()
        } catch (e: AuthException) {
            throw e
        } catch (e: Exception) {
            state.message = "Server nicht erreichbar"
            log("Heartbeat fehlgeschlagen: ${e.message}")
            return pollSec * 1000L
        }

        val list = try {
            api.fetchTransfers(inProgress)
        } catch (e: AuthException) {
            throw e
        } catch (e: Exception) {
            log("Aufträge holen fehlgeschlagen: ${e.message}")
            return pollSec * 1000L
        }
        pollSec = list.pollIntervalSec
        state.message = ""

        for (id in list.cancelled) {
            downloader.discard(id)
            inProgress.remove(id)
        }

        var retry = false
        for (t in list.transfers) {
            inProgress.add(t.id)
            state.phase = "transfer"
            state.currentFile = t.file?.name
            state.currentSize = t.file?.size ?: 0
            state.currentBytes = downloader.bytesOnDisk(t.id)
            val result = runner.run(t)
            if (result != RunResult.RETRY) inProgress.remove(t.id) else retry = true
            state.currentFile = null
        }
        state.phase = "idle"
        // Nach einem Fehlversuch bald erneut probieren, statt das volle Intervall zu warten.
        return if (retry) minOf(pollSec * 1000L, 5_000L) else pollSec * 1000L
    }
}

/** Kopplung: Code anzeigen lassen, auf Bestätigung warten, Token speichern. */
class PairingFlow(
    private val api: ApiClient,
    private val tokens: TokenStore,
    private val info: DeviceInfo,
    private val state: SyncState = SyncState(),
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
    private val log: (String) -> Unit = {},
) {
    /**
     * Blockiert, bis die Brille gekoppelt ist oder `shouldStop` wahr wird.
     * Abgelaufene Codes werden automatisch durch neue ersetzt.
     */
    fun run(shouldStop: () -> Boolean): Boolean {
        while (!shouldStop()) {
            val pairing = try {
                api.createPairing(info)
            } catch (e: Exception) {
                state.message = "Server nicht erreichbar"
                log("Kopplung anfordern fehlgeschlagen: ${e.message}")
                sleep(10_000)
                continue
            }
            state.phase = "pairing"
            state.pairingCode = pairing.code
            state.message = ""
            val intervalMs = maxOf(pairing.pollIntervalSec, 1) * 1000L

            while (!shouldStop()) {
                sleep(intervalMs)
                val result = try {
                    api.pollPairing(pairing.pairingId, pairing.pollSecret)
                } catch (e: Exception) {
                    log("Kopplung abfragen fehlgeschlagen: ${e.message}")
                    continue
                }
                when (result) {
                    is PairingPoll.Pending -> Unit
                    is PairingPoll.Confirmed -> {
                        tokens.set(result.token)
                        state.deviceName = result.name
                        state.pairingCode = null
                        state.phase = "paired"
                        return true
                    }
                    is PairingPoll.Gone -> break // abgelaufen: neuen Code holen
                }
            }
        }
        return false
    }
}
