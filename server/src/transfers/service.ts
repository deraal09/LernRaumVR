import crypto from 'node:crypto';
import type { Db } from '../db/index.js';

export type TransferKind = 'send' | 'install' | 'remove' | 'play';
export type TransferStatus =
  | 'pending'
  | 'downloading'
  | 'verified'
  | 'done'
  | 'awaiting_confirmation'
  | 'installed'
  | 'failed'
  | 'cancelled';

/** Aufträge, die noch nicht abgeschlossen sind. */
export const OPEN_STATUSES = ['pending', 'downloading', 'verified', 'awaiting_confirmation'] as const;
const OPEN_SQL = OPEN_STATUSES.map((s) => `'${s}'`).join(', ');
/** Ein Download-Slot ist belegt, solange geladen oder geprüft wird. */
const SLOT_SQL = "'pending', 'downloading', 'verified'";
/** Ohne Fortschrittsmeldung geben Aufträge ihren Slot nach dieser Zeit zurück (Brille ausgeschaltet o. Ä.). */
const STALL_MINUTES = 10;
/** Reserve für Dateisystem und Medien-Scan: 10 % der Datei, mindestens 100 MB. */
const reserveFor = (size: number): number => Math.max(Math.ceil(size * 0.1), 100 * 1024 * 1024);

export interface CreateResult {
  batchId: string;
  created: number[];
  skipped: Array<{ deviceId: number; reason: 'unknown_device' | 'already_queued' | 'no_space' }>;
}

/** Legt je Brille einen Sendeauftrag an. Brillen mit zu wenig Speicher oder offenem Auftrag werden übersprungen. */
export function createSendTransfers(
  db: Db,
  args: { fileId: string; deviceIds: number[]; userId: number },
): CreateResult | { error: 'file_not_found' | 'file_not_ready' } {
  const file = db.prepare('SELECT id, name, groesse, status FROM files WHERE id = ?').get(args.fileId) as
    | { id: string; name: string; groesse: number; status: string }
    | undefined;
  if (!file) return { error: 'file_not_found' };
  if (file.status !== 'ready') return { error: 'file_not_ready' };

  const batchId = crypto.randomBytes(8).toString('hex');
  const result: CreateResult = { batchId, created: [], skipped: [] };
  const getDevice = db.prepare('SELECT id, freier_speicher FROM devices WHERE id = ? AND revoked_at IS NULL');
  const queued = db.prepare(
    `SELECT 1 FROM transfers WHERE file_id = ? AND device_id = ? AND kind = 'send' AND status IN (${OPEN_SQL})`,
  );
  const insert = db.prepare(
    `INSERT INTO transfers (batch_id, kind, file_id, file_name, device_id, created_by)
     VALUES (?, 'send', ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    for (const deviceId of new Set(args.deviceIds)) {
      const dev = getDevice.get(deviceId) as { id: number; freier_speicher: number | null } | undefined;
      if (!dev) {
        result.skipped.push({ deviceId, reason: 'unknown_device' });
      } else if (queued.get(file.id, deviceId)) {
        result.skipped.push({ deviceId, reason: 'already_queued' });
      } else if (dev.freier_speicher !== null && dev.freier_speicher < file.groesse + reserveFor(file.groesse)) {
        result.skipped.push({ deviceId, reason: 'no_space' });
      } else {
        result.created.push(Number(insert.run(batchId, file.id, file.name, deviceId, args.userId).lastInsertRowid));
      }
    }
  })();
  return result;
}

/** Gibt Slots von Aufträgen frei, die lange keine Meldung mehr hatten. */
function reclaimStalled(db: Db): void {
  db.prepare(
    `UPDATE transfers SET released_at = NULL, status = 'pending', updated_at = datetime('now')
     WHERE released_at IS NOT NULL AND kind != 'remove' AND status IN ('pending', 'downloading')
       AND updated_at < datetime('now', ?)`,
  ).run(`-${STALL_MINUTES} minutes`);
}

/**
 * Vergibt freie Download-Slots: höchstens `maxParallel` gleichzeitig auf allen Brillen, je Brille einer.
 * Die übrigen Aufträge bleiben wartend (Warteschlange).
 */
export function assignSlots(db: Db, deviceId: number, maxParallel: number): void {
  db.transaction(() => {
    reclaimStalled(db);
    // Lösch-Aufträge brauchen keinen Download und gelten sofort als freigegeben.
    db.prepare(
      `UPDATE transfers SET released_at = datetime('now')
       WHERE device_id = ? AND kind = 'remove' AND status = 'pending' AND released_at IS NULL`,
    ).run(deviceId);

    const mine = db
      .prepare(
        `SELECT count(*) AS n FROM transfers
         WHERE device_id = ? AND kind != 'remove' AND released_at IS NOT NULL AND status IN (${SLOT_SQL})`,
      )
      .get(deviceId) as { n: number };
    if (mine.n > 0) return;
    const active = db
      .prepare(
        `SELECT count(*) AS n FROM transfers
         WHERE kind != 'remove' AND released_at IS NOT NULL AND status IN (${SLOT_SQL})`,
      )
      .get() as { n: number };
    if (active.n >= maxParallel) return;

    const next = db
      .prepare(
        `SELECT t.id FROM transfers t JOIN files f ON f.id = t.file_id
         WHERE t.device_id = ? AND t.kind != 'remove' AND t.status = 'pending' AND t.released_at IS NULL
           AND f.status = 'ready'
         ORDER BY t.id LIMIT 1`,
      )
      .get(deviceId) as { id: number } | undefined;
    if (next) {
      db.prepare("UPDATE transfers SET released_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(
        next.id,
      );
    }
  })();
}

export interface DeviceTransferView {
  id: number;
  kind: TransferKind;
  status: TransferStatus;
  bytesDone: number;
  file: { id: string; name: string; typ: string; size: number; sha256: string | null; downloadUrl: string } | null;
  payload: unknown;
}

interface DeviceRow {
  id: number;
  kind: TransferKind;
  status: TransferStatus;
  bytes_done: number;
  payload: string;
  file_id: string | null;
  file_name: string | null;
  fname: string | null;
  typ: string | null;
  groesse: number | null;
  sha256: string | null;
}

/** Aufträge, die diese Brille jetzt bearbeiten darf, und IDs bereits abgebrochener Aufträge. */
export function listForDevice(
  db: Db,
  deviceId: number,
  maxParallel: number,
  knownIds: number[],
): { transfers: DeviceTransferView[]; cancelled: number[] } {
  assignSlots(db, deviceId, maxParallel);
  const rows = db
    .prepare(
      `SELECT t.id, t.kind, t.status, t.bytes_done, t.payload, t.file_id, t.file_name,
              f.name AS fname, f.typ, f.groesse, f.sha256
       FROM transfers t LEFT JOIN files f ON f.id = t.file_id
       WHERE t.device_id = ? AND t.released_at IS NOT NULL AND t.status IN ('pending', 'downloading', 'verified', 'awaiting_confirmation')
       ORDER BY t.id`,
    )
    .all(deviceId) as DeviceRow[];

  const transfers: DeviceTransferView[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    bytesDone: r.bytes_done,
    file: r.file_id
      ? {
          id: r.file_id,
          name: r.fname ?? r.file_name ?? 'datei',
          typ: r.typ ?? 'other',
          size: r.groesse ?? 0,
          sha256: r.sha256,
          downloadUrl: `/api/device/files/${r.file_id}`,
        }
      : null,
    payload: JSON.parse(r.payload) as unknown,
  }));

  // Aufträge, die die Brille kennt, aber nicht mehr offen sind (abgebrochen, Datei gelöscht): abbrechen lassen.
  const cancelled: number[] = [];
  if (knownIds.length > 0) {
    const placeholders = knownIds.map(() => '?').join(',');
    const known = db
      .prepare(`SELECT id, status FROM transfers WHERE device_id = ? AND id IN (${placeholders})`)
      .all(deviceId, ...knownIds) as Array<{ id: number; status: string }>;
    const byId = new Map(known.map((k) => [k.id, k.status]));
    for (const id of knownIds) {
      const status = byId.get(id);
      if (status === undefined || status === 'cancelled') cancelled.push(id);
    }
  }
  return { transfers, cancelled };
}

const ALLOWED: Record<string, TransferStatus[]> = {
  pending: ['downloading', 'failed'],
  downloading: ['downloading', 'verified', 'failed'],
  verified: ['done', 'installed', 'awaiting_confirmation', 'failed'],
  awaiting_confirmation: ['installed', 'failed'],
};

export interface DeviceUpdate {
  status: TransferStatus;
  bytesDone?: number;
  errorCode?: string;
  errorText?: string;
}

export type UpdateResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'cancelled' | 'invalid_transition' | 'not_released'; from?: string };

/** Statusmeldung der Brille. Der Server prüft, dass nur zulässige Übergänge gemeldet werden. */
export function applyDeviceUpdate(db: Db, deviceId: number, transferId: number, u: DeviceUpdate): UpdateResult {
  return db.transaction((): UpdateResult => {
    const t = db
      .prepare('SELECT id, kind, status, released_at FROM transfers WHERE id = ? AND device_id = ?')
      .get(transferId, deviceId) as { id: number; kind: TransferKind; status: TransferStatus; released_at: string | null } | undefined;
    if (!t) return { ok: false, error: 'not_found' };
    if (t.status === 'cancelled') return { ok: false, error: 'cancelled' };
    if (t.released_at === null) return { ok: false, error: 'not_released' };

    let allowed = ALLOWED[t.status] ?? [];
    // Lösch-Aufträge haben keinen Download: direkt erledigt oder fehlgeschlagen.
    if (t.kind === 'remove' && t.status === 'pending') allowed = ['done', 'failed'];
    // Sendeaufträge enden bei „fertig“, Installationsaufträge bei „installiert“.
    if (t.kind === 'send' && t.status === 'verified') allowed = ['done', 'failed'];
    if (t.kind === 'install' && t.status === 'verified') allowed = ['installed', 'awaiting_confirmation', 'failed'];
    if (!allowed.includes(u.status)) return { ok: false, error: 'invalid_transition', from: t.status };

    const finished = u.status === 'done' || u.status === 'installed' || u.status === 'failed';
    db.prepare(
      `UPDATE transfers SET status = ?, bytes_done = COALESCE(?, bytes_done),
         fehler_code = ?, fehler_text = ?, updated_at = datetime('now'),
         finished_at = CASE WHEN ? THEN datetime('now') ELSE finished_at END
       WHERE id = ?`,
    ).run(u.status, u.bytesDone ?? null, u.errorCode ?? null, u.errorText ?? null, finished ? 1 : 0, transferId);
    return { ok: true };
  })();
}

/** Darf diese Brille die Datei gerade laden? Nur mit einem freigegebenen, offenen Auftrag. */
export function deviceMayDownload(db: Db, deviceId: number, fileId: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM transfers WHERE device_id = ? AND file_id = ? AND kind != 'remove'
           AND released_at IS NOT NULL AND status IN ('pending', 'downloading', 'verified')`,
      )
      .get(deviceId, fileId),
  );
}

export function cancelTransfers(db: Db, where: { id?: number; batchId?: string; deviceId?: number }): number {
  const clauses: string[] = [];
  const params: Array<number | string> = [];
  if (where.id !== undefined) { clauses.push('id = ?'); params.push(where.id); }
  if (where.batchId !== undefined) { clauses.push('batch_id = ?'); params.push(where.batchId); }
  if (where.deviceId !== undefined) { clauses.push('device_id = ?'); params.push(where.deviceId); }
  if (clauses.length === 0) return 0;
  return db
    .prepare(
      `UPDATE transfers SET status = 'cancelled', updated_at = datetime('now'), finished_at = datetime('now')
       WHERE ${clauses.join(' AND ')} AND status IN (${OPEN_SQL})`,
    )
    .run(...params).changes;
}

/** Fehlgeschlagenen Auftrag erneut in die Warteschlange stellen. */
export function retryTransfer(db: Db, id: number): boolean {
  return (
    db
      .prepare(
        `UPDATE transfers SET status = 'pending', released_at = NULL, fehler_code = NULL, fehler_text = NULL,
           finished_at = NULL, updated_at = datetime('now')
         WHERE id = ? AND status IN ('failed', 'cancelled')`,
      )
      .run(id).changes > 0
  );
}
