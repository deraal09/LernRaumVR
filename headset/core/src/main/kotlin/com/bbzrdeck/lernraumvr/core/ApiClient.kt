package com.bbzrdeck.lernraumvr.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.io.InputStream
import java.util.concurrent.TimeUnit

/** Antwort eines Downloads. Der Aufrufer schließt sie nach dem Lesen. */
class DownloadResponse(
    val status: Int,
    /** Gesamtgröße der Datei, aus Content-Range bzw. Content-Length. */
    val totalSize: Long?,
    /** Startposition der gelieferten Daten (bei 206 aus Content-Range, sonst 0). */
    val startOffset: Long,
    val body: InputStream?,
    private val response: Response,
) : Closeable {
    override fun close() = response.close()
}

/** Schnittstelle zum LernRaumVR-Server aus Sicht der Brille. */
class ApiClient(
    baseUrl: String,
    private val tokens: TokenStore,
    private val http: OkHttpClient = defaultClient(),
) {
    private val base: HttpUrl = baseUrl.trimEnd('/').toHttpUrl()
    private val json = "application/json; charset=utf-8".toMediaType()

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    private fun url(path: String): HttpUrl =
        base.resolve(path) ?: throw IllegalArgumentException("Ungültiger Pfad: $path")

    private fun authorized(builder: Request.Builder, target: HttpUrl): Request.Builder {
        // Den Token nur an den eigenen Server schicken (später kann ein lokaler Cache eine andere Adresse liefern).
        val token = tokens.get()
        if (token != null && target.host == base.host && target.port == base.port) {
            builder.header("Authorization", "Bearer $token")
        }
        return builder
    }

    private fun errorCode(response: Response): String? =
        runCatching { JSONObject(response.body?.string() ?: "").optString("error").ifEmpty { null } }.getOrNull()

    private fun failure(response: Response): ApiException {
        val code = errorCode(response)
        return ApiException(response.code, code, "Server antwortete ${response.code}${code?.let { " ($it)" } ?: ""}")
    }

    // --- Kopplung (ohne Token) -------------------------------------------------------------

    fun createPairing(info: DeviceInfo): PairingStart {
        val body = JSONObject().apply {
            info.model?.let { put("model", it) }
            info.androidVersion?.let { put("androidVersion", it) }
            info.appVersion?.let { put("appVersion", it) }
        }
        val request = Request.Builder().url(url("/api/pairing")).post(body.toString().toRequestBody(json)).build()
        http.newCall(request).execute().use { r ->
            if (!r.isSuccessful) throw failure(r)
            val o = JSONObject(r.body!!.string())
            return PairingStart(
                pairingId = o.getLong("pairingId"),
                code = o.getString("code"),
                pollSecret = o.getString("pollSecret"),
                expiresInSec = o.getInt("expiresInSec"),
                pollIntervalSec = o.optInt("pollIntervalSec", 3),
            )
        }
    }

    fun pollPairing(pairingId: Long, pollSecret: String): PairingPoll {
        val request = Request.Builder().url(url("/api/pairing/$pairingId")).header("X-Poll-Secret", pollSecret).get().build()
        http.newCall(request).execute().use { r ->
            if (r.code == 404 || r.code == 410) return PairingPoll.Gone
            if (!r.isSuccessful) throw failure(r)
            val o = JSONObject(r.body!!.string())
            return when (o.getString("status")) {
                "confirmed" -> PairingPoll.Confirmed(o.getString("token"), o.getLong("deviceId"), o.getString("name"))
                else -> PairingPoll.Pending
            }
        }
    }

    // --- mit Token -------------------------------------------------------------------------

    fun heartbeat(freeBytes: Long?, batteryPercent: Int?, appVersion: String?, androidVersion: String?): Int {
        val body = JSONObject().apply {
            freeBytes?.let { put("freeBytes", it) }
            batteryPercent?.let { put("batteryPercent", it) }
            appVersion?.let { put("appVersion", it) }
            androidVersion?.let { put("androidVersion", it) }
        }
        val request = authorized(Request.Builder().url(url("/api/device/heartbeat")), base)
            .post(body.toString().toRequestBody(json)).build()
        http.newCall(request).execute().use { r ->
            if (r.code == 401) throw AuthException()
            if (!r.isSuccessful) throw failure(r)
            return JSONObject(r.body!!.string()).optInt("pollIntervalSec", 15)
        }
    }

    fun fetchTransfers(knownIds: Collection<Long>): TransferList {
        val query = if (knownIds.isEmpty()) "" else "?known=" + knownIds.joinToString(",")
        val request = authorized(Request.Builder().url(url("/api/device/transfers$query")), base).get().build()
        http.newCall(request).execute().use { r ->
            if (r.code == 401) throw AuthException()
            if (!r.isSuccessful) throw failure(r)
            val o = JSONObject(r.body!!.string())
            val transfers = o.getJSONArray("transfers").objects().map { t ->
                RemoteTransfer(
                    id = t.getLong("id"),
                    kind = t.getString("kind"),
                    status = t.getString("status"),
                    bytesDone = t.optLong("bytesDone", 0),
                    file = t.optJSONObject("file")?.let { f ->
                        RemoteFile(
                            id = f.getString("id"),
                            name = f.getString("name"),
                            typ = f.optString("typ", "other"),
                            size = f.getLong("size"),
                            sha256 = if (f.isNull("sha256")) null else f.getString("sha256"),
                            downloadUrl = f.getString("downloadUrl"),
                        )
                    },
                )
            }
            val cancelled = o.optJSONArray("cancelled")?.let { a -> (0 until a.length()).map { a.getLong(it) } } ?: emptyList()
            return TransferList(transfers, cancelled, o.optInt("pollIntervalSec", 15))
        }
    }

    fun patchTransfer(
        id: Long,
        status: String,
        bytesDone: Long? = null,
        errorCode: String? = null,
        errorText: String? = null,
    ): PatchOutcome {
        val body = JSONObject().apply {
            put("status", status)
            bytesDone?.let { put("bytesDone", it) }
            errorCode?.let { put("errorCode", it.take(64)) }
            errorText?.let { put("errorText", it.take(500)) }
        }
        val request = authorized(Request.Builder().url(url("/api/device/transfers/$id")), base)
            .patch(body.toString().toRequestBody(json)).build()
        http.newCall(request).execute().use { r ->
            if (r.code == 401) throw AuthException()
            if (r.isSuccessful) return PatchOutcome.Ok
            val code = errorCode(r)
            if (r.code == 409 && code == "cancelled") return PatchOutcome.Cancelled
            if (r.code == 404 || r.code == 409) return PatchOutcome.Rejected(code ?: "rejected")
            throw ApiException(r.code, code, "Server antwortete ${r.code}")
        }
    }

    /** Lädt ab `offset` (Range). Die Antwort muss geschlossen werden. */
    fun download(downloadUrl: String, offset: Long): DownloadResponse {
        val target = url(downloadUrl)
        val builder = authorized(Request.Builder().url(target), target)
        if (offset > 0) builder.header("Range", "bytes=$offset-")
        val response = http.newCall(builder.get().build()).execute()
        when {
            response.code == 401 -> { response.close(); throw AuthException() }
            response.code == 404 -> { response.close(); throw RemoteGoneException() }
            response.code == 416 -> return DownloadResponse(416, parseTotal(response), 0, null, response)
            !response.isSuccessful -> { val e = failure(response); response.close(); throw e }
        }
        val total: Long?
        val start: Long
        if (response.code == 206) {
            val cr = response.header("Content-Range") // bytes 100-999/1000
            val m = cr?.let { Regex("""bytes (\d+)-(\d+)/(\d+)""").find(it) }
            start = m?.groupValues?.get(1)?.toLong() ?: offset
            total = m?.groupValues?.get(3)?.toLong()
        } else {
            start = 0
            total = response.header("Content-Length")?.toLongOrNull()
        }
        return DownloadResponse(response.code, total, start, response.body?.byteStream(), response)
    }

    private fun parseTotal(response: Response): Long? =
        response.header("Content-Range")?.substringAfter('/', "")?.toLongOrNull()

    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
}
