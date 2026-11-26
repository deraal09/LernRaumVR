import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3-multiple-ciphers';

export type Db = Database.Database;

const here = path.dirname(fileURLToPath(import.meta.url));
/** Gilt für `src/db` und `dist/db` gleichermaßen (beide zwei Ebenen unter `server/`). */
export const MIGRATIONS_DIR = path.resolve(here, '../../migrations');

/** Schlüssel als SQL-Literal; einfache Anführungszeichen werden verdoppelt. */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Öffnet die verschlüsselte SQLite-Datenbank (SQLCipher-kompatibel, wie noten_webapp)
 * und wirft, wenn der Schlüssel nicht passt.
 */
export function openDatabase(dbPath: string, encryptionKey: string): Db {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    // In-Memory-Datenbanken (nur Tests) unterstützen keine Verschlüsselung.
    if (dbPath !== ':memory:') {
      db.pragma("cipher='sqlcipher'");
      db.pragma(`key=${sqlLiteral(encryptionKey)}`);
    }
    // Erster Zugriff entschlüsselt die Datei; bei falschem Schlüssel schlägt er fehl.
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  } catch (err) {
    db.close();
    throw new Error(
      'Datenbank lässt sich nicht öffnen: falscher Schlüssel (DB_ENCRYPTION_KEY) oder beschädigte Datei.',
      { cause: err },
    );
  }
  return db;
}

export interface MigrationResult {
  applied: string[];
}

/**
 * Führt alle noch nicht angewendeten `NNN_name.sql`-Dateien in Reihenfolge aus,
 * jede in einer eigenen Transaktion.
 */
export function runMigrations(db: Db, dir: string = MIGRATIONS_DIR): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const done = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => (r as { name: string }).name),
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    })();
    applied.push(file);
  }
  return { applied };
}
