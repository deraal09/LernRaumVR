import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { NotInGroupError, type Authenticator, type DirectoryIdentity, type DirectorySearch } from '../src/auth/types.js';
import { loadConfig, type Config } from '../src/config.js';
import { openDatabase, runMigrations, type Db } from '../src/db/index.js';
import { LocalStorage } from '../src/storage/local.js';

export function tempDir(prefix = 'lernraumvr-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export interface FakeUser {
  password: string;
  name?: string;
  inGroup?: boolean;
}

/** Ersatz für das Active Directory. */
export class FakeAuthenticator implements Authenticator, DirectorySearch {
  calls = 0;
  constructor(public users: Record<string, FakeUser>) {}

  async authenticate(username: string, password: string): Promise<DirectoryIdentity | null> {
    this.calls += 1;
    const u = this.users[username];
    if (!u || u.password !== password) return null;
    if (u.inGroup === false) throw new NotInGroupError('AAD-LUL');
    return u.name !== undefined ? { loginSub: username, name: u.name } : { loginSub: username };
  }

  async search(query: string) {
    return Object.entries(this.users)
      .filter(([k, u]) => k.includes(query) || (u.name ?? '').includes(query))
      .map(([k, u]) => ({ dn: `CN=${k}`, loginSub: k, name: u.name }));
  }
}

export interface TestEnv {
  app: FastifyInstance;
  db: Db;
  dir: string;
  config: Config;
  storage: LocalStorage;
  ldap: FakeAuthenticator;
  close(): Promise<void>;
}

export async function createTestEnv(
  env: Record<string, string> = {},
  users: Record<string, FakeUser> = {},
): Promise<TestEnv> {
  const dir = tempDir();
  const config = loadConfig(
    { NODE_ENV: 'test', WEB_DIST: `${dir}/gibt-es-nicht`, DATA_DIR: `${dir}/data`, ...env },
    dir,
  );
  const db = openDatabase(':memory:', config.dbEncryptionKey);
  runMigrations(db);
  const storage = new LocalStorage(`${dir}/data/files`);
  const ldap = new FakeAuthenticator(users);
  const app = await buildApp({ config, db, storage, authenticator: ldap, directory: ldap });
  return {
    app,
    db,
    dir,
    config,
    storage,
    ldap,
    async close() {
      // Der tus-FileStore legt sein Verzeichnis asynchron an; nicht aufräumen, bevor das fertig ist.
      await app.ready();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await app.close();
      db.close();
      removeDir(dir);
    },
  };
}

/** Meldet an und liefert den Cookie-Header für Folgeanfragen. */
export async function login(app: FastifyInstance, username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
  const cookie = res.cookies.find((c) => c.name === 'lrvr_session');
  if (!cookie) throw new Error(`Login fehlgeschlagen: ${res.statusCode} ${res.body}`);
  return `lrvr_session=${cookie.value}`;
}

export interface PairedDevice {
  id: number;
  name: string;
  token: string;
  auth: { authorization: string };
}

/** Koppelt eine Brille über die echten Endpunkte (Code anfordern, bestätigen, Token abholen). */
export async function pairDevice(t: TestEnv, adminCookie: string, name?: string): Promise<PairedDevice> {
  const p = await t.app.inject({ method: 'POST', url: '/api/pairing', payload: { model: 'G2 4K', androidVersion: '8.1.0', appVersion: '0.1.0' } });
  if (p.statusCode !== 201) throw new Error(`pairing: ${p.statusCode} ${p.body}`);
  const { pairingId, code, pollSecret } = p.json();
  const c = await t.app.inject({
    method: 'POST', url: '/api/devices/confirm', headers: { cookie: adminCookie },
    payload: name ? { code, name } : { code },
  });
  if (c.statusCode !== 201) throw new Error(`confirm: ${c.statusCode} ${c.body}`);
  const poll = await t.app.inject({ method: 'GET', url: `/api/pairing/${pairingId}`, headers: { 'x-poll-secret': pollSecret } });
  const body = poll.json();
  if (body.status !== 'confirmed') throw new Error(`poll: ${poll.body}`);
  return { id: body.deviceId, name: body.name, token: body.token, auth: { authorization: `Bearer ${body.token}` } };
}

/** Legt eine fertig verarbeitete Datei direkt in Speicher und Datenbank ab. */
export function addReadyFile(t: TestEnv, content: Buffer, name = 'film.mp4', uploadedBy = 1): string {
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(t.dir, 'data/files', id), content);
  t.db
    .prepare(
      `INSERT INTO files (id, name, original_name, typ, groesse, sha256, status, storage_key, uploaded_by)
       VALUES (?, ?, ?, 'video', ?, ?, 'ready', ?, ?)`,
    )
    .run(id, name, name, content.length, crypto.createHash('sha256').update(content).digest('hex'), id, uploadedBy);
  return id;
}
