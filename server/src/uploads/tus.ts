import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Server as TusServer, EVENTS } from '@tus/server';
import { FileStore } from '@tus/file-store';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import type { AuthGuards } from '../auth/plugin.js';
import type { AppUser } from '../auth/types.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import type { StorageBackend } from '../storage/types.js';
import { detectKind, sanitizeFilename } from './file-types.js';
import type { FileProcessor } from './processing.js';

export const MAX_UPLOADS_PER_USER = 2;
export const MAX_UPLOADS_TOTAL = 4;

export interface UploadDeps {
  config: Config;
  db: Db;
  storage: StorageBackend;
  guards: AuthGuards;
  processor: FileProcessor;
}

interface Ctx {
  user: AppUser;
}

/** Fehler im Format, das @tus/server in eine HTTP-Antwort umsetzt. */
const reject = (status_code: number, body: string): never => {
  throw { status_code, body };
};

/** Geschätzter Platz, den laufende Uploads noch brauchen (angekündigte Größe minus bereits Geschriebenes). */
function reservedBytes(db: Db, uploadsDir: string): number {
  const rows = db.prepare('SELECT tus_id, laenge FROM uploads').all() as Array<{ tus_id: string; laenge: number }>;
  let reserved = 0;
  for (const r of rows) {
    let written = 0;
    try {
      written = fs.statSync(path.join(uploadsDir, r.tus_id)).size;
    } catch {
      // Datei (noch) nicht vorhanden
    }
    reserved += Math.max(0, r.laenge - written);
  }
  return reserved;
}

export function uploadsDir(config: Config): string {
  return path.join(config.dataDir, 'uploads');
}

/** Entfernt unvollständige Uploads, deren Frist abgelaufen ist. Liefert die Anzahl. */
export function cleanupExpiredUploads(db: Db, dir: string, now = new Date()): number {
  const rows = db
    .prepare('SELECT tus_id, file_id FROM uploads WHERE expires_at <= ?')
    .all(now.toISOString()) as Array<{ tus_id: string; file_id: string | null }>;
  for (const r of rows) {
    fs.rmSync(path.join(dir, r.tus_id), { force: true });
    fs.rmSync(path.join(dir, `${r.tus_id}.json`), { force: true });
    if (r.file_id) db.prepare("DELETE FROM files WHERE id = ? AND status = 'uploading'").run(r.file_id);
    db.prepare('DELETE FROM uploads WHERE tus_id = ?').run(r.tus_id);
  }
  return rows.length;
}

/**
 * Fortsetzbarer Upload per tus-Protokoll unter /api/uploads.
 *
 * Ablauf: POST legt an (Vorabprüfung von Größe, Platz, Kontingent, Parallelität), PATCH überträgt
 * Teile, nach dem letzten Teil wird die Datei per rename in den Speicher übernommen und die
 * Nachverarbeitung (Prüfsumme, ffprobe) als Hintergrundjob gestartet.
 */
export async function registerUploads(app: FastifyInstance, deps: UploadDeps): Promise<void> {
  const { config, db, storage, guards, processor } = deps;
  const dir = uploadsDir(config);
  fs.mkdirSync(dir, { recursive: true });
  const als = new AsyncLocalStorage<Ctx>();
  const currentUser = (): AppUser => {
    const ctx = als.getStore();
    if (!ctx) return reject(401, 'Nicht angemeldet');
    return ctx.user;
  };

  const tus = new TusServer({
    path: '/api/uploads',
    datastore: new FileStore({
      directory: dir,
      expirationPeriodInMilliseconds: config.uploadExpiryHours * 3600 * 1000,
    }),
    relativeLocation: true,
    respectForwardedHeaders: true,
    maxSize: config.maxUploadBytes,
    namingFunction: () => crypto.randomBytes(16).toString('hex'),
    disableTerminationForFinishedUploads: true,

    async onIncomingRequest(_req, uploadId) {
      const user = currentUser();
      if (!uploadId) return;
      const row = db.prepare('SELECT user_id FROM uploads WHERE tus_id = ?').get(uploadId) as
        | { user_id: number }
        | undefined;
      // Fremde Uploads sind unsichtbar (404 statt 403).
      if (row && row.user_id !== user.id && user.role !== 'admin') reject(404, 'Upload nicht gefunden');
    },

    async onUploadCreate(_req, upload) {
      const user = currentUser();
      if (upload.size === undefined || upload.sizeIsDeferred) reject(400, 'Upload-Length ist erforderlich');
      const size = upload.size as number;
      if (size < 1) reject(400, 'Leere Dateien werden nicht hochgeladen');
      if (size > config.maxUploadBytes) reject(413, `Datei zu groß (Maximum ${config.maxUploadBytes} Bytes)`);

      const rawName = upload.metadata?.['filename'] ?? null;
      const name = sanitizeFilename(rawName);
      const kind = detectKind(name);
      if (kind === 'apk' && user.role !== 'admin') reject(403, 'APK-Dateien dürfen nur Admins hochladen');

      const mine = db.prepare('SELECT count(*) AS n FROM uploads WHERE user_id = ?').get(user.id) as { n: number };
      const total = db.prepare('SELECT count(*) AS n FROM uploads').get() as { n: number };
      if (mine.n >= MAX_UPLOADS_PER_USER) reject(429, `Höchstens ${MAX_UPLOADS_PER_USER} gleichzeitige Uploads je Person`);
      if (total.n >= MAX_UPLOADS_TOTAL) reject(429, 'Zu viele gleichzeitige Uploads, bitte später erneut versuchen');

      const quotaRow = db.prepare('SELECT quota_bytes FROM users WHERE id = ?').get(user.id) as { quota_bytes: number | null };
      const quota = quotaRow.quota_bytes ?? config.defaultQuotaBytes;
      if (quota !== null) {
        const used = (db.prepare('SELECT COALESCE(SUM(groesse), 0) AS s FROM files WHERE uploaded_by = ?').get(user.id) as { s: number }).s;
        if (used + size > quota) reject(413, 'Speicherkontingent überschritten');
      }

      const free = await storage.freeBytes();
      if (free - reservedBytes(db, dir) < size + config.minFreeBytes) {
        reject(507, 'Nicht genug freier Speicherplatz auf dem Server');
      }

      const expires = new Date(Date.now() + config.uploadExpiryHours * 3600 * 1000).toISOString();
      db.transaction(() => {
        db.prepare(
          `INSERT INTO files (id, name, original_name, typ, mime, groesse, status, storage_backend, storage_key, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?)`,
        ).run(
          upload.id,
          name,
          (rawName ?? name).slice(0, 500),
          kind,
          upload.metadata?.['filetype'] ?? null,
          size,
          storage.name,
          upload.id,
          user.id,
        );
        db.prepare('INSERT INTO uploads (tus_id, user_id, file_id, laenge, expires_at) VALUES (?, ?, ?, ?, ?)').run(
          upload.id,
          user.id,
          upload.id,
          size,
          expires,
        );
      })();
      audit(db, user.id, 'upload_started', upload.id, { name, groesse: size });
      return {};
    },

    async onUploadFinish(_req, upload) {
      const id = upload.id;
      await storage.adopt(id, path.join(dir, id));
      fs.rmSync(path.join(dir, `${id}.json`), { force: true });
      db.transaction(() => {
        db.prepare("UPDATE files SET status = 'processing' WHERE id = ?").run(id);
        db.prepare('DELETE FROM uploads WHERE tus_id = ?').run(id);
      })();
      processor.enqueue(id);
      return {};
    },
  });

  // Abgebrochene Uploads (DELETE durch den Client) aus der Datenbank entfernen.
  tus.on(EVENTS.POST_TERMINATE, (_req, _res, id) => {
    db.prepare("DELETE FROM files WHERE id = ? AND status = 'uploading'").run(id);
    db.prepare('DELETE FROM uploads WHERE tus_id = ?').run(id);
  });

  await app.register(async (scope) => {
    // Der tus-Server liest den Request-Body selbst: Fastify darf ihn nicht vorher verbrauchen.
    scope.addContentTypeParser('application/offset+octet-stream', (_req, _payload, done) => done(null));

    const handler = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      reply.hijack();
      await als.run({ user: req.user! }, () => tus.handle(req.raw, reply.raw));
    };
    scope.route({
      method: ['POST', 'PATCH', 'HEAD', 'DELETE', 'OPTIONS'],
      url: '/api/uploads',
      preHandler: guards.requireApproved,
      handler,
    });
    scope.route({
      method: ['POST', 'PATCH', 'HEAD', 'DELETE', 'OPTIONS'],
      url: '/api/uploads/*',
      preHandler: guards.requireApproved,
      handler,
    });
  });

  // Aufräumen: beim Start und danach stündlich.
  const cleanup = (): void => {
    try {
      const n = cleanupExpiredUploads(db, dir);
      if (n) app.log.info({ n }, 'Abgelaufene Uploads entfernt');
      guards.sessions.purgeExpired();
    } catch (err) {
      app.log.error({ err }, 'Aufräumen fehlgeschlagen');
    }
  };
  cleanup();
  const timer = setInterval(cleanup, 60 * 60 * 1000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
