import path from 'node:path';

export interface Config {
  nodeEnv: string;
  /** Zahl (TCP-Port) oder Pfad eines Unix-Sockets (Plesk/Passenger). */
  port: number | string;
  dataDir: string;
  dbPath: string;
  dbEncryptionKey: string;
  secret: string;
  publicUrl: string;
  /** LDAP-Benutzernamen der Admins, klein geschrieben. */
  adminUsers: string[];
  maxUploadBytes: number;
  minFreeBytes: number;
  maxParallelDownloads: number;
  uploadExpiryHours: number;
  /** Verzeichnis mit der gebauten Weboberfläche (optional). */
  webDist: string;
}

const GB = 1024 ** 3;
// Nur in der Testsuite gilt ein fester Ersatzschlüssel. Er ist bewusst an NODE_ENV=test
// gebunden, damit eine vergessene Variable auf dem Server nie still mit einem
// im Quelltext stehenden Schlüssel läuft (wie bei noten_webapp).
const TEST_KEY = 'nur-fuer-die-testsuite-niemals-fuer-echte-daten';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new ConfigError(`${name} muss eine positive ganze Zahl sein (war: "${raw}")`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, baseDir = process.cwd()): Config {
  const nodeEnv = env['NODE_ENV'] ?? 'development';

  const dbEncryptionKey = env['DB_ENCRYPTION_KEY'] || (nodeEnv === 'test' ? TEST_KEY : '');
  if (!dbEncryptionKey) {
    throw new ConfigError(
      'DB_ENCRYPTION_KEY ist nicht gesetzt. Erzeugen mit: openssl rand -hex 32. ' +
        'Den Schlüssel getrennt von Backups sichern, ohne ihn ist die Datenbank unlesbar.',
    );
  }
  if (nodeEnv !== 'test' && dbEncryptionKey.length < 32) {
    throw new ConfigError('DB_ENCRYPTION_KEY ist zu kurz (mindestens 32 Zeichen).');
  }

  const secret = env['SECRET'] || (nodeEnv === 'test' ? 'test-secret-test-secret-test-secret!' : '');
  if (!secret) {
    throw new ConfigError('SECRET ist nicht gesetzt. Erzeugen mit: openssl rand -hex 32.');
  }
  if (nodeEnv !== 'test' && secret.length < 32) {
    throw new ConfigError('SECRET ist zu kurz (mindestens 32 Zeichen).');
  }

  const dataDir = path.resolve(baseDir, env['DATA_DIR'] ?? './data');
  const rawPort = env['PORT'];
  const port: number | string =
    rawPort === undefined || rawPort === '' ? 3001 : /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort;

  return {
    nodeEnv,
    port,
    dataDir,
    dbPath: path.resolve(baseDir, env['DB_PFAD'] ?? path.join(dataDir, 'lernraumvr.sqlite3')),
    dbEncryptionKey,
    secret,
    publicUrl: (env['PUBLIC_URL'] ?? 'http://localhost:3001').replace(/\/+$/, ''),
    adminUsers: (env['ADMIN_USERS'] ?? '')
      .split(',')
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean),
    maxUploadBytes: positiveInt(env, 'MAX_UPLOAD_BYTES', 10 * GB),
    minFreeBytes: positiveInt(env, 'MIN_FREE_BYTES', 20 * GB),
    maxParallelDownloads: positiveInt(env, 'MAX_PARALLEL_DOWNLOADS', 8),
    uploadExpiryHours: positiveInt(env, 'UPLOAD_EXPIRY_HOURS', 48),
    webDist: path.resolve(baseDir, env['WEB_DIST'] ?? '../web/dist'),
  };
}
