import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { LdapAuthenticator, LdapDirectorySearch } from './auth/ldap.js';
import { registerAuth } from './auth/plugin.js';
import type { Authenticator, DirectorySearch } from './auth/types.js';
import { adminUserRoutes } from './routes/admin-users.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import type { StorageBackend } from './storage/types.js';

export const VERSION = '0.1.0';

export interface AppDeps {
  config: Config;
  db: Db;
  storage: StorageBackend;
  logger?: boolean;
  /** Standard: LDAP aus der Konfiguration (oder keine Anmeldung, wenn LDAP fehlt). Tests übergeben Ersatz. */
  authenticator?: Authenticator | null;
  directory?: DirectorySearch | null;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? deps.config.nodeEnv !== 'test',
    // Hinter Plesk/nginx: echte Client-IP aus X-Forwarded-For (Ratenbegrenzung, Audit-Log).
    trustProxy: true,
  });

  const { config, db } = deps;
  const authenticator =
    deps.authenticator !== undefined ? deps.authenticator : config.ldap ? new LdapAuthenticator(config.ldap) : null;
  const directory =
    deps.directory !== undefined ? deps.directory : config.ldap ? new LdapDirectorySearch(config.ldap) : null;

  const guards = await registerAuth(app, { config, db });
  healthRoutes(app, { db, storage: deps.storage, version: VERSION });
  authRoutes(app, { config, db, guards, authenticator });
  adminUserRoutes(app, { config, db, guards, directory });

  // Gebaute Weboberfläche ausliefern, falls vorhanden (Produktion: ein Prozess, ein Port).
  const webDist = deps.config.webDist;
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    // Einseitige Anwendung: alles außerhalb von /api liefert die Startseite.
    if (fs.existsSync(webDist)) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'not_found' });
  });

  return app;
}
