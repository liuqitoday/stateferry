import { beforeEach, describe, expect, it } from 'vitest';
import { applyPageStorage, readPageStorage } from './storage';

describe('page storage bridge', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('reads both storage areas without depending on extension-scope helpers', () => {
    localStorage.setItem('theme', 'dark');
    sessionStorage.setItem('step', '2');

    expect(readPageStorage()).toEqual({
      localStorage: { ok: true, items: [{ key: 'theme', value: 'dark' }] },
      sessionStorage: { ok: true, items: [{ key: 'step', value: '2' }] },
    });
  });

  it('applies set and remove mutations to the requested storage area', () => {
    localStorage.setItem('remove-me', 'old');

    expect(applyPageStorage([
      { id: 'set', storage: 'localStorage', operation: 'set', key: 'theme', value: 'light' },
      { id: 'remove', storage: 'localStorage', operation: 'remove', key: 'remove-me' },
      { id: 'session', storage: 'sessionStorage', operation: 'set', key: 'step', value: '3' },
    ])).toEqual([
      { id: 'set', ok: true },
      { id: 'remove', ok: true },
      { id: 'session', ok: true },
    ]);
    expect(localStorage.getItem('theme')).toBe('light');
    expect(localStorage.getItem('remove-me')).toBeNull();
    expect(sessionStorage.getItem('step')).toBe('3');
  });
});
