import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { SESSION_COOKIE, SessionStore } from './sessions.js';
import type { AppUser } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Angemeldete Person (jeder Status) oder `null`. */
    user: AppUser | null;
  }
}

export interface AuthGuards {
  sessions: SessionStore;
  /** Angemeldet (auch wenn noch nicht freigeschaltet). */
  requireSession: preHandlerAsyncHookHandler;
  /** Angemeldet und freigeschaltet. */
  requireApproved: preHandlerAsyncHookHandler;
  requireAdmin: preHandlerAsyncHookHandler;
  setSessionCookie(reply: FastifyReply, token: string, expiresAt: number): void;
  clearSessionCookie(reply: FastifyReply): void;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Cookie-Auswertung, CSRF-Prüfung (Origin) und Zugriffs-Wächter für Routen. */
export async function registerAuth(app: FastifyInstance, deps: { config: Config; db: Db }): Promise<AuthGuards> {
  const { config, db } = deps;
  const sessions = new SessionStore(db);
  await app.register(fastifyCookie);
  app.decorateRequest('user', null);

  // CSRF: Browser senden bei Schreibzugriffen immer Origin. Cookie ist zusätzlich SameSite=Strict.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || !MUTATING.has(req.method)) return;
    const origin = req.headers.origin;
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'bad_origin' });
    }
  });

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? sessions.find(token) : null;
  });

  const requireSession: preHandlerAsyncHookHandler = async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
  };
  const requireApproved: preHandlerAsyncHookHandler = async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
    if (req.user.status !== 'approved') return reply.code(403).send({ error: req.user.status });
  };
  const requireAdmin: preHandlerAsyncHookHandler = async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
    if (req.user.status !== 'approved' || req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }
  };

  return {
    sessions,
    requireSession,
    requireApproved,
    requireAdmin,
    setSessionCookie(reply: FastifyReply, token: string, expiresAt: number) {
      void reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'strict',
        path: '/',
        expires: new Date(expiresAt),
      });
    },
    clearSessionCookie(reply: FastifyReply) {
      void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    },
  };
}

export type { FastifyRequest };
