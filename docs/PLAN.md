# LernRaumVR – Umsetzungsplan

Stand: 26.11.2026 · Grundlage: erste Idee von Till · Status: Entwurf 6 (Dateigrößen 0,5–5 GB, Repo-Gerüst angelegt)

Ziel: Lehrkräfte laden Videos, Bilder, APKs und andere Dateien im Browser hoch und senden sie an PICO G2 4K. Die Brille holt sich die Aufträge selbst ab, sobald sie online ist. Der Server kann nichts auf die Brille schieben, deshalb fragt eine kleine App auf der Brille nach.

---

## 0. Festlegungen

| Thema | Entscheidung |
|---|---|
| Projektname | **LernRaumVR** („Lernblick“ entfällt) |
| Anzahl Brillen | **33** (Klassensatz) |
| Hosting | **Plesk-Server**, Subdomain **`lernraumvr.bbz-rd-eck.com`** |
| Anmeldung | **LDAP, umgesetzt wie in `noten_webapp`** (Active Directory, `ldapts`, Ratenbegrenzung); Pflichtgruppe **`AAD-LUL`** (`LDAP_REQUIRED_GROUP`) |
| Datenbank | SQLite via `better-sqlite3-multiple-ciphers` (wie `noten_webapp`), `DB_ENCRYPTION_KEY` Pflicht | WAL; **ein** Serverprozess; Verschlüsselungs-/Migrationslogik aus `noten_webapp/src/db.js` übernehmen. Schlüssel getrennt vom Backup sichern. Die Dateien selbst werden nicht verschlüsselt |
| Inhalte | **500 MB bis 5 GB je Datei**, Bestand wächst; Upload, Speicher und Verteilung sind darauf ausgelegt (Abschnitt 6.1) |
| Wer darf hochladen | Personen mit LDAP-Zugang **und** Freischaltung durch einen Admin auf der Plattform |
| Admins | Benutzernamen in einer **Plesk-Umgebungsvariable** (`ADMIN_USERS`) |
| Brillen-App | soll die **Startapp (Launcher)** der Brille werden; später verwaltet sie die App-Auswahl und sperrt die Einstellungen (Abschnitt 7.5) |

**Phase-0-Stand (Till):** APK-Installation läuft **über das Pico-SDK** (still, ohne Rückfrage in der Brille). Damit ist Weg A bestätigt. Version, Bezugsquelle und Lizenz des SDK gehören noch in `docs/phase0.md` (das SDK selbst nicht in ein öffentliches Repo einchecken, ohne die Lizenz zu prüfen).

Folgen daraus, die den ersten Entwurf ändern:

- **Startapp/Kiosk:** Die App wird zusätzlich als Launcher gebaut, später mit App-Auswahl und gesperrten Einstellungen. Dafür gibt es Richtlinien pro Brille/Gruppe, die der Server verteilt.
- **33 Brillen:** Versand an viele Brillen gleichzeitig ist kein „später“, sondern V1 (Mehrfachauswahl + einfache Gruppen). Dazu kommen eine Download-Begrenzung (Warteschlange) und ein Lasttest, siehe Abschnitt 6.
- **LDAP:** Passwort-Tabelle, Hashing und Passwort-Regeln entfallen. Der LDAP-Teil wird aus `noten_webapp` übernommen (Abschnitt 5); neu ist nur der Freischaltungs-Workflow für Uploads.
- **Plesk:** `noten_webapp` läuft bereits auf deinem Plesk als Node.js-App (Passenger, Git-Deploy, Umgebungsvariablen in der Plesk-UI, ein Prozess). Dieser Weg wird übernommen (Abschnitt 12). Offen bleiben nur WebSocket und sehr große Uploads/Downloads.

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
| Dateien hochladen/verwalten | ja, **auch sehr große** (fortsetzbar, Speicherübersicht, Löschen) | Ordner, Schlagworte |
| Brillen koppeln, Status sehen | ja, Übersicht für 33 Geräte | |
| Senden | an einzelne, **mehrere und Gruppen** gleichzeitig | Zeitpläne |
| Warteschlange/Download-Begrenzung | ja | lokaler Cache im Schulnetz |
| APK installieren | still über das Pico-SDK (in Phase 0 bestätigt), nur Admin, Paketname-Allowlist | |
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
| Server | Node.js LTS (Plesk-Node 22 wie bei `noten_webapp`), Fastify, TypeScript | gleiche Fastify-Hauptversion wie `noten_webapp` (v4), damit Plugins und Code 1:1 übernommen werden können; Zod/TypeBox zur Validierung. `noten_webapp` ist reines JavaScript, hier TypeScript wegen der größeren API |
| LDAP | `ldapts` (wie `noten_webapp`) | `src/auth/ldap.js` portieren: Service-Modus und Direkt-Bind-Modus, RFC-4515-Escaping, Pflichtgruppe auch verschachtelt (AD-Regel `1.2.840.113556.1.4.1941`), Verzeichnissuche für Admins |
| Upload | tus (`@tus/server`, `FileStore`) | Chunks 32–64 MB, Vorab-Prüfung von Größe/Platz/Kontingent, Nachverarbeitung (SHA-256, ffprobe) als Hintergrundjob im Worker-Thread, Abschluss per `rename` (gleiches Dateisystem); Details in 6.1 |
| Download | eigener Fastify-Handler mit `Range` | `206`, `ETag` = SHA-256, Auth per Gerätetoken, Slot-Vergabe (6.2), Blockhash-Manifest für große Dateien |
| Datenbank | SQLite, `better-sqlite3`, SQL-Migrationen | WAL; **ein** Serverprozess. `noten_webapp` nutzt `better-sqlite3-multiple-ciphers` mit `DB_ENCRYPTION_KEY`; hier optional (keine Notendaten), Entscheidung offen |
| Sessions | `@fastify/session` mit SQLite-Store (wie `noten_webapp`), Cookie `HttpOnly; Secure; SameSite=Strict` | |
| Web | Vite + TypeScript, Preact oder Vanilla | `tus-js-client` |
| Brillen-App | Kotlin, minSdk 26, OkHttp (HTTP + WS), Coroutines | `SharedPreferences` für Token |
| Medienprüfung | `ffprobe` (statische Binärdatei, falls Plesk keins bietet) | Codec, Auflösung, Dauer, Bitrate → Warnungen |
| APK-Prüfung | Paketname/Version auslesen | Anzeige vor dem Senden |
| Tests | Vitest (Server, LDAP gegen Test-Container), Playwright (Web-Smoke) | |
| CI | GitHub Actions: Lint, Typecheck, Tests, APK-Build (signiert über Secret) | |

---

## 5. Anmeldung und Freischaltung (LDAP, wie `noten_webapp`)

Die Anmeldung wird aus `noten_webapp` übernommen (Quelle: `src/auth/ldap.js`, `ldap-settings.js`, `login-ratelimit.js`, `secret-crypto.js`, `sqlite-session-store.js`). Dort funktioniert sie auf demselben Plesk gegen dasselbe Active Directory.

### 5.1 Was übernommen wird
- **Zwei Anmelde-Modi:** Service-Modus (Service-Konto sucht, dann Bind mit der Benutzer-DN) und Direkt-Modus (`LDAP_BIND_USER_TEMPLATE`, z. B. `DOMAIN\{{username}}`).
- **Pflichtgruppe** (`LDAP_REQUIRED_GROUP`, auch verschachtelte AD-Gruppen): nur Mitglieder dürfen sich überhaupt anmelden. Das löst das Problem, dass Auszubildende mit AD-Konto Freischaltungsanträge stellen könnten. Fehlermeldung „Konto gehört nicht zur Gruppe“.
- **Konfiguration:** Plesk-Umgebungsvariablen (`LDAP_URL`, `LDAP_BASE_DN`, `LDAP_USER_FILTER`, `LDAP_LOGIN_ATTR`, `LDAP_NAME_ATTR`, `LDAP_TLS_CA_PFAD`, `LDAP_BIND_DN`, `LDAP_BIND_PW`) und optional Admin-Oberfläche mit verschlüsselt gespeichertem Service-Passwort.
- **Login-Ratenbegrenzung** pro Benutzername mit exponentiellem Backoff, in SQLite gespeichert (übersteht Neustarts), Versuche während einer Sperre verlängern sie nicht (kein Aussperren Fremder).
- **Admin-LDAP-Suche** („Lehrkräfte aus LDAP importieren“) wird zur Freischaltungs-Suche: Admin sucht eine Lehrkraft im Verzeichnis und schaltet sie vorab frei.
- Rollen kommen **nicht** aus dem AD, sondern aus der eigenen DB.

### 5.2 Was neu ist (Freischaltung)
1. Nach erfolgreicher LDAP-Anmeldung wird die Person über `ldap_uid` (klein geschrieben) in `users` gesucht.
2. `uid` steht in der Plesk-Variable **`ADMIN_USERS`** (kommagetrennt) → Rolle `admin`, Status `approved`. Das wird bei **jedem** Login neu aus der Variable bestimmt; wer entfernt wird, verliert die Rechte.
3. Unbekannt → Status `pending`, Hinweis „Freischaltung durch Admin ausstehend“, kein Zugriff auf Dateien/Brillen. Der Admin sieht Anträge in der Benutzerverwaltung und schaltet frei oder sperrt (`blocked`).
4. Alternativ schaltet der Admin per LDAP-Suche vorab frei (Konto steht dann schon als `approved`).
5. Session-Cookie setzen. Brillen nutzen eigene Tokens und sind von LDAP-Ausfällen nicht betroffen.

`noten_webapp` kennt zusätzlich `auto_provision` (Konto automatisch anlegen) und lokale Konten per `seed-admin`. Beides wird hier **nicht** übernommen: Anlegen nur als `pending`, kein lokales Passwort-Konto in V1 (Notfall-Admin: siehe offene Fragen).

### 5.3 Rechte (Vorschlag)
| Aktion | `pending` | `user` (freigeschaltet) | `admin` |
|---|---|---|---|
| Dateien ansehen, hochladen, eigene löschen | nein | ja | ja |
| Fremde Dateien löschen | nein | nein | ja |
| An Brillen senden | nein | ja | ja |
| APK hochladen/installieren | nein | **nein** (Vorschlag) | ja |
| Brillen koppeln/sperren, Gruppen, Richtlinien | nein | nein | ja |
| Benutzer freischalten/sperren, LDAP-Suche | nein | nein | ja |

### 5.4 Konfiguration LernRaumVR (Plesk-Variablen)
Wie in `noten_webapp` die `LDAP_*`-Variablen (`LDAP_REQUIRED_GROUP=AAD-LUL`), dazu `ADMIN_USERS`, `SECRET` (Session + Verschlüsselung), `DB_ENCRYPTION_KEY` (**Pflicht**), `DB_PFAD`, `DATA_DIR`, `PUBLIC_URL`, `MAX_UPLOAD_BYTES`, `MIN_FREE_BYTES`, `MAX_PARALLEL_DOWNLOADS`.

### 5.5 Besonderheiten
- **Ausfall:** Fällt LDAP aus, laufen bestehende Sessions und alle Brillen weiter.
- **Datenschutz:** Gespeichert werden nur `ldap_uid`, Anzeigename, Status, Zeiten; keine Passwörter, keine E-Mail-Adressen. Ins Verfahrensverzeichnis aufnehmen (analog zu `noten_webapp`).

---

## 6. Große Dateien und Versand an 33 Brillen

### 6.1 Sehr große Inhalte: Upload, Speicher, Verteilung

Einzeldateien liegen zwischen **500 MB und 5 GB** (Angabe von Till), der Gesamtbestand wächst über die Zeit (Gesamtvolumen noch offen, Frage 10). Der Entwurf lässt Reserve: `MAX_UPLOAD_BYTES` steht standardmäßig auf 10 GB.

**Upload**
1. **tus mit großen Chunks** (32–64 MB, `tus-js-client`), Wiederholung mit Backoff, Fortsetzen nach Browser-Neustart oder Netzwechsel (gemerkter Upload), Anzeige von Fortschritt und Restzeit, Hinweis „Tab offen lassen“. Das `client_max_body_size` von nginx gilt je Chunk, nicht je Datei. Phase 0 prüft, ob Plesk/Passenger Chunks puffert (Plattenplatz, Zeitlimits).
2. **Vorabprüfung** beim Anlegen (`POST /api/uploads`): angekündigte Größe ≤ `MAX_UPLOAD_BYTES`, freier Platz ≥ Größe + Reserve (`MIN_FREE_BYTES`), Kontingent der Person nicht überschritten. Abgelehnt wird **vor** dem Übertragen von 30 GB, mit klarer Meldung.
3. **Kein Puffern im Arbeitsspeicher:** Streaming auf Platte. `uploads/` und `files/` liegen auf **demselben Dateisystem**, damit der Abschluss ein `rename` ist und nicht eine Kopie von 30 GB.
4. **Nachverarbeitung als Hintergrundjob** (Status `processing`): SHA-256 und Blockhashes, ffprobe, APK-Analyse. Läuft im Worker-Thread, höchstens 1–2 Jobs parallel, damit der Server reaktionsfähig bleibt. Erst danach `ready`; erst dann ist Versand möglich. Unterbrochene Jobs werden nach einem Neustart wieder aufgenommen.
5. **Aufräumen:** unvollständige Uploads verfallen nach 48 h (täglicher Cleanup); Konsistenzprüfung findet Dateien ohne Eintrag und Einträge ohne Datei.
6. **Parallelität begrenzen:** z. B. 2 Uploads je Person, 4 insgesamt.
7. **Server-Import als Alternative zum Browser:** Admin legt Dateien per SFTP/SSH in `DATA_DIR/import/`, LernRaumVR registriert sie (Hash, Analyse) ohne Browser-Upload. Sinnvoll, wenn ein Browser-Upload Stunden dauern würde.
8. **Neustarts überstehen:** Deployment oder Passenger-Recycling dürfen Uploads und Transfers nicht zerstören. tus-Zustand liegt auf der Platte; beim Start werden Slots zurückgesetzt und Jobs wieder aufgenommen. Deployments trotzdem außerhalb von Upload- und Unterrichtszeiten.

**Speicher**
- **`StorageBackend`-Schnittstelle** (`put`, `stat`, `openRange`, `delete`). V1: lokales Dateisystem unter `DATA_DIR`. Später austauschbar (Netzlaufwerk, S3-kompatibler Speicher), ohne die API zu ändern. Dateien liegen unter `files/<id>`, nie unter dem Originalnamen.
- **Kontingente:** Plattenplatz (Dateien + `uploads/` + `import/` + Verarbeitungsreserve), **monatlicher Traffic**, CPU/RAM-Limits. Wegen `noten_webapp` auf demselben Server die Limits des Abos klären. Subdomain: `lernraumvr.bbz-rd-eck.com`.
- **Duplikate:** nach der Verarbeitung Hinweis, wenn dieselbe SHA-256 schon existiert.
- **Löschen** nur ohne offene Transfers; Papierkorb später.
- **Backup:** die verschlüsselte Datenbank täglich. Die Inhalte sind für ein Plesk-Gesamtbackup je nach Bestand vermutlich zu groß; Strategie ist offen (Frage 11): z. B. Abgleich auf zweiten Speicher oder Inhalte als wiederbeschaffbar behandeln und nur Metadaten sichern.

**Verteilung großer Dateien an die Brillen**
- **Download mit `Range`** und Fortsetzen über Tage hinweg (`.part` auf der Brille).
- **Blockhashes** (z. B. je 64 MB) im Manifest: die Brille prüft jeden Block beim Laden, bei Fehlern wird nur dieser Block neu geholt, am Ende entfällt langes Voll-Hashing. Die Gesamt-SHA-256 bleibt Referenz. Bei Dateien bis 5 GB ist das eine Optimierung für schwaches WLAN und kann nach dem Lasttest entschieden werden (Phase 3, optional).
- **Speicher der Brille:** vor dem Senden freien Platz prüfen (Datei + 10 % Reserve). Der Speicher der G2 4K ist begrenzt (Modell prüfen). Neuer Auftragstyp `remove`, der Dateien von der Brille löscht; der Heartbeat liefert die Liste der vorhandenen Inhalte.
- **Traffic:** Größe × 33. Ein 5-GB-Inhalt sind 165 GB je Klassensatz, ein 1-GB-Video 33 GB. Das kann ein Plesk-Kontingent schnell belasten. Der **lokale Cache im Schulnetz** bleibt eine bedingte Phase 6; ob er nötig ist, zeigen die Messung des Traffic-Kontingents in Phase 0 und der Lasttest in Phase 4. Ein kleiner Server im Schulnetz holt die Datei einmal vom Plesk-Server und verteilt sie im LAN. Das Protokoll ist vorbereitet, weil die Download-URL im Auftrag steht und nicht fest in der App.

### 6.2 Versand an 33 Brillen

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

### 7.3 APK-Installation (Pico-SDK, bestätigt)
Die Installation läuft **still über das Pico-SDK** und wurde von dir an der Brille erfolgreich getestet. Die App kapselt das hinter einem `ApkInstaller`-Interface (Standard-Android-Installer nur als Entwicklungs-Rückfall) und prüft den Erfolg per `PackageManager` (Paketname, Versionscode).

Weil die Brille **nicht nachfragt**, trägt der Server die Verantwortung:
- APK-Upload nur für Admins (V1), Paketname/Version/Signatur-Fingerprint werden beim Upload ausgelesen und angezeigt.
- **Allowlist erlaubter Paketnamen** ist ab V1 Pflicht, nicht Option; optional zusätzlich der erwartete Signatur-Fingerprint.
- Audit-Log für jede Installation (wer, was, wo).
- Selbstupdate der LernRaumVR-App über denselben Weg, mit unveränderter Signatur-Keystore.
- Zu dokumentieren: SDK-Version, Bezugsquelle, Lizenz (siehe Abschnitt 0); verfügbare Funktionen für Kiosk/Einstellungen sperren (siehe 7.5).

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
| `users` | id, ldap_uid (unique, klein), display_name, role (`user`/`admin`), status (`pending`/`approved`/`blocked`), quota_bytes, created_at, last_login_at |
| `sessions` | id, user_id, expires_at, created_at |
| `files` | id, name, original_name, typ (`video`/`image`/`apk`/`other`), mime, groesse, sha256, status (`uploading`/`processing`/`ready`/`failed`), storage_backend, storage_key, block_size, duplicate_of, meta (JSON), warnungen (JSON), uploaded_by, created_at (Blockhashes als Datei `files/<id>.blocks`) |
| `uploads` | tus_id, user_id, file_id, laenge, expires_at, created_at |
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
| `GET /api/storage` | Speicherbelegung, Kontingent (Admin: alle) |
| `POST /api/admin/import` | Dateien aus `import/` registrieren (Admin, Phase 3) |
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
| `GET /api/device/files/:id/blocks` | Blockhash-Manifest für große Dateien |
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

Angelegt (Stand Entwurf 6):

```
LernRaumVR/
├── docs/                 PLAN.md, phase0.md (Vorlage), später lasttest.md
├── server/               Fastify 5, TypeScript, verschlüsselte SQLite, Migrationen, Tests (Vitest)
│   ├── migrations/       001_init.sql (Schema aus Abschnitt 8)
│   └── src/              config, db, storage, routes
├── web/                  Vite + TypeScript (Startseite mit Server-Status)
├── headset/              Android-Projekt (Gradle, Kotlin): Service, Autostart, Launcher-Alias
├── .github/workflows/    CI (Typecheck, Tests, Build, APK)
├── package.json          npm-Workspaces: server, web
└── README.md
```

Später: `tools/` (Rollout-Skript für 33 Brillen), gemeinsame API-Typen in `shared/`, falls nötig.

---

## 11. Phasen

Aufwände sind Schätzungen für eine Person mit Node-Erfahrung und etwas Android-Einarbeitung. Gegenüber Entwurf 1 sind LDAP/Freischaltung, Gruppen/Warteschlange, Plesk-Test, Rollout und Lasttest dazugekommen.

| Phase | Inhalt | Fertig, wenn | Aufwand |
|---|---|---|---|
| **0 Machbarkeit** | **Brille:** ~~APK-Installation~~ (läuft über Pico-SDK, Version/Quelle/Lizenz dokumentieren), Entwicklermodus, Datei nach `Movies/`, Pico-Player, Standby, Dauertest Service, **Startapp-Test (HOME-Filter, Standard-App, Home-Taste), Möglichkeiten zum Sperren der Einstellungen im Pico-SDK**, Bauen-vs-kaufen. **Plesk:** WS, 2-GB-Upload (tus), Range-Download, Passenger-Prozessmodell, ffprobe, Traffic-Kontingent | Datei/Video kommt an; Plesk-Test bestanden oder Alternative benannt; `docs/phase0.md` | 2–4 Tage |
| **1 Server** | Gerüst, Migrationen, verschlüsselte DB, **LDAP-Login aus `noten_webapp` portieren (Pflichtgruppe `AAD-LUL`), Freischaltung, `ADMIN_USERS`**, tus-Upload mit Vorabprüfung (Größe, Platz, Kontingent), Nachverarbeitung im Worker, Cleanup, Dateiliste, Löschen; Web: Login, Antrag-ausstehend-Seite, Upload, Liste, Benutzerverwaltung mit LDAP-Suche | 2-GB-Datei lässt sich abbrechen und fortsetzen, Hash stimmt; Test mit ≥ 20-GB-Datei; neue LDAP-Person bleibt gesperrt bis zur Freischaltung | 5–7 Tage |
| **2 Brillen-App** | Gerüst, **Launcher-Filter + einfache App-Liste (falls Phase 0 grünes Licht gibt)**, Kopplung, Service, Aufträge, Download mit Range, Prüfsumme, Ablage + Media-Scan; Web: Geräte, Kopplung, Einzelversand | Datei aus dem Browser liegt auf der gewählten Brille | 6–10 Tage |
| **3 Status, Gruppen, APK, große Dateien** | Fortschritt/Heartbeat/Speicher live, Fehlerbilder, **Gruppen, Mehrfachversand, Download-Slots/Warteschlange**, APK-Installation, Selbstupdate, Abbrechen/Wiederholen, **Blockhashes, Server-Import, Speicherübersicht, Auftrag `remove`** | Weboberfläche zeigt Erfolg/Fehler; Versand an Gruppe aus 5 Brillen klappt mit Warteschlange; 20-GB-Datei kommt mit Blockprüfung an | 7–10 Tage |
| **4 Betrieb** | Rollout-Skript, HTTPS, Backup, **Lasttest mit 33 Brillen**, Test im Unterricht | Eine Unterrichtsstunde mit allen Brillen läuft ohne Eingriff | 3–5 Tage |
| **5 Launcher & Richtlinien** | `policies`-Tabelle und Admin-Seite, `GET /api/device/policy`, Kiosk-Launcher mit App-Auswahl vom Server, Einstellungen sperren (je nach Phase-0-Weg), Notausstieg/Entsperrcode, Stufentest 1 → Gruppe → 33 Brillen | Eine Gruppe zeigt nur freigegebene Apps, Einstellungen sind gesperrt, Rückbau per Server klappt | 5–8 Tage |
| **6 Lokaler Cache** (bedingt) | kleiner Server im Schulnetz, holt Inhalte einmal vom Plesk-Server und verteilt im LAN; App versucht zuerst die lokale Adresse, dann Plesk | 33 Brillen laden einen 20-GB-Inhalt, ohne dass der Plesk-Traffic 33-fach anfällt | 4–6 Tage |

Summe: ca. 23–36 Arbeitstage für V1 (Phasen 0–4), dazu 5–8 Tage für Phase 5 und bedingt 4–6 Tage für Phase 6.

**Entscheidungspunkte:**
- Ende Phase 0: Plesk tauglich (WS, Upload, Prozessmodell)? Reichen die Pico-SDK-Funktionen für Startapp/Sperren? Eigenbau oder Fertigprodukt? Dateikonventionen 180°/360°.
- Ende Phase 2: reichen Polling + WS, oder sind Wake-Locks/Lade-Logik nötig?
- Ende Phase 4: reicht der externe Server für 33 Brillen, oder lokaler Cache nötig?

---

## 12. Betrieb auf Plesk

Grundlage: `noten_webapp` läuft bereits als Plesk-Node.js-App und zeigt, was funktioniert. Das wird übernommen:

- **Node.js-Erweiterung** (Passenger), Node 22 aus `/opt/plesk/node/22`, App als **Ein-Prozess-Anwendung** ohne eigenen Reverse-Proxy.
- **Deployment:** Git-Repository in Plesk verknüpfen (Deploy-Key bei GitHub), Bereitstellungsaktion `npm install` + `touch tmp/restart.txt` bzw. in der Plesk-UI „npm-Installation“ und „Anwendung neu starten“. Für TypeScript zusätzlich Build-Schritt (`npm run build`) in der Bereitstellungsaktion oder fertiges `dist/` aus der CI.
- **Konfiguration:** nur Plesk-Umgebungsvariablen (siehe 5.4), keine Secrets im Repo.
- **Dokumentenstamm** auf ein leeres `public/`-Verzeichnis, Daten (`DB`, `files/`, `uploads/`) **außerhalb** des Webverzeichnisses (z. B. unter `…/private/lernraumvr/`).
- **Native Module:** `better-sqlite3` hat dort vorkompilierte Binaries bzw. `npm rebuild` als Rückfall (wie bei `noten_webapp`).
- **Backup:** Datenbank täglich (Schlüssel `DB_ENCRYPTION_KEY` getrennt sichern). Inhalte voraussichtlich nicht im Plesk-Gesamtbackup, siehe 6.1 und Frage 11.
- **LDAP-Erreichbarkeit** vom Plesk-Server ist damit bereits gegeben.

Noch in Phase 0 zu prüfen (bei `noten_webapp` nicht nötig gewesen, nicht auf deinem Server getestet):
- **WebSocket** über nginx/Passenger. Falls nicht möglich: Polling alle 30 s als Plan B.
- **Sehr große Uploads/Downloads (Details 6.1):** `client_max_body_size` je Chunk, Puffer, Timeouts über „Zusätzliche nginx-Anweisungen“; Passenger kann Request-Bodys puffern, daher tus mit festen Chunk-Größen (32–64 MB) und Test mit einer Datei ≥ 20 GB samt Unterbrechung. Range-Downloads über 2 GB testen. Prüfen, ob `uploads/` und `files/` auf demselben Dateisystem liegen.
- **Ein Prozess:** Passenger-Einstellungen (maximal eine Instanz, Verhalten bei Leerlauf), weil Slot-Vergabe und WS-Zustand im Prozess liegen.
- **ffprobe** vorhanden? Sonst statische Binärdatei in `DATA_DIR/bin`.
- **Kontingente:** Plattenplatz und **monatlicher Traffic** (66 GB pro Klassensatz-Versand), CPU/RAM-Limits. Läuft LernRaumVR auf demselben Plesk-Abonnement wie `noten_webapp`, teilen sie sich diese Limits; deshalb eigene Subdomain/Abo bevorzugen (z. B. `lernraumvr.<domain>` nach dem Muster von `noten.bbz-rd-eck.com`).

---

## 13. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Plesk-Node/Passenger passt nicht für WS und sehr große Uploads (Grundbetrieb ist durch `noten_webapp` belegt) | Phase-0-Test; Plan B: Polling, Docker/Dienst auf eigener VM |
| LDAP-Konten werden durch Fremde gesperrt oder Unberechtigte melden sich an | Ratenbegrenzung wie `noten_webapp` (keine Verlängerung während Sperre), Pflichtgruppe |
| Stille Installation verteilt unbemerkt eine schädliche APK | nur Admin darf APK hochladen, Paketname-Allowlist (+ Signatur-Fingerprint), Audit-Log |
| Serverleitung/WLAN bei 33 Brillen zu langsam | Download-Slots, vorab senden, Lasttest, später lokaler Cache |
| Traffic-Kontingent des Hostings überschritten (5 GB × 33 Brillen = 165 GB je Versand) | Kontingent in Phase 0 messen/erfragen, Download-Slots, Phase 6 (lokaler Cache) |
| Platte läuft voll, Uploads brechen ab | Vorabprüfung (Größe, `MIN_FREE_BYTES`, Kontingent), Speicherübersicht, Cleanup, `StorageBackend` austauschbar, Server-Import |
| Backup der großen Inhalte nicht möglich | Strategie festlegen (Frage 11); Metadaten/DB immer sichern |
| Service wird im Standby beendet / Brille offline | Phase-0-Test, Watchdog, Autostart, Akku-Optimierung ausnehmen, am Ladegerät lassen |
| Fremde Home-App/Kiosk wird von der Pico-Oberfläche nicht akzeptiert oder lässt sich umgehen | Phase-0-Test; Rückfall: Launcher nur auf App-Ebene, Sperren per Pico-SDK/Device Owner oder gar nicht |
| Gesperrte Einstellungen machen Brillen unbrauchbar (z. B. kein WLAN-Wechsel) | Stufentest, Entsperrcode, Rückbau per Server, WLAN-Zugang bleibt erlaubt, USB-Debugging für Admins |
| Schad-APKs | HTTPS, LDAP + Freischaltung, APK nur Admin, Allowlist, Token sperrbar |
| Video läuft nicht | ffprobe beim Upload, Warnung bei ungeeignetem Codec/Auflösung |
| Speicher der Brille voll | Heartbeat, Prüfung vor dem Senden, `NO_SPACE` |
| Datenschutz, Urheberrecht | nur Lehrkräfte-Daten (uid/Name), nur nutzungsberechtigtes Material, Abstimmung mit der Schule |
| Eine Person als Single Point of Failure | Doku in `docs/`, Backup, Admin-Liste über Variable ergänzbar |

---

## 14. Offene Fragen

1. ~~LDAP~~ **geklärt:** wie `noten_webapp`, Pflichtgruppe `AAD-LUL`.
2. ~~Subdomain~~ **geklärt:** `lernraumvr.bbz-rd-eck.com`. Noch zu klären: Wie viel Plattenplatz und Traffic hat das Abo? Teilt es sich Limits mit `noten_webapp`?
3. **Rechte:** Gemeinsame Dateibibliothek für alle Freigeschalteten? APKs nur durch Admins? Dürfen alle Freigeschalteten an alle Brillen senden?
4. **Notfall-Zugang:** Soll es ein lokales Notfall-Admin-Konto geben, falls LDAP ausfällt (Vorschlag: nein in V1)?
5. **Paketname:** Domain steht fest; Vorschlag `com.bbzrdeck.lernraumvr` (Bindestriche sind in Android-Paketnamen nicht erlaubt). Vor dem ersten Release festlegen, später praktisch nicht änderbar.
6. **Brille:** genaue Gerätevariante/Firmware, Entwicklermodus schon aktiv?
7. **WLAN:** Wie viele Access Points im Raum, welche Bandbreite zum Internet?
8. **Startapp/Sperren (offen, Till klärt):** Welche Funktionen bietet das Pico-SDK dafür (Kiosk, Einstellungen sperren, Standard-Launcher setzen)? Ist die Brille in einem Unternehmens-/Business-Modus?
9. ~~Datenbank~~ **geklärt:** verschlüsselt wie `noten_webapp`.
10. **Größenordnung:** Einzeldateien 0,5–5 GB (geklärt). Offen: Gesamtbestand heute und in 12 Monaten, wie viele Inhalte kommen pro Halbjahr neu dazu?
11. **Backup/Speicherort:** Wo sollen die Inhalte langfristig liegen (Plesk-Platte, Schul-NAS, Objektspeicher), und müssen sie gesichert werden?

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

- [x] LDAP: Umsetzung wie `noten_webapp` festgelegt, APK-Installation per Pico-SDK läuft
- [x] AD-Gruppe `AAD-LUL`, Subdomain `lernraumvr.bbz-rd-eck.com`, verschlüsselte DB festgelegt
- [ ] Größenordnung der Inhalte, Plattenplatz und Traffic des Plesk-Abos klären (Fragen 2, 10, 11)
- [ ] Plesk: WebSocket, nginx-Anweisungen für Große-Datei-Upload/Download, Passenger-Instanzen, Traffic-/Plattenkontingent prüfen
- [ ] Gerätevariante, Android-Version, Firmware der Brille notieren; Entwicklermodus + USB-Debugging aktivieren
- [ ] Testvideo nach `Movies/` kopieren, im Pico-Player öffnen; 2D-Bedienbarkeit der App prüfen
- [ ] Pico-SDK: Version, Quelle, Lizenz dokumentieren; Funktionen für Startapp/Kiosk/Sperren prüfen
- [ ] Bauen-vs-kaufen-Recherche (ArborXR, ManageXR, Pico Business Suite)
- [ ] Repo-Gerüst (`server`, `web`, `headset`) anlegen
