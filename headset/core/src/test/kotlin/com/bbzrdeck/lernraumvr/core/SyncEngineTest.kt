package com.bbzrdeck.lernraumvr.core

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Nachbildung der Server-Schnittstelle für die Brille. */
class FakeServer(private val content: ByteArray) : Dispatcher() {
    val files = FileDispatcher(content)
    val patches = CopyOnWriteArrayList<JSONObject>()
    var transfersJson = "[]"
    var cancelledJson = "[]"
    var heartbeatStatus = 200
    var patchStatus = 200
    var patchBody = "{}"
    var truncateFile = false
    var knownQueries = CopyOnWriteArrayList<String?>()

    override fun dispatch(request: RecordedRequest): MockResponse {
        val path = request.path ?: ""
        return when {
            path.startsWith("/api/device/files/") -> files.dispatch(request)
            path == "/api/device/heartbeat" ->
                if (heartbeatStatus == 401) MockResponse().setResponseCode(401).setBody("""{"error":"unauthorized"}""")
                else MockResponse().setBody("""{"ok":true,"pollIntervalSec":15}""")
            path.startsWith("/api/device/transfers") && request.method == "GET" -> {
                knownQueries.add(request.requestUrl?.queryParameter("known"))
                MockResponse().setBody("""{"transfers":$transfersJson,"cancelled":$cancelledJson,"pollIntervalSec":15}""")
            }
            path.startsWith("/api/device/transfers/") && request.method == "PATCH" -> {
                patches.add(JSONObject(request.body.readUtf8()))
                MockResponse().setResponseCode(patchStatus).setBody(patchBody)
            }
            else -> MockResponse().setResponseCode(404)
        }
    }
}

class SyncEngineTest {
    private val content = randomBytes(250_000)
    private lateinit var fake: FakeServer
    private lateinit var server: MockWebServer
    private lateinit var root: File
    private lateinit var placement: FolderPlacement
    private lateinit var api: ApiClient
    private lateinit var downloader: Downloader
    private var freeBytes = Long.MAX_VALUE

    @BeforeTest
    fun setUp() {
        fake = FakeServer(content)
        server = MockWebServer().apply { dispatcher = fake; start() }
        root = tempDir()
        placement = FolderPlacement(File(root, "sdcard")) { freeBytes }
        api = ApiClient(server.baseUrl(), MemoryTokenStore("lrv_testtoken"))
        downloader = Downloader(api, File(root, "part"))
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
        root.deleteRecursively()
    }

    private fun transferJson(id: Int = 1, kind: String = "send", sha: String? = sha256(content), typ: String = "video") =
        """{"id":$id,"kind":"$kind","status":"pending","bytesDone":0,"payload":{},""" +
            """"file":{"id":"f1","name":"Lektion.mp4","typ":"$typ","size":${content.size},"sha256":${sha?.let { "\"$it\"" } ?: "null"},"downloadUrl":"/api/device/files/f1"}}"""

    private fun engine(maxFailures: Int = 5): SyncEngine {
        val runner = TransferRunner(api, downloader, placement, maxNetworkFailures = maxFailures)
        val status = object : DeviceStatus {
            override fun freeBytes() = 5_000_000_000L
            override fun batteryPercent() = 77
            override fun appVersion() = "0.1.0"
            override fun androidVersion() = "8.1.0"
        }
        return SyncEngine(api, runner, downloader, status)
    }

    private fun statuses() = fake.patches.map { it.getString("status") }

    @Test
    fun `fuehrt einen Auftrag von wartend bis fertig aus`() {
        fake.transfersJson = "[${transferJson()}]"
        val delay = engine().cycle()
        assertEquals(15_000L, delay)
        assertEquals(listOf("downloading", "verified", "done"), statuses())
        val placed = File(root, "sdcard/Movies/Lektion.mp4")
        assertContentEquals(content, placed.readBytes())
        assertEquals(listOf(placed), placement.placed)
        assertFalse(File(root, "part/1.part").exists())
        assertEquals(content.size.toLong(), fake.patches.last().getLong("bytesDone"))
    }

    @Test
    fun `sortiert Bilder und andere Dateien in die passenden Ordner`() {
        fake.transfersJson = "[${transferJson(typ = "image")}]"
        engine().cycle()
        assertTrue(File(root, "sdcard/Pictures/Lektion.mp4").exists())
    }

    @Test
    fun `bricht ab, wenn der Browser den Auftrag abgebrochen hat`() {
        fake.transfersJson = "[${transferJson()}]"
        fake.patchStatus = 409
        fake.patchBody = """{"error":"cancelled"}"""
        engine().cycle()
        assertEquals(listOf("downloading"), statuses())
        assertTrue(placement.placed.isEmpty())
        assertFalse(File(root, "part/1.part").exists())
    }

    @Test
    fun `meldet zu wenig Speicher`() {
        freeBytes = 1_000
        fake.transfersJson = "[${transferJson()}]"
        engine().cycle()
        assertEquals(listOf("failed"), statuses())
        assertEquals("NO_SPACE", fake.patches.single().getString("errorCode"))
        assertTrue(fake.files.ranges.isEmpty(), "es darf nichts geladen werden")
    }

    @Test
    fun `meldet falsche Pruefsumme und legt nichts ab`() {
        fake.transfersJson = "[${transferJson(sha = "f".repeat(64))}]"
        engine().cycle()
        assertEquals(listOf("downloading", "failed"), statuses())
        assertEquals("HASH_MISMATCH", fake.patches.last().getString("errorCode"))
        assertTrue(placement.placed.isEmpty())
        assertFalse(File(root, "part/1.part").exists())
    }

    @Test
    fun `behandelt Netzwerkfehler als vorlaeufig und meldet erst nach mehreren Versuchen`() {
        fake.files.truncateAtBytes = 100_000
        fake.transfersJson = "[${transferJson()}]"
        val engine = engine(maxFailures = 2)

        assertEquals(5_000L, engine.cycle()) // bald erneut versuchen
        assertEquals(listOf("downloading"), statuses())
        assertEquals(100_000L, File(root, "part/1.part").length())
        assertEquals("1", fake.knownQueries.lastOrNull() ?: "1")

        engine.cycle() // zweiter Fehlschlag -> melden
        assertEquals("failed", statuses().last())
        assertEquals("NETWORK", fake.patches.last().getString("errorCode"))
    }

    @Test
    fun `setzt nach einem Netzwerkfehler fort und schliesst ab`() {
        fake.files.truncateAtBytes = 100_000
        fake.transfersJson = "[${transferJson()}]"
        val engine = engine()
        engine.cycle()
        fake.files.truncateAtBytes = null
        engine.cycle()
        assertEquals("done", statuses().last())
        assertEquals("bytes=100000-", fake.files.ranges.last())
        assertContentEquals(content, File(root, "sdcard/Movies/Lektion.mp4").readBytes())
    }

    @Test
    fun `meldet unbekannte Auftragsarten als nicht unterstuetzt`() {
        fake.transfersJson = "[${transferJson(kind = "install")}]"
        engine().cycle()
        assertEquals("UNSUPPORTED_KIND", fake.patches.single().getString("errorCode"))
    }

    @Test
    fun `verwirft Teildateien abgebrochener Auftraege`() {
        File(root, "part").mkdirs()
        File(root, "part/9.part").writeBytes(ByteArray(10))
        fake.cancelledJson = "[9]"
        engine().cycle()
        assertFalse(File(root, "part/9.part").exists())
    }

    @Test
    fun `meldet gesperrte Brillen`() {
        fake.heartbeatStatus = 401
        assertFailsWith<AuthException> { engine().cycle() }
    }

    @Test
    fun `uebersteht einen nicht erreichbaren Server`() {
        server.shutdown()
        assertEquals(15_000L, engine().cycle())
    }
}

class PairingFlowTest {
    private lateinit var server: MockWebServer

    @AfterTest
    fun tearDown() = server.shutdown()

    @Test
    fun `holt den Token nach der Bestaetigung ab und ersetzt abgelaufene Codes`() {
        var created = 0
        var polls = 0
        server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val path = request.path!!
                    return when {
                        request.method == "POST" && path == "/api/pairing" -> {
                            created += 1
                            MockResponse().setResponseCode(201).setBody(
                                """{"pairingId":$created,"code":"12345$created","pollSecret":"geheim$created","expiresInSec":600,"pollIntervalSec":1}""",
                            )
                        }
                        path == "/api/pairing/1" -> MockResponse().setResponseCode(410).setBody("""{"error":"gone"}""")
                        path == "/api/pairing/2" -> {
                            assertEquals("geheim2", request.getHeader("X-Poll-Secret"))
                            polls += 1
                            if (polls < 2) MockResponse().setBody("""{"status":"pending"}""")
                            else MockResponse().setBody("""{"status":"confirmed","token":"lrv_abc","deviceId":5,"name":"Brille 05"}""")
                        }
                        else -> MockResponse().setResponseCode(404)
                    }
                }
            }
            start()
        }
        val tokens = MemoryTokenStore()
        val state = SyncState()
        val codes = ArrayList<String?>()
        val flow = PairingFlow(
            ApiClient(server.baseUrl(), tokens), tokens, DeviceInfo("G2 4K", "8.1.0", "0.1.0"), state,
            sleep = { codes.add(state.pairingCode) },
        )
        assertTrue(flow.run { false.also { } })
        assertEquals("lrv_abc", tokens.get())
        assertEquals("Brille 05", state.deviceName)
        assertEquals(null, state.pairingCode)
        assertEquals(2, created)
        // Zuerst wurde Code 1 angezeigt, nach Ablauf Code 2
        assertTrue(codes.contains("123451") && codes.contains("123452"), "angezeigte Codes: $codes")
    }

    @Test
    fun `endet, wenn die Abbruchbedingung eintritt`() {
        server = MockWebServer().apply { start() }
        val flow = PairingFlow(ApiClient(server.baseUrl(), MemoryTokenStore()), MemoryTokenStore(), DeviceInfo(), SyncState(), sleep = {})
        assertFalse(flow.run { true })
    }
}
