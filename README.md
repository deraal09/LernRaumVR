# LernRaumVR

Webplattform zum Verteilen von Videos, Bildern und Apps auf PICO G2 4K im Unterricht.
Lehrkräfte laden Inhalte im Browser hoch und senden sie an einzelne Brillen oder Gruppen;
die Brillen holen sich ihre Aufträge selbst ab.

Der Umsetzungsplan steht in [docs/PLAN.md](docs/PLAN.md), die Ergebnisse der
Machbarkeitsphase werden in [docs/phase0.md](docs/phase0.md) gesammelt.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `server/` | Fastify-Server (TypeScript): Konfiguration, verschlüsselte SQLite-Datenbank mit Migrationen, Speicher-Schnittstelle, `GET /api/health` |
| `web/` | Weboberfläche (Vite + TypeScript) |
| `headset/` | Brillen-App (Kotlin, Android 8.1), siehe [headset/README.md](headset/README.md) |
| `docs/` | Plan und Phase-0-Ergebnisse |

Noch nicht umgesetzt (Phase 1 ff.): LDAP-Anmeldung, Upload, Brillen-Kopplung, Transfers.

## Entwicklung

Voraussetzung: Node.js 22.

```bash
npm install
cp server/.env.example server/.env   # DB_ENCRYPTION_KEY und SECRET mit `openssl rand -hex 32` füllen
npm test                             # Tests des Servers
npm run typecheck
npm run build
```

Server und Weboberfläche lokal starten (zwei Terminals):

```bash
set -a; . server/.env; set +a; npm run dev:server   # http://localhost:3001
npm run dev:web                                     # http://localhost:5173, leitet /api an den Server weiter
```

## Betrieb auf Plesk

Plesk → Node.js: Anwendungsstamm `server`, Startdatei `dist/index.js`, Umgebungsvariablen
laut `server/.env.example`. Gebaut werden müssen `web` und `server` (`npm run build`). Wie das in der
Plesk-Bereitstellungsaktion mit npm-Workspaces am besten läuft, ist in Phase 0 zu prüfen.
Details und offene Prüfungen: Abschnitt 12 in `docs/PLAN.md`.
`DB_ENCRYPTION_KEY` getrennt von Backups sichern: ohne ihn ist die Datenbank unlesbar.
