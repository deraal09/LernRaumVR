import crypto from 'node:crypto';
import type { Db } from '../db/index.js';
import type { AppUser } from './types.js';

export const SESSION_COOKIE = 'lrvr_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Ablauf wird höchstens alle 5 Minuten verlängert (gleitende Sitzung ohne Schreiblast). */
const REFRESH_AFTER_MS = 5 * 60 * 1000;

const hash = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

interface SessionUserRow {
  session_id: string;
  expires_at: number;
  id: number;
  ldap_uid: string;
  display_name: string | null;
  role: 'user' | 'admin';
  status: 'pending' | 'approved' | 'blocked';
}

/** Server-Sessions in SQLite; im Cookie liegt nur ein Zufallstoken, in der DB sein Hash. */
export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  create(userId: number): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = this.now() + SESSION_TTL_MS;
    this.db
      .prepare("INSERT INTO sessions (id, user_id, data, expires_at) VALUES (?, ?, '{}', ?)")
      .run(hash(token), userId, expiresAt);
    return { token, expiresAt };
  }

  /** Liefert die Person zur Sitzung oder `null` (unbekannt, abgelaufen, gesperrt). */
  find(token: string): AppUser | null {
    const row = this.db
      .prepare(
        `SELECT s.id AS session_id, s.expires_at, u.id, u.ldap_uid, u.display_name, u.role, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(hash(token)) as SessionUserRow | undefined;
    if (!row) return null;
    const now = this.now();
    if (row.expires_at <= now || row.status === 'blocked') {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
      return null;
    }
    if (row.expires_at - now < SESSION_TTL_MS - REFRESH_AFTER_MS) {
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(now + SESSION_TTL_MS, row.session_id);
    }
    return {
      id: row.id,
      ldapUid: row.ldap_uid,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
    };
  }

  destroy(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(hash(token));
  }

  destroyAllForUser(userId: number): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  purgeExpired(): number {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now()).changes;
  }
}
