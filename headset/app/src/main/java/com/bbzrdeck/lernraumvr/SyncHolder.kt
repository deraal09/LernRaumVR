package com.bbzrdeck.lernraumvr

import com.bbzrdeck.lernraumvr.core.SyncState

/** Gemeinsamer Zustand zwischen Hintergrunddienst und Anzeige (läuft im selben Prozess). */
object SyncHolder {
    val state = SyncState()
}
