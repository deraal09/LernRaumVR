package com.bbzrdeck.lernraumvr.core

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Random

fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

fun randomBytes(size: Int, seed: Long = 42): ByteArray = ByteArray(size).also { Random(seed).nextBytes(it) }

fun tempDir(prefix: String = "lrvr-test"): File = Files.createTempDirectory(prefix).toFile()

/**
 * Nachbildung des Datei-Endpunkts des Servers (`/api/device/files/:id`) mit Range-Unterstützung.
 * Verhalten lässt sich pro Test umschalten.
 */
class FileDispatcher(var content: ByteArray) : Dispatcher() {
    var honorRange = true
    var rejectRangeWith416 = false
    var truncateAtBytes: Int? = null
    var status404 = false
    val ranges = ArrayList<String?>()
    val authHeaders = ArrayList<String?>()

    override fun dispatch(request: RecordedRequest): MockResponse {
        ranges.add(request.getHeader("Range"))
        authHeaders.add(request.getHeader("Authorization"))
        if (status404) return MockResponse().setResponseCode(404).setBody("""{"error":"not_found"}""")
        val range = request.getHeader("Range")
        if (range != null && rejectRangeWith416) {
            return MockResponse().setResponseCode(416).setHeader("Content-Range", "bytes */${content.size}")
        }
        val start = if (range != null && honorRange) Regex("""bytes=(\d+)-""").find(range)?.groupValues?.get(1)?.toInt() else null
        val body = if (start != null) content.copyOfRange(start, content.size) else content
        val sent = truncateAtBytes?.let { body.copyOfRange(0, minOf(it, body.size)) } ?: body
        val response = MockResponse()
            .setResponseCode(if (start != null) 206 else 200)
            .setHeader("Content-Length", body.size.toString())
            .setBody(Buffer().write(sent))
        if (start != null) response.setHeader("Content-Range", "bytes $start-${content.size - 1}/${content.size}")
        if (truncateAtBytes != null) response.socketPolicy = SocketPolicy.DISCONNECT_AT_END
        return response
    }
}

fun MockWebServer.baseUrl(): String = url("/").toString().trimEnd('/')

fun remoteFile(content: ByteArray, id: String = "f1", name: String = "film.mp4", typ: String = "video", sha: String? = sha256(content)) =
    RemoteFile(id, name, typ, content.size.toLong(), sha, "/api/device/files/$id")

/** Zielordner Movies/Pictures/Download unterhalb eines Wurzelordners (Ersatz für die Android-Ablage). */
class FolderPlacement(private val root: File, private val free: () -> Long = { Long.MAX_VALUE }) : Placement {
    val placed = ArrayList<File>()
    override fun targetDir(typ: String): File = File(
        root,
        when (typ) {
            "video" -> "Movies"
            "image" -> "Pictures"
            else -> "Download"
        },
    )
    override fun freeBytes(): Long = free()
    override fun afterPlaced(file: File) {
        placed.add(file)
    }
}
