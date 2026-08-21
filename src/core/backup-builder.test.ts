import { describe, expect, it } from 'vitest';
import { createBackup } from './backup-builder';
import type { CurrentSnapshot } from './types';

const snapshot: CurrentSnapshot = {
  context: {
    tabId: 1,
    pageUrl: 'https://example.test/account',
    origin: 'https://example.test',
    hostname: 'example.test',
    capturedAt: '2026-08-20T06:30:00.000Z',
  },
  cookies: [{ name: 'sid', value: 'secret', domain: 'example.test', path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true }],
  localStorage: [{ key: 'theme', value: 'dark' }],
  sessionStorage: [{ key: 'step', value: '2' }],
};

describe('createBackup', () => {
  it('includes all storage types when requested', () => {
    const backup = createBackup(snapshot, { includeValues: true });

    expect(backup.cookies).toHaveLength(1);
    expect(backup.localStorage).toEqual([{ key: 'theme', value: 'dark' }]);
    expect(backup.sessionStorage).toEqual([{ key: 'step', value: '2' }]);
    expect(backup.redacted).toBeUndefined();
  });

  it('redacts every value when includeValues is false', () => {
    const backup = createBackup(snapshot, { includeValues: false });

    expect(backup.redacted).toBe(true);
    expect(backup.cookies[0].value).toBe('');
    expect(backup.localStorage[0].value).toBe('');
    expect(backup.sessionStorage[0].value).toBe('');
  });
});
