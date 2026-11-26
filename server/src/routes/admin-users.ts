import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import type { AuthGuards } from '../auth/plugin.js';
import type { DirectorySearch } from '../auth/types.js';
import { listUsers } from '../auth/users.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';

export interface AdminUsersDeps {
  config: Config;
  db: Db;
  guards: AuthGuards;
  directory: DirectorySearch | null;
}

export function adminUserRoutes(app: FastifyInstance, deps: AdminUsersDeps): void {
  const { config, db, guards, directory } = deps;
  const pre = { preHandler: guards.requireAdmin };

  app.get('/api/admin/users', pre, async () => ({ users: listUsers(db) }));

  app.patch<{ Params: { id: string }; Body: { status?: 'pending' | 'approved' | 'blocked'; quotaBytes?: number | null } }>(
    '/api/admin/users/:id',
    {
      ...pre,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            status: { enum: ['pending', 'approved', 'blocked'] },
            quotaBytes: { type: ['integer', 'null'], minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const id = Number(req.params.id);
      const target = db.prepare('SELECT id, ldap_uid, role FROM users WHERE id = ?').get(id) as
        | { id: number; ldap_uid: string; role: string }
        | undefined;
      if (!target) return reply.code(404).send({ error: 'not_found' });
      const { status, quotaBytes } = req.body;

      if (status !== undefined) {
        // Admins stehen in ADMIN_USERS und werden bei jedem Login wieder freigeschaltet.
        if (config.adminUsers.includes(target.ldap_uid) && status !== 'approved') {
          return reply.code(409).send({ error: 'admin_user', message: 'Admins werden über ADMIN_USERS verwaltet.' });
        }
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
        if (status !== 'approved') guards.sessions.destroyAllForUser(id);
        audit(db, req.user!.id, `user_${status}`, target.ldap_uid);
      }
      if (quotaBytes !== undefined) {
        db.prepare('UPDATE users SET quota_bytes = ? WHERE id = ?').run(quotaBytes, id);
        audit(db, req.user!.id, 'user_quota', target.ldap_uid, { quotaBytes });
      }
      return { user: listUsers(db).find((u) => u.id === id) };
    },
  );

  /** Vorab freischalten (z. B. nach der Verzeichnissuche). */
  app.post<{ Body: { username: string; displayName?: string } }>(
    '/api/admin/users',
    {
      ...pre,
      schema: {
        body: {
          type: 'object',
          required: ['username'],
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[\\w.@\\-\\\\]+$' },
            displayName: { type: 'string', maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const uid = req.body.username.trim().toLowerCase();
      const existing = db.prepare('SELECT id FROM users WHERE ldap_uid = ?').get(uid) as { id: number } | undefined;
      if (existing) {
        db.prepare("UPDATE users SET status = 'approved' WHERE id = ? AND status = 'pending'").run(existing.id);
      } else {
        db.prepare("INSERT INTO users (ldap_uid, display_name, status) VALUES (?, ?, 'approved')").run(
          uid,
          req.body.displayName ?? null,
        );
      }
      audit(db, req.user!.id, 'user_preapproved', uid);
      const user = listUsers(db).find((u) => u.ldapUid === uid);
      return reply.code(existing ? 200 : 201).send({ user });
    },
  );

  app.get<{ Querystring: { q?: string } }>('/api/admin/ldap-search', pre, async (req, reply) => {
    if (!directory) return reply.code(503).send({ error: 'ldap_not_configured' });
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return reply.code(400).send({ error: 'query_too_short' });
    try {
      const results = await directory.search(q, 50);
      return { results: results.map((r) => ({ username: r.loginSub, displayName: r.name ?? null })) };
    } catch (err) {
      req.log.error({ err }, 'LDAP-Suche fehlgeschlagen');
      return reply.code(502).send({ error: 'ldap_error' });
    }
  });
}
