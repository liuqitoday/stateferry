import type { RuntimeError, StorageItem } from '../core/types';

export type PageStorageRead = {
  localStorage: { ok: true; items: StorageItem[] } | { ok: false; error: RuntimeError };
  sessionStorage: { ok: true; items: StorageItem[] } | { ok: false; error: RuntimeError };
};

export type PageStorageMutation = {
  id: string;
  storage: 'localStorage' | 'sessionStorage';
  operation: 'set' | 'remove';
  key: string;
  value?: string;
};

export type PageStorageResult = { id: string; ok: true } | { id: string; ok: false; error: RuntimeError };

/**
 * This function is injected into the page's MAIN world. Keep it self-contained:
 * Chrome serializes the function body and does not carry module closures with it.
 */
export function readPageStorage(): PageStorageRead {
  const read = (storage: Storage): { ok: true; items: StorageItem[] } | { ok: false; error: RuntimeError } => {
    try {
      const items: StorageItem[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) items.push({ key, value: storage.getItem(key) ?? '' });
      }
      return { ok: true, items };
    } catch {
      return { ok: false, error: { code: 'STORAGE_READ_FAILED', message: 'The page storage could not be read.' } };
    }
  };

  let localStorageResult: PageStorageRead['localStorage'];
  let sessionStorageResult: PageStorageRead['sessionStorage'];
  try {
    localStorageResult = read(window.localStorage);
  } catch {
    localStorageResult = { ok: false, error: { code: 'STORAGE_READ_FAILED', message: 'Local storage is unavailable on this page.' } };
  }
  try {
    sessionStorageResult = read(window.sessionStorage);
  } catch {
    sessionStorageResult = { ok: false, error: { code: 'SESSION_TAB_UNAVAILABLE', message: 'Session storage is unavailable on this tab.' } };
  }
  return { localStorage: localStorageResult, sessionStorage: sessionStorageResult };
}

/** This function is also injected into the page's MAIN world; keep it closure-free. */
export function applyPageStorage(operations: PageStorageMutation[]): PageStorageResult[] {
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
