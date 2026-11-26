import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, login, type TestEnv } from './helpers.js';

describe('Anmeldung und Freischaltung', () => {
  let t: TestEnv;

  beforeEach(async () => {
    t = await createTestEnv(
      { ADMIN_USERS: 'Chef' },
      {
        chef: { password: 'pw-chef', name: 'Die Chefin' },
        anna: { password: 'pw-anna', name: 'Anna Lehrkraft' },
        berta: { password: 'pw-berta' },
        azubi: { password: 'pw-azubi', inGroup: false },
      },
    );
  });
  afterEach(() => t.close());

  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
    t.app.inject({ method: 'POST', url, payload: payload as object, headers });

  it('lehnt falsche Zugangsdaten ab', async () => {
    const res = await post('/api/login', { username: 'anna', password: 'falsch' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_credentials' });
    expect(res.cookies).toHaveLength(0);
  });

  it('legt neue Personen als wartend an und gewährt keinen Zugriff', async () => {
    const res = await post('/api/login', { username: 'anna', password: 'pw-anna' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ username: 'anna', displayName: 'Anna Lehrkraft', role: 'user', status: 'pending' });
    const cookie = `lrvr_session=${res.cookies[0]!.value}`;

    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json().user.status).toBe('pending');

    const files = await t.app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie } });
    expect(files.statusCode).toBe(403);
  });

  it('setzt das Session-Cookie sicher', async () => {
    const res = await post('/api/login', { username: 'anna', password: 'pw-anna' });
    const c = res.cookies[0]!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    expect(c.path).toBe('/');
  });

  it('macht Personen aus ADMIN_USERS zu freigeschalteten Admins (Groß-/Kleinschreibung egal)', async () => {
    const res = await post('/api/login', { username: 'chef', password: 'pw-chef' });
    expect(res.json().user).toMatchObject({ role: 'admin', status: 'approved' });
  });

  it('weist Personen außerhalb der Pflichtgruppe ab, ohne Fehlversuch zu zählen', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await post('/api/login', { username: 'azubi', password: 'pw-azubi' });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'not_in_group' });
    }
    expect(t.db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it('Admin schaltet frei, danach hat die Person Zugriff; Sperren beendet Sitzungen', async () => {
    const admin = await login(t.app, 'chef', 'pw-chef');
    const annaCookie = await login(t.app, 'anna', 'pw-anna');

    const list = await t.app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: admin } });
    const anna = list.json().users.find((u: { ldapUid: string }) => u.ldapUid === 'anna');
    expect(anna.status).toBe('pending');
    // Wartende stehen oben
    expect(list.json().users[0].ldapUid).toBe('anna');

    const ok = await t.app.inject({
      method: 'PATCH', url: `/api/admin/users/${anna.id}`, headers: { cookie: admin }, payload: { status: 'approved' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.status).toBe('approved');
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: annaCookie } })).json().user.status).toBe('approved');

    await t.app.inject({
      method: 'PATCH', url: `/api/admin/users/${anna.id}`, headers: { cookie: admin }, payload: { status: 'blocked' },
    });
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: annaCookie } })).statusCode).toBe(401);
    const again = await post('/api/login', { username: 'anna', password: 'pw-anna' });
    expect(again.statusCode).toBe(403);
    expect(again.json()).toEqual({ error: 'blocked' });
  });

  it('erlaubt nicht, Admins aus ADMIN_USERS zu sperren', async () => {
    const admin = await login(t.app, 'chef', 'pw-chef');
    const id = (t.db.prepare("SELECT id FROM users WHERE ldap_uid='chef'").get() as { id: number }).id;
    const res = await t.app.inject({
      method: 'PATCH', url: `/api/admin/users/${id}`, headers: { cookie: admin }, payload: { status: 'blocked' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('entzieht Admin-Rechte, wenn der Name aus ADMIN_USERS entfernt wurde', async () => {
    await login(t.app, 'chef', 'pw-chef');
    t.config.adminUsers.length = 0;
    const res = await post('/api/login', { username: 'chef', password: 'pw-chef' });
    expect(res.json().user.role).toBe('user');
    // Status bleibt freigeschaltet, nur die Admin-Rolle fällt weg
    expect(res.json().user.status).toBe('approved');
  });

  it('schaltet per Vorab-Freigabe frei und sucht im Verzeichnis', async () => {
    const admin = await login(t.app, 'chef', 'pw-chef');
    const search = await t.app.inject({ method: 'GET', url: '/api/admin/ldap-search?q=berta', headers: { cookie: admin } });
    expect(search.json().results).toEqual([{ username: 'berta', displayName: null }]);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/ldap-search?q=b', headers: { cookie: admin } })).statusCode).toBe(400);

    const pre = await post('/api/admin/users', { username: 'Berta' }, { cookie: admin });
    expect(pre.statusCode).toBe(201);
    const login2 = await post('/api/login', { username: 'berta', password: 'pw-berta' });
    expect(login2.json().user.status).toBe('approved');
  });

  it('sperrt nach drei Fehlversuchen, ohne das Verzeichnis weiter zu belasten', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await post('/api/login', { username: 'anna', password: 'x' })).statusCode).toBe(401);
    }
    const callsBefore = t.ldap.calls;
    const blocked = await post('/api/login', { username: 'anna', password: 'pw-anna' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(t.ldap.calls).toBe(callsBefore); // LDAP wurde nicht gefragt
  });

  it('meldet ab und macht die Sitzung ungültig', async () => {
    const cookie = await login(t.app, 'anna', 'pw-anna');
    await t.app.inject({ method: 'POST', url: '/api/logout', headers: { cookie } });
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('lehnt Schreibzugriffe mit fremdem Origin ab (CSRF)', async () => {
    const cookie = await login(t.app, 'chef', 'pw-chef');
    const bad = await t.app.inject({
      method: 'POST', url: '/api/logout', headers: { cookie, origin: 'https://boese.example.org' },
    });
    expect(bad.statusCode).toBe(403);
    const good = await t.app.inject({
      method: 'POST', url: '/api/logout', headers: { cookie, origin: 'http://localhost:5173' },
    });
    expect(good.statusCode).toBe(200);
  });

  it('antwortet 503, wenn LDAP nicht eingerichtet ist', async () => {
    const t2 = await createTestEnv();
    // eigene App ohne Authenticator
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ config: t2.config, db: t2.db, storage: t2.storage, authenticator: null, directory: null });
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'a', password: 'b' } });
    expect(res.statusCode).toBe(503);
    await app.close();
    await t2.close();
  });

  it('validiert die Eingabe', async () => {
    expect((await post('/api/login', { username: 'a' })).statusCode).toBe(400);
    expect((await post('/api/login', { username: '(x)*', password: 'b' })).statusCode).toBe(401);
  });
});
