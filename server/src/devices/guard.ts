import crypto from 'node:crypto';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { Db } from '../db/index.js';

export interface DeviceIdentity {
  id: number;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Authentifizierte Brille (Bearer-Token) oder `null`. */
    device: DeviceIdentity | null;
  }
}

export const TOKEN_PREFIX = 'lrv_';
export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
export const newToken = (): string => TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');

/** Anmeldung der Brillen per `Authorization: Bearer <Token>`; in der Datenbank liegt nur der Hash. */
export function registerDeviceAuth(app: FastifyInstance, db: Db): { requireDevice: preHandlerAsyncHookHandler } {
  app.decorateRequest('device', null);
  const find = db.prepare('SELECT id, name FROM devices WHERE token_hash = ? AND revoked_at IS NULL');
  // last_seen_at höchstens alle 20 Sekunden schreiben
  const touch = db.prepare(
    "UPDATE devices SET last_seen_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-20 seconds'))",
  );

  const requireDevice: preHandlerAsyncHookHandler = async (req, reply) => {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer (lrv_[A-Za-z0-9_-]{20,})$/.exec(header);
    const row = match ? (find.get(hashToken(match[1]!)) as DeviceIdentity | undefined) : undefined;
    if (!row) return reply.code(401).send({ error: 'unauthorized' });
    touch.run(row.id);
    req.device = row;
  };
  return { requireDevice };
}
