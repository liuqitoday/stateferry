import { describe, expect, it } from 'vitest';
import { parseBackup, serializeBackup } from './backup-schema';
import type { BackupDocument } from './types';

const validBackup: BackupDocument = {
  schemaVersion: 1,
  exportedAt: '2026-08-20T06:30:00.000Z',
  source: {
    origin: 'https://source.example.test',
    pageUrl: 'https://source.example.test/account',
  },
  scope: {
    cookies: 'current-url-match',
    localStorage: 'exact-origin',
    sessionStorage: 'current-tab',
  },
  cookies: [
    {
      name: 'sid',
      value: 'abc',
      domain: 'source.example.test',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      session: false,
    },
  ],
  localStorage: [{ key: 'theme', value: 'dark' }],
  sessionStorage: [{ key: 'step', value: '2' }],
};

describe('backup schema', () => {
  it('parses a valid version 1 document from an object', () => {
    const result = parseBackup(validBackup);

    expect(result).toEqual({ ok: true, backup: validBackup });
  });

  it('parses a valid JSON string and serializes it deterministically', () => {
    const result = parseBackup(JSON.stringify(validBackup));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(serializeBackup(result.backup)).toBe(`${JSON.stringify(validBackup, null, 2)}\n`);
    }
  });

  it('rejects malformed input, missing arrays, and invalid storage item types', () => {
    expect(parseBackup('{not-json')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_BACKUP_JSON' },
    });
    expect(parseBackup({ ...validBackup, cookies: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_BACKUP_JSON' },
    });
    expect(parseBackup({ ...validBackup, localStorage: [{ key: 1, value: 'x' }] })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_BACKUP_JSON' },
    });
  });

  it('rejects future schema versions with a dedicated error', () => {
    expect(parseBackup({ ...validBackup, schemaVersion: 99 })).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_SCHEMA_VERSION' },
    });
  });

  it('preserves the redacted marker for a structurally valid document', () => {
    const result = parseBackup({ ...validBackup, redacted: true });

    expect(result).toEqual({ ok: true, backup: { ...validBackup, redacted: true } });
  });
});
