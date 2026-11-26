import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tempDir(prefix = 'lernraumvr-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
