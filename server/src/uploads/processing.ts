import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyBaseLogger } from 'fastify';
import { audit } from '../audit.js';
import type { Db } from '../db/index.js';
import type { StorageBackend } from '../storage/types.js';
import { analyzeVideo } from './analyze.js';
import type { FileKind } from './file-types.js';

const execFileAsync = promisify(execFile);

interface FileRow {
  id: string;
  typ: FileKind;
  groesse: number;
  storage_key: string;
  uploaded_by: number | null;
}

export interface ProcessorOptions {
  db: Db;
  storage: StorageBackend;
  /** Pfad der ffprobe-Binärdatei, leer = Format nicht prüfen. */
  ffprobePath: string;
  log: FastifyBaseLogger;
  concurrency?: number;
}

/**
 * Nachverarbeitung hochgeladener Dateien als Hintergrundjob: SHA-256, ffprobe, Duplikat-Hinweis.
 * Läuft im selben Prozess; das Hashen arbeitet auf Streams und blockiert den Event-Loop nur in
 * kurzen Stücken (bei Dateien bis einige GB unkritisch). Ein Neustart nimmt unterbrochene Jobs
 * über `recover()` wieder auf.
 */
export class FileProcessor {
  private readonly queue: string[] = [];
  private running = 0;
  private waiters: Array<() => void> = [];
  private readonly concurrency: number;

  constructor(private readonly opts: ProcessorOptions) {
    this.concurrency = opts.concurrency ?? 1;
  }

  enqueue(fileId: string): void {
    if (this.queue.includes(fileId)) return;
    this.queue.push(fileId);
    this.pump();
  }

  /** Nach einem Neustart: Dateien im Status `processing` erneut einreihen. */
  recover(): number {
    const rows = this.opts.db.prepare("SELECT id FROM files WHERE status = 'processing'").all() as Array<{ id: string }>;
    for (const r of rows) this.enqueue(r.id);
    return rows.length;
  }

  /** Wartet, bis alle eingereihten Jobs fertig sind (für Tests und das geordnete Beenden). */
  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.running += 1;
      this.process(id)
        .catch((err: unknown) => this.opts.log.error({ err, fileId: id }, 'Nachverarbeitung fehlgeschlagen'))
        .finally(() => {
          this.running -= 1;
          this.pump();
          if (this.running === 0 && this.queue.length === 0) {
            for (const w of this.waiters.splice(0)) w();
          }
        });
    }
  }

  private fail(row: FileRow, code: string, message: string): void {
    this.opts.db
      .prepare("UPDATE files SET status = 'failed', warnungen = ? WHERE id = ?")
      .run(JSON.stringify([message]), row.id);
    audit(this.opts.db, row.uploaded_by, 'file_failed', row.id, { code });
  }

  private async process(id: string): Promise<void> {
    const { db, storage } = this.opts;
    const row = db
      .prepare("SELECT id, typ, groesse, storage_key, uploaded_by FROM files WHERE id = ? AND status = 'processing'")
      .get(id) as FileRow | undefined;
    if (!row) return;

    const stat = await storage.stat(row.storage_key);
    if (!stat) return this.fail(row, 'missing', 'Datei fehlt im Speicher.');
    if (stat.size !== row.groesse) {
      return this.fail(row, 'size_mismatch', `Größe stimmt nicht (erwartet ${row.groesse}, vorhanden ${stat.size}).`);
    }

    const sha256 = await this.hash(row.storage_key);

    let meta: Record<string, unknown> = {};
    let warnings: string[] = [];
    if (row.typ === 'video') {
      ({ meta, warnings } = await this.probeVideo(row.storage_key));
    }

    const duplicate = db
      .prepare("SELECT id FROM files WHERE sha256 = ? AND id != ? AND status = 'ready' ORDER BY created_at LIMIT 1")
      .get(sha256, id) as { id: string } | undefined;
    if (duplicate) warnings.push('Diese Datei existiert bereits in der Bibliothek (gleiche Prüfsumme).');

    db.prepare(
      "UPDATE files SET status = 'ready', sha256 = ?, meta = ?, warnungen = ?, duplicate_of = ? WHERE id = ?",
    ).run(sha256, JSON.stringify(meta), JSON.stringify(warnings), duplicate?.id ?? null, id);
    audit(db, row.uploaded_by, 'file_ready', id, { sha256, groesse: row.groesse });
  }

  private async hash(key: string): Promise<string> {
    const h = crypto.createHash('sha256');
    for await (const chunk of await this.opts.storage.openRange(key)) h.update(chunk as Buffer);
    return h.digest('hex');
  }

  private async probeVideo(key: string): Promise<{ meta: Record<string, unknown>; warnings: string[] }> {
    const { ffprobePath, storage, log } = this.opts;
    const filePath = storage.localPath(key);
    if (!ffprobePath || !filePath) {
      return { meta: {}, warnings: ['Videoformat wurde nicht geprüft (ffprobe nicht eingerichtet).'] };
    }
    try {
      const { stdout } = await execFileAsync(
        ffprobePath,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
        { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      );
      const { info, warnings } = analyzeVideo(JSON.parse(stdout) as Parameters<typeof analyzeVideo>[0]);
      return { meta: { ...info }, warnings };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { meta: {}, warnings: ['Videoformat wurde nicht geprüft (ffprobe nicht gefunden).'] };
      }
      log.warn({ err }, 'ffprobe fehlgeschlagen');
      return { meta: {}, warnings: ['Die Datei lässt sich nicht als Video lesen (ffprobe-Fehler).'] };
    }
  }
}
