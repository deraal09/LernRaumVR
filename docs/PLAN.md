# LernRaumVR (Arbeitstitel „Lernblick“) – Umsetzungsplan

Stand: 26.11.2026 · Grundlage: erste Idee von Till · Status: Entwurf zur Abstimmung

Ziel: Lehrkräfte laden Videos, Bilder, APKs und andere Dateien im Browser hoch und senden sie an einzelne PICO G2 4K. Die Brille holt sich die Aufträge selbst ab, sobald sie online ist. Der Server kann nichts auf die Brille schieben, deshalb fragt eine kleine App auf der Brille nach.

---

## 1. Was ich gegenüber der ersten Idee ändere oder ergänze

Die Grundrichtung (Server + Browser-UI + Brillen-App, Brille fragt aktiv nach) bleibt. Beim Durchgehen sind mir diese Punkte aufgefallen:

1. **Server-URL auf der Brille eintippen ist unpraktisch** (G2 4K hat keine Tastatur). Für V1 wird die URL fest in die App gebaut (`BuildConfig`) oder per Konfigdatei in `/sdcard/Download/lernraumvr.json` übergeben.
2. **Kopplung braucht ein Geheimnis, nicht nur den Code.** Ein 6-stelliger Code ist erratbar. Die Brille bekommt beim Anfordern zusätzlich ein `poll_secret`; nur wer das kennt, kann den Token nach der Bestätigung abholen. Code läuft nach 10 Minuten ab, Versuche sind ratenbegrenzt.
3. **Android 8.1 (API 27) bestimmt die Brillen-App.** Hintergrundlimits seit Android 8 bedeuten: Dauerbetrieb nur als Foreground-Service mit sichtbarer Benachrichtigung, plus Autostart nach Neustart. Dafür gibt es noch kein Scoped Storage, d. h. Schreiben nach `Movies/`, `Pictures/`, `Download/` geht mit der normalen Speicher-Berechtigung, danach muss der Media-Scanner angestoßen werden, damit die Dateien in der Galerie/im Player erscheinen.
4. **Standby der Brille ist ein Praxisproblem.** Brillen liegen im Koffer/Ladewagen. Ob sie im Standby oder beim Laden online bleiben, entscheidet, ob „Datei vor der Stunde senden“ überhaupt funktioniert. Gehört in Phase 0.
5. **Bauen vs. kaufen kurz prüfen.** Es gibt fertige Geräteverwaltungen für Pico (z. B. ArborXR, ManageXR, Pico Business Suite). Ich habe weder Preise noch Funktionsumfang geprüft. Eine Stunde Recherche in Phase 0 verhindert, dass etwas gebaut wird, was es schon gibt. Eigenbau lohnt vor allem wegen Kosten, Datenschutz und Anpassung an den Unterricht.
6. **Fehlende Schnittstellen ergänzt** (siehe Abschnitt 6): Logout, Dateien löschen, Brillen umbenennen/sperren, Transfers abbrechen, Heartbeat.
7. **Brillen-App muss sich selbst aktualisieren können**, sonst muss man jede Brille per USB anfassen. Nutzt dieselbe Installationsfunktion wie fremde APKs (siehe 5.3) und dieselbe Signatur-Keystore.
8. **Auftragsfeld `kind` von Anfang an** (wie von dir vorgesehen): `send`, `install`, später `play`. Dazu ein `payload` (JSON) für artspezifische Daten.
9. **Name:** Repo heißt `LernRaumVR`, die Idee „Lernblick“. Bitte einen Namen festlegen, bevor Paketname (`de.…`) und Domain feststehen, denn der Android-Paketname lässt sich später nicht mehr sauber ändern.

---

## 2. Umfang Version 1

| Funktion | Version 1 | Später |
|---|---|---|
| Anmeldung | 1–wenige Konten, Passwort | Rollen, Schul-Login |
| Dateien hochladen/verwalten | ja (fortsetzbar, Liste, Löschen) | Ordner, Schlagworte |
| Brillen koppeln, Status sehen | ja | Gruppen, Klassensätze |
| Dateien an einzelne Brillen senden | ja | Zeitpläne |
| APK installieren | Bestätigung in der Brille (ggf. still, falls Phase 0 es erlaubt) | ohne Rückfrage |
| Videos umwandeln | nein, nur Prüfung + Warnung | FFmpeg-Warteschlange |
| Wiedergabe fernsteuern | nein | ja |

Nicht Teil von V1: Gruppen, Zeitpläne, Rollen, Transcoding, Fernsteuerung, Unterrichtspakete.

---

## 3. Architektur

```
   Browser (Lehrkraft)                         PICO G2 4K (Android 8.1)
   Vite-Weboberfläche                          Kotlin-App, Foreground-Service
        │  HTTPS: Login, Upload (tus),                  │  HTTPS (nur ausgehend):
        │  Dateiliste, Transfers                        │  Kopplung, Aufträge, Download (Range),
        │  WS: Live-Status ◄────────┐        ┌────────► │  Fortschritt, Heartbeat
        ▼                           │        │          ▼
   ┌──────────────────────────────────────────────────────────┐
   │ Server: Node.js (LTS) · TypeScript · Fastify             │
   │  Auth · tus-Upload · Dateien · Geräte · Transfers · WS   │
   │  SQLite (Metadaten)   Dateisystem (uploads/, files/)     │
   └──────────────────────────────────────────────────────────┘
```

**Verbindungsstrategie der Brille:** WebSocket als Schnellkanal („neuer Auftrag“), zusätzlich Polling alle 60 s als Rückfall, falls WS durch Proxy/WLAN/Standby abreißt. Aufträge selbst werden immer über `GET /api/device/transfers` geholt, der WS-Kanal ist nur ein Wecksignal. So ist die Logik nur einmal vorhanden und robust.

---

## 4. Technologieentscheidungen

| Teil | Wahl | Anmerkung |
|---|---|---|
| Server | Node.js LTS, TypeScript, Fastify | Zod/TypeBox für Schema-Validierung der Requests |
| Upload | tus (`@tus/server`, `FileStore`) | Läuft über den Node-HTTP-Handler; in Fastify mit eigenem Content-Type-Parser für `application/offset+octet-stream` einbinden. Nach Abschluss: SHA-256, ffprobe, Verschieben in `files/` |
| Download | eigener Fastify-Handler mit `Range` | `createReadStream({start,end})`, `206`, `ETag` = SHA-256; Auth per Gerätetoken |
| Datenbank | SQLite via `better-sqlite3`, SQL-Migrationen als Dateien | WAL-Modus, ein Prozess; reicht für Dutzende Brillen locker |
| Passwörter | `scrypt` (Node-Bordmittel) oder argon2 | Session-Cookie `HttpOnly; Secure; SameSite=Strict` |
| Web | Vite + TypeScript, schlanke Bibliothek (Preact o. ä.) oder Vanilla | Kein großes Framework; tus-Client `tus-js-client` |
| Brillen-App | Kotlin, minSdk 26, OkHttp (HTTP + WebSocket), Coroutines | Keine Room/Compose nötig; `SharedPreferences` für Token |
| Prüfung Medien | `ffprobe` auf dem Server | Codec, Auflösung, Dauer, Bitrate → Warnungen |
| APK-Prüfung | Paketname/Version aus APK lesen (z. B. `aapt2`/`apkanalyzer` oder Java-Bibliothek) | Anzeige vor dem Senden |
| Tests | Vitest (Server), Playwright (Web-Smoke), Android: manuell + wenige Unit-Tests | |
| CI | GitHub Actions: Lint, Typecheck, Tests, APK-Build | APK als Artefakt, signiert über Secret-Keystore |

---

## 5. Brillen-App im Detail

### 5.1 Bestandteile
- **MainActivity** (2D-Fenster, wenig Bedienung): zeigt Kopplungscode, Verbindungsstatus, letzte Aufträge, freien Speicher. Keine Texteingabe nötig.
- **SyncService** (Foreground-Service, Notification „LernRaumVR verbunden“): hält WS, pollt, arbeitet Aufträge nacheinander ab.
- **BootReceiver**: startet den Service nach Neustart.
- **WorkManager-Watchdog** (alle 15 min): startet den Service neu, falls das System ihn beendet hat.
- **Downloader**: lädt in `getExternalFilesDir()/part/<transfer>.part`, setzt per `Range` fort, prüft SHA-256, verschiebt dann nach `Movies/`, `Pictures/` bzw. `Download/` (nach `typ`), ruft `MediaScannerConnection.scanFile` auf.
- **Installer**: siehe 5.3.

### 5.2 Ablauf eines Transfers (Brillensicht)
1. Auftrag abholen (`status=pending`) → `PATCH … downloading` + `bytes_done` etwa alle 2 s/5 %.
2. Vor dem Start freien Speicher prüfen; zu wenig → `failed` mit Fehlercode `NO_SPACE`.
3. Download mit Range-Fortsetzung, Retry mit Backoff, nach Neustart der App wird `.part` wieder aufgenommen.
4. SHA-256 vergleichen → `verified`; Abweichung → Datei löschen, `failed` mit `HASH_MISMATCH`.
5. `kind=send`: verschieben + Media-Scan → `done`. `kind=install`: siehe 5.3.

### 5.3 APK-Installation (größtes Risiko)
Zwei Wege, Phase 0 entscheidet:

- **A – stille Installation** über das Pico-Enterprise-SDK (laut deiner Recherche für die G2 4K vorgesehen, SDK-Herkunft/Version noch unklar). Nicht von mir geprüft.
- **B – Standard-Android-Weg** (Rückfall, V1-tauglich): `REQUEST_INSTALL_PACKAGES`, „Unbekannte Quellen“ einmalig für die App erlauben, Installation über `FileProvider` + Installer-Intent. Der Nutzer bestätigt in der Brille; Transfer-Status `awaiting_confirmation`, danach `installed`.

Die App kapselt beides hinter einem `ApkInstaller`-Interface, damit die Entscheidung später ohne Umbau wechselbar ist. Dazu gehört die Prüfung, ob die Installation wirklich erfolgt ist (`PackageManager.getPackageInfo`, Versionscode).

### 5.4 Offene Praxisfragen für Phase 0
- Findet der Pico-Videoplayer Dateien in `Movies/` automatisch? Welche Dateinamen-/Ordnerkonventionen steuern 180°/360°/3D (z. B. Suffixe wie `_180_LR`)? Noch nicht geprüft.
- Bleibt der Foreground-Service am Leben, wenn die Brille abgesetzt wird, im Standby ist oder lädt? Gibt es Akku-Optimierung/Autostart-Whitelist in den Pico-Einstellungen?
- Ist die App in der Pico-Oberfläche als 2D-App bedienbar (Kopplungscode lesbar)?

---

## 6. Datenmodell und Schnittstellen

### 6.1 Tabellen
| Tabelle | Felder (Auswahl) |
|---|---|
| `users` | id, name, password_hash, role (`admin`), created_at |
| `files` | id, name, original_name, typ (`video`/`image`/`apk`/`other`), mime, groesse, sha256, pfad, meta (JSON: Codec, Auflösung, Dauer; bei APK Paketname, versionCode), warnungen (JSON), uploaded_by, created_at |
| `devices` | id, name, token_hash, last_seen_at, freier_speicher, app_version, android_version, revoked_at, created_at |
| `pairings` | id, code, poll_secret_hash, device_info, expires_at, device_id (nach Bestätigung), token_ausgegeben |
| `transfers` | id, **kind**, file_id, device_id, status, bytes_done, fehler_code, fehler_text, payload (JSON), created_at, updated_at, finished_at |

Dateien liegen als `files/<id>` (nicht unter dem Originalnamen) auf der Platte, der Anzeigename steht nur in der DB. Verhindert Pfadtricks und Namenskollisionen.

### 6.2 Transfer-Zustände
`pending` (wartend) → `downloading` (lädt) → `verified` (geprüft) → `done` (fertig) bzw. bei `kind=install` → `awaiting_confirmation` → `installed`.
Jederzeit möglich: `failed` (mit Fehlercode, Wiederholen möglich) und `cancelled` (vom Browser aus).
Die Brille meldet nur zulässige Übergänge, der Server prüft das.

### 6.3 API
Browser (Session-Cookie):

| Aufruf | Zweck |
|---|---|
| `POST /api/login`, `POST /api/logout` | an-/abmelden |
| `* /api/uploads/…` | tus-Upload (Teile, Fortsetzen) |
| `GET /api/files`, `DELETE /api/files/:id` | auflisten, löschen (nur wenn kein offener Transfer) |
| `GET /api/devices`, `PATCH /api/devices/:id`, `DELETE /api/devices/:id` | Status, umbenennen, sperren/entfernen |
| `POST /api/devices/confirm` | Kopplungscode bestätigen, Name vergeben |
| `POST /api/transfers`, `GET /api/transfers`, `POST /api/transfers/:id/cancel` | senden, Verlauf, abbrechen |

Brille (`Authorization: Bearer <Token>`):

| Aufruf | Zweck |
|---|---|
| `POST /api/pairing` | Code + `poll_secret` anfordern (ohne Auth, ratenbegrenzt) |
| `GET /api/pairing/:id` | wartet auf Bestätigung, liefert Token **einmalig** |
| `GET /api/device/transfers` | offene Aufträge |
| `GET /api/device/files/:id` | Download, `Range`, `ETag` |
| `PATCH /api/device/transfers/:id` | Status, `bytes_done`, Fehler |
| `POST /api/device/heartbeat` | Speicher, App-Version, Akku, `last_seen` |

`WS /ws`: Browser (Cookie) erhält Transfer- und Geräteänderungen live, Brille (Token) erhält „neuer Auftrag“. Nachrichtenformat mit `type` und `version`, damit spätere Erweiterungen (`play`) kompatibel bleiben.

---

## 7. Sicherheit

- Nur HTTPS (Let’s Encrypt); Cookies `Secure`, `HttpOnly`, `SameSite=Strict`; JSON-only-API und Origin-Prüfung gegen CSRF.
- Passwörter gehasht, Ratenbegrenzung auf Login und Kopplung, Passwortlänge erzwingen.
- Gerätetokens: 32 Byte zufällig, in der DB nur als Hash, pro Brille widerrufbar. Die Brille bekommt nur Dateien, die per Transfer an sie vergeben wurden.
- APK-Upload nur für Admin-Rolle; vor dem Senden wird Paketname/Version angezeigt; optional Allowlist erlaubter Paketnamen.
- Upload-Limits (Größe, Typen), Dateinamen nie als Pfad verwenden, Speicherquote auf der Platte überwachen.
- Auditlog: wer hat wann welche Datei an welche Brille gesendet/installiert.
- Datenschutz: keine personenbezogenen Daten von Auszubildenden; Brillen haben nur Gerätenamen. Betrieb mit Schule/Datenschutzbeauftragten abklären (vor Phase 4).

---

## 8. Repository-Struktur

```
LernRaumVR/
├── docs/                 PLAN.md, Entscheidungen (ADR), Phase-0-Ergebnisse
├── server/               Fastify, TypeScript, Migrationen, Tests
├── web/                  Vite-Oberfläche
├── headset/              Android-Projekt (Gradle, Kotlin)
├── shared/               (optional) API-Typen/Schemas, von server und web genutzt
├── .github/workflows/    CI
├── package.json          npm-Workspaces: server, web, shared
└── README.md
```

---

## 9. Phasen

Die Aufwände aus deiner Idee übernehme ich als Schätzung (eine Person, Node-Erfahrung, Android-Einarbeitung). Unsicher ist vor allem Phase 0/2; ich plane dort Puffer ein.

| Phase | Inhalt | Abnahme („fertig, wenn“) | Aufwand |
|---|---|---|---|
| **0 Machbarkeit** | Entwicklermodus, USB-Debugging, Test-App per `adb install`; Datei laden und in `Movies/` ablegen, im Pico-Player öffnen; APK-Installation (A und B) testen; Standby-/Lade-Verhalten; Foreground-Service-Dauertest; Bauen-vs-kaufen-Recherche | Video und APK kommen auf der Brille an, Ergebnisse in `docs/phase0.md`, Entscheidung A oder B | 2–4 Tage |
| **1 Server** | Projektgerüst, Migrationen, Login, tus-Upload, SHA-256/ffprobe, Dateiliste, Löschen; erste Weboberfläche (Login, Upload, Liste) | 2-GB-Datei lässt sich abbrechen und fortsetzen, Hash stimmt | 4–6 Tage |
| **2 Brillen-App** | Gerüst, Kopplung, Service, Aufträge, Download mit Range, Prüfsumme, Ablage + Media-Scan; Web: Geräte, Kopplung, Senden | Datei aus dem Browser liegt auf der gewählten Brille | 6–10 Tage |
| **3 Status & APK** | Fortschritt/Heartbeat/Speicher live (WS), Fehlerbilder, APK-Installation, Selbstupdate der App, Abbrechen/Wiederholen | Weboberfläche zeigt Erfolg oder Fehler nachvollziehbar | 3–5 Tage |
| **4 Betrieb** | HTTPS, Reverse-Proxy-Einstellungen, Backup (DB + Dateien), Monitoring-Mindestmaß, Test im Unterricht | Eine Unterrichtsstunde läuft ohne Eingriff | 2–3 Tage |

Summe: ca. 17–28 Arbeitstage.

**Entscheidungspunkte:**
- Ende Phase 0: stille Installation (A) oder Bestätigung (B); Standby-Strategie; Dateikonventionen für 180°/360°.
- Ende Phase 2: reicht Polling + WS, oder braucht es zusätzliche Mechanismen (z. B. Wake-Locks, Ladezustand)?

---

## 10. Betrieb

- **Plesk-Server:** Node-Anwendung über die Plesk-Node.js-Erweiterung oder als eigener Dienst; der vorgeschaltete nginx muss große Uploads durchlassen (`client_max_body_size`, `proxy_request_buffering off`) und WebSocket weiterreichen (`Upgrade`-Header). Plattenplatz und Upload-Limits des Hostings prüfen.
- **Schulnetz:** Brille muss den Server erreichen; Zertifikat über Domain/DNS-Challenge, weil Android 8.1 eigene CAs nur mühsam akzeptiert. Der Vorteil: schnelle Downloads im LAN. Nachteil: Betrieb und Erreichbarkeit hängen an der Schul-IT.
- **Bandbreite:** Bei einem Klassensatz (30 Brillen × 2 GB) sind es 60 GB. Auf einem externen Server kann das die Leitung sprengen, deshalb später ein lokaler Cache/Server im Schulnetz oder „vor der Stunde senden“.
- **Backup:** nächtlich SQLite (`.backup`) + `files/`; Wiederherstellung einmal real testen.
- **Konfiguration:** Umgebungsvariablen (`DATA_DIR`, `PUBLIC_URL`, `SESSION_SECRET`), keine Secrets im Repo.

---

## 11. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Stille Installation nicht möglich oder SDK nicht beschaffbar | Weg B (Bestätigung in der Brille) ist V1-tauglich; `ApkInstaller`-Interface |
| Dienst wird im Standby beendet / Brille nicht online | Phase-0-Test, Watchdog, Autostart, Akku-Optimierung ausnehmen, Empfehlung „am Ladegerät lassen“ |
| Schad-APKs verteilt | HTTPS, starke Passwörter, APK-Upload nur Admin, Allowlist, Token sperrbar |
| Video läuft nicht | ffprobe beim Upload, Warnung bei Codec/Auflösung außerhalb der Hardware-Grenzen der G2 4K |
| Speicher der Brille voll | Heartbeat meldet freien Platz, Prüfung vor dem Senden, Fehlercode `NO_SPACE` |
| WLAN langsam/abgeschottet | nur ausgehende Verbindungen, Fortsetzen, große Dateien vor der Stunde senden |
| Datenschutz, Urheberrecht | keine Daten von Auszubildenden, nur nutzungsberechtigtes Material, Abstimmung mit der Schule |
| Android-/Gradle-Einstieg dauert länger | Phase 0 früh, Brillen-App bewusst klein, UI nur Status + Code |
| Eine Person als Single Point of Failure | Doku in `docs/`, Backup, Brille bleibt auch ohne Server bedienbar (Dateien bleiben liegen) |

---

## 12. Offene Fragen an dich

1. Wie viele Brillen am Anfang, wie viele in 12 Monaten?
2. Plesk-Server oder Schulnetz?
3. Wer außer dir darf hochladen, wer darf APKs hochladen?
4. Ist die Brille schon im Entwicklermodus, welche genaue Gerätevariante/Firmware?
5. Endgültiger Projektname (`LernRaumVR` oder `Lernblick`) und Domain?
6. Dürfen Teilnehmende/Kolleg:innen sich selbst Inhalte schicken lassen, oder immer nur du?

---

## 13. Späterer Ausbau (Reihenfolge nach Unterrichtsnutzen)

1. FFmpeg-Umwandlung in passende Formate (Warteschlange, Fortschritt in der UI).
2. Brillengruppen und Klassensatz-Versand.
3. Zentrales Starten/Pausieren, 180°/360°-Format vorgeben (`kind=play`).
4. Unterrichtspakete (Video + Bild + App als Set).
5. Rollen, Schul-Login (OIDC).
6. Lokaler Cache/Server im Schulnetz.

---

## 14. Erste Schritte (nächste 1–2 Tage)

- [ ] Gerätevariante, Android-Version und Firmware der Brille notieren
- [ ] Entwicklermodus und USB-Debugging aktivieren, `adb devices` prüfen
- [ ] Test-APK per `adb install` installieren, 2D-Bedienbarkeit prüfen
- [ ] Testvideo manuell nach `Movies/` kopieren und im Pico-Player öffnen
- [ ] Pico-SDK-Herkunft klären (Version, Quelle, Lizenz), stille Installation testen
- [ ] Bauen-vs-kaufen-Recherche (ArborXR, ManageXR, Pico Business Suite)
- [ ] Projektname festlegen, Repo-Gerüst (`server`, `web`, `headset`) anlegen
