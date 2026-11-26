import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, runMigrations, type Db } from '../src/db/index.js';
import { LocalStorage } from '../src/storage/local.js';
import { removeDir, tempDir } from './helpers.js';

describe('API', () => {
  let app: FastifyInstance;
  let db: Db;
  let dir: string;

  beforeEach(async () => {
    dir = tempDir();
    const config = loadConfig({ NODE_ENV: 'test', WEB_DIST: `${dir}/gibt-es-nicht` }, dir);
    db = openDatabase(':memory:', config.dbEncryptionKey);
    runMigrations(db);
    app = await buildApp({ config, db, storage: new LocalStorage(`${dir}/files`) });
  });

  afterEach(async () => {
    await app.close();
    db.close();
    removeDir(dir);
  });

  it('GET /api/health meldet ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe(true);
    expect(body.freeBytes).toBeGreaterThan(0);
  });

  it('meldet 503, wenn die Datenbank nicht antwortet', async () => {
    db.close();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    // für afterEach wieder öffnen
    db = openDatabase(':memory:', 'k');
  });

  it('antwortet unter /api/ mit JSON-404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/gibt-es-nicht' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});
