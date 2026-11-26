package com.bbzrdeck.lernraumvr.core

data class DeviceInfo(
    val model: String? = null,
    val androidVersion: String? = null,
    val appVersion: String? = null,
)

data class PairingStart(
    val pairingId: Long,
    val code: String,
    val pollSecret: String,
    val expiresInSec: Int,
    val pollIntervalSec: Int,
)

sealed class PairingPoll {
    object Pending : PairingPoll()
    data class Confirmed(val token: String, val deviceId: Long, val name: String) : PairingPoll()
    /** Abgelaufen oder bereits abgeschlossen: neuen Code anfordern. */
    object Gone : PairingPoll()
}

data class RemoteFile(
    val id: String,
    val name: String,
    val typ: String,
    val size: Long,
    val sha256: String?,
    val downloadUrl: String,
)

data class RemoteTransfer(
    val id: Long,
    val kind: String,
    val status: String,
    val bytesDone: Long,
    val file: RemoteFile?,
)

data class TransferList(
    val transfers: List<RemoteTransfer>,
    val cancelled: List<Long>,
    val pollIntervalSec: Int,
)

sealed class PatchOutcome {
    object Ok : PatchOutcome()
    /** Der Auftrag wurde im Browser abgebrochen: Arbeit einstellen, Teildatei löschen. */
    object Cancelled : PatchOutcome()
    data class Rejected(val code: String) : PatchOutcome()
}

/** Speicher für den Gerätetoken (SharedPreferences auf der Brille, im Test im Arbeitsspeicher). */
interface TokenStore {
    fun get(): String?
    fun set(token: String?)
}

class MemoryTokenStore(private var token: String? = null) : TokenStore {
    override fun get(): String? = token
    override fun set(token: String?) {
        this.token = token
    }
}

/** HTTP-Fehler des Servers (nicht 401). 5xx und Netzwerkfehler gelten als vorübergehend. */
open class ApiException(val status: Int, val code: String?, message: String) : Exception(message) {
    val isTemporary: Boolean get() = status >= 500 || status == 429
}

/** Token ungültig oder gesperrt: die Brille muss neu gekoppelt werden. */
class AuthException : ApiException(401, "unauthorized", "Token ungültig oder gesperrt")

class CancelledException : Exception("Auftrag abgebrochen")

class HashMismatchException(val expected: String, val actual: String) :
    Exception("Prüfsumme stimmt nicht (erwartet $expected, erhalten $actual)")

/** Datei ist auf dem Server nicht (mehr) für diese Brille freigegeben. */
class RemoteGoneException : Exception("Datei ist auf dem Server nicht mehr verfügbar")
