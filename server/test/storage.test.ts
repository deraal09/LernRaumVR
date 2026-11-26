import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../src/storage/local.js';
import { removeDir, tempDir } from './helpers.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

async function read(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks).toString();
}

describe('LocalStorage', () => {
  const setup = (): { storage: LocalStorage; dir: string } => {
    const dir = tempDir();
    dirs.push(dir);
    return { storage: new LocalStorage(dir), dir };
  };

  it('liest ganze Dateien und Bereiche (inklusive Ende)', async () => {
    const { storage, dir } = setup();
    fs.writeFileSync(`${dir}/abc123`, '0123456789');
    expect(await storage.stat('abc123')).toEqual({ size: 10 });
    expect(await read(await storage.openRange('abc123'))).toBe('0123456789');
    expect(await read(await storage.openRange('abc123', { start: 2, end: 4 }))).toBe('234');
  });

  it('meldet fehlende Dateien als null und löscht idempotent', async () => {
    const { storage, dir } = setup();
    expect(await storage.stat('fehlt')).toBeNull();
    fs.writeFileSync(`${dir}/x1`, 'a');
    await storage.delete('x1');
    await storage.delete('x1');
    expect(await storage.stat('x1')).toBeNull();
  });

  it('weist Pfadtricks ab', () => {
    const { storage } = setup();
    for (const key of ['../etc/passwd', 'a/b', '..', '.versteckt', '', 'a\\b']) {
      expect(() => storage.resolve(key), key).toThrow(/Ungültiger/);
    }
  });

  it('liefert freien Platz', async () => {
    const { storage } = setup();
    expect(await storage.freeBytes()).toBeGreaterThan(0);
  });
});
