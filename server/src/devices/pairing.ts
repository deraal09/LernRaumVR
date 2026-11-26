import crypto from 'node:crypto';
import type { Db } from '../db/index.js';
import { hashToken, newToken } from './guard.js';

export const PAIRING_TTL_MINUTES = 10;
const MAX_OPEN_PAIRINGS = 300;

export interface DeviceInfo {
  model?: string;
  androidVersion?: string;
  appVersion?: string;
  serial?: string;
}

export class PairingLimitError extends Error {
  override name = 'PairingLimitError';
}

function randomCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Legt einen Kopplungsantrag an: 6-stelliger Code für die Anzeige, Geheimnis nur für die Brille. */
export function createPairing(db: Db, info: DeviceInfo): { id: number; code: string; pollSecret: string; expiresInSec: number } {
  const open = db.prepare("SELECT count(*) AS n FROM pairings WHERE device_id IS NULL AND expires_at > datetime('now')").get() as { n: number };
  if (open.n >= MAX_OPEN_PAIRINGS) throw new PairingLimitError('Zu viele offene Kopplungsanträge');

  let code = randomCode();
  const taken = db.prepare("SELECT 1 FROM pairings WHERE code = ? AND expires_at > datetime('now')");
  for (let i = 0; i < 20 && taken.get(code); i += 1) code = randomCode();
  if (taken.get(code)) throw new PairingLimitError('Kein freier Kopplungscode');

  const pollSecret = crypto.randomBytes(24).toString('base64url');
  const res = db
    .prepare(
      `INSERT INTO pairings (code, poll_secret_hash, device_info, expires_at)
       VALUES (?, ?, ?, datetime('now', ?))`,
    )
    .run(code, hashToken(pollSecret), JSON.stringify(info), `+${PAIRING_TTL_MINUTES} minutes`);
  return { id: Number(res.lastInsertRowid), code, pollSecret, expiresInSec: PAIRING_TTL_MINUTES * 60 };
}

export type ConfirmResult =
  | { ok: true; deviceId: number; name: string }
  | { ok: false; error: 'unknown_code' };

/** Nächster freier Standardname „Brille 01“, „Brille 02“ ... */
export function nextDeviceName(db: Db): string {
  const rows = db.prepare("SELECT name FROM devices WHERE name LIKE 'Brille %'").all() as Array<{ name: string }>;
  const used = new Set(rows.map((r) => Number(/^Brille (\d+)$/.exec(r.name)?.[1] ?? NaN)));
  let n = 1;
  while (used.has(n)) n += 1;
  return `Brille ${String(n).padStart(2, '0')}`;
}

/** Bestätigung im Browser: legt die Brille an. Der Token wird erst bei der Abfrage der Brille erzeugt. */
export function confirmPairing(db: Db, code: string, name?: string): ConfirmResult {
  return db.transaction((): ConfirmResult => {
    const p = db
      .prepare(
        "SELECT id, device_info FROM pairings WHERE code = ? AND device_id IS NULL AND expires_at > datetime('now') ORDER BY id DESC",
      )
      .get(code) as { id: number; device_info: string } | undefined;
    if (!p) return { ok: false, error: 'unknown_code' };
    const info = JSON.parse(p.device_info) as DeviceInfo;
    const deviceName = (name?.trim() || nextDeviceName(db)).slice(0, 60);
    // Platzhalter-Hash, bis die Brille ihren echten Token abholt
    const placeholder = hashToken(crypto.randomBytes(32).toString('hex'));
    const dev = db
      .prepare('INSERT INTO devices (name, token_hash, app_version, android_version) VALUES (?, ?, ?, ?)')
      .run(deviceName, placeholder, info.appVersion ?? null, info.androidVersion ?? null);
    db.prepare('UPDATE pairings SET device_id = ? WHERE id = ?').run(Number(dev.lastInsertRowid), p.id);
    return { ok: true, deviceId: Number(dev.lastInsertRowid), name: deviceName };
  })();
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'confirmed'; token: string; deviceId: number; name: string }
  | { status: 'gone' };

/** Abfrage durch die Brille. Der Token wird genau einmal ausgegeben. */
export function pollPairing(db: Db, id: number, secret: string): PollResult | null {
  return db.transaction((): PollResult | null => {
    const p = db
      .prepare(
        `SELECT id, poll_secret_hash, device_id, token_ausgegeben, expires_at > datetime('now') AS active
         FROM pairings WHERE id = ?`,
      )
      .get(id) as
      | { id: number; poll_secret_hash: string; device_id: number | null; token_ausgegeben: number; active: number }
      | undefined;
    const given = Buffer.from(hashToken(secret));
    const expected = Buffer.from(p?.poll_secret_hash ?? hashToken('x'));
    if (!p || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null; // unbekannt oder falsches Geheimnis
    if (p.device_id === null) return p.active ? { status: 'pending' } : { status: 'gone' };
    const device = db
      .prepare('SELECT id, name, last_seen_at FROM devices WHERE id = ? AND revoked_at IS NULL')
      .get(p.device_id) as { id: number; name: string; last_seen_at: string | null } | undefined;
    if (!device) return { status: 'gone' };
    // Ging die Antwort mit dem Token verloren (WLAN-Abbruch), darf die Brille ihn erneut abholen,
    // solange der alte Token nie benutzt wurde. Danach ist die Kopplung abgeschlossen.
    if (p.token_ausgegeben && device.last_seen_at !== null) return { status: 'gone' };
    const token = newToken();
    db.prepare('UPDATE devices SET token_hash = ? WHERE id = ?').run(hashToken(token), device.id);
    db.prepare('UPDATE pairings SET token_ausgegeben = 1 WHERE id = ?').run(p.id);
    return { status: 'confirmed', token, deviceId: device.id, name: device.name };
  })();
}

export function purgePairings(db: Db): number {
  return db.prepare("DELETE FROM pairings WHERE expires_at < datetime('now', '-1 day')").run().changes;
}
