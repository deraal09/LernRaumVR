import type { Readable } from 'node:stream';

export interface StoredObject {
  size: number;
}

/**
 * Austauschbarer Speicher für Inhalte. V1: lokales Dateisystem.
 * Später z. B. Netzlaufwerk oder S3-kompatibler Speicher, ohne die API zu ändern.
 */
export interface StorageBackend {
  readonly name: string;
  stat(key: string): Promise<StoredObject | null>;
  /** Liest den Bereich [start, end] (beide inklusive) oder die ganze Datei. */
  openRange(key: string, range?: { start: number; end: number }): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Freier Platz in Bytes, für Vorabprüfungen beim Upload. */
  freeBytes(): Promise<number>;
}
