import type {
  ApplyReport,
  CookieRecord,
  CurrentSnapshot,
  DiffItem,
  RuntimeError,
  RuntimeResponse,
  StorageItem,
  TabContext,
} from '../core/types';

export type RuntimeMessage =
  | { type: 'PING' }
  | { type: 'GET_CONTEXT' }
  | { type: 'GET_SNAPSHOT' }
  | { type: 'APPLY_PLAN'; context: TabContext; items: DiffItem[] }
  | { type: 'DOWNLOAD_TEXT'; filename: string; text: string; mimeType: string }
  | { type: 'OPEN_MIGRATION'; context: TabContext };

type PageStorageRead = {
  localStorage: { ok: true; items: StorageItem[] } | { ok: false; error: RuntimeError };
  sessionStorage: { ok: true; items: StorageItem[] } | { ok: false; error: RuntimeError };
};

type PageStorageResult = { id: string; ok: true } | { id: string; ok: false; error: RuntimeError };

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

function readPageStorage(): PageStorageRead {
  const read = (storage: Storage): { ok: true; items: StorageItem[] } | { ok: false; error: RuntimeError } => {
    try {
      const items: StorageItem[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) items.push({ key, value: storage.getItem(key) ?? '' });
      }
      return { ok: true, items };
    } catch {
      return { ok: false, error: runtimeError('STORAGE_READ_FAILED', 'The page storage could not be read.') };
    }
  };

  let localStorageResult: PageStorageRead['localStorage'];
  let sessionStorageResult: PageStorageRead['sessionStorage'];
  try {
    localStorageResult = read(window.localStorage);
  } catch {
    localStorageResult = { ok: false, error: runtimeError('STORAGE_READ_FAILED', 'Local storage is unavailable on this page.') };
  }
  try {
    sessionStorageResult = read(window.sessionStorage);
  } catch {
    sessionStorageResult = { ok: false, error: runtimeError('SESSION_TAB_UNAVAILABLE', 'Session storage is unavailable on this tab.') };
  }
  return { localStorage: localStorageResult, sessionStorage: sessionStorageResult };
}

function applyPageStorage(operations: Array<{
  id: string;
  storage: 'localStorage' | 'sessionStorage';
  operation: 'set' | 'remove';
  key: string;
  value?: string;
}>): PageStorageResult[] {
  return operations.map((item) => {
    try {
      const storage = item.storage === 'localStorage' ? window.localStorage : window.sessionStorage;
      if (item.operation === 'remove') storage.removeItem(item.key);
      else storage.setItem(item.key, item.value ?? '');
      return { id: item.id, ok: true };
    } catch {
      return {
        id: item.id,
        ok: false,
        error: {
          code: item.storage === 'sessionStorage' ? 'SESSION_TAB_UNAVAILABLE' : 'STORAGE_READ_FAILED',
          message: `Unable to update ${item.storage}.`,
        },
      };
    }
  });
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
    const cookies = (await chrome.cookies.getAll({ url: context.pageUrl })) as CookieRecord[];
    if (!page) return responseError(runtimeError('STORAGE_READ_FAILED', 'The page storage response was empty.'));
    if (!page.localStorage.ok) return responseError(page.localStorage.error);
    if (!page.sessionStorage.ok) return responseError(page.sessionStorage.error);
    return responseData({ context, cookies, localStorage: page.localStorage.items, sessionStorage: page.sessionStorage.items });
  } catch (error) {
    return responseError(runtimeError('STORAGE_READ_FAILED', error instanceof Error ? error.message : 'Unable to read the current page.'));
  }
}

function applyCookieItem(item: DiffItem): Promise<{ id: string; status: 'succeeded' | 'failed'; error?: RuntimeError }> {
  if (item.type !== 'cookie' || !('name' in item.incoming) || !item.targetUrl) {
    return Promise.resolve({ id: item.id, status: 'failed', error: runtimeError('COOKIE_CONSTRAINT_INVALID', 'Cookie data is incomplete.') });
  }
  const cookie = item.incoming;
  return chrome.cookies
    .set({
      url: item.targetUrl,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: cookie.session ? undefined : cookie.expirationDate,
      partitionKey: cookie.partitionKey,
    })
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

async function applyPlan(context: TabContext, items: DiffItem[]): Promise<RuntimeResponse<ApplyReport>> {
  const start = new Date().toISOString();
  const actual = await getContextForTab(context.tabId);
  if ('code' in actual) return responseError(actual);
  if (!sameTarget(context, actual)) return responseError(runtimeError('TAB_NAVIGATED', 'The page changed. Refresh and try again.'));

  const selected = items.filter((item) => item.status === 'add' || item.status === 'update');
  const results: ApplyReport['results'] = items
    .filter((item) => item.status === 'skip' || item.status === 'error')
    .map((item) => ({ id: item.id, status: 'skipped' as const, error: item.error }));

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
  results.push(...(await Promise.all(cookieItems.map(applyCookieItem))));
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
      case 'APPLY_PLAN':
        return applyPlan(message.context, message.items);
      case 'DOWNLOAD_TEXT':
        return downloadText(message.filename, message.text, message.mimeType);
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
