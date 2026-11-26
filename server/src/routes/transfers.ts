import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import type { AuthGuards } from '../auth/plugin.js';
import type { Db } from '../db/index.js';
import { cancelTransfers, createSendTransfers, retryTransfer } from '../transfers/service.js';

interface TransferRow {
  id: number;
  batch_id: string | null;
  kind: string;
  file_id: string | null;
  file_name: string | null;
  groesse: number | null;
  device_id: number;
  device_name: string | null;
  created_by: number | null;
  creator: string | null;
  status: string;
  bytes_done: number;
  released_at: string | null;
  fehler_code: string | null;
  fehler_text: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

const SELECT = `
  SELECT t.id, t.batch_id, t.kind, t.file_id, COALESCE(t.file_name, f.name) AS file_name, f.groesse,
         t.device_id, d.name AS device_name, t.created_by, COALESCE(u.display_name, u.ldap_uid) AS creator,
         t.status, t.bytes_done, t.released_at, t.fehler_code, t.fehler_text, t.created_at, t.updated_at, t.finished_at
  FROM transfers t
  LEFT JOIN files f ON f.id = t.file_id
  LEFT JOIN devices d ON d.id = t.device_id
  LEFT JOIN users u ON u.id = t.created_by`;

const view = (r: TransferRow) => ({
  id: r.id,
  batchId: r.batch_id,
  kind: r.kind,
  fileId: r.file_id,
  fileName: r.file_name,
  fileSize: r.groesse,
  deviceId: r.device_id,
  deviceName: r.device_name,
  createdBy: r.creator,
  status: r.status,
  /** wartend ohne freien Download-Slot */
  queued: r.status === 'pending' && r.released_at === null,
  bytesDone: r.bytes_done,
  errorCode: r.fehler_code,
  errorText: r.fehler_text,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  finishedAt: r.finished_at,
});

export function transferRoutes(app: FastifyInstance, deps: { db: Db; guards: AuthGuards }): void {
  const { db, guards } = deps;
  const pre = { preHandler: guards.requireApproved };

  app.post<{ Body: { fileId: string; deviceIds: number[] } }>(
    '/api/transfers',
    {
      ...pre,
      schema: {
        body: {
          type: 'object',
          required: ['fileId', 'deviceIds'],
          additionalProperties: false,
          properties: {
            fileId: { type: 'string', maxLength: 64 },
            deviceIds: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'integer' } },
          },
        },
      },
    },
    async (req, reply) => {
      const res = createSendTransfers(db, { fileId: req.body.fileId, deviceIds: req.body.deviceIds, userId: req.user!.id });
      if ('error' in res) return reply.code(res.error === 'file_not_found' ? 404 : 409).send({ error: res.error });
      audit(db, req.user!.id, 'transfer_created', req.body.fileId, {
        batchId: res.batchId, created: res.created.length, skipped: res.skipped.length,
      });
      return reply.code(201).send({ batchId: res.batchId, created: res.created.length, skipped: res.skipped });
    },
  );

  app.get<{ Querystring: { status?: 'open' | 'all'; batch?: string; device?: string; limit?: string } }>(
    '/api/transfers',
    pre,
    async (req) => {
      const where: string[] = [];
      const params: Array<string | number> = [];
      if (req.query.status !== 'all') {
        where.push("t.status IN ('pending', 'downloading', 'verified', 'awaiting_confirmation')");
      }
      if (req.query.batch) { where.push('t.batch_id = ?'); params.push(req.query.batch); }
      if (req.query.device) { where.push('t.device_id = ?'); params.push(Number(req.query.device)); }
      const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000);
      // Offene zuerst, dann neueste
      const rows = db
        .prepare(
          `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY (t.finished_at IS NULL) DESC, t.id DESC LIMIT ?`,
        )
        .all(...params, limit) as TransferRow[];
      return { transfers: rows.map(view) };
    },
  );

  const mayChange = (req: { user: { id: number; role: string } | null }, createdBy: number | null): boolean =>
    req.user!.role === 'admin' || createdBy === req.user!.id;

  app.post<{ Params: { id: string } }>('/api/transfers/:id/cancel', pre, async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT created_by FROM transfers WHERE id = ?').get(id) as { created_by: number | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (!mayChange(req, row.created_by)) return reply.code(403).send({ error: 'forbidden' });
    const n = cancelTransfers(db, { id });
    audit(db, req.user!.id, 'transfer_cancelled', String(id));
    return { cancelled: n };
  });

  app.post<{ Params: { id: string } }>('/api/transfers/:id/retry', pre, async (req, reply) => {
    const id = Number(req.params.id);
    const row = db
      .prepare(
        "SELECT t.created_by, f.status AS file_status FROM transfers t LEFT JOIN files f ON f.id = t.file_id WHERE t.id = ?",
      )
      .get(id) as { created_by: number | null; file_status: string | null } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (!mayChange(req, row.created_by)) return reply.code(403).send({ error: 'forbidden' });
    if (row.file_status !== 'ready') return reply.code(409).send({ error: 'file_not_ready' });
    if (!retryTransfer(db, id)) return reply.code(409).send({ error: 'not_retryable' });
    audit(db, req.user!.id, 'transfer_retried', String(id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/batches/:id/cancel', pre, async (req) => {
    const owner = req.user!.role === 'admin' ? null : req.user!.id;
    const ids = (
      db
        .prepare(`SELECT id FROM transfers WHERE batch_id = ? ${owner === null ? '' : 'AND created_by = ?'}`)
        .all(...(owner === null ? [req.params.id] : [req.params.id, owner])) as Array<{ id: number }>
    ).map((r) => r.id);
    let cancelled = 0;
    for (const id of ids) cancelled += cancelTransfers(db, { id });
    audit(db, req.user!.id, 'batch_cancelled', req.params.id, { cancelled });
    return { cancelled };
  });
}
