package com.bbzrdeck.lernraumvr

/** Feste Einstellungen der Brillen-App. Die Server-Adresse kommt aus dem Build (`-PserverUrl`). */
object Config {
    const val SERVER_URL: String = BuildConfig.SERVER_URL

    /** Rückfall-Abfrage der Aufträge, falls der WebSocket nicht verfügbar ist. */
    const val POLL_INTERVAL_MS: Long = 60_000L
}
