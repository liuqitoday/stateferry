export type SupportedLocale = 'en' | 'zh-CN' | 'zh-TW';

export type ErrorCode =
  | 'UNSUPPORTED_PAGE'
  | 'TAB_NAVIGATED'
  | 'STORAGE_READ_FAILED'
  | 'SESSION_TAB_UNAVAILABLE'
  | 'INVALID_BACKUP_JSON'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'COOKIE_CONSTRAINT_INVALID'
  | 'COOKIE_PERMISSION_DENIED'
  | 'PARTIAL_APPLY'
  | 'REDACTED_VALUE'
  | 'DOWNLOAD_FAILED'
  | 'UNKNOWN_ERROR';

export interface RuntimeError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface TabContext {
  tabId: number;
  pageUrl: string;
  origin: string;
  hostname: string;
  capturedAt: string;
}

export interface StorageItem {
  key: string;
  value: string;
}

export type CookieSameSite = 'no_restriction' | 'lax' | 'strict' | 'unspecified';

export interface CookiePartitionKey {
  topLevelSite: string;
  hasCrossSiteAncestor?: boolean;
}

export interface CookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: CookieSameSite;
  session: boolean;
  expirationDate?: number;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  hostOnly?: boolean;
}

export interface BackupDocument {
  schemaVersion: 1;
  exportedAt: string;
  source: {
    origin: string;
    pageUrl: string;
  };
  scope: {
    cookies: 'current-url-match';
    localStorage: 'exact-origin';
    sessionStorage: 'current-tab';
  };
  cookies: CookieRecord[];
  localStorage: StorageItem[];
  sessionStorage: StorageItem[];
  redacted?: boolean;
}

export interface CurrentSnapshot {
  context: TabContext;
  cookieAccess?: 'granted' | 'required';
  cookies: CookieRecord[];
  localStorage: StorageItem[];
  sessionStorage: StorageItem[];
}

export type ParseBackupResult =
  | { ok: true; backup: BackupDocument }
  | { ok: false; error: RuntimeError };

export type ImportStrategy = 'merge' | 'overwrite';
export type StorageType = 'cookie' | 'localStorage' | 'sessionStorage';
export type DiffStatus = 'add' | 'update' | 'skip' | 'error';

export interface DiffOptions {
  strategy: ImportStrategy;
}

export interface DiffItem {
  id: string;
  type: StorageType;
  key: string;
  status: DiffStatus;
  incoming: CookieRecord | StorageItem;
  current?: CookieRecord | StorageItem;
  error?: RuntimeError;
  targetUrl?: string;
  domainRemapped?: boolean;
}

export interface DiffPlan {
  items: DiffItem[];
  counts: {
    total: number;
    add: number;
    update: number;
    skip: number;
    error: number;
  };
}

export type CookieMappingResult =
  | { ok: true; cookie: CookieRecord; url: string; remapped: boolean }
  | { ok: false; error: RuntimeError };

export type RuntimeResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: RuntimeError };

export interface StorageMutation {
  type: 'localStorage' | 'sessionStorage';
  operation: 'set' | 'remove';
  key: string;
  value?: string;
}

export type ItemMutation =
  | {
      type: 'localStorage' | 'sessionStorage';
      operation: 'set' | 'remove';
      key: string;
      value?: string;
    }
  | {
      type: 'cookie';
      operation: 'set' | 'remove';
      key: string;
      cookie: CookieRecord;
      originalCookie?: CookieRecord;
    };

export interface MutationRequest {
  context: TabContext;
  mutation: ItemMutation;
}

export interface ApplyItemResult {
  id: string;
  status: 'succeeded' | 'skipped' | 'failed';
  error?: RuntimeError;
}

export interface ApplyReport {
  startedAt: string;
  finishedAt: string;
  context: TabContext;
  results: ApplyItemResult[];
  counts: {
    succeeded: number;
    skipped: number;
    failed: number;
  };
}
