package com.bbzrdeck.lernraumvr.core

import okhttp3.mockwebserver.MockWebServer
import java.io.File
import java.io.IOException
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DownloaderTest {
    private val content = randomBytes(300_000)
    private lateinit var server: MockWebServer
    private lateinit var dispatcher: FileDispatcher
    private lateinit var dir: File
    private lateinit var downloader: Downloader

    @BeforeTest
    fun setUp() {
        dispatcher = FileDispatcher(content)
        server = MockWebServer().apply { this.dispatcher = this@DownloaderTest.dispatcher; start() }
        dir = tempDir()
        downloader = Downloader(ApiClient(server.baseUrl(), MemoryTokenStore("lrv_testtoken")), dir)
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
        dir.deleteRecursively()
    }

    private fun run(file: RemoteFile = remoteFile(content), cancelled: () -> Boolean = { false }, progress: (Long) -> Unit = {}) =
        downloader.download(7, file, cancelled, progress)

    @Test
    fun `laedt die ganze Datei und prueft die Pruefsumme`() {
        val part = run()
        assertContentEquals(content, part.readBytes())
        assertEquals(listOf<String?>(null), dispatcher.ranges)
        assertEquals("Bearer lrv_testtoken", dispatcher.authHeaders.single())
    }

    @Test
    fun `meldet Fortschritt bis zur Dateigroesse`() {
        var last = 0L
        run(progress = { last = it })
        assertEquals(content.size.toLong(), last)
    }

    @Test
    fun `setzt eine Teildatei per Range fort`() {
        File(dir, "7.part").apply { dir.mkdirs() }.writeBytes(content.copyOfRange(0, 100_000))
        val part = run()
        assertEquals(listOf<String?>("bytes=100000-"), dispatcher.ranges)
        assertContentEquals(content, part.readBytes())
    }

    @Test
    fun `beginnt von vorn, wenn der Server den Range-Header ignoriert`() {
        dispatcher.honorRange = false
        File(dir, "7.part").writeBytes(content.copyOfRange(0, 100_000))
        assertContentEquals(content, run().readBytes())
    }

    @Test
    fun `beginnt von vorn bei 416`() {
        dispatcher.rejectRangeWith416 = true
        File(dir, "7.part").writeBytes(ByteArray(50_000) { 1 })
        assertContentEquals(content, run().readBytes())
        assertEquals(listOf<String?>("bytes=50000-", null), dispatcher.ranges)
    }

    @Test
    fun `verwirft zu grosse Teildateien`() {
        File(dir, "7.part").writeBytes(ByteArray(content.size + 10))
        assertContentEquals(content, run().readBytes())
        assertEquals(listOf<String?>(null), dispatcher.ranges)
    }

    @Test
    fun `lehnt falsche Pruefsumme ab und loescht die Teildatei`() {
        val e = assertFailsWith<HashMismatchException> { run(remoteFile(content, sha = "0".repeat(64))) }
        assertTrue(e.message!!.contains("Prüfsumme"))
        assertFalse(File(dir, "7.part").exists())
    }

    @Test
    fun `behaelt die Teildatei bei abgebrochener Verbindung und setzt danach fort`() {
        dispatcher.truncateAtBytes = 120_000
        assertFailsWith<IOException> { run() }
        assertEquals(120_000L, File(dir, "7.part").length())

        dispatcher.truncateAtBytes = null
        assertContentEquals(content, run().readBytes())
        assertEquals("bytes=120000-", dispatcher.ranges.last())
    }

    @Test
    fun `bricht auf Wunsch ab und laesst die Teildatei liegen`() {
        var calls = 0
        assertFailsWith<CancelledException> { run(cancelled = { ++calls > 2 }) }
        assertTrue(File(dir, "7.part").exists())
    }

    @Test
    fun `meldet nicht mehr verfuegbare Dateien`() {
        dispatcher.status404 = true
        assertFailsWith<RemoteGoneException> { run() }
    }

    @Test
    fun `sendet den Token nicht an fremde Adressen`() {
        val other = MockWebServer().apply { dispatcher = FileDispatcher(content); start() }
        try {
            val file = remoteFile(content).copy(downloadUrl = other.url("/api/device/files/f1").toString())
            run(file)
            assertNull((other.dispatcher as FileDispatcher).authHeaders.single())
        } finally {
            other.shutdown()
        }
    }
}
