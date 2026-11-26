package com.bbzrdeck.lernraumvr.core

import java.io.File
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FilePlacerTest {
    private val dir = tempDir()

    @AfterTest
    fun tearDown() {
        dir.deleteRecursively()
    }

    private fun part(bytes: ByteArray) = File(dir, "x.part").also { it.writeBytes(bytes) }

    @Test
    fun `bereinigt Dateinamen`() {
        assertEquals("film.mp4", FilePlacer.safeName("../../etc/film.mp4"))
        assertEquals("a_b_c.mp4", FilePlacer.safeName("a:b*c.mp4"))
        assertEquals("datei", FilePlacer.safeName("..."))
        assertEquals("versteckt", FilePlacer.safeName(".versteckt"))
        assertEquals(200, FilePlacer.safeName("a".repeat(500)).length)
    }

    @Test
    fun `legt die Datei im Zielordner ab`() {
        val bytes = randomBytes(1000)
        val target = FilePlacer.place(part(bytes), File(dir, "Movies"), "Film.mp4", sha256(bytes))
        assertEquals(File(dir, "Movies/Film.mp4"), target)
        assertContentEquals(bytes, target.readBytes())
        assertFalse(File(dir, "x.part").exists())
    }

    @Test
    fun `behaelt gleiche vorhandene Datei und loescht die Teildatei`() {
        val bytes = randomBytes(1000)
        val first = FilePlacer.place(part(bytes), File(dir, "Movies"), "Film.mp4", sha256(bytes))
        val second = FilePlacer.place(part(bytes), File(dir, "Movies"), "Film.mp4", sha256(bytes))
        assertEquals(first, second)
        assertFalse(File(dir, "x.part").exists())
        assertEquals(1, File(dir, "Movies").listFiles()!!.size)
    }

    @Test
    fun `ueberschreibt keine andere Datei gleichen Namens`() {
        val a = randomBytes(1000, 1)
        val b = randomBytes(1000, 2)
        FilePlacer.place(part(a), File(dir, "Movies"), "Film.mp4", sha256(a))
        val second = FilePlacer.place(part(b), File(dir, "Movies"), "Film.mp4", sha256(b))
        assertEquals("Film (2).mp4", second.name)
        val third = FilePlacer.place(part(randomBytes(1000, 3)), File(dir, "Movies"), "Film.mp4", null)
        assertEquals("Film (3).mp4", third.name)
        assertTrue(File(dir, "Movies/Film.mp4").exists())
        assertContentEquals(a, File(dir, "Movies/Film.mp4").readBytes())
    }
}
