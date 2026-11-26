import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { createPairing, PairingLimitError, pollPairing, type DeviceInfo } from '../devices/pairing.js';

/** Einfaches Fenster je IP im Arbeitsspeicher. Großzügig, weil alle Brillen hinter derselben NAT-Adresse hängen können. */
class WindowLimit {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
}

const str = { type: 'string', maxLength: 100 } as const;

/** Kopplung der Brille: Code anfordern und Token abholen (ohne Anmeldung, aber mit Geheimnis). */
export function pairingRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const limit = new WindowLimit(120, 10 * 60 * 1000);

  app.post<{ Body: DeviceInfo }>(
    '/api/pairing',
    {
      schema: {
        body: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: { model: str, androidVersion: str, appVersion: str, serial: str },
        },
      },
    },
    async (req, reply) => {
      if (!limit.allow(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
      try {
        const p = createPairing(db, req.body ?? {});
        return reply.code(201).send({
          pairingId: p.id,
          code: p.code,
          pollSecret: p.pollSecret,
          expiresInSec: p.expiresInSec,
          pollIntervalSec: 3,
        });
      } catch (err) {
        if (err instanceof PairingLimitError) return reply.code(429).send({ error: 'rate_limited' });
        throw err;
      }
    },
  );

  // Das Geheimnis kommt im Header, nicht in der URL (Logs, Verläufe).
  app.get<{ Params: { id: string } }>('/api/pairing/:id', async (req, reply) => {
    const secret = req.headers['x-poll-secret'];
    const id = Number(req.params.id);
    if (typeof secret !== 'string' || !Number.isInteger(id)) return reply.code(404).send({ error: 'not_found' });
    const result = pollPairing(db, id, secret);
    if (!result) return reply.code(404).send({ error: 'not_found' });
    if (result.status === 'gone') return reply.code(410).send({ error: 'gone' });
    reply.header('Cache-Control', 'no-store');
    return result;
  });
}
