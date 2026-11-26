import path from 'node:path';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openDatabase, runMigrations } from './db/index.js';
import { LocalStorage } from './storage/local.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath, config.dbEncryptionKey);
  const { applied } = runMigrations(db);
  // Zwischenspeicher für Uploads und fertige Dateien liegen bewusst auf demselben
  // Dateisystem, damit der Abschluss eines Uploads ein rename statt einer Kopie ist.
  const storage = new LocalStorage(path.join(config.dataDir, 'files'));

  const app = await buildApp({ config, db, storage });
  if (applied.length) app.log.info({ applied }, 'Migrationen angewendet');

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Beende Server');
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Plesk/Passenger übergibt eine Portnummer oder einen Socket-Pfad.
  if (typeof config.port === 'number') {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } else {
    await app.listen({ path: config.port });
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`FEHLER (Konfiguration): ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
