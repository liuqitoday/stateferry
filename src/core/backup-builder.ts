import { cookieIdentity } from './cookie-rules';
import type { BackupDocument, CookieRecord, CurrentSnapshot, StorageItem } from './types';

export type BackupSelection = {
  cookies?: string[];
  localStorage?: string[];
  sessionStorage?: string[];
};

export interface CreateBackupOptions {
  includeValues?: boolean;
  selection?: BackupSelection;
  exportedAt?: string;
}

function selected<T>(items: T[], ids: string[] | undefined, identity: (item: T) => string): T[] {
  if (!ids) return items;
  const allowed = new Set(ids);
  return items.filter((item) => allowed.has(identity(item)));
}

function redactCookie(cookie: CookieRecord, includeValues: boolean): CookieRecord {
  return includeValues ? { ...cookie } : { ...cookie, value: '' };
}

function redactStorage(item: StorageItem, includeValues: boolean): StorageItem {
  return includeValues ? { ...item } : { ...item, value: '' };
}

export function createBackup(snapshot: CurrentSnapshot, options: CreateBackupOptions = {}): BackupDocument {
  const includeValues = options.includeValues !== false;
  const selection = options.selection;
  const cookies = selected(snapshot.cookies, selection?.cookies, cookieIdentity).map((cookie) => redactCookie(cookie, includeValues));
  const localStorage = selected(snapshot.localStorage, selection?.localStorage, (item) => item.key).map((item) => redactStorage(item, includeValues));
  const sessionStorage = selected(snapshot.sessionStorage, selection?.sessionStorage, (item) => item.key).map((item) => redactStorage(item, includeValues));

  return {
    schemaVersion: 1,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    source: { origin: snapshot.context.origin, pageUrl: snapshot.context.pageUrl },
    scope: { cookies: 'current-url-match', localStorage: 'exact-origin', sessionStorage: 'current-tab' },
    cookies,
    localStorage,
    sessionStorage,
    ...(includeValues ? {} : { redacted: true }),
  };
}
