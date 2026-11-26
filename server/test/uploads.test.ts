import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupExpiredUploads, uploadsDir } from '../src/uploads/tus.js';
import { createTestEnv, login, type TestEnv } from './helpers.js';

const USERS = {
  chef: { password: 'pw' },
  anna: { password: 'pw', name: 'Anna' },
  berta: { password: 'pw', name: 'Berta' },
  neu: { password: 'pw' },
};

let t: TestEnv;
let base: string;
let chef: string;
let anna: string;
let berta: string;

async function start(env: Record<string, string> = {}): Promise<void> {
  t = await createTestEnv({ ADMIN_USERS: 'chef', MIN_FREE_BYTES: '1', ...env }, USERS);
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = t.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  chef = await login(t.app, 'chef', 'pw');
  anna = await login(t.app, 'anna', 'pw');
  berta = await login(t.app, 'berta', 'pw');
  t.db.prepare("UPDATE users SET status = 'approved' WHERE ldap_uid IN ('anna', 'berta')").run();
}

afterEach(() => t.close());

const b64 = (s: string): string => Buffer.from(s).toString('base64');

async function create(cookie: string | null, size: number, filename: string, extra: Record<string, string> = {}) {
  return fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(size),
      'Upload-Metadata': `filename ${b64(filename)},filetype ${b64('application/octet-stream')}`,
      ...(cookie ? { cookie } : {}),
      ...extra,
    },
  });
}

async function patch(cookie: string, location: string, offset: number, body: Buffer) {
  return fetch(`${base}${location}`, {
    method: 'PATCH',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': String(offset),
      'Content-Type': 'application/offset+octet-stream',
      cookie,
    },
    body,
  });
}

const head = (cookie: string, location: string) =>
  fetch(`${base}${location}`, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0', cookie } });

async function uploadAll(cookie: string, data: Buffer, filename: string, chunk = data.length): Promise<string> {
  const res = await create(cookie, data.length, filename);
  expect(res.status).toBe(201);
  const location = res.headers.get('location')!;
  for (let off = 0; off < data.length; off += chunk) {
    const r = await patch(cookie, location, off, data.subarray(off, off + chunk));
    expect(r.status).toBe(204);
  }
  return location.split('/').pop()!;
}

const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
const fileRow = (id: string) => t.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as Record<string, any> | undefined;

describe('Upload (tus)', () => {
  describe('Ablauf', () => {
    beforeEach(() => start());

    it('überträgt in Teilen, übernimmt per rename und verarbeitet im Hintergrund', async () => {
      const data = crypto.randomBytes(300_000);
      const id = await uploadAll(anna, data, 'Lektion 1.bin', 100_000);

      await t.app.processor.idle();
      const row = fileRow(id)!;
      expect(row.status).toBe('ready');
      expect(row.sha256).toBe(sha(data));
      expect(row.name).toBe('Lektion 1.bin');
      expect(row.typ).toBe('other');
      expect(fs.readFileSync(path.join(t.dir, 'data/files', id))).toEqual(data);
      // Zwischenspeicher ist leer, Upload-Eintrag entfernt
      expect(fs.readdirSync(uploadsDir(t.config))).toEqual([]);
      expect(t.db.prepare('SELECT count(*) AS n FROM uploads').get()).toEqual({ n: 0 });

      const list = await t.app.inject({ method: 'GET', url: '/api/files', headers: { cookie: berta } });
      expect(list.json().files[0]).toMatchObject({ id, name: 'Lektion 1.bin', status: 'ready', groesse: 300_000, canDelete: false });
      expect(list.json().files[0].uploadedBy.name).toBe('Anna');
    });

    it('setzt einen unterbrochenen Upload fort', async () => {
      const data = crypto.randomBytes(200_000);
      const res = await create(anna, data.length, 'gross.bin');
      const location = res.headers.get('location')!;
      await patch(anna, location, 0, data.subarray(0, 80_000));

      const h = await head(anna, location);
      expect(h.status).toBe(200);
      expect(h.headers.get('upload-offset')).toBe('80000');

      expect((await patch(anna, location, 80_000, data.subarray(80_000))).status).toBe(204);
      await t.app.processor.idle();
      expect(fileRow(location.split('/').pop()!)!.sha256).toBe(sha(data));
    });

    it('erkennt Duplikate an der Prüfsumme', async () => {
      const data = crypto.randomBytes(50_000);
      const first = await uploadAll(anna, data, 'a.bin');
      const second = await uploadAll(berta, data, 'b.bin');
      await t.app.processor.idle();
      expect(fileRow(second)!.duplicate_of).toBe(first);
      expect(JSON.parse(fileRow(second)!.warnungen)[0]).toMatch(/existiert bereits/);
      expect(fileRow(first)!.duplicate_of).toBeNull();
    });

    it('ordnet Dateien nach Endung ein und bereinigt Pfade im Namen', async () => {
      const id = await uploadAll(anna, Buffer.from('x'), '..\\..\\etc/Film.MP4');
      expect(fileRow(id)!.name).toBe('Film.MP4');
      expect(fileRow(id)!.typ).toBe('video');
    });

    it('verlangt Anmeldung und Freischaltung', async () => {
      expect((await create(null, 10, 'a.bin')).status).toBe(401);
      const neu = await login(t.app, 'neu', 'pw');
      expect((await create(neu, 10, 'a.bin')).status).toBe(403);
    });

    it('erlaubt APK-Uploads nur Admins', async () => {
      const res = await create(anna, 10, 'App.apk');
      expect(res.status).toBe(403);
      const ok = await create(chef, 10, 'App.apk');
      expect(ok.status).toBe(201);
    });

    it('lehnt zu große und leere Uploads sowie fehlende Größe ab', async () => {
      await t.close();
      await start({ MAX_UPLOAD_BYTES: '1000' });
      expect((await create(anna, 1001, 'a.bin')).status).toBe(413);
      expect((await create(anna, 0, 'a.bin')).status).toBe(400);
      const deferred = await fetch(`${base}/api/uploads`, {
        method: 'POST',
        headers: { 'Tus-Resumable': '1.0.0', 'Upload-Defer-Length': '1', cookie: anna },
      });
      expect(deferred.status).toBeGreaterThanOrEqual(400);
      expect(t.db.prepare('SELECT count(*) AS n FROM files').get()).toEqual({ n: 0 });
    });

    it('begrenzt gleichzeitige Uploads je Person', async () => {
      expect((await create(anna, 100, 'a')).status).toBe(201);
      expect((await create(anna, 100, 'b')).status).toBe(201);
      const third = await create(anna, 100, 'c');
      expect(third.status).toBe(429);
      expect((await create(berta, 100, 'd')).status).toBe(201);
    });

    it('verbirgt fremde Uploads, Admins sehen sie', async () => {
      const res = await create(anna, 100, 'a.bin');
      const location = res.headers.get('location')!;
      expect((await head(berta, location)).status).toBe(404);
      expect((await patch(berta, location, 0, Buffer.alloc(100))).status).toBe(404);
      expect((await head(chef, location)).status).toBe(200);
    });

    it('bricht Uploads per DELETE ab und räumt auf', async () => {
      const res = await create(anna, 100, 'a.bin');
      const location = res.headers.get('location')!;
      const id = location.split('/').pop()!;
      await patch(anna, location, 0, Buffer.alloc(40));
      const del = await fetch(`${base}${location}`, { method: 'DELETE', headers: { 'Tus-Resumable': '1.0.0', cookie: anna } });
      expect(del.status).toBe(204);
      expect(fileRow(id)).toBeUndefined();
      expect(t.db.prepare('SELECT count(*) AS n FROM uploads').get()).toEqual({ n: 0 });
      expect(fs.readdirSync(uploadsDir(t.config))).toEqual([]);
    });

    it('entfernt abgelaufene Uploads', async () => {
      const res = await create(anna, 100, 'a.bin');
      const id = res.headers.get('location')!.split('/').pop()!;
      t.db.prepare("UPDATE uploads SET expires_at = '2000-01-01T00:00:00.000Z'").run();
      expect(cleanupExpiredUploads(t.db, uploadsDir(t.config))).toBe(1);
      expect(fileRow(id)).toBeUndefined();
      expect(fs.readdirSync(uploadsDir(t.config))).toEqual([]);
    });

    it('lehnt Schreibzugriffe mit fremdem Origin ab', async () => {
      const res = await create(anna, 100, 'a.bin', { Origin: 'https://boese.example.org' });
      expect(res.status).toBe(403);
    });

    it('nimmt unterbrochene Nachverarbeitung nach einem Neustart wieder auf', async () => {
      const data = crypto.randomBytes(1000);
      const id = await uploadAll(anna, data, 'a.bin');
      await t.app.processor.idle();
      t.db.prepare("UPDATE files SET status = 'processing', sha256 = NULL WHERE id = ?").run(id);
      expect(t.app.processor.recover()).toBe(1);
      await t.app.processor.idle();
      expect(fileRow(id)!.status).toBe('ready');
      expect(fileRow(id)!.sha256).toBe(sha(data));
    });

    it('markiert Dateien mit abweichender Größe als fehlerhaft', async () => {
      const id = await uploadAll(anna, crypto.randomBytes(500), 'a.bin');
      await t.app.processor.idle();
      fs.appendFileSync(path.join(t.dir, 'data/files', id), 'mehr');
      t.db.prepare("UPDATE files SET status = 'processing' WHERE id = ?").run(id);
      t.app.processor.enqueue(id);
      await t.app.processor.idle();
      expect(fileRow(id)!.status).toBe('failed');
    });
  });

  describe('Kontingent und Speicherplatz', () => {
    it('lehnt Uploads über dem Kontingent der Person ab', async () => {
      await start({ DEFAULT_QUOTA_BYTES: '1000' });
      expect((await create(anna, 600, 'a')).status).toBe(201);
      expect((await create(anna, 600, 'b')).status).toBe(413);
      // eigenes Kontingent pro Person
      t.db.prepare("UPDATE users SET quota_bytes = 100000 WHERE ldap_uid = 'anna'").run();
      expect((await create(anna, 600, 'c')).status).toBe(201);
    });

    it('lehnt Uploads ab, wenn der freie Platz nicht reicht', async () => {
      await start({ MIN_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) });
      const res = await create(anna, 100, 'a');
      expect(res.status).toBe(507);
      expect(t.db.prepare('SELECT count(*) AS n FROM files').get()).toEqual({ n: 0 });
    });

    it('meldet Speicherbelegung', async () => {
      await start({ DEFAULT_QUOTA_BYTES: '5000' });
      await uploadAll(anna, Buffer.alloc(1200, 1), 'a.bin');
      const res = await t.app.inject({ method: 'GET', url: '/api/storage', headers: { cookie: anna } });
      expect(res.json()).toMatchObject({ usedBytes: 1200, totalBytes: 1200, quotaBytes: 5000 });
      expect(res.json().freeBytes).toBeGreaterThan(0);
    });
  });

  describe('Dateien löschen', () => {
    beforeEach(() => start());

    it('erlaubt Besitzer und Admin, nicht anderen Personen', async () => {
      const id = await uploadAll(anna, Buffer.from('daten'), 'a.bin');
      await t.app.processor.idle();
      const del = (cookie: string) => t.app.inject({ method: 'DELETE', url: `/api/files/${id}`, headers: { cookie } });
      expect((await del(berta)).statusCode).toBe(403);
      expect((await del(anna)).statusCode).toBe(200);
      expect(fileRow(id)).toBeUndefined();
      expect(fs.existsSync(path.join(t.dir, 'data/files', id))).toBe(false);
      expect((await del(anna)).statusCode).toBe(404);

      const id2 = await uploadAll(anna, Buffer.from('mehr'), 'b.bin');
      await t.app.processor.idle();
      expect((await t.app.inject({ method: 'DELETE', url: `/api/files/${id2}`, headers: { cookie: chef } })).statusCode).toBe(200);
    });

    it('verweigert das Löschen bei offenen Aufträgen und behält die Historie sonst', async () => {
      const id = await uploadAll(anna, Buffer.from('daten'), 'a.bin');
      await t.app.processor.idle();
      t.db.prepare("INSERT INTO devices (name, token_hash) VALUES ('Brille 01', 'h')").run();
      t.db.prepare("INSERT INTO transfers (file_id, file_name, device_id, status) VALUES (?, 'a.bin', 1, 'pending')").run(id);
      const blocked = await t.app.inject({ method: 'DELETE', url: `/api/files/${id}`, headers: { cookie: anna } });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toMatchObject({ error: 'open_transfers', count: 1 });

      t.db.prepare("UPDATE transfers SET status = 'done'").run();
      expect((await t.app.inject({ method: 'DELETE', url: `/api/files/${id}`, headers: { cookie: anna } })).statusCode).toBe(200);
      expect(t.db.prepare('SELECT file_id, file_name FROM transfers').get()).toEqual({ file_id: null, file_name: 'a.bin' });
    });

    it('verweigert das Löschen laufender Uploads über die Dateien-API', async () => {
      const res = await create(anna, 100, 'a.bin');
      const id = res.headers.get('location')!.split('/').pop()!;
      expect((await t.app.inject({ method: 'DELETE', url: `/api/files/${id}`, headers: { cookie: anna } })).statusCode).toBe(409);
    });
  });

  describe('Videoprüfung (ffprobe)', () => {
    let hasFfmpeg = true;
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    } catch {
      hasFfmpeg = false;
    }

    const makeVideo = (codec: string, size: string): Buffer => {
      const out = path.join(t.dir, `test-${codec}.mp4`);
      execFileSync(
        'ffmpeg',
        ['-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10`, '-t', '1', '-c:v', codec, '-pix_fmt', 'yuv420p', out],
        { stdio: 'ignore' },
      );
      return fs.readFileSync(out);
    };

    it.skipIf(!hasFfmpeg)('liest Format aus und warnt bei ungeeignetem Codec', async () => {
      await start();
      const good = await uploadAll(anna, makeVideo('libx264', '320x240'), 'gut.mp4');
      const bad = await uploadAll(anna, makeVideo('mpeg4', '320x240'), 'schlecht.mp4');
      await t.app.processor.idle();

      expect(JSON.parse(fileRow(good)!.meta)).toMatchObject({ codec: 'h264', width: 320, height: 240 });
      expect(JSON.parse(fileRow(good)!.warnungen)).toEqual([]);
      expect(JSON.parse(fileRow(bad)!.meta).codec).toBe('mpeg4');
      expect(JSON.parse(fileRow(bad)!.warnungen)[0]).toMatch(/Codec „mpeg4“/);
    });

    it.skipIf(!hasFfmpeg)('warnt, wenn die Datei kein Video ist', async () => {
      await start();
      const id = await uploadAll(anna, Buffer.from('kein video'), 'kaputt.mp4');
      await t.app.processor.idle();
      expect(fileRow(id)!.status).toBe('ready');
      expect(JSON.parse(fileRow(id)!.warnungen)[0]).toMatch(/nicht als Video lesen/);
    });

    it('prüft ohne ffprobe nicht, sondern weist darauf hin', async () => {
      await start({ FFPROBE_PATH: '/gibt/es/nicht/ffprobe' });
      const id = await uploadAll(anna, Buffer.from('x'), 'a.mp4');
      await t.app.processor.idle();
      expect(fileRow(id)!.status).toBe('ready');
      expect(JSON.parse(fileRow(id)!.warnungen)[0]).toMatch(/nicht gefunden/);
    });
  });
});
