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
