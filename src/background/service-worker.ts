import type {
  ApplyReport,
  CookieRecord,
  ItemMutation,
  CurrentSnapshot,
  DiffItem,
  RuntimeError,
  RuntimeResponse,
  TabContext,
} from '../core/types';
import { mapCookieToTarget } from '../core/cookie-rules';
import { applyPageStorage, readPageStorage } from '../page-bridge/storage';

export type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'GET_CONTEXT' }
  | { type: 'GET_SNAPSHOT' }
  | { type: 'GET_SNAPSHOT_FOR_TAB'; context: TabContext }
  | { type: 'APPLY_PLAN'; context: TabContext; items: DiffItem[] }
  | { type: 'DOWNLOAD_TEXT'; filename: string; text: string; mimeType: string }
  | { type: 'MUTATE_ITEM'; context: TabContext; mutation: ItemMutation }
  | { type: 'OPEN_MIGRATION'; context: TabContext };

function runtimeError(code: RuntimeError['code'], message: string, details?: Record<string, unknown>): RuntimeError {
  return { code, message, details };
}

function responseError<T>(error: RuntimeError): RuntimeResponse<T> {
  return { ok: false, error };
}

function responseData<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

function isSupportedUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function createContext(tab: chrome.tabs.Tab): TabContext | RuntimeError {
  if (!tab.id || !isSupportedUrl(tab.url)) {
    return runtimeError('UNSUPPORTED_PAGE', 'This page cannot be accessed by the extension.');
  }
  const url = new URL(tab.url);
  return {
    tabId: tab.id,
    pageUrl: tab.url,
    origin: url.origin,
    hostname: url.hostname,
    capturedAt: new Date().toISOString(),
  };
}

async function getActiveContext(): Promise<TabContext | RuntimeError> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const active = tabs[0];
  return active ? createContext(active) : runtimeError('UNSUPPORTED_PAGE', 'No active tab is available.');
}

async function getContextForTab(tabId: number): Promise<TabContext | RuntimeError> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return createContext(tab);
  } catch {
    return runtimeError('UNSUPPORTED_PAGE', 'The target tab is no longer available.');
  }
}

function sameTarget(expected: TabContext, actual: TabContext): boolean {
  return expected.tabId === actual.tabId && expected.pageUrl === actual.pageUrl && expected.origin === actual.origin;
}

function siteOriginPattern(pageUrl: string): string {
  const url = new URL(pageUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

async function executeOnTab<T>(tabId: number, func: (...args: never[]) => T, args: unknown[] = []): Promise<T> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args,
  } as unknown as chrome.scripting.ScriptInjection<unknown[], T>);
  return (results[0]?.result as T) ?? (undefined as T);
}

async function snapshot(context: TabContext): Promise<RuntimeResponse<CurrentSnapshot>> {
  try {
    const actual = await getContextForTab(context.tabId);
    if ('code' in actual) return responseError(actual);
    if (!sameTarget(context, actual)) return responseError(runtimeError('TAB_NAVIGATED', 'The page changed. Refresh and try again.'));

    const page = await executeOnTab(context.tabId, readPageStorage);
    if (!page) return responseError(runtimeError('STORAGE_READ_FAILED', 'The page storage response was empty.'));
    if (!page.localStorage.ok) return responseError(page.localStorage.error);
    if (!page.sessionStorage.ok) return responseError(page.sessionStorage.error);
    const hasCookieAccess = await chrome.permissions.contains({ origins: [siteOriginPattern(context.pageUrl)] });
    let cookies: CookieRecord[] = [];
    if (hasCookieAccess) {
      try {
        cookies = (await chrome.cookies.getAll({ url: context.pageUrl })) as CookieRecord[];
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cookie access was denied.';
        return responseError(runtimeError(
          message.toLowerCase().includes('permission') ? 'COOKIE_PERMISSION_DENIED' : 'STORAGE_READ_FAILED',
          message,
        ));
      }
    }
    return responseData({
      context,
      cookieAccess: hasCookieAccess ? 'granted' : 'required',
      cookies,
      localStorage: page.localStorage.items,
      sessionStorage: page.sessionStorage.items,
    });
  } catch (error) {
    return responseError(runtimeError('STORAGE_READ_FAILED', error instanceof Error ? error.message : 'Unable to read the current page.'));
  }
}

function applyCookieItem(context: TabContext, item: DiffItem): Promise<{ id: string; status: 'succeeded' | 'failed'; error?: RuntimeError }> {
  if (item.type !== 'cookie' || !('name' in item.incoming)) {
    return Promise.resolve({ id: item.id, status: 'failed', error: runtimeError('COOKIE_CONSTRAINT_INVALID', 'Cookie data is incomplete.') });
  }
  const mapped = mapCookieToTarget(item.incoming, context);
  if (!mapped.ok) return Promise.resolve({ id: item.id, status: 'failed', error: mapped.error });
  const cookie = mapped.cookie;
  const details: chrome.cookies.SetDetails = {
    url: mapped.url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    ...(cookie.session || cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
    ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
  };
  return chrome.cookies
    .set(details)
    .then(() => ({ id: item.id, status: 'succeeded' as const }))
    .catch((error: unknown) => ({
      id: item.id,
      status: 'failed' as const,
      error: runtimeError(
        String(error).toLowerCase().includes('permission') ? 'COOKIE_PERMISSION_DENIED' : 'COOKIE_CONSTRAINT_INVALID',
        error instanceof Error ? error.message : 'Cookie could not be applied.',
      ),
    }));
}

function cookieRemoveDetails(context: TabContext, cookie: CookieRecord): chrome.cookies.CookieDetails {
  const url = new URL(context.pageUrl);
  url.pathname = cookie.path || '/';
  url.search = '';
  url.hash = '';
  return {
    url: url.toString(),
    name: cookie.name,
    ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
    ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
  } as chrome.cookies.CookieDetails;
}

async function mutateItem(context: TabContext, mutation: ItemMutation): Promise<RuntimeResponse<{ id: string }>> {
  const actual = await getContextForTab(context.tabId);
  if ('code' in actual) return responseError(actual);
  if (!sameTarget(context, actual)) return responseError(runtimeError('TAB_NAVIGATED', 'The page changed. Refresh and try again.'));

  try {
    if (mutation.type !== 'cookie') {
      const id = `${mutation.type}:${mutation.key}`;
      const results = await executeOnTab(context.tabId, applyPageStorage, [[{
        id,
        storage: mutation.type,
        operation: mutation.operation,
        key: mutation.key,
        value: mutation.value,
      }]]);
      const result = results?.[0];
      return result?.ok ? responseData({ id }) : responseError(result?.error ?? runtimeError('STORAGE_READ_FAILED', 'Storage could not be updated.'));
    }

    const sourceCookie = mutation.operation === 'remove' ? mutation.cookie : (mutation.originalCookie ?? mutation.cookie);
    if (mutation.operation === 'remove') {
      await chrome.cookies.remove(cookieRemoveDetails(context, sourceCookie));
      return responseData({ id: `cookie:${mutation.key}` });
    }

    if (mutation.originalCookie && cookieIdentityChanged(mutation.originalCookie, mutation.cookie)) {
      await chrome.cookies.remove(cookieRemoveDetails(context, mutation.originalCookie));
    }
    const mapped = mapCookieToTarget(mutation.cookie, context);
    if (!mapped.ok) return responseError(mapped.error);
    const cookie = mapped.cookie;
    await chrome.cookies.set({
      url: mapped.url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
      ...(cookie.session || cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
      ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
      ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
    });
    return responseData({ id: `cookie:${mutation.cookie.name}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The item could not be updated.';
    return responseError(runtimeError(
      mutation.type === 'cookie' && message.toLowerCase().includes('permission') ? 'COOKIE_PERMISSION_DENIED' :
        mutation.type === 'cookie' ? 'COOKIE_CONSTRAINT_INVALID' :
          mutation.type === 'sessionStorage' ? 'SESSION_TAB_UNAVAILABLE' : 'STORAGE_READ_FAILED',
      message,
    ));
  }
}

function cookieIdentityChanged(before: CookieRecord, after: CookieRecord): boolean {
  return before.name !== after.name || before.domain !== after.domain || before.path !== after.path || before.partitionKey?.topLevelSite !== after.partitionKey?.topLevelSite;
}

async function applyPlan(context: TabContext, items: DiffItem[]): Promise<RuntimeResponse<ApplyReport>> {
  const start = new Date().toISOString();
  const actual = await getContextForTab(context.tabId);
  if ('code' in actual) return responseError(actual);
  if (!sameTarget(context, actual)) return responseError(runtimeError('TAB_NAVIGATED', 'The page changed. Refresh and try again.'));

  const selected = items.filter((item) => item.status === 'add' || item.status === 'update');
  const results: ApplyReport['results'] = items
    .filter((item) => item.status === 'skip' || item.status === 'error')
    .map((item) => ({
      id: item.id,
      status: item.status === 'error' ? 'failed' as const : 'skipped' as const,
      error: item.error,
    }));

  const storageItems = selected.filter((item) => item.type !== 'cookie');
  if (storageItems.length > 0) {
    try {
      const operations = storageItems.map((item) => ({
        id: item.id,
        storage: item.type as 'localStorage' | 'sessionStorage',
        operation: 'set' as const,
        key: item.key,
        value: 'value' in item.incoming ? item.incoming.value : '',
      }));
      const pageResults = await executeOnTab(context.tabId, applyPageStorage, [operations]);
      for (const result of pageResults ?? []) {
        results.push(result.ok ? { id: result.id, status: 'succeeded' } : { id: result.id, status: 'failed', error: result.error });
      }
    } catch {
      for (const item of storageItems) {
        results.push({ id: item.id, status: 'failed', error: item.type === 'sessionStorage' ? runtimeError('SESSION_TAB_UNAVAILABLE', 'Session storage is unavailable on this tab.') : runtimeError('STORAGE_READ_FAILED', 'Storage could not be updated.') });
      }
    }
  }

  const cookieItems = selected.filter((item) => item.type === 'cookie');
  results.push(...(await Promise.all(cookieItems.map((item) => applyCookieItem(context, item)))));
  const finishedAt = new Date().toISOString();
  const counts = results.reduce<ApplyReport['counts']>((acc, result) => {
    acc[result.status] += 1;
    return acc;
  }, { succeeded: 0, skipped: 0, failed: 0 });
  return responseData({ startedAt: start, finishedAt, context, results, counts });
}

async function downloadText(filename: string, text: string, mimeType: string): Promise<RuntimeResponse<{ downloadId: number }>> {
  try {
    const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
    const downloadId = await chrome.downloads.download({ url, filename, saveAs: true });
    return responseData({ downloadId });
  } catch (error) {
    return responseError(runtimeError('DOWNLOAD_FAILED', error instanceof Error ? error.message : 'Download failed.'));
  }
}

export async function handleRuntimeMessage(message: RuntimeMessage): Promise<RuntimeResponse<unknown>> {
  try {
    switch (message.type) {
      case 'PING':
        return responseData({});
      case 'GET_CONTEXT': {
        const context = await getActiveContext();
        return 'code' in context ? responseError(context) : responseData(context);
      }
      case 'GET_SNAPSHOT': {
        const context = await getActiveContext();
        return 'code' in context ? responseError(context) : snapshot(context);
      }
      case 'GET_SNAPSHOT_FOR_TAB':
        return snapshot(message.context);
      case 'APPLY_PLAN':
        return applyPlan(message.context, message.items);
      case 'DOWNLOAD_TEXT':
        return downloadText(message.filename, message.text, message.mimeType);
      case 'MUTATE_ITEM':
        return mutateItem(message.context, message.mutation);
      case 'OPEN_MIGRATION': {
        const query = new URLSearchParams({ tabId: String(message.context.tabId), pageUrl: message.context.pageUrl, origin: message.context.origin });
        const tab = await chrome.tabs.create({ url: `${chrome.runtime.getURL('migration.html')}?${query.toString()}` });
        return responseData({ tabId: tab.id });
      }
    }
  } catch (error) {
    return responseError(runtimeError('UNKNOWN_ERROR', error instanceof Error ? error.message : 'Unexpected runtime error.'));
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void handleRuntimeMessage(message).then(sendResponse);
  return true;
});
