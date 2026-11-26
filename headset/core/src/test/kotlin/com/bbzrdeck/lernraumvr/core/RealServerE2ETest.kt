package com.bbzrdeck.lernraumvr.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Durchlauf gegen einen echten LernRaumVR-Server (Kopplung, Abgleich, Download, Ablage).
 * Läuft nur, wenn LRVR_E2E_BASE gesetzt ist; der Server muss Kopplungen bestätigen und der neuen
 * Brille eine Datei zusenden (siehe docs/phase0.md bzw. das Testskript im Repo-Verlauf).
 */
class RealServerE2ETest {
    @Test
    fun `koppelt, laedt und legt die Datei ab`() {
        val base = System.getenv("LRVR_E2E_BASE") ?: return
        val expectedSha = System.getenv("LRVR_E2E_SHA")!!
        val expectedName = System.getenv("LRVR_E2E_NAME")!!

        val root = tempDir()
        try {
            val tokens = MemoryTokenStore()
            val api = ApiClient(base, tokens)
            val state = SyncState()

            val paired = PairingFlow(api, tokens, DeviceInfo("E2E", "8.1.0", "0.1.0"), state, log = ::println)
                .run { false }
            assertTrue(paired)
            assertTrue(tokens.get()!!.startsWith("lrv_"))

            val downloader = Downloader(api, File(root, "part"))
            val placement = FolderPlacement(File(root, "sdcard"))
            val status = object : DeviceStatus {
                override fun freeBytes() = 50_000_000_000L
                override fun batteryPercent() = 90
                override fun appVersion() = "0.1.0"
                override fun androidVersion() = "8.1.0"
            }
            val engine = SyncEngine(api, TransferRunner(api, downloader, placement, ::println), downloader, status, state, ::println)

            val target = File(root, "sdcard/Movies/$expectedName")
            val deadline = System.currentTimeMillis() + 60_000
            while (!target.exists() && System.currentTimeMillis() < deadline) {
                engine.cycle()
                if (!target.exists()) Thread.sleep(500)
            }
            assertTrue(target.exists(), "Datei wurde nicht abgelegt")
            assertEquals(expectedSha, sha256Hex(target))
            assertEquals(0, File(root, "part").listFiles()?.size ?: 0)
        } finally {
            root.deleteRecursively()
        }
    }
}
