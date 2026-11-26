/**
 * Ratenbegrenzung für Anmeldeversuche (Konzept aus noten_webapp).
 *
 * Je Benutzername, in SQLite gespeichert (übersteht Neustarts): ab dem 3. Fehlversuch in Folge
 * Sperre von 30 s, jeder weitere Fehlversuch nach Ablauf der Sperre verdoppelt sie. Versuche
 * WÄHREND einer Sperre zählen nicht und verlängern sie nicht, sonst könnte man fremde Konten
 * beliebig lange sperren. Zusätzlich ein Fenster je IP im Arbeitsspeicher.
 *
 * Wichtig: Die Prüfung läuft VOR dem LDAP-Aufruf, damit Fremde keine AD-Konten sperren können.
 */
import type { Db } from '../db/index.js';

const THRESHOLD = 3;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 60 * 60 * 1000;

const normalize = (key: string): string => key.trim().toLowerCase();

export class LoginRateLimit {
  private readonly ipFailures = new Map<string, number[]>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
    private readonly ipLimit = { max: 20, windowMs: 10 * 60 * 1000 },
  ) {}

  /** Restsekunden der Sperre oder `null`, wenn der Versuch erlaubt ist. */
  check(username: string, ip: string): number | null {
    const key = normalize(username);
    const row = key
      ? (this.db.prepare('SELECT gesperrt_bis FROM login_ratelimit WHERE schluessel = ?').get(key) as
          | { gesperrt_bis: number | null }
          | undefined)
      : undefined;
    if (row?.gesperrt_bis && row.gesperrt_bis > this.now()) {
      return Math.ceil((row.gesperrt_bis - this.now()) / 1000);
    }
    const recent = this.recentIpFailures(ip);
    if (recent.length >= this.ipLimit.max) {
      const oldest = recent[0]!;
      return Math.max(1, Math.ceil((oldest + this.ipLimit.windowMs - this.now()) / 1000));
    }
    return null;
  }

  recordFailure(username: string, ip: string): void {
    const key = normalize(username);
    if (key) {
      const existing = this.db
        .prepare('SELECT fehlversuche FROM login_ratelimit WHERE schluessel = ?')
        .get(key) as { fehlversuche: number } | undefined;
      const failures = (existing?.fehlversuche ?? 0) + 1;
      const lockedUntil =
        failures >= THRESHOLD
          ? this.now() + Math.min(BASE_LOCK_MS * 2 ** (failures - THRESHOLD), MAX_LOCK_MS)
          : null;
      this.db
        .prepare(
          `INSERT INTO login_ratelimit (schluessel, fehlversuche, gesperrt_bis) VALUES (?, ?, ?)
           ON CONFLICT(schluessel) DO UPDATE SET fehlversuche = excluded.fehlversuche, gesperrt_bis = excluded.gesperrt_bis`,
        )
        .run(key, failures, lockedUntil);
    }
    const list = this.recentIpFailures(ip);
    list.push(this.now());
    this.ipFailures.set(ip, list);
  }

  reset(username: string): void {
    const key = normalize(username);
    if (key) this.db.prepare('DELETE FROM login_ratelimit WHERE schluessel = ?').run(key);
  }

  private recentIpFailures(ip: string): number[] {
    const cutoff = this.now() - this.ipLimit.windowMs;
    const list = (this.ipFailures.get(ip) ?? []).filter((t) => t > cutoff);
    if (list.length) this.ipFailures.set(ip, list);
    else this.ipFailures.delete(ip);
    return list;
  }
}
