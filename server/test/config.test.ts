import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const prod = {
  NODE_ENV: 'production',
  DB_ENCRYPTION_KEY: 'a'.repeat(64),
  SECRET: 'b'.repeat(64),
};

describe('loadConfig', () => {
  it('liefert Standardwerte', () => {
    const c = loadConfig(prod, '/srv/app');
    expect(c.port).toBe(3001);
    expect(c.dataDir).toBe('/srv/app/data');
    expect(c.maxUploadBytes).toBe(10 * 1024 ** 3);
    expect(c.maxParallelDownloads).toBe(8);
    expect(c.adminUsers).toEqual([]);
  });

  it('verlangt DB_ENCRYPTION_KEY außerhalb der Testsuite', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SECRET: 'b'.repeat(64) })).toThrow(ConfigError);
    expect(() => loadConfig({ SECRET: 'b'.repeat(64) })).toThrow(/DB_ENCRYPTION_KEY/);
  });

  it('akzeptiert Ersatzschlüssel nur bei NODE_ENV=test', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('lehnt zu kurze Geheimnisse ab', () => {
    expect(() => loadConfig({ ...prod, SECRET: 'kurz' })).toThrow(/SECRET/);
    expect(() => loadConfig({ ...prod, DB_ENCRYPTION_KEY: 'kurz' })).toThrow(/zu kurz/);
  });

  it('normalisiert ADMIN_USERS', () => {
    const c = loadConfig({ ...prod, ADMIN_USERS: ' Till.Gades , ,Admin2 ' });
    expect(c.adminUsers).toEqual(['till.gades', 'admin2']);
  });

  it('erkennt Portnummer und Socket-Pfad', () => {
    expect(loadConfig({ ...prod, PORT: '8080' }).port).toBe(8080);
    expect(loadConfig({ ...prod, PORT: '/tmp/passenger.sock' }).port).toBe('/tmp/passenger.sock');
  });

  it('prüft Zahlenwerte', () => {
    expect(() => loadConfig({ ...prod, MAX_UPLOAD_BYTES: 'viel' })).toThrow(/MAX_UPLOAD_BYTES/);
    expect(() => loadConfig({ ...prod, MIN_FREE_BYTES: '-1' })).toThrow(/MIN_FREE_BYTES/);
  });
});
