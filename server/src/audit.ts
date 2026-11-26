import type { Db } from './db/index.js';

export function audit(
  db: Db,
  userId: number | null,
  aktion: string,
  ziel: string | null = null,
  details: Record<string, unknown> = {},
): void {
  db.prepare('INSERT INTO audit_log (user_id, aktion, ziel, details) VALUES (?, ?, ?, ?)').run(
    userId,
    aktion,
    ziel,
    JSON.stringify(details),
  );
}
