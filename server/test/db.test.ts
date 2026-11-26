import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../src/db/index.js';
import { removeDir, tempDir } from './helpers.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});
const tmp = (): string => {
  const d = tempDir();
  dirs.push(d);
  return d;
};

describe('Datenbank', () => {
  it('wendet Migrationen an und ist beim zweiten Lauf idempotent', () => {
    const db = openDatabase(':memory:', 'testschluessel');
    const first = runMigrations(db);
    expect(first.applied).toEqual(['001_init.sql']);
    expect(runMigrations(db).applied).toEqual([]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ['users', 'files', 'uploads', 'devices', 'device_groups', 'policies', 'pairings', 'transfers', 'audit_log']) {
      expect(tables).toContain(t);
    }
    db.close();
  });

  it('verschlüsselt die Datei und lehnt falsche Schlüssel ab', () => {
    const file = path.join(tmp(), 'test.sqlite3');
    const db = openDatabase(file, 'richtiger-schluessel');
    runMigrations(db);
    db.prepare("INSERT INTO users (ldap_uid) VALUES ('Geheim-Benutzer')").run();
    db.close();

    // Kein Klartext in der Datei (SQLite-Kopfzeile und Inhalt sind verschlüsselt).
    const raw = fs.readFileSync(file);
    expect(raw.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    expect(raw.includes(Buffer.from('Geheim-Benutzer'))).toBe(false);

    expect(() => openDatabase(file, 'falscher-schluessel')).toThrow(/Schlüssel/);

    const again = openDatabase(file, 'richtiger-schluessel');
    expect(again.prepare('SELECT ldap_uid FROM users').get()).toEqual({ ldap_uid: 'Geheim-Benutzer' });
    again.close();
  });

  it('erzwingt Wertebereiche und Fremdschlüssel', () => {
    const db = openDatabase(':memory:', 'k');
    runMigrations(db);
    expect(() => db.prepare("INSERT INTO users (ldap_uid, status) VALUES ('a', 'x')").run()).toThrow();
    expect(() =>
      db.prepare("INSERT INTO transfers (device_id, kind) VALUES (999, 'send')").run(),
    ).toThrow(/FOREIGN KEY/);
    // ldap_uid ist unabhängig von der Groß-/Kleinschreibung eindeutig
    db.prepare("INSERT INTO users (ldap_uid) VALUES ('Anna')").run();
    expect(() => db.prepare("INSERT INTO users (ldap_uid) VALUES ('anna')").run()).toThrow(/UNIQUE/);
    db.close();
  });

  it('erlaubt je Brille/Gruppe genau eine Richtlinie', () => {
    const db = openDatabase(':memory:', 'k');
    runMigrations(db);
    db.prepare("INSERT INTO policies (name) VALUES ('p')").run();
    expect(() => db.prepare('INSERT INTO device_policy (policy_id) VALUES (1)').run()).toThrow();
    db.close();
  });
});
