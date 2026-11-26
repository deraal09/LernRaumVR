import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addReadyFile, createTestEnv, login, pairDevice, type TestEnv } from './helpers.js';

const USERS = { chef: { password: 'pw' }, anna: { password: 'pw', name: 'Anna' }, berta: { password: 'pw' } };

let t: TestEnv;
let chef: string;
let anna: string;
let berta: string;

async function start(env: Record<string, string> = {}): Promise<void> {
  t = await createTestEnv({ ADMIN_USERS: 'chef', ...env }, USERS);
  chef = await login(t.app, 'chef', 'pw');
  anna = await login(t.app, 'anna', 'pw');
  berta = await login(t.app, 'berta', 'pw');
  t.db.prepare("UPDATE users SET status = 'approved' WHERE ldap_uid IN ('anna', 'berta')").run();
}
afterEach(() => t.close());

const json = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  t.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe('Kopplung', () => {
  beforeEach(() => start());

  it('koppelt eine Brille: Code, Bestätigung durch Admin, Token einmalig', async () => {
    const p = (await t.app.inject({ method: 'POST', url: '/api/pairing', payload: { appVersion: '0.1.0' } })).json();
    expect(p.code).toMatch(/^\d{6}$/);
    expect(p.pollSecret.length).toBeGreaterThan(20);

    const poll = (secret = p.pollSecret) =>
      t.app.inject({ method: 'GET', url: `/api/pairing/${p.pairingId}`, headers: { 'x-poll-secret': secret } });
    expect((await poll()).json()).toEqual({ status: 'pending' });
    // falsches Geheimnis: wie unbekannt
    expect((await poll('falsch')).statusCode).toBe(404);

    // Nur Admins bestätigen
    expect((await json('POST', '/api/devices/confirm', { cookie: anna }, { code: p.code })).statusCode).toBe(403);
    const conf = await json('POST', '/api/devices/confirm', { cookie: chef }, { code: p.code });
    expect(conf.statusCode).toBe(201);
    expect(conf.json().device.name).toBe('Brille 01');

    const done = (await poll()).json();
    expect(done.status).toBe('confirmed');
    expect(done.token).toMatch(/^lrv_/);

    // Der Token wird nicht im Klartext gespeichert
    const row = t.db.prepare('SELECT token_hash FROM devices').get() as { token_hash: string };
    expect(row.token_hash).toBe(crypto.createHash('sha256').update(done.token).digest('hex'));

    // Erster Einsatz des Tokens schließt die Kopplung ab; danach gibt es keinen Token mehr
    const me = await t.app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: { authorization: `Bearer ${done.token}` }, payload: {} });
    expect(me.statusCode).toBe(200);
    expect((await poll()).statusCode).toBe(410);
  });

  it('gibt den Token erneut aus, solange er nie benutzt wurde (verlorene Antwort)', async () => {
    const p = (await t.app.inject({ method: 'POST', url: '/api/pairing', payload: {} })).json();
    await json('POST', '/api/devices/confirm', { cookie: chef }, { code: p.code });
    const poll = () => t.app.inject({ method: 'GET', url: `/api/pairing/${p.pairingId}`, headers: { 'x-poll-secret': p.pollSecret } });
    const first = (await poll()).json();
    const second = (await poll()).json();
    expect(second.token).not.toBe(first.token);
    // Der erste Token ist damit ungültig
    expect((await t.app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: { authorization: `Bearer ${first.token}` }, payload: {} })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: { authorization: `Bearer ${second.token}` }, payload: {} })).statusCode).toBe(200);
  });

  it('lehnt unbekannte, abgelaufene und doppelte Codes ab', async () => {
    expect((await json('POST', '/api/devices/confirm', { cookie: chef }, { code: '123456' })).statusCode).toBe(404);
    expect((await json('POST', '/api/devices/confirm', { cookie: chef }, { code: 'abc' })).statusCode).toBe(400);
    const p = (await t.app.inject({ method: 'POST', url: '/api/pairing', payload: {} })).json();
    t.db.prepare("UPDATE pairings SET expires_at = datetime('now', '-1 minute')").run();
    expect((await json('POST', '/api/devices/confirm', { cookie: chef }, { code: p.code })).statusCode).toBe(404);
    const poll = await t.app.inject({ method: 'GET', url: `/api/pairing/${p.pairingId}`, headers: { 'x-poll-secret': p.pollSecret } });
    expect(poll.statusCode).toBe(410);
  });

  it('vergibt fortlaufende Namen und verhindert doppelte', async () => {
    const a = await pairDevice(t, chef);
    const b = await pairDevice(t, chef);
    const c = await pairDevice(t, chef, 'Reihe A 3');
    expect([a.name, b.name, c.name]).toEqual(['Brille 01', 'Brille 02', 'Reihe A 3']);
    const p = (await t.app.inject({ method: 'POST', url: '/api/pairing', payload: {} })).json();
    expect((await json('POST', '/api/devices/confirm', { cookie: chef }, { code: p.code, name: 'brille 01' })).statusCode).toBe(409);
    expect((await json('PATCH', `/api/devices/${b.id}`, { cookie: chef }, { name: 'Brille 01' })).statusCode).toBe(409);
    expect((await json('PATCH', `/api/devices/${b.id}`, { cookie: chef }, { name: 'Neu' })).statusCode).toBe(200);
  });

  it('listet Brillen mit Status für alle Freigeschalteten', async () => {
    const d = await pairDevice(t, chef);
    await t.app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: d.auth, payload: { freeBytes: 5_000_000_000, batteryPercent: 80, appVersion: '0.2.0' } });
    const list = (await json('GET', '/api/devices', { cookie: berta })).json().devices;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: d.id, online: true, freeBytes: 5_000_000_000, batteryPercent: 80, appVersion: '0.2.0', openTransfers: 0 });
    t.db.prepare("UPDATE devices SET last_seen_at = datetime('now', '-10 minutes')").run();
    expect((await json('GET', '/api/devices', { cookie: berta })).json().devices[0].online).toBe(false);
  });

  it('sperrt Brillen: Token ungültig, Aufträge abgebrochen', async () => {
    const d = await pairDevice(t, chef);
    const file = addReadyFile(t, Buffer.from('x'));
    await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: [d.id] });
    const del = await json('DELETE', `/api/devices/${d.id}`, { cookie: chef });
    expect(del.json()).toMatchObject({ ok: true, cancelled: 1 });
    expect((await t.app.inject({ method: 'GET', url: '/api/device/transfers', headers: d.auth })).statusCode).toBe(401);
    expect((await json('GET', '/api/devices', { cookie: anna })).json().devices).toEqual([]);
  });

  it('verlangt Token für Brillen-Routen', async () => {
    for (const url of ['/api/device/transfers', '/api/device/files/abc']) {
      expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await t.app.inject({ method: 'GET', url, headers: { authorization: 'Bearer lrv_falschfalschfalschfalsch' } })).statusCode).toBe(401);
    }
  });
});

describe('Aufträge', () => {
  beforeEach(() => start({ MAX_PARALLEL_DOWNLOADS: '2' }));

  const transfersOf = async (d: { auth: { authorization: string } }, known = '') =>
    (await t.app.inject({ method: 'GET', url: `/api/device/transfers${known ? `?known=${known}` : ''}`, headers: d.auth })).json();

  it('legt Aufträge an und überspringt Brillen mit offenem Auftrag, unbekannte und volle', async () => {
    const [d1, d2, d3] = [await pairDevice(t, chef), await pairDevice(t, chef), await pairDevice(t, chef)];
    const file = addReadyFile(t, Buffer.alloc(1000));
    await t.app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: d3.auth, payload: { freeBytes: 10 } });

    const res = await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: [d1.id, d2.id, d3.id, 999] });
    expect(res.statusCode).toBe(201);
    expect(res.json().created).toBe(2);
    expect(res.json().skipped).toEqual([
      { deviceId: d3.id, reason: 'no_space' },
      { deviceId: 999, reason: 'unknown_device' },
    ]);
    const again = await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: [d1.id] });
    expect(again.json().skipped).toEqual([{ deviceId: d1.id, reason: 'already_queued' }]);
  });

  it('prüft Datei und Berechtigung', async () => {
    const d = await pairDevice(t, chef);
    const body = { fileId: 'gibtesnicht', deviceIds: [d.id] };
    expect((await json('POST', '/api/transfers', { cookie: anna }, body)).statusCode).toBe(404);
    const f = addReadyFile(t, Buffer.from('x'));
    t.db.prepare("UPDATE files SET status = 'processing' WHERE id = ?").run(f);
    expect((await json('POST', '/api/transfers', { cookie: anna }, { fileId: f, deviceIds: [d.id] })).statusCode).toBe(409);
    expect((await t.app.inject({ method: 'POST', url: '/api/transfers', payload: body })).statusCode).toBe(401);
    expect((await json('POST', '/api/transfers', { cookie: anna }, { fileId: f, deviceIds: [] })).statusCode).toBe(400);
  });

  it('begrenzt gleichzeitige Downloads (Slots) und gibt sie nach Abschluss weiter', async () => {
    const devs = [await pairDevice(t, chef), await pairDevice(t, chef), await pairDevice(t, chef)];
    const file = addReadyFile(t, Buffer.from('inhalt'));
    await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: devs.map((d) => d.id) });

    const r = [await transfersOf(devs[0]!), await transfersOf(devs[1]!), await transfersOf(devs[2]!)];
    expect(r[0].transfers).toHaveLength(1);
    expect(r[1].transfers).toHaveLength(1);
    expect(r[2].transfers).toHaveLength(0); // wartet in der Warteschlange
    const queued = (await json('GET', '/api/transfers', { cookie: anna })).json().transfers.filter((x: { queued: boolean }) => x.queued);
    expect(queued).toHaveLength(1);
    expect(queued[0].deviceName).toBe('Brille 03');

    // Brille 1 meldet Abschluss -> Slot wird für Brille 3 frei
    const id = r[0].transfers[0].id;
    for (const status of ['downloading', 'verified', 'done']) {
      const p = await t.app.inject({ method: 'PATCH', url: `/api/device/transfers/${id}`, headers: devs[0]!.auth, payload: { status, bytesDone: 6 } });
      expect(p.statusCode).toBe(200);
    }
    expect((await transfersOf(devs[2]!)).transfers).toHaveLength(1);
    expect((await transfersOf(devs[0]!)).transfers).toHaveLength(0);
  });

  it('gibt Slots von Brillen zurück, die sich nicht mehr melden', async () => {
    const devs = [await pairDevice(t, chef), await pairDevice(t, chef), await pairDevice(t, chef)];
    const file = addReadyFile(t, Buffer.from('x'));
    await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: devs.map((d) => d.id) });
    await transfersOf(devs[0]!);
    await transfersOf(devs[1]!);
    expect((await transfersOf(devs[2]!)).transfers).toHaveLength(0);
    t.db.prepare("UPDATE transfers SET updated_at = datetime('now', '-11 minutes') WHERE device_id = ?").run(devs[0]!.id);
    expect((await transfersOf(devs[2]!)).transfers).toHaveLength(1);
    // Brille 1 ist wieder wartend
    expect((await transfersOf(devs[0]!)).transfers).toHaveLength(0);
  });

  it('gibt Dateiangaben für die Brille aus und erzwingt zulässige Statusübergänge', async () => {
    const d = await pairDevice(t, chef);
    const file = addReadyFile(t, Buffer.from('inhalt'), 'Lektion.mp4');
    await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: [d.id] });
    const [tr] = (await transfersOf(d)).transfers;
    expect(tr).toMatchObject({ kind: 'send', status: 'pending', bytesDone: 0 });
    expect(tr.file).toMatchObject({ id: file, name: 'Lektion.mp4', typ: 'video', size: 6, downloadUrl: `/api/device/files/${file}` });
    expect(tr.file.sha256).toHaveLength(64);

    const patch = (status: string, extra: object = {}) =>
      t.app.inject({ method: 'PATCH', url: `/api/device/transfers/${tr.id}`, headers: d.auth, payload: { status, ...extra } });
    expect((await patch('done')).statusCode).toBe(409); // nicht direkt von wartend zu fertig
    expect((await patch('installed')).statusCode).toBe(409);
    expect((await patch('downloading', { bytesDone: 3 })).statusCode).toBe(200);
    expect((await patch('downloading', { bytesDone: 5 })).statusCode).toBe(200);
    expect((await patch('bogus')).statusCode).toBe(400);
    expect((await patch('failed', { errorCode: 'HASH_MISMATCH', errorText: 'Prüfsumme falsch' })).statusCode).toBe(200);
    expect((await patch('downloading')).statusCode).toBe(409); // abgeschlossen

    const shown = (await json('GET', '/api/transfers?status=all', { cookie: anna })).json().transfers[0];
    expect(shown).toMatchObject({ status: 'failed', errorCode: 'HASH_MISMATCH', bytesDone: 5, createdBy: 'Anna' });

    // Wiederholen
    expect((await json('POST', `/api/transfers/${tr.id}/retry`, { cookie: berta })).statusCode).toBe(403);
    expect((await json('POST', `/api/transfers/${tr.id}/retry`, { cookie: anna })).statusCode).toBe(200);
    expect((await transfersOf(d)).transfers[0].status).toBe('pending');
  });

  it('bricht Aufträge ab und teilt es der Brille über „known“ mit', async () => {
    const d = await pairDevice(t, chef);
    const file = addReadyFile(t, Buffer.from('x'));
    await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: [d.id] });
    const [tr] = (await transfersOf(d)).transfers;
    await t.app.inject({ method: 'PATCH', url: `/api/device/transfers/${tr.id}`, headers: d.auth, payload: { status: 'downloading' } });

    expect((await json('POST', `/api/transfers/${tr.id}/cancel`, { cookie: berta })).statusCode).toBe(403);
    expect((await json('POST', `/api/transfers/${tr.id}/cancel`, { cookie: anna })).json()).toEqual({ cancelled: 1 });
    const after = await transfersOf(d, String(tr.id));
    expect(after.transfers).toEqual([]);
    expect(after.cancelled).toEqual([tr.id]);
    const patch = await t.app.inject({ method: 'PATCH', url: `/api/device/transfers/${tr.id}`, headers: d.auth, payload: { status: 'downloading', bytesDone: 1 } });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error).toBe('cancelled');
  });

  it('bricht ganze Sendungen ab (Admin alle, andere nur eigene)', async () => {
    const devs = [await pairDevice(t, chef), await pairDevice(t, chef)];
    const file = addReadyFile(t, Buffer.from('x'));
    const { batchId } = (await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: devs.map((d) => d.id) })).json();
    expect((await json('POST', `/api/batches/${batchId}/cancel`, { cookie: berta })).json()).toEqual({ cancelled: 0 });
    expect((await json('POST', `/api/batches/${batchId}/cancel`, { cookie: chef })).json()).toEqual({ cancelled: 2 });
  });

  it('meldet Aufträge gelöschter Dateien als abgebrochen', async () => {
    const d = await pairDevice(t, chef);
    const file = addReadyFile(t, Buffer.from('x'));
    await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: [d.id] });
    const [tr] = (await transfersOf(d)).transfers;
    t.db.prepare("UPDATE transfers SET status = 'done'").run();
    t.db.prepare('DELETE FROM transfers').run();
    expect((await transfersOf(d, String(tr.id))).cancelled).toEqual([tr.id]);
  });
});

describe('Download', () => {
  const content = crypto.randomBytes(10_000);
  let d: Awaited<ReturnType<typeof pairDevice>>;
  let file: string;

  beforeEach(async () => {
    await start();
    d = await pairDevice(t, chef);
    file = addReadyFile(t, content);
    await json('POST', '/api/transfers', { cookie: anna }, { fileId: file, deviceIds: [d.id] });
    await t.app.inject({ method: 'GET', url: '/api/device/transfers', headers: d.auth }); // Slot vergeben
  });

  const get = (headers: Record<string, string> = {}, method: 'GET' | 'HEAD' = 'GET') =>
    t.app.inject({ method, url: `/api/device/files/${file}`, headers: { ...d.auth, ...headers } });

  it('liefert die ganze Datei mit ETag und Range-Unterstützung', async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(content)).toBe(true);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['etag']).toBe(`"${crypto.createHash('sha256').update(content).digest('hex')}"`);
    expect(res.headers['content-length']).toBe('10000');
  });

  it('liefert Teilbereiche (Fortsetzen)', async () => {
    const part = await get({ range: 'bytes=9000-' });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 9000-9999/10000');
    expect(part.rawPayload.equals(content.subarray(9000))).toBe(true);

    const mid = await get({ range: 'bytes=100-199' });
    expect(mid.rawPayload.equals(content.subarray(100, 200))).toBe(true);

    const suffix = await get({ range: 'bytes=-50' });
    expect(suffix.headers['content-range']).toBe('bytes 9950-9999/10000');
    expect(suffix.rawPayload.equals(content.subarray(9950))).toBe(true);

    // Ende über die Dateigröße hinaus wird gekürzt
    expect((await get({ range: 'bytes=9990-99999' })).headers['content-range']).toBe('bytes 9990-9999/10000');
  });

  it('antwortet 416 bei nicht erfüllbaren Bereichen', async () => {
    const res = await get({ range: 'bytes=20000-' });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */10000');
  });

  it('beantwortet HEAD ohne Inhalt', async () => {
    const res = await get({}, 'HEAD');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe('10000');
    expect(res.rawPayload.length).toBe(0);
  });

  it('liefert nur an die Brille mit freigegebenem Auftrag', async () => {
    const other = await pairDevice(t, chef);
    expect((await t.app.inject({ method: 'GET', url: `/api/device/files/${file}`, headers: other.auth })).statusCode).toBe(404);
    // Nach Abbruch des Auftrags ist der Download gesperrt
    await json('POST', '/api/batches/x/cancel', { cookie: chef });
    t.db.prepare("UPDATE transfers SET status = 'cancelled'").run();
    expect((await get()).statusCode).toBe(404);
  });

  it('verlangt einen freigegebenen Slot', async () => {
    t.db.prepare('UPDATE transfers SET released_at = NULL').run();
    expect((await get()).statusCode).toBe(404);
  });
});
