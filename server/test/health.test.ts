import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers.js';

describe('API', () => {
  let t: TestEnv;
  beforeEach(async () => {
    t = await createTestEnv();
  });
  afterEach(() => t.close());

  it('GET /api/health meldet ok', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe(true);
    expect(body.freeBytes).toBeGreaterThan(0);
  });

  it('meldet 503, wenn die Datenbank nicht antwortet', async () => {
    await t.app.ready();
    t.db.close();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
  });

  it('antwortet unter /api/ mit JSON-404', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/gibt-es-nicht' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});
