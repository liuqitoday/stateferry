import { describe, expect, it } from 'vitest';
import { buildDiff } from './diff-engine';
import type { BackupDocument, CurrentSnapshot } from './types';

const context = {
  tabId: 7,
  pageUrl: 'https://target.example.test/cart',
  origin: 'https://target.example.test',
  hostname: 'target.example.test',
  capturedAt: '2026-08-20T06:30:00.000Z',
};

const baseBackup: BackupDocument = {
  schemaVersion: 1,
  exportedAt: '2026-08-20T06:00:00.000Z',
  source: { origin: 'https://source.example.test', pageUrl: 'https://source.example.test/cart' },
  scope: { cookies: 'current-url-match', localStorage: 'exact-origin', sessionStorage: 'current-tab' },
  cookies: [],
  localStorage: [
    { key: 'a', value: 'one' },
    { key: 'b', value: 'new' },
  ],
  sessionStorage: [{ key: 'tab-only', value: 'from-file' }],
};

const current: CurrentSnapshot = {
  context,
  cookies: [],
  localStorage: [
    { key: 'a', value: 'one' },
    { key: 'b', value: 'old' },
  ],
  sessionStorage: [{ key: 'tab-only', value: 'old-session' }],
};

describe('buildDiff', () => {
  it('plans Add, Skip, and Merge conflicts deterministically', () => {
    const plan = buildDiff(baseBackup, current, { strategy: 'merge' });

    expect(plan.items.map(({ type, key, status }) => ({ type, key, status }))).toEqual([
      { type: 'localStorage', key: 'a', status: 'skip' },
      { type: 'localStorage', key: 'b', status: 'skip' },
      { type: 'sessionStorage', key: 'tab-only', status: 'skip' },
    ]);
    expect(plan.counts).toEqual({ total: 3, add: 0, update: 0, skip: 3, error: 0 });
  });

  it('plans Update for changed keys under overwrite and Add for absent keys', () => {
    const backup = {
      ...baseBackup,
      localStorage: [...baseBackup.localStorage, { key: 'c', value: 'fresh' }],
    };
    const plan = buildDiff(backup, current, { strategy: 'overwrite' });

    expect(plan.items.map(({ key, status }) => ({ key, status }))).toEqual([
      { key: 'a', status: 'skip' },
      { key: 'b', status: 'update' },
      { key: 'c', status: 'add' },
      { key: 'tab-only', status: 'update' },
    ]);
    expect(plan.counts).toEqual({ total: 4, add: 1, update: 2, skip: 1, error: 0 });
  });

  it('marks all incoming values as errors when the backup is redacted', () => {
    const plan = buildDiff({ ...baseBackup, redacted: true }, current, { strategy: 'overwrite' });

    expect(plan.items.every((item) => item.status === 'error')).toBe(true);
    expect(plan.items.every((item) => item.error?.code === 'REDACTED_VALUE')).toBe(true);
    expect(plan.counts.error).toBe(3);
  });

  it('uses the current tab and target origin for session identity', () => {
    const plan = buildDiff(
      { ...baseBackup, sessionStorage: [{ key: 'same', value: 'incoming' }] },
      { ...current, sessionStorage: [{ key: 'same', value: 'current' }] },
      { strategy: 'overwrite' },
    );

    expect(plan.items.find((item) => item.type === 'sessionStorage')).toMatchObject({
      id: 'sessionStorage:7:https://target.example.test:same',
      status: 'update',
    });
  });
});
