import type {
  BackupDocument,
  CookieRecord,
  CookieSameSite,
  ParseBackupResult,
  RuntimeError,
  StorageItem,
} from './types';

const SAME_SITE_VALUES = new Set<CookieSameSite>([
  'no_restriction',
  'lax',
  'strict',
  'unspecified',
]);

function invalid(message: string): ParseBackupResult {
  return {
    ok: false,
    error: { code: 'INVALID_BACKUP_JSON', message },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown, fields: string[]): value is Record<string, string> {
  return isRecord(value) && fields.every((field) => typeof value[field] === 'string');
}

function isStorageItem(value: unknown): value is StorageItem {
  return isStringRecord(value, ['key', 'value']);
}

function isPartitionKey(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.topLevelSite === 'string' &&
      (value.hasCrossSiteAncestor === undefined || typeof value.hasCrossSiteAncestor === 'boolean'))
  );
}

function isCookie(value: unknown): value is CookieRecord {
  if (!isRecord(value)) return false;

  return (
    ['name', 'value', 'domain', 'path'].every((field) => typeof value[field] === 'string') &&
    ['secure', 'httpOnly', 'session'].every((field) => typeof value[field] === 'boolean') &&
    typeof value.sameSite === 'string' &&
    SAME_SITE_VALUES.has(value.sameSite as CookieSameSite) &&
    (value.expirationDate === undefined || typeof value.expirationDate === 'number') &&
    (value.storeId === undefined || typeof value.storeId === 'string') &&
    (value.hostOnly === undefined || typeof value.hostOnly === 'boolean') &&
    isPartitionKey(value.partitionKey)
  );
}

function validateDocument(value: unknown): ParseBackupResult {
  if (!isRecord(value)) return invalid('Backup must be a JSON object.');

  if (value.schemaVersion !== 1) {
    if (typeof value.schemaVersion === 'number' && value.schemaVersion > 1) {
      const error: RuntimeError = {
        code: 'UNSUPPORTED_SCHEMA_VERSION',
        message: `Schema version ${value.schemaVersion} is not supported.`,
      };
      return { ok: false, error };
    }
    return invalid('schemaVersion must be 1.');
  }

  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) {
    return invalid('exportedAt must be an ISO date string.');
  }

  if (!isStringRecord(value.source, ['origin', 'pageUrl'])) {
    return invalid('source must contain origin and pageUrl strings.');
  }

  if (
    !isRecord(value.scope) ||
    value.scope.cookies !== 'current-url-match' ||
    value.scope.localStorage !== 'exact-origin' ||
    value.scope.sessionStorage !== 'current-tab'
  ) {
    return invalid('scope is invalid.');
  }

  if (!Array.isArray(value.cookies) || !value.cookies.every(isCookie)) {
    return invalid('cookies must be an array of valid cookie records.');
  }
  if (!Array.isArray(value.localStorage) || !value.localStorage.every(isStorageItem)) {
    return invalid('localStorage must be an array of key/value strings.');
  }
  if (!Array.isArray(value.sessionStorage) || !value.sessionStorage.every(isStorageItem)) {
    return invalid('sessionStorage must be an array of key/value strings.');
  }
  if (value.redacted !== undefined && typeof value.redacted !== 'boolean') {
    return invalid('redacted must be a boolean when present.');
  }

  return { ok: true, backup: value as unknown as BackupDocument };
}

export function parseBackup(input: unknown): ParseBackupResult {
  if (typeof input !== 'string') return validateDocument(input);

  try {
    return validateDocument(JSON.parse(input));
  } catch {
    return invalid('The selected file is not valid JSON.');
  }
}

export function serializeBackup(backup: BackupDocument): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

