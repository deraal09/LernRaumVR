import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import type { AuthGuards } from '../auth/plugin.js';
import type { Db } from '../db/index.js';
import { confirmPairing } from '../devices/pairing.js';
import { hashToken } from '../devices/guard.js';
import { cancelTransfers } from '../transfers/service.js';

interface DeviceRow {
  id: number;
  name: string;
  last_seen_at: string | null;
  online: number;
  freier_speicher: number | null;
  akku_prozent: number | null;
  app_version: string | null;
  android_version: string | null;
  created_at: string;
  open_transfers: number;
}

const SELECT = `
  SELECT d.id, d.name, d.last_seen_at, d.freier_speicher, d.akku_prozent, d.app_version, d.android_version, d.created_at,
         (d.last_seen_at IS NOT NULL AND d.last_seen_at >= datetime('now', '-3 minutes')) AS online,
         (SELECT count(*) FROM transfers t WHERE t.device_id = d.id
            AND t.status IN ('pending', 'downloading', 'verified', 'awaiting_confirmation')) AS open_transfers
  FROM devices d WHERE d.revoked_at IS NULL`;

const view = (r: DeviceRow) => ({
  id: r.id,
  name: r.name,
  online: r.online === 1,
  lastSeenAt: r.last_seen_at,
  freeBytes: r.freier_speicher,
  batteryPercent: r.akku_prozent,
  appVersion: r.app_version,
  androidVersion: r.android_version,
  createdAt: r.created_at,
  openTransfers: r.open_transfers,
});

export function deviceRoutes(app: FastifyInstance, deps: { db: Db; guards: AuthGuards }): void {
  const { db, guards } = deps;

  app.get('/api/devices', { preHandler: guards.requireApproved }, async () => {
    const rows = db.prepare(`${SELECT} ORDER BY d.name`).all() as DeviceRow[];
    return { devices: rows.map(view) };
  });

  app.post<{ Body: { code: string; name?: string } }>(
    '/api/devices/confirm',
    {
      preHandler: guards.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['code'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', pattern: '^[0-9]{6}$' },
            name: { type: 'string', maxLength: 60 },
          },
        },
      },
    },
    async (req, reply) => {
      const dup = req.body.name?.trim()
        ? db.prepare('SELECT 1 FROM devices WHERE name = ? COLLATE NOCASE AND revoked_at IS NULL').get(req.body.name.trim())
        : undefined;
      if (dup) return reply.code(409).send({ error: 'name_taken' });
      const res = confirmPairing(db, req.body.code, req.body.name);
      if (!res.ok) return reply.code(404).send({ error: res.error });
      audit(db, req.user!.id, 'device_paired', String(res.deviceId), { name: res.name });
      return reply.code(201).send({ device: { id: res.deviceId, name: res.name } });
    },
  );

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    '/api/devices/:id',
    {
      preHandler: guards.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 60 } },
        },
      },
    },
    async (req, reply) => {
      const id = Number(req.params.id);
      const name = req.body.name.trim();
      if (!name) return reply.code(400).send({ error: 'invalid_name' });
      const clash = db.prepare('SELECT 1 FROM devices WHERE name = ? COLLATE NOCASE AND id != ? AND revoked_at IS NULL').get(name, id);
      if (clash) return reply.code(409).send({ error: 'name_taken' });
      const res = db.prepare('UPDATE devices SET name = ? WHERE id = ? AND revoked_at IS NULL').run(name, id);
      if (res.changes === 0) return reply.code(404).send({ error: 'not_found' });
      audit(db, req.user!.id, 'device_renamed', String(id), { name });
      return { ok: true };
    },
  );

  /** Brille sperren: Token wird ungültig, offene Aufträge werden abgebrochen. */
  app.delete<{ Params: { id: string } }>('/api/devices/:id', { preHandler: guards.requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    const res = db
      .prepare(
        "UPDATE devices SET revoked_at = datetime('now'), token_hash = ? WHERE id = ? AND revoked_at IS NULL",
      )
      .run(hashToken(crypto.randomBytes(32).toString('hex')), id);
    if (res.changes === 0) return reply.code(404).send({ error: 'not_found' });
    const cancelled = cancelTransfers(db, { deviceId: id });
    audit(db, req.user!.id, 'device_revoked', String(id), { cancelled });
    return { ok: true, cancelled };
  });
}
