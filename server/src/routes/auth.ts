import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import type { AuthGuards } from '../auth/plugin.js';
import { LoginRateLimit } from '../auth/ratelimit.js';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { NotInGroupError, type AppUser, type Authenticator } from '../auth/types.js';
import { upsertUserOnLogin } from '../auth/users.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';

export interface AuthRouteDeps {
  config: Config;
  db: Db;
  guards: AuthGuards;
  /** `null`: LDAP nicht eingerichtet. */
  authenticator: Authenticator | null;
  rateLimit?: LoginRateLimit;
}

const publicUser = (u: AppUser) => ({
  id: u.id,
  username: u.ldapUid,
  displayName: u.displayName,
  role: u.role,
  status: u.status,
});

const loginSchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    additionalProperties: false,
    properties: {
      username: { type: 'string', minLength: 1, maxLength: 128 },
      password: { type: 'string', minLength: 1, maxLength: 256 },
    },
  },
} as const;

export function authRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { config, db, guards, authenticator } = deps;
  const rateLimit = deps.rateLimit ?? new LoginRateLimit(db);

  app.post<{ Body: { username: string; password: string } }>(
    '/api/login',
    { schema: loginSchema },
    async (req, reply) => {
      if (!authenticator) return reply.code(503).send({ error: 'ldap_not_configured' });
      const username = req.body.username.trim();
      if (!/^[\w.@\-\\]+$/.test(username)) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      const wait = rateLimit.check(username, req.ip);
      if (wait !== null) {
        return reply.code(429).header('Retry-After', String(wait)).send({ error: 'rate_limited', retryAfter: wait });
      }

      let identity;
      try {
        identity = await authenticator.authenticate(username, req.body.password);
      } catch (err) {
        if (err instanceof NotInGroupError) {
          // Passwort war korrekt: kein Fehlversuch, aber auch keine Anmeldung.
          return reply.code(403).send({ error: 'not_in_group' });
        }
        req.log.error({ err }, 'LDAP-Anmeldung fehlgeschlagen (technischer Fehler)');
        return reply.code(502).send({ error: 'ldap_error' });
      }
      if (!identity) {
        rateLimit.recordFailure(username, req.ip);
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      rateLimit.reset(username);

      const user = upsertUserOnLogin(db, config.adminUsers, identity.loginSub, identity.name);
      if (user.status === 'blocked') {
        audit(db, user.id, 'login_blocked', user.ldapUid);
        return reply.code(403).send({ error: 'blocked' });
      }
      const { token, expiresAt } = guards.sessions.create(user.id);
      guards.setSessionCookie(reply, token, expiresAt);
      audit(db, user.id, 'login', user.ldapUid, { status: user.status });
      return { user: publicUser(user) };
    },
  );

  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) guards.sessions.destroy(token);
    guards.clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/me', { preHandler: guards.requireSession }, async (req) => ({ user: publicUser(req.user!) }));
}
