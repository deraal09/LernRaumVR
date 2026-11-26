import type { Db } from '../db/index.js';
import type { AppUser, Role, UserStatus } from './types.js';

interface UserRow {
  id: number;
  ldap_uid: string;
  display_name: string | null;
  role: Role;
  status: UserStatus;
  quota_bytes: number | null;
  created_at: string;
  last_login_at: string | null;
}

const toAppUser = (r: UserRow): AppUser => ({
  id: r.id,
  ldapUid: r.ldap_uid,
  displayName: r.display_name,
  role: r.role,
  status: r.status,
});

/**
 * Legt die Person nach erfolgreicher Verzeichnis-Anmeldung an oder aktualisiert sie.
 *
 * - Steht der Name in ADMIN_USERS: Rolle `admin`, Status `approved`, bei JEDEM Login neu bestimmt
 *   (wer aus der Variable entfernt wird, verliert die Rechte).
 * - Sonst neu: Status `pending` (wartet auf Freischaltung); bestehende Status bleiben erhalten.
 */
export function upsertUserOnLogin(db: Db, adminUsers: string[], loginSub: string, name?: string): AppUser {
  const uid = loginSub.trim().toLowerCase();
  const isAdmin = adminUsers.includes(uid);
  const role: Role = isAdmin ? 'admin' : 'user';
  const existing = db.prepare('SELECT * FROM users WHERE ldap_uid = ?').get(uid) as UserRow | undefined;
  if (!existing) {
    const info = db
      .prepare(
        `INSERT INTO users (ldap_uid, display_name, role, status, last_login_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(uid, name ?? null, role, isAdmin ? 'approved' : 'pending');
    return getUser(db, Number(info.lastInsertRowid))!;
  }
  db.prepare(
    `UPDATE users SET role = ?, status = ?, display_name = COALESCE(?, display_name),
       last_login_at = datetime('now') WHERE id = ?`,
  ).run(role, isAdmin ? 'approved' : existing.status, name ?? null, existing.id);
  return getUser(db, existing.id)!;
}

export function getUser(db: Db, id: number): AppUser | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? toAppUser(row) : null;
}

export interface AdminUserView {
  id: number;
  ldapUid: string;
  displayName: string | null;
  role: Role;
  status: UserStatus;
  quotaBytes: number | null;
  usedBytes: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export function listUsers(db: Db): AdminUserView[] {
  const rows = db
    .prepare(
      `SELECT u.*, COALESCE((SELECT SUM(groesse) FROM files f WHERE f.uploaded_by = u.id), 0) AS used
       FROM users u ORDER BY (u.status = 'pending') DESC, u.ldap_uid`,
    )
    .all() as Array<UserRow & { used: number }>;
  return rows.map((r) => ({
    id: r.id,
    ldapUid: r.ldap_uid,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
    quotaBytes: r.quota_bytes,
    usedBytes: r.used,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  }));
}
