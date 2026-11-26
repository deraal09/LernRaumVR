import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import type { StorageBackend } from '../storage/types.js';

export interface HealthDeps {
  db: Db;
  storage: StorageBackend;
  version: string;
}

export function healthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/api/health', async (_req, reply) => {
    try {
      deps.db.prepare('SELECT 1').get();
    } catch {
      return reply.code(503).send({ status: 'error', db: false });
    }
    return { status: 'ok', version: deps.version, db: true, freeBytes: await deps.storage.freeBytes() };
  });
}
