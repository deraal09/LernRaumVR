import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageBackend, StoredObject } from './types.js';

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class LocalStorage implements StorageBackend {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** Schlüssel sind interne IDs, nie Dateinamen von Nutzern; Pfadtricks werden abgelehnt. */
  resolve(key: string): string {
    if (!KEY_PATTERN.test(key) || key.includes('..')) {
      throw new Error(`Ungültiger Speicherschlüssel: ${JSON.stringify(key)}`);
    }
    return path.join(this.root, key);
  }

  async stat(key: string): Promise<StoredObject | null> {
    try {
      const s = await fs.promises.stat(this.resolve(key));
      return s.isFile() ? { size: s.size } : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async openRange(key: string, range?: { start: number; end: number }): Promise<Readable> {
    return fs.createReadStream(this.resolve(key), range ? { start: range.start, end: range.end } : {});
  }

  async delete(key: string): Promise<void> {
    await fs.promises.rm(this.resolve(key), { force: true });
  }

  async freeBytes(): Promise<number> {
    const s = await fs.promises.statfs(this.root);
    return Number(s.bavail) * Number(s.bsize);
  }
}
