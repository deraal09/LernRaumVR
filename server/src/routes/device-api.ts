import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import type { preHandlerAsyncHookHandler } from 'fastify';
import type { StorageBackend } from '../storage/types.js';
import { applyDeviceUpdate, deviceMayDownload, listForDevice } from '../transfers/service.js';

export const POLL_INTERVAL_SEC = 15;

/** `Range: bytes=...` (nur ein Bereich). `null` = kein/nicht unterstützter Header, `'invalid'` = nicht erfüllbar. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // z. B. mehrere Bereiche: ganze Datei ausliefern
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    const n = Number(b);
    if (n === 0) return 'invalid';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

const nullableInt = { type: ['integer', 'null'], minimum: 0 } as const;
const str = { type: 'string', maxLength: 100 } as const;

/** Schnittstelle für die Brillen (Bearer-Token). */
export function deviceApiRoutes(
  app: FastifyInstance,
  deps: { config: Config; db: Db; storage: StorageBackend; requireDevice: preHandlerAsyncHookHandler },
): void {
  const { config, db, storage, requireDevice } = deps;
  const pre = { preHandler: requireDevice };

  app.post<{
    Body: { freeBytes?: number | null; batteryPercent?: number | null; appVersion?: string; androidVersion?: string };
  }>(
    '/api/device/heartbeat',
    {
      ...pre,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            freeBytes: nullableInt,
            batteryPercent: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
            appVersion: str,
            androidVersion: str,
          },
        },
      },
    },
    async (req) => {
      const b = req.body ?? {};
      db.prepare(
        `UPDATE devices SET last_seen_at = datetime('now'),
           freier_speicher = COALESCE(?, freier_speicher), akku_prozent = COALESCE(?, akku_prozent),
           app_version = COALESCE(?, app_version), android_version = COALESCE(?, android_version)
         WHERE id = ?`,
      ).run(b.freeBytes ?? null, b.batteryPercent ?? null, b.appVersion ?? null, b.androidVersion ?? null, req.device!.id);
      return { ok: true, serverTime: new Date().toISOString(), pollIntervalSec: POLL_INTERVAL_SEC };
    },
  );

  /**
   * Offene Aufträge. Mit `?known=1,2,3` meldet die Brille die Aufträge, an denen sie gerade arbeitet;
   * abgebrochene oder gelöschte kommen in `cancelled` zurück.
   */
  app.get<{ Querystring: { known?: string } }>('/api/device/transfers', pre, async (req) => {
    const known = (req.query.known ?? '')
      .split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 50);
    const { transfers, cancelled } = listForDevice(db, req.device!.id, config.maxParallelDownloads, known);
    return { transfers, cancelled, pollIntervalSec: POLL_INTERVAL_SEC };
  });

  app.patch<{
    Params: { id: string };
    Body: { status: string; bytesDone?: number; errorCode?: string; errorText?: string };
  }>(
    '/api/device/transfers/:id',
    {
      ...pre,
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: {
            status: {
              enum: ['downloading', 'verified', 'done', 'awaiting_confirmation', 'installed', 'failed'],
            },
            bytesDone: { type: 'integer', minimum: 0 },
            errorCode: { type: 'string', maxLength: 64 },
            errorText: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = applyDeviceUpdate(db, req.device!.id, Number(req.params.id), {
        status: req.body.status as Parameters<typeof applyDeviceUpdate>[3]['status'],
        ...(req.body.bytesDone !== undefined ? { bytesDone: req.body.bytesDone } : {}),
        ...(req.body.errorCode !== undefined ? { errorCode: req.body.errorCode } : {}),
        ...(req.body.errorText !== undefined ? { errorText: req.body.errorText } : {}),
      });
      if (result.ok) return { ok: true };
      const code = result.error === 'not_found' ? 404 : 409;
      return reply.code(code).send({ error: result.error, ...(result.from ? { from: result.from } : {}) });
    },
  );

  app.get<{ Params: { id: string } }>('/api/device/files/:id', pre, async (req, reply: FastifyReply) => {
    const fileId = req.params.id;
    const file = db
      .prepare("SELECT id, groesse, sha256, storage_key FROM files WHERE id = ? AND status = 'ready'")
      .get(fileId) as { id: string; groesse: number; sha256: string | null; storage_key: string } | undefined;
    if (!file || !deviceMayDownload(db, req.device!.id, fileId)) return reply.code(404).send({ error: 'not_found' });
    const stat = await storage.stat(file.storage_key);
    if (!stat) return reply.code(404).send({ error: 'not_found' });

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Cache-Control', 'no-store');
    if (file.sha256) reply.header('ETag', `"${file.sha256}"`);

    const range = parseRange(req.headers.range, stat.size);
    if (range === 'invalid') {
      return reply.code(416).header('Content-Range', `bytes */${stat.size}`).send();
    }
    if (range === null) {
      reply.header('Content-Length', String(stat.size));
      return reply.send(await storage.openRange(file.storage_key));
    }
    reply.code(206);
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
    reply.header('Content-Length', String(range.end - range.start + 1));
    return reply.send(await storage.openRange(file.storage_key, range));
  });
}
