# Brillen-App (Android 8.1, PICO G2 4K)

Aufbau:

| Ordner | Inhalt |
|---|---|
| `core/` | Plattformunabhängiger Kern in Kotlin (Server-Protokoll mit OkHttp, Download mit Fortsetzen, SHA-256-Prüfung, Ablage, Kopplung, Abgleich). Läuft auf der JVM und wird dort getestet, ohne Android-SDK. |
| `app/` | Android-App: Dienst, Autostart, Anzeige, Ablage in Movies/Pictures/Download. Bindet die Quellen aus `core/` ein. |

Kern testen (JDK genügt):

```bash
cd headset/core
gradle test
```

Die Tests laufen gegen einen nachgebildeten Server (MockWebServer). Zusätzlich gibt es `RealServerE2ETest`,
der nur mit gesetztem `LRVR_E2E_BASE` läuft und gegen einen echten LernRaumVR-Server koppelt, lädt und ablegt.

Kotlin-App ohne AndroidX-Abhängigkeiten. Gerüst: Foreground-Service (`SyncService`), Autostart
(`BootReceiver`), Startbildschirm (`MainActivity`) und ein ausgeschalteter Launcher-Alias
(`LauncherAlias`, siehe `docs/PLAN.md`, Abschnitt 7.5).

## Bauen

Voraussetzungen: JDK 17, Android SDK (Plattform 34, Build-Tools).

```bash
cd headset
./gradlew assembleDebug                                   # Server-Adresse aus app/build.gradle.kts
./gradlew assembleDebug -PserverUrl=https://test.example.org
```

Die APK liegt danach unter `app/build/outputs/apk/debug/`. Installation per USB; `-g` erteilt die
Speicherberechtigung gleich mit, sonst muss sie einmal in der Brille bestätigt werden:

```bash
adb install -r -g app/build/outputs/apk/debug/app-debug.apk
```

Danach die App einmal starten: Sie zeigt einen 6-stelligen Code, den ein Admin in der Weboberfläche
unter „Brillen“ eingibt. Ab dann holt die Brille ihre Aufträge selbst ab.

## Release-Signatur

Die Release-Signatur kommt aus Umgebungsvariablen (nie aus dem Repo):
`LERNRAUMVR_KEYSTORE`, `LERNRAUMVR_KEYSTORE_PASSWORD`, `LERNRAUMVR_KEY_ALIAS`,
`LERNRAUMVR_KEY_PASSWORD`. Alle Updates müssen mit demselben Schlüssel signiert sein,
den Schlüssel deshalb sicher und getrennt vom Repo aufbewahren.
