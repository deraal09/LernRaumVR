# Brillen-App (Android 8.1, PICO G2 4K)

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

Die APK liegt danach unter `app/build/outputs/apk/debug/`. Installation per USB:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Release-Signatur

Die Release-Signatur kommt aus Umgebungsvariablen (nie aus dem Repo):
`LERNRAUMVR_KEYSTORE`, `LERNRAUMVR_KEYSTORE_PASSWORD`, `LERNRAUMVR_KEY_ALIAS`,
`LERNRAUMVR_KEY_PASSWORD`. Alle Updates müssen mit demselben Schlüssel signiert sein,
den Schlüssel deshalb sicher und getrennt vom Repo aufbewahren.
