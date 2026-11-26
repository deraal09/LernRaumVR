// Plattformunabhängiger Kern der Brillen-App (Protokoll, Download, Prüfsumme, Ablage).
// Läuft auf der JVM und lässt sich ohne Android-SDK testen. Die App bindet diese Quellen ein
// (siehe ../app/build.gradle.kts). Auf der Brille liefert Android org.json selbst.
plugins {
    kotlin("jvm") version "2.0.21"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.json:json:20240303")

    testImplementation(kotlin("test"))
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

tasks.test {
    useJUnitPlatform()
}
