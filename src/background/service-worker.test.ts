import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffItem, TabContext } from '../core/types';

const context: TabContext = {
  tabId: 7,
  pageUrl: 'https://target.example.test/cart',
  origin: 'https://target.example.test',
  hostname: 'target.example.test',
  capturedAt: '2026-08-20T06:30:00.000Z',
};

function chromeStub() {
  return {
    runtime: {
      onMessage: { addListener: vi.fn() },
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 7, url: context.pageUrl }]),
      get: vi.fn().mockResolvedValue({ id: 7, url: context.pageUrl }),
      create: vi.fn().mockResolvedValue({ id: 99 }),
    },
    scripting: {
      executeScript: vi.fn(),
    },
    cookies: {
      getAll: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue({ name: 'sid' }),
      remove: vi.fn().mockResolvedValue({ name: 'sid' }),
    },
    downloads: {
      download: vi.fn().mockResolvedValue(42),
    },
  };
}

async function loadRuntime(stub = chromeStub()) {
  vi.resetModules();
  vi.stubGlobal('chrome', stub);
  const runtime = await import('./service-worker');
  return { runtime, stub };
}

describe('service worker runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the current supported tab context', async () => {
    const { runtime } = await loadRuntime();

    const response = await runtime.handleRuntimeMessage({ type: 'GET_CONTEXT' });

    expect(response).toMatchObject({
      ok: true,
      data: {
        tabId: 7,
        pageUrl: context.pageUrl,
        origin: context.origin,
        hostname: context.hostname,
      },
    });
  });

  it('rejects protected browser pages before injecting a script', async () => {
    const stub = chromeStub();
    stub.tabs.query.mockResolvedValue([{ id: 8, url: 'chrome://settings' }]);
    const { runtime } = await loadRuntime(stub);

    const response = await runtime.handleRuntimeMessage({ type: 'GET_SNAPSHOT' });

    expect(response).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_PAGE' } });
    expect(stub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('returns a current snapshot with page storage and cookies', async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue([
      {
        result: {
          localStorage: { ok: true, items: [{ key: 'theme', value: 'dark' }] },
          sessionStorage: { ok: true, items: [{ key: 'step', value: '2' }] },
        },
      },
    ]);
    stub.cookies.getAll.mockResolvedValue([
      {
        name: 'sid',
        value: 'secret',
        domain: 'target.example.test',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        session: true,
        storeId: '0',
        hostOnly: true,
      },
    ]);
    const { runtime } = await loadRuntime(stub);

    const response = await runtime.handleRuntimeMessage({ type: 'GET_SNAPSHOT' });

    expect(response).toMatchObject({
      ok: true,
      data: {
        context: { tabId: 7 },
        cookies: [{ name: 'sid', value: 'secret' }],
        localStorage: [{ key: 'theme', value: 'dark' }],
        sessionStorage: [{ key: 'step', value: '2' }],
      },
    });
  });

  it('aborts apply when the target tab navigated', async () => {
    const stub = chromeStub();
    stub.tabs.get.mockResolvedValue({ id: 7, url: 'https://target.example.test/other' });
    const { runtime } = await loadRuntime(stub);

    const response = await runtime.handleRuntimeMessage({
      type: 'APPLY_PLAN',
      context,
      items: [],
    });

    expect(response).toMatchObject({ ok: false, error: { code: 'TAB_NAVIGATED' } });
    expect(stub.cookies.set).not.toHaveBeenCalled();
  });

  it('reports partial apply results without logging plaintext values', async () => {
    const storageItem: DiffItem = {
      id: 'localStorage:https://target.example.test:theme',
      type: 'localStorage',
      key: 'theme',
      status: 'update',
      incoming: { key: 'theme', value: 'secret-theme' },
    };
    const cookieItem: DiffItem = {
      id: 'cookie:sid|.target.example.test|/|',
      type: 'cookie',
      key: 'sid',
      status: 'update',
      targetUrl: 'https://target.example.test/',
      incoming: {
        name: 'sid',
        value: 'secret-cookie',
        domain: '.target.example.test',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        session: true,
      },
    };
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue([
      { result: [{ id: storageItem.id, ok: true }] },
    ]);
    stub.cookies.set.mockRejectedValue(new Error('permission denied'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { runtime } = await loadRuntime(stub);

    const response = await runtime.handleRuntimeMessage({
      type: 'APPLY_PLAN',
      context,
      items: [storageItem, cookieItem],
    });

    expect(response).toMatchObject({
      ok: true,
      data: {
        counts: { succeeded: 1, skipped: 0, failed: 1 },
        results: [
          { id: storageItem.id, status: 'succeeded' },
          { id: cookieItem.id, status: 'failed', error: { code: 'COOKIE_PERMISSION_DENIED' } },
        ],
      },
    });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('downloads text through an in-memory data URL', async () => {
    const { runtime, stub } = await loadRuntime();

    const response = await runtime.handleRuntimeMessage({
      type: 'DOWNLOAD_TEXT',
      filename: 'report.json',
      text: '{"ok":true}',
      mimeType: 'application/json',
    });

    expect(response).toEqual({ ok: true, data: { downloadId: 42 } });
    expect(stub.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'report.json',
        saveAs: true,
        url: expect.stringMatching(/^data:application\/json;charset=utf-8,/),
      }),
    );
  });

  it('opens the migration page without putting snapshot values in the URL', async () => {
    const { runtime, stub } = await loadRuntime();

    const response = await runtime.handleRuntimeMessage({ type: 'OPEN_MIGRATION', context });

    expect(response).toEqual({ ok: true, data: { tabId: 99 } });
    const url = stub.tabs.create.mock.calls[0]?.[0]?.url as string;
    expect(url).toContain('migration.html?');
    expect(url).toContain('tabId=7');
    expect(url).toContain(encodeURIComponent(context.origin));
    expect(url).not.toContain('secret');
  });
});
