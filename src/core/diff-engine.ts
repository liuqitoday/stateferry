import { cookieIdentity, mapCookieToTarget } from './cookie-rules';
import type {
  BackupDocument,
  CookieRecord,
  CurrentSnapshot,
  DiffItem,
  DiffOptions,
  DiffPlan,
  StorageItem,
} from './types';

function storageMap(items: StorageItem[]): Map<string, StorageItem> {
  return new Map(items.map((item) => [item.key, item]));
}

function valuesEqual(
  incoming: CookieRecord | StorageItem,
  current: CookieRecord | StorageItem,
): boolean {
  if ('name' in incoming && 'name' in current) {
    return (
      incoming.value === current.value &&
      incoming.secure === current.secure &&
      incoming.httpOnly === current.httpOnly &&
      incoming.sameSite === current.sameSite &&
      incoming.session === current.session &&
      incoming.expirationDate === current.expirationDate
    );
  }
  return 'key' in incoming && 'key' in current && incoming.value === current.value;
}

function statusFor(
  incoming: CookieRecord | StorageItem,
  current: CookieRecord | StorageItem | undefined,
  options: DiffOptions,
): DiffItem['status'] {
  if (!current) return 'add';
  if (valuesEqual(incoming, current)) return 'skip';
  return options.strategy === 'overwrite' ? 'update' : 'skip';
}

function count(items: DiffItem[]): DiffPlan['counts'] {
  return items.reduce<DiffPlan['counts']>(
    (counts, item) => {
      counts.total += 1;
      counts[item.status] += 1;
      return counts;
    },
    { total: 0, add: 0, update: 0, skip: 0, error: 0 },
  );
}

export function buildDiff(
  backup: BackupDocument,
  current: CurrentSnapshot,
  options: DiffOptions,
): DiffPlan {
  const items: DiffItem[] = [];
  const redactedError = {
    code: 'REDACTED_VALUE' as const,
    message: 'Redacted values cannot be restored.',
  };

  const currentCookies = new Map(current.cookies.map((item) => [cookieIdentity(item), item]));
  for (const sourceCookie of [...backup.cookies].sort((a, b) => a.name.localeCompare(b.name))) {
    const mapped = mapCookieToTarget(sourceCookie, current.context);
    if (!mapped.ok) {
      items.push({
        id: `cookie:error:${sourceCookie.name}:${sourceCookie.domain}:${sourceCookie.path}`,
        type: 'cookie',
        key: sourceCookie.name,
        status: 'error',
        incoming: sourceCookie,
        error: mapped.error,
      });
      continue;
    }

    const id = cookieIdentity(mapped.cookie);
    const existing = currentCookies.get(id);
    items.push({
      id: `cookie:${id}`,
      type: 'cookie',
      key: mapped.cookie.name,
      status: backup.redacted ? 'error' : statusFor(mapped.cookie, existing, options),
      incoming: mapped.cookie,
      current: existing,
      error: backup.redacted ? redactedError : undefined,
      targetUrl: mapped.url,
      domainRemapped: mapped.remapped,
    });
  }

  const currentLocal = storageMap(current.localStorage);
  for (const incoming of [...backup.localStorage].sort((a, b) => a.key.localeCompare(b.key))) {
    const existing = currentLocal.get(incoming.key);
    items.push({
      id: `localStorage:${current.context.origin}:${incoming.key}`,
      type: 'localStorage',
      key: incoming.key,
      status: backup.redacted ? 'error' : statusFor(incoming, existing, options),
      incoming,
      current: existing,
      error: backup.redacted ? redactedError : undefined,
    });
  }

  const currentSession = storageMap(current.sessionStorage);
  for (const incoming of [...backup.sessionStorage].sort((a, b) => a.key.localeCompare(b.key))) {
    const existing = currentSession.get(incoming.key);
    items.push({
      id: `sessionStorage:${current.context.tabId}:${current.context.origin}:${incoming.key}`,
      type: 'sessionStorage',
      key: incoming.key,
      status: backup.redacted ? 'error' : statusFor(incoming, existing, options),
      incoming,
      current: existing,
      error: backup.redacted ? redactedError : undefined,
    });
  }

  return { items, counts: count(items) };
}

