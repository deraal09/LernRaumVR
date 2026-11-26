# Phase 0: Machbarkeit (Ergebnisse)

Vorlage zum Ausfüllen. Ergebnisse bestimmen die Entscheidungen am Ende von Phase 0
(siehe `PLAN.md`, Abschnitt 11).

## Brille

| Punkt | Ergebnis | Stand |
|---|---|---|
| Gerätevariante, Android-Version, Firmware | | offen |
| Entwicklermodus, USB-Debugging | | offen |
| APK-Installation über das Pico-SDK (still) | funktioniert (Till) | erledigt |
| Pico-SDK: Version, Bezugsquelle, Lizenz | | offen |
| Pico-SDK: Funktionen für Startapp/Kiosk/Einstellungen sperren | | offen |
| Startapp: Fragt Android beim Home-Druck nach der Standard-App? (`LauncherAlias` aktivieren) | | offen |
| Startapp: Landet die Pico-Home-Taste in unserer App? | | offen |
| Datei in `Movies/` wird im Pico-Player gefunden | | offen |
| Dateinamen-Konventionen für 180°/360°/3D | | offen |
| Foreground-Service bleibt aktiv: abgesetzt / Standby / am Ladegerät | | offen |
| Akku-Optimierung/Autostart-Whitelist vorhanden? | | offen |
| App als 2D-Fenster in der Pico-Oberfläche bedienbar | | offen |
| Freier Speicher der Brille (Modell) | | offen |

## Plesk (`lernraumvr.bbz-rd-eck.com`)

| Punkt | Ergebnis | Stand |
|---|---|---|
| Node-Version in Plesk | | offen |
| Anwendung startet (`server/dist/index.js`), `better-sqlite3-multiple-ciphers` lädt | | offen |
| Ein Passenger-Prozess (maximal eine Instanz), Verhalten bei Leerlauf | | offen |
| WebSocket durch nginx/Passenger | | offen |
| Upload mit tus: 5-GB-Datei, mit Unterbrechung und Fortsetzen | | offen |
| nginx: `client_max_body_size`, Puffer, Timeouts | | offen |
| Range-Download einer 5-GB-Datei | | offen |
| `uploads/` und `files/` auf demselben Dateisystem | | offen |
| ffprobe vorhanden | | offen |
| Plattenplatz des Abos | | offen |
| Traffic-Kontingent pro Monat | | offen |
| Teilen sich LernRaumVR und `noten_webapp` die Limits? | | offen |

## Entscheidungen am Ende von Phase 0

- [ ] Plesk tauglich (WebSocket, Upload, Prozessmodell) oder Plan B
- [ ] Pico-SDK-Funktionen reichen für Startapp/Sperren
- [ ] Lokaler Cache im Schulnetz nötig (Phase 6)?
- [ ] Eigenbau oder Fertigprodukt (ArborXR, ManageXR, Pico Business Suite)
