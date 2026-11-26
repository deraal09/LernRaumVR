# LernRaumVR – Umsetzungsplan

Stand: 26.11.2026 · Grundlage: erste Idee von Till · Status: Entwurf 3 (Festlegungen und Phase-0-Zwischenstand eingearbeitet)

Ziel: Lehrkräfte laden Videos, Bilder, APKs und andere Dateien im Browser hoch und senden sie an PICO G2 4K. Die Brille holt sich die Aufträge selbst ab, sobald sie online ist. Der Server kann nichts auf die Brille schieben, deshalb fragt eine kleine App auf der Brille nach.

---

## 0. Festlegungen

| Thema | Entscheidung |
|---|---|
| Projektname | **LernRaumVR** („Lernblick“ entfällt) |
| Anzahl Brillen | **33** (Klassensatz) |
| Hosting | **Plesk-Server** |
| Anmeldung | **LDAP** (keine lokalen Passwörter) |
| Wer darf hochladen | Personen mit LDAP-Zugang **und** Freischaltung durch einen Admin auf der Plattform |
| Admins | Benutzernamen in einer **Plesk-Umgebungsvariable** (`ADMIN_USERS`) |
| Brillen-App | soll die **Startapp (Launcher)** der Brille werden; später verwaltet sie die App-Auswahl und sperrt die Einstellungen (Abschnitt 7.5) |

**Phase-0-Zwischenstand (Till):** APK-Installation auf der Brille funktioniert. Welcher Weg genau (still über Pico-SDK oder mit Bestätigung) ist noch in `docs/phase0.md` festzuhalten, er bestimmt Abschnitt 7.3 und 7.5.

Folgen daraus, die den ersten Entwurf ändern:

- **Startapp/Kiosk:** Die App wird zusätzlich als Launcher gebaut, später mit App-Auswahl und gesperrten Einstellungen. Dafür gibt es Richtlinien pro Brille/Gruppe, die der Server verteilt.
- **33 Brillen:** Versand an viele Brillen gleichzeitig ist kein „später“, sondern V1 (Mehrfachauswahl + einfache Gruppen). Dazu kommen eine Download-Begrenzung (Warteschlange) und ein Lasttest, siehe Abschnitt 6.
- **LDAP:** Passwort-Tabelle, Hashing und Passwort-Regeln entfallen. Neu: Freischaltungs-Workflow und Admin-Seite für Benutzer, siehe Abschnitt 5.
- **Plesk:** Node.js läuft dort über Passenger (nach meinem Kenntnisstand; auf deinem Server prüfen). Das hat Folgen für WebSocket, große Uploads, mehrere Prozesse und native Module. Phase 0 enthält deshalb einen Plesk-Test, siehe Abschnitt 12.

---

## 1. Ergänzungen gegenüber der ersten Idee

1. **Server-URL auf der Brille** (keine Tastatur): fest in die App gebaut (`BuildConfig`) oder per Konfigdatei `/sdcard/Download/lernraumvr.json`.
2. **Kopplung braucht ein Geheimnis, nicht nur den Code.** Die Brille bekommt beim Anfordern zusätzlich ein `poll_secret`; nur damit holt sie nach der Bestätigung den Token ab (einmalig). Code läuft nach 10 Minuten ab, Versuche sind ratenbegrenzt.
3. **Android 8.1 (API 27) bestimmt die Brillen-App:** Dauerbetrieb nur als Foreground-Service mit Benachrichtigung plus Autostart. Kein Scoped Storage, Schreiben nach `Movies/`, `Pictures/`, `Download/` geht mit normaler Speicher-Berechtigung; danach Media-Scan anstoßen.
4. **Standby der Brille:** Brillen liegen im Ladewagen. Ob sie dort online bleiben, entscheidet, ob „vor der Stunde senden“ funktioniert. Prüfung in Phase 0.
5. **Bauen vs. kaufen kurz prüfen.** Es gibt fertige Geräteverwaltungen für Pico (z. B. ArborXR, ManageXR, Pico Business Suite). Preise und Funktionsumfang habe ich nicht geprüft. Bei 33 Brillen lohnt sich die Recherche in Phase 0 besonders, Eigenbau punktet bei Kosten, Datenschutz (LDAP-Anbindung) und Anpassung an den Unterricht.
6. **Brillen-App aktualisiert sich selbst** (bei 33 Geräten unverzichtbar), über dieselbe Installationsfunktion wie fremde APKs und mit derselben Signatur-Keystore.
7. **Auftragsfeld `kind`** von Anfang an: `send`, `install`, später `play`; dazu `payload` (JSON).
8. **Erstausstattung von 33 Brillen** per Skript (adb): App installieren, Konfigdatei ablegen, Berechtigungen setzen, Akku-Optimierung ausnehmen. Einmalig, aber ohne Skript sehr mühsam.
9. **Fehlende Schnittstellen** ergänzt (siehe 8.3): Logout, Dateien löschen, Brillen umbenennen/sperren, Transfers abbrechen, Heartbeat.

---

## 2. Umfang Version 1

| Funktion | Version 1 | Später |
|---|---|---|
| Anmeldung | LDAP + Freischaltung durch Admin, Admin per Umgebungsvariable | feinere Rollen, SSO |
| Benutzerverwaltung | Admin-Seite: freischalten, sperren | Gruppen/Fachbereiche |
| Dateien hochladen/verwalten | ja (fortsetzbar, Liste, Löschen) | Ordner, Schlagworte |
| Brillen koppeln, Status sehen | ja, Übersicht für 33 Geräte | |
| Senden | an einzelne, **mehrere und Gruppen** gleichzeitig | Zeitpläne |
| Warteschlange/Download-Begrenzung | ja | lokaler Cache im Schulnetz |
| APK installieren | Installation klappt (Phase 0); still oder mit Bestätigung je nach Weg | |
| Brillen-App als Startapp | ja, sofern die Brille es zulässt (Phase 0): Start nach Boot und Home-Taste, einfache App-Liste | |
| App-Auswahl verwalten, Einstellungen sperren | nein | ja (Phase 5): Richtlinien pro Brille/Gruppe |
| Videos umwandeln | nein, nur Prüfung + Warnung | FFmpeg-Warteschlange |
| Wiedergabe fernsteuern | nein | ja |

Nicht Teil von V1: Zeitpläne, Transcoding, Fernsteuerung, Unterrichtspakete, Ordner/Schlagworte.

---

## 3. Architektur

```
 Browser (Lehrkraft)                                PICO G2 4K ×33 (Android 8.1)
 Vite-Weboberfläche                                 Kotlin-App, Foreground-Service
      │ HTTPS: Login, Upload (tus), Dateien,             │ HTTPS (nur ausgehend): Kopplung,
      │ Transfers, Benutzerverwaltung                    │ Aufträge, Download (Range),
      │ WS: Live-Status ◄───────────┐        ┌─────────► │ Fortschritt, Heartbeat
      ▼                             │        │           ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Plesk: Node.js LTS · TypeScript · Fastify (1 Prozess)       │
 │  Auth(LDAP) · tus-Upload · Dateien · Geräte · Transfers · WS│
 │  SQLite (Metadaten)    Dateisystem (uploads/, files/)       │
 └──────────────┬──────────────────────────────────────────────┘
                │ LDAPS (ausgehend)
                ▼
          LDAP-Server (Schule)
```

**Verbindungsstrategie der Brille:** WebSocket als Wecksignal („neuer Auftrag“), zusätzlich Polling alle 60 s als Rückfall. Aufträge werden immer über `GET /api/device/transfers` geholt; so gibt es nur eine Logik und sie bleibt robust, wenn der WS-Kanal abreißt.

---

## 4. Technologieentscheidungen

| Teil | Wahl | Anmerkung |
|---|---|---|
| Server | Node.js LTS, TypeScript, Fastify | Zod/TypeBox zur Validierung |
| LDAP | `ldapts` (TypeScript-Client) | Suche per Service-Konto, danach Bind mit dem Passwort der Person; nur LDAPS/StartTLS mit Zertifikatsprüfung |
| Upload | tus (`@tus/server`, `FileStore`) | feste Chunk-Größe (z. B. 8–32 MB), nach Abschluss SHA-256, ffprobe, Verschieben in `files/` |
| Download | eigener Fastify-Handler mit `Range` | `206`, `ETag` = SHA-256, Auth per Gerätetoken, Slot-Vergabe (Abschnitt 6) |
| Datenbank | SQLite, `better-sqlite3`, SQL-Migrationen | WAL; **ein** Serverprozess. Falls Kompilieren auf Plesk scheitert: `node:sqlite` oder vorkompilierte Binaries |
| Sessions | Server-Sessions in SQLite, Cookie `HttpOnly; Secure; SameSite=Strict` | |
| Web | Vite + TypeScript, Preact oder Vanilla | `tus-js-client` |
| Brillen-App | Kotlin, minSdk 26, OkHttp (HTTP + WS), Coroutines | `SharedPreferences` für Token |
| Medienprüfung | `ffprobe` (statische Binärdatei, falls Plesk keins bietet) | Codec, Auflösung, Dauer, Bitrate → Warnungen |
| APK-Prüfung | Paketname/Version auslesen | Anzeige vor dem Senden |
| Tests | Vitest (Server, LDAP gegen Test-Container), Playwright (Web-Smoke) | |
| CI | GitHub Actions: Lint, Typecheck, Tests, APK-Build (signiert über Secret) | |

---

## 5. Anmeldung und Freischaltung (LDAP)

### 5.1 Ablauf
1. Person gibt Benutzername + Passwort im Browser ein (`POST /api/login`).
2. Server sucht den Eintrag mit dem **Service-Konto** (nur Leserechte) per Filter, prüft ggf. Gruppenzugehörigkeit, bindet dann mit dem Passwort der Person. Das Passwort wird nie gespeichert oder geloggt.
3. Erfolg → Benutzerzeile anhand `ldap_uid` (kleingeschrieben) suchen oder anlegen:
   - `uid` steht in `ADMIN_USERS` → Rolle `admin`, Status `approved` (wird bei **jedem** Login aus der Variable neu bestimmt; Entfernen aus der Variable nimmt die Rechte wieder).
   - sonst neu → Status `pending`, Hinweis „Freischaltung durch Admin ausstehend“, kein Zugriff auf Upload, Dateien, Brillen.
   - Status `approved` → Rolle `user`, voller Zugriff (außer Admin-Funktionen).
   - Status `blocked` → Login abgelehnt.
4. Session-Cookie wird gesetzt. Die Brillen sind nicht betroffen, sie nutzen eigene Tokens, auch wenn LDAP ausfällt.

### 5.2 Rechte (Vorschlag)
| Aktion | `pending` | `user` (freigeschaltet) | `admin` |
|---|---|---|---|
| Dateien ansehen, hochladen, eigene löschen | nein | ja | ja |
| Fremde Dateien löschen | nein | nein | ja |
| An Brillen senden | nein | ja | ja |
| APK hochladen/installieren | nein | **nein** (Vorschlag) | ja |
| Brillen koppeln/sperren/Gruppen verwalten | nein | nein | ja |
| Benutzer freischalten/sperren | nein | nein | ja |

Das ist ein Vorschlag, bitte bestätigen (Abschnitt 14): gemeinsame Bibliothek für alle Freigeschalteten, APKs nur durch Admins.

### 5.3 Konfiguration (Plesk-Umgebungsvariablen)
`ADMIN_USERS` (kommagetrennt), `LDAP_URL` (`ldaps://…`), `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_BASE_DN`, `LDAP_USER_FILTER` (z. B. `(&(objectClass=person)(sAMAccountName={{username}})(memberOf=CN=Lehrkraefte,…))`), `LDAP_CA_FILE` (falls eigene CA), dazu `SESSION_SECRET`, `PUBLIC_URL`, `DATA_DIR`.

### 5.4 Besonderheiten
- **Filter einschränken:** Falls Auszubildende LDAP-Konten haben, soll der Filter nur Lehrkräfte durchlassen, sonst füllt sich die Freischaltungsliste und Lernende könnten sich einen Antrag stellen.
- **LDAP-Injection:** Benutzername strikt escapen, nur zulässige Zeichen.
- **Aussperren durch Fremde:** Wiederholte Fehlversuche können LDAP-Konten sperren. Deshalb Ratenbegrenzung pro Benutzername und IP **vor** dem LDAP-Aufruf.
- **Ausfall:** Fällt LDAP aus, laufen bestehende Sessions und alle Brillen weiter. Kein lokales Notfall-Konto in V1 (Entscheidung offen).
- **Datenschutz:** Gespeichert werden nur `ldap_uid`, Anzeigename, Status, Zeiten. Keine E-Mail-Adressen, keine Passwörter. Ins Verfahrensverzeichnis der Schule aufnehmen.

---

## 6. Versand an 33 Brillen

Ein 2-GB-Video an 33 Brillen sind **66 GB**. Der Engpass ist meist das schulische WLAN (geteilte Access Points) oder die Upload-Rate/das Traffic-Kontingent des Plesk-Servers, nicht die Rechenleistung.

Maßnahmen in V1:

- **Mehrfachversand:** `POST /api/transfers` akzeptiert `device_ids[]` oder `group_id`; es entsteht ein `batch_id`, die UI zeigt „18 von 33 fertig“.
- **Gruppen:** einfache Gruppen (Name + Mitglieder), z. B. „Klassensatz“, „Reihe A“. Brillen heißen standardmäßig „Brille 01 … 33“.
- **Download-Slots:** Server begrenzt gleichzeitig aktive Downloads (`MAX_PARALLEL_DOWNLOADS`, Startwert 8, später aus dem Lasttest ableiten). `GET /api/device/transfers` liefert nur Aufträge, die starten dürfen; die übrigen stehen in der UI als „in Warteschlange (Platz n)“. Slot wird bei Abschluss, Fehler oder Zeitüberschreitung frei.
- **Fortsetzen** überall, damit ein WLAN-Abbruch nicht von vorn beginnt.
- **Empfehlung im Betrieb:** große Dateien vor der Stunde senden, Brillen am Ladegerät.
- **Lasttest in Phase 4:** alle 33 Brillen gleichzeitig mit einer realen Datei; Messwerte (Dauer, Fehlerrate, Serverlast) in `docs/lasttest.md`.
- **Falls zu langsam:** lokaler Cache/Server im Schulnetz (z. B. kleiner Mini-PC), siehe „Später“; die Brillen-App fragt dann zuerst die lokale Adresse und fällt auf den Plesk-Server zurück. Das ist im Protokoll von Anfang an vorgesehen (Download-URL kommt im Auftrag, nicht fest in der App).

---

## 7. Brillen-App

### 7.1 Bestandteile
- **MainActivity** (2D-Fenster): Kopplungscode, Verbindungsstatus, letzte Aufträge, freier Speicher. Keine Texteingabe.
- **SyncService** (Foreground-Service mit Benachrichtigung): WS, Polling, Aufträge nacheinander.
- **BootReceiver** (Autostart) und **WorkManager-Watchdog** (alle 15 min).
- **Downloader:** Zieldatei `getExternalFilesDir()/part/<transfer>.part`, `Range`-Fortsetzung, Retry mit Backoff, SHA-256 prüfen, dann nach `Movies/`/`Pictures/`/`Download/` verschieben, `MediaScannerConnection.scanFile`.
- **ApkInstaller** (Interface, siehe 7.3).

### 7.2 Ablauf eines Transfers (Brillensicht)
1. Auftrag abholen → `downloading`, `bytes_done` etwa alle 2 s bzw. 5 %.
2. Freien Speicher prüfen, sonst `failed` (`NO_SPACE`).
3. Download mit Fortsetzung; nach App-Neustart wird `.part` weiterverwendet.
4. SHA-256 vergleichen → `verified`; Abweichung → Datei löschen, `failed` (`HASH_MISMATCH`).
5. `send`: verschieben + Media-Scan → `done`. `install`: siehe 7.3.

### 7.3 APK-Installation (größtes Risiko)
- **A – still** über das Pico-Enterprise-SDK (laut deiner Recherche für die G2 4K vorgesehen, Herkunft/Version unklar, nicht von mir geprüft).
- **B – Standard-Android** als Rückfall: `REQUEST_INSTALL_PACKAGES`, „Unbekannte Quellen“ einmalig erlauben, Installer-Intent per `FileProvider`; Nutzer bestätigt in der Brille (`awaiting_confirmation` → `installed`).

Bei 33 Brillen ist Weg B mühsam (33× bestätigen), A ist deshalb deutlich wertvoller. Stand: Installation funktioniert, der Weg ist noch zu dokumentieren. Beide Wege hinter einem `ApkInstaller`-Interface; Erfolg wird per `PackageManager` verifiziert.

### 7.4 Offene Praxisfragen für Phase 0
- Findet der Pico-Videoplayer Dateien in `Movies/` automatisch? Gibt es Namenskonventionen für 180°/360°/3D? (nicht geprüft)
- Bleibt der Service im Standby/beim Laden am Leben? Gibt es Akku-Optimierung/Autostart-Whitelist?
- Ist die App als 2D-App in der Pico-Oberfläche bedienbar?
- Startapp/Sperren: siehe 7.5.

### 7.5 Startapp, App-Auswahl, gesperrte Einstellungen

Ja, das ist machbar zu planen, die Umsetzung hängt aber davon ab, was die G2 4K zulässt. Ich habe das nicht an der Brille geprüft. Die Brille nutzt eine eigene Pico-Oberfläche; ob sie eine fremde Home-App als Standard akzeptiert, entscheidet Phase 0.

**Stufen (jede baut auf der vorigen auf, jede ist einzeln nutzbar):**

1. **Startapp:** App meldet sich im Manifest als Launcher an (`intent-filter` mit `MAIN`, `HOME`, `DEFAULT`) und startet nach dem Boot (`BootReceiver`). Zu testen: Fragt Android beim Home-Druck nach der Standard-App? Lässt sich die Standard-App per adb oder Pico-SDK festlegen? Landet auch die Pico-Home-Taste in unserer App?
2. **App-Liste (Launcher-UI):** große Kacheln für erlaubte Apps (und Medien), bedienbar per Blick/Controller ohne Tastatur. Die Liste kommt vom Server (Richtlinie), die App startet sie per `PackageManager.getLaunchIntentForPackage`.
3. **Richtlinien vom Server:** pro Brille oder Gruppe: sichtbare Apps (Paketnamen, Reihenfolge, Beschriftung), Kiosk an/aus, Einstellungen gesperrt ja/nein. Die Brille holt sie wie Aufträge (`GET /api/device/policy`, Versionsnummer, Wecksignal über WS) und wendet sie lokal an.
4. **Einstellungen sperren:** hier gibt es drei mögliche Wege, die Phase 0 klärt:
   - **Pico-Enterprise-SDK** (falls Funktionen wie Kiosk, Einstellungen/Systemleiste sperren, App-Whitelist für die G2 4K verfügbar sind; unklar, nicht von mir geprüft)
   - **Android Device Owner** + Lock-Task-Modus (`setLockTaskPackages`, `startLockTask`): verlässlich, wenn die Brille sich als Device Owner einrichten lässt (`dpm set-device-owner`, geht meist nur auf frischen/zurückgesetzten Geräten)
   - **Nur App-Ebene** (Rückfall): unsere Startapp zeigt nur erlaubte Apps, die Systemeinstellungen sind aber über die Pico-Oberfläche weiter erreichbar. Das ist **keine echte Sperre**.

**Wichtige Schutzmaßnahmen, damit 33 Brillen nicht unbrauchbar werden:**
- Erst an **einer** Brille testen, dann eine Gruppe, dann alle.
- Notausstieg: ein Admin-Entsperrcode (geräteeigene PIN, vom Server pro Brille vergeben, für Admins in der Plattform einsehbar) und USB-Debugging bleibt für Admins erreichbar; Richtlinie lässt sich per Server wieder auf „nicht gesperrt“ setzen.
- Die LernRaumVR-App selbst ist immer in der Whitelist und nicht deinstallierbar; Updates der App sind auch im Kiosk-Modus möglich.
- Richtlinien tragen eine Versionsnummer; schlägt das Anwenden fehl, meldet die Brille den Fehler (Heartbeat) und bleibt beim letzten funktionierenden Stand.
- Kein Aussperren aus dem Netzwerk: WLAN-Einstellungen müssen auch bei gesperrten Einstellungen änderbar bleiben (z. B. eigene WLAN-Seite in der App oder per Richtlinie vom Server), sonst ist die Brille bei Netzwechsel nicht mehr erreichbar.

---

## 8. Datenmodell und Schnittstellen

### 8.1 Tabellen
| Tabelle | Felder (Auswahl) |
|---|---|
| `users` | id, ldap_uid (unique, klein), display_name, role (`user`/`admin`), status (`pending`/`approved`/`blocked`), created_at, last_login_at |
| `sessions` | id, user_id, expires_at, created_at |
| `files` | id, name, original_name, typ (`video`/`image`/`apk`/`other`), mime, groesse, sha256, pfad, meta (JSON), warnungen (JSON), uploaded_by, created_at |
| `devices` | id, name, token_hash, last_seen_at, freier_speicher, app_version, android_version, revoked_at, created_at |
| `device_groups`, `device_group_members` | Gruppen und Zuordnung |
| `policies` | id, name, kiosk (bool), einstellungen_gesperrt (bool), apps (JSON: Paketname, Titel, Reihenfolge), version, updated_at |
| `device_policy` | device_id oder group_id → policy_id (Brille erbt Gruppen-Richtlinie, einzelne Brille kann überschreiben) |
| `pairings` | id, code, poll_secret_hash, device_info, expires_at, device_id, token_ausgegeben |
| `transfers` | id, batch_id, **kind**, file_id, device_id, created_by, status, bytes_done, released_at (Slot), fehler_code, fehler_text, payload (JSON), created_at, updated_at, finished_at |
| `audit_log` | id, user_id, aktion, ziel, zeit |

Dateien liegen als `files/<id>` auf der Platte, der Anzeigename steht nur in der DB.

### 8.2 Transfer-Zustände
`pending` (wartend; ohne `released_at` = in Warteschlange) → `downloading` (lädt) → `verified` (geprüft) → `done` (fertig) bzw. bei `install` → `awaiting_confirmation` → `installed`. Jederzeit: `failed` (mit Fehlercode, wiederholbar) und `cancelled`. Der Server prüft, dass nur zulässige Übergänge gemeldet werden.

### 8.3 API
Browser (Session-Cookie, jeweils nur für `approved`, wo nicht anders vermerkt):

| Aufruf | Zweck |
|---|---|
| `POST /api/login`, `POST /api/logout`, `GET /api/me` | LDAP-Anmeldung; `/me` liefert Status (`pending` sichtbar) |
| `* /api/uploads/…` | tus-Upload |
| `GET /api/files`, `DELETE /api/files/:id` | auflisten, löschen |
| `GET /api/devices`, `PATCH`/`DELETE /api/devices/:id` | Status, umbenennen, sperren (Admin) |
| `POST /api/devices/confirm` | Kopplungscode bestätigen (Admin) |
| `GET/POST/PATCH /api/groups…` | Gruppen (Admin) |
| `POST /api/transfers` | senden an `device_ids[]` oder `group_id` |
| `GET /api/transfers`, `POST /api/transfers/:id/cancel`, `POST /api/batches/:id/cancel` | Verlauf, abbrechen |
| `GET /api/admin/users`, `PATCH /api/admin/users/:id` | freischalten/sperren (Admin) |
| `GET/POST/PUT /api/policies…`, `PUT /api/devices/:id/policy`, `PUT /api/groups/:id/policy` | Richtlinien anlegen und zuweisen (Admin, ab Phase 5) |

Brille (`Authorization: Bearer <Token>`):

| Aufruf | Zweck |
|---|---|
| `POST /api/pairing`, `GET /api/pairing/:id` | Code + Geheimnis anfordern; Token einmalig abholen |
| `GET /api/device/transfers` | startberechtigte Aufträge (Slots) |
| `GET /api/device/files/:id` | Download, `Range`, `ETag` |
| `PATCH /api/device/transfers/:id` | Status, `bytes_done`, Fehler |
| `POST /api/device/heartbeat` | Speicher, App-Version, Akku, installierte Apps, angewendete Richtlinien-Version |
| `GET /api/device/policy` | gültige Richtlinie (App-Liste, Kiosk, Sperren), ab Phase 5 |

`WS /ws`: Browser erhält Änderungen live, Brille erhält „neuer Auftrag“. Nachrichten mit `type` und `version`.

---

## 9. Sicherheit

- Nur HTTPS; Cookies `Secure`, `HttpOnly`, `SameSite=Strict`; JSON-only-API und Origin-Prüfung gegen CSRF.
- LDAP nur über LDAPS/StartTLS mit Zertifikatsprüfung; Service-Konto mit minimalen Leserechten; Zugangsdaten nur in Plesk-Variablen.
- Gerätetokens: 32 Byte zufällig, in der DB nur als Hash, pro Brille widerrufbar. Brillen erhalten nur Dateien aus ihren Transfers.
- APK-Upload nur Admin; vor dem Senden Paketname/Version anzeigen; optional Allowlist von Paketnamen.
- Upload-Limits (Größe, Typen), Dateinamen nie als Pfad, Plattenplatz überwachen.
- Auditlog: wer hat wann was an welche Brillen gesendet/installiert, Freischaltungen und Sperren.
- Datenschutz: keine Daten von Auszubildenden; Brillen haben nur Gerätenamen; Verfahrensverzeichnis/Datenschutzbeauftragte vor Phase 4 einbinden.

---

## 10. Repository-Struktur

```
LernRaumVR/
├── docs/                 PLAN.md, phase0.md, lasttest.md, Entscheidungen (ADR)
├── server/               Fastify, TypeScript, Migrationen, Tests
├── web/                  Vite-Oberfläche
├── headset/              Android-Projekt (Gradle, Kotlin)
├── tools/                Rollout-Skript für 33 Brillen (adb)
├── shared/               (optional) API-Typen/Schemas
├── .github/workflows/    CI
├── package.json          npm-Workspaces: server, web, shared
└── README.md
```

---

## 11. Phasen

Aufwände sind Schätzungen für eine Person mit Node-Erfahrung und etwas Android-Einarbeitung. Gegenüber Entwurf 1 sind LDAP/Freischaltung, Gruppen/Warteschlange, Plesk-Test, Rollout und Lasttest dazugekommen.

| Phase | Inhalt | Fertig, wenn | Aufwand |
|---|---|---|---|
| **0 Machbarkeit** | **Brille:** Entwicklermodus, Test-App, Datei nach `Movies/`, Pico-Player, APK-Installation (A/B, **läuft bereits**, Weg dokumentieren), Standby, Dauertest Service, **Startapp-Test (HOME-Filter, Standard-App, Home-Taste), Möglichkeiten zum Sperren der Einstellungen (Pico-SDK, Device Owner)**, Bauen-vs-kaufen. **Plesk:** Hello-World mit WS, 2-GB-Upload (tus), Range-Download, `better-sqlite3`, ffprobe, Passenger-Verhalten, LDAPS-Verbindung zum Schul-LDAP | Video und APK kommen an; Plesk-Test bestanden oder Alternative benannt; `docs/phase0.md` | 3–5 Tage |
| **1 Server** | Gerüst, Migrationen, **LDAP-Login, Freischaltung, Admin-Variable**, tus-Upload, SHA-256/ffprobe, Dateiliste, Löschen; Web: Login, Antrag-ausstehend-Seite, Upload, Liste, Benutzerverwaltung | 2-GB-Datei lässt sich unterbrechen und fortsetzen; neue LDAP-Person bleibt gesperrt bis zur Freischaltung | 5–8 Tage |
| **2 Brillen-App** | Gerüst, **Launcher-Filter + einfache App-Liste (falls Phase 0 grünes Licht gibt)**, Kopplung, Service, Aufträge, Download mit Range, Prüfsumme, Ablage + Media-Scan; Web: Geräte, Kopplung, Einzelversand | Datei aus dem Browser liegt auf der gewählten Brille | 6–10 Tage |
| **3 Status, Gruppen, APK** | Fortschritt/Heartbeat/Speicher live, Fehlerbilder, **Gruppen, Mehrfachversand, Download-Slots/Warteschlange**, APK-Installation, Selbstupdate, Abbrechen/Wiederholen | Weboberfläche zeigt Erfolg/Fehler; Versand an Gruppe aus 5 Brillen klappt mit Warteschlange | 5–8 Tage |
| **4 Betrieb** | Rollout-Skript, HTTPS, Backup, **Lasttest mit 33 Brillen**, Test im Unterricht | Eine Unterrichtsstunde mit allen Brillen läuft ohne Eingriff | 3–5 Tage |
| **5 Launcher & Richtlinien** | `policies`-Tabelle und Admin-Seite, `GET /api/device/policy`, Kiosk-Launcher mit App-Auswahl vom Server, Einstellungen sperren (je nach Phase-0-Weg), Notausstieg/Entsperrcode, Stufentest 1 → Gruppe → 33 Brillen | Eine Gruppe zeigt nur freigegebene Apps, Einstellungen sind gesperrt, Rückbau per Server klappt | 5–8 Tage |

Summe: ca. 22–36 Arbeitstage für V1 (Phasen 0–4), dazu 5–8 Tage für Phase 5.

**Entscheidungspunkte:**
- Ende Phase 0: Plesk tauglich (WS, Upload, Prozessmodell)? Stille Installation (A) oder Bestätigung (B)? Eigenbau oder Fertigprodukt? Dateikonventionen 180°/360°.
- Ende Phase 2: reichen Polling + WS, oder sind Wake-Locks/Lade-Logik nötig?
- Ende Phase 4: reicht der externe Server für 33 Brillen, oder lokaler Cache nötig?

---

## 12. Betrieb auf Plesk

Zu prüfen in Phase 0, Annahmen von mir, nicht auf deinem Server getestet:

- **Node.js-Erweiterung:** Node-LTS-Version verfügbar? Startdatei, „Custom environment variables“ für `ADMIN_USERS` und LDAP-Zugang.
- **Prozessmodell:** Passenger kann Instanzen starten, mehrere parallel betreiben und bei Leerlauf beenden. Wir brauchen **genau einen** dauerhaften Prozess (SQLite, WS-Zustand, Slot-Vergabe). Einstellung für maximal eine Instanz und Verhalten bei Leerlauf prüfen; sonst Betrieb als eigener Dienst/Docker.
- **WebSocket** durch den vorgeschalteten nginx/Passenger; falls nicht möglich, reicht notfalls Polling (30 s) als Plan B.
- **Große Uploads/Downloads:** `client_max_body_size`, Proxy-Puffer, Timeouts (über „Zusätzliche nginx-Anweisungen“); tus mit festen Chunk-Größen entschärft Puffer-Probleme. Downloads mit Range prüfen.
- **Native Module:** lässt sich `better-sqlite3` auf dem Server bauen (Compiler/Python vorhanden)? Sonst Build in CI und fertiges Paket deployen oder `node:sqlite`.
- **ffprobe:** vorhanden? Sonst statische Binärdatei in `DATA_DIR/bin`.
- **Kontingente:** Plattenplatz (Dateien + `uploads/`-Zwischenspeicher), Traffic-Limit pro Monat (66 GB pro Klassensatz-Versand!), CPU/RAM-Limits.
- **LDAP-Erreichbarkeit:** Liegt der Plesk-Server außerhalb des Schulnetzes, muss der LDAPS-Port von dort erreichbar sein (Firewall-Freigabe oder VPN). Das ist die wichtigste Abhängigkeit für die Anmeldung, siehe Abschnitt 14.
- **Deployment:** CI baut `server` und `web`, Auslieferung per Plesk-Git oder SSH/rsync; Rollback = vorheriges Artefakt. Konfiguration nur über Variablen, keine Secrets im Repo.
- **Backup:** nächtlich SQLite (`.backup`) + `files/`, Wiederherstellung einmal real testen (Plesk-Backup kann mitgenutzt werden).

---

## 13. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Plesk-Node/Passenger passt nicht (WS, ein Prozess, Uploads) | Phase-0-Test; Plan B: Polling, Docker/Dienst auf eigener VM |
| LDAP vom Plesk-Server aus nicht erreichbar | früh klären; VPN/Firewall-Regel; Notlösung Proxy im Schulnetz |
| Stille Installation nicht möglich | Weg B als Rückfall; bei 33 Brillen aufwendig, daher früh klären |
| Serverleitung/WLAN bei 33 Brillen zu langsam | Download-Slots, vorab senden, Lasttest, später lokaler Cache |
| Traffic-Kontingent des Hostings überschritten | Kontingent prüfen, Dateien klein halten, Cache-Option |
| Service wird im Standby beendet / Brille offline | Phase-0-Test, Watchdog, Autostart, Akku-Optimierung ausnehmen, am Ladegerät lassen |
| Fremde Home-App/Kiosk wird von der Pico-Oberfläche nicht akzeptiert oder lässt sich umgehen | Phase-0-Test; Rückfall: Launcher nur auf App-Ebene, Sperren per Pico-SDK/Device Owner oder gar nicht |
| Gesperrte Einstellungen machen Brillen unbrauchbar (z. B. kein WLAN-Wechsel) | Stufentest, Entsperrcode, Rückbau per Server, WLAN-Zugang bleibt erlaubt, USB-Debugging für Admins |
| Schad-APKs | HTTPS, LDAP + Freischaltung, APK nur Admin, Allowlist, Token sperrbar |
| LDAP-Konten werden durch Fehlversuche gesperrt | Ratenbegrenzung vor LDAP, nur Lehrkräfte-Filter |
| Video läuft nicht | ffprobe beim Upload, Warnung bei ungeeignetem Codec/Auflösung |
| Speicher der Brille voll | Heartbeat, Prüfung vor dem Senden, `NO_SPACE` |
| Datenschutz, Urheberrecht | nur Lehrkräfte-Daten (uid/Name), nur nutzungsberechtigtes Material, Abstimmung mit der Schule |
| Eine Person als Single Point of Failure | Doku in `docs/`, Backup, Admin-Liste über Variable ergänzbar |

---

## 14. Offene Fragen

1. **LDAP:** Welcher Server (Active Directory, OpenLDAP, anderes), welche Attribute (`sAMAccountName`/`uid`), gibt es eine Gruppe für Lehrkräfte? Ist der Server von Plesk aus per LDAPS erreichbar, und gibt es ein Service-Konto?
2. **Plesk:** Shared Hosting oder VPS/eigener Server? Schulserver oder externer Anbieter (wegen Traffic-Kontingent und LDAP-Erreichbarkeit)? Welche Node-Version bietet Plesk?
3. **Rechte:** Gemeinsame Dateibibliothek für alle Freigeschalteten? APKs nur durch Admins? Dürfen alle Freigeschalteten an alle Brillen senden?
4. **Notfall-Zugang:** Soll es ein lokales Notfall-Admin-Konto geben, falls LDAP ausfällt (Vorschlag: nein in V1)?
5. **Domain und Paketname** (z. B. `de.<domain>.lernraumvr`), da der Android-Paketname später nicht mehr geändert werden sollte.
6. **Brille:** genaue Gerätevariante/Firmware, Entwicklermodus schon aktiv?
7. **WLAN:** Wie viele Access Points im Raum, welche Bandbreite zum Internet?
8. **Startapp/Sperren:** Welchen Weg hat die APK-Installation genommen (still über Pico-SDK oder mit Bestätigung)? Welche Funktionen bietet das SDK für Kiosk/Einstellungen sperren, und ist die Brille bereits in einem Unternehmens-/Business-Modus?

---

## 15. Späterer Ausbau

1. Lokaler Cache/Server im Schulnetz (Priorität nach Lasttest).
2. FFmpeg-Umwandlung (Warteschlange, Fortschritt in der UI).
3. Zentrales Starten/Pausieren, 180°/360° vorgeben (`kind=play`).
4. Zeitpläne („Datei um 7:00 senden“).
5. Unterrichtspakete (Video + Bild + App als Set).
6. Feinere Rollen, SSO/OIDC statt Formular-Login.

---

## 16. Erste Schritte

- [ ] LDAP-Eckdaten klären (Fragen 1 und 2) und Erreichbarkeit vom Plesk-Server testen (`openssl s_client`/`ldapsearch`)
- [ ] Plesk: Node.js-Version, Prozessmodell, WS, nginx-Anweisungen, Traffic- und Plattenkontingent prüfen
- [ ] Gerätevariante, Android-Version, Firmware der Brille notieren; Entwicklermodus + USB-Debugging aktivieren
- [ ] Test-APK per `adb install`, 2D-Bedienbarkeit prüfen; Testvideo nach `Movies/` kopieren, im Pico-Player öffnen
- [ ] Pico-SDK-Herkunft klären (Version, Quelle, Lizenz), stille Installation testen
- [ ] Bauen-vs-kaufen-Recherche (ArborXR, ManageXR, Pico Business Suite)
- [ ] Repo-Gerüst (`server`, `web`, `headset`) anlegen
