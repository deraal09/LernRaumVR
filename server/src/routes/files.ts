import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import type { AuthGuards } from '../auth/plugin.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import type { StorageBackend } from '../storage/types.js';

interface FileRow {
  id: string;
  name: string;
  typ: string;
  groesse: number;
  sha256: string | null;
  status: string;
  duplicate_of: string | null;
  meta: string;
  warnungen: string;
  uploaded_by: number | null;
  uploader_name: string | null;
  uploader_uid: string | null;
  created_at: string;
}

const SELECT = `
  SELECT f.id, f.name, f.typ, f.groesse, f.sha256, f.status, f.duplicate_of, f.meta, f.warnungen,
         f.uploaded_by, u.display_name AS uploader_name, u.ldap_uid AS uploader_uid, f.created_at
  FROM files f LEFT JOIN users u ON u.id = f.uploaded_by`;

export function filesRoutes(
  app: FastifyInstance,
  deps: { config: Config; db: Db; storage: StorageBackend; guards: AuthGuards },
): void {
  const { config, db, storage, guards } = deps;
  const pre = { preHandler: guards.requireApproved };

  const view = (r: FileRow, userId: number, isAdmin: boolean) => ({
    id: r.id,
    name: r.name,
    typ: r.typ,
    groesse: r.groesse,
    sha256: r.sha256,
    status: r.status,
    duplicateOf: r.duplicate_of,
    meta: JSON.parse(r.meta) as unknown,
    warnungen: JSON.parse(r.warnungen) as string[],
    uploadedBy: r.uploaded_by ? { id: r.uploaded_by, name: r.uploader_name ?? r.uploader_uid } : null,
    createdAt: r.created_at,
    canDelete: isAdmin || r.uploaded_by === userId,
  });

  app.get('/api/files', pre, async (req) => {
    const rows = db.prepare(`${SELECT} ORDER BY f.created_at DESC, f.rowid DESC`).all() as FileRow[];
    const admin = req.user!.role === 'admin';
    return { files: rows.map((r) => view(r, req.user!.id, admin)) };
  });

  app.get<{ Params: { id: string } }>('/api/files/:id', pre, async (req, reply) => {
    const row = db.prepare(`${SELECT} WHERE f.id = ?`).get(req.params.id) as FileRow | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { file: view(row, req.user!.id, req.user!.role === 'admin') };
  });

  app.delete<{ Params: { id: string } }>('/api/files/:id', pre, async (req, reply) => {
    const row = db
      .prepare('SELECT id, name, status, storage_key, uploaded_by FROM files WHERE id = ?')
      .get(req.params.id) as
      | { id: string; name: string; status: string; storage_key: string; uploaded_by: number | null }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.uploaded_by !== req.user!.id && req.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    // Laufende Uploads werden über das tus-Protokoll abgebrochen (DELETE /api/uploads/:id).
    if (row.status === 'uploading') return reply.code(409).send({ error: 'uploading' });
    const open = db
      .prepare(
        `SELECT count(*) AS n FROM transfers WHERE file_id = ?
         AND status IN ('pending', 'downloading', 'verified', 'awaiting_confirmation')`,
      )
      .get(row.id) as { n: number };
    if (open.n > 0) return reply.code(409).send({ error: 'open_transfers', count: open.n });

    await storage.delete(row.storage_key);
    db.prepare('DELETE FROM files WHERE id = ?').run(row.id);
    audit(db, req.user!.id, 'file_deleted', row.id, { name: row.name });
    return { ok: true };
  });

  app.get('/api/storage', pre, async (req) => {
    const user = req.user!;
    const sum = (where: string, ...params: number[]) =>
      (db.prepare(`SELECT COALESCE(SUM(groesse), 0) AS s FROM files ${where}`).get(...params) as { s: number }).s;
    const quotaRow = db.prepare('SELECT quota_bytes FROM users WHERE id = ?').get(user.id) as { quota_bytes: number | null };
    return {
      freeBytes: await storage.freeBytes(),
      minFreeBytes: config.minFreeBytes,
      maxUploadBytes: config.maxUploadBytes,
      totalBytes: sum(''),
      usedBytes: sum('WHERE uploaded_by = ?', user.id),
      quotaBytes: quotaRow.quota_bytes ?? config.defaultQuotaBytes,
    };
  });
}
