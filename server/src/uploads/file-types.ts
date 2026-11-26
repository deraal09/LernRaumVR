import path from 'node:path';

export type FileKind = 'video' | 'image' | 'apk' | 'other';

const VIDEO = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi']);
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

/** Art der Datei nach Endung (die vom Browser gemeldete Mime-Art ist nicht vertrauenswürdig). */
export function detectKind(filename: string): FileKind {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.apk') return 'apk';
  if (VIDEO.has(ext)) return 'video';
  if (IMAGE.has(ext)) return 'image';
  return 'other';
}

/** Anzeigename: nur der Dateiname ohne Pfad, ohne Steuerzeichen, begrenzte Länge. */
export function sanitizeFilename(raw: string | null | undefined): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const limited = cleaned.length > 200 ? cleaned.slice(-200) : cleaned;
  return limited && limited !== '.' && limited !== '..' ? limited : 'datei';
}
