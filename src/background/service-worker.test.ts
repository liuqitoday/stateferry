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
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
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

  it('keeps page storage available without host access and does not query cookies', async () => {
    const stub = chromeStub();
    stub.permissions.contains.mockResolvedValue(false);
    stub.scripting.executeScript.mockResolvedValue([
      {
        result: {
          localStorage: { ok: true, items: [{ key: 'theme', value: 'dark' }] },
          sessionStorage: { ok: true, items: [{ key: 'step', value: '2' }] },
        },
      },
    ]);
    const { runtime } = await loadRuntime(stub);

    const response = await runtime.handleRuntimeMessage({ type: 'GET_SNAPSHOT' });

    expect(response).toMatchObject({
      ok: true,
      data: {
        cookieAccess: 'required',
        cookies: [],
        localStorage: [{ key: 'theme', value: 'dark' }],
        sessionStorage: [{ key: 'step', value: '2' }],
      },
    });
    expect(stub.permissions.contains).toHaveBeenCalledWith({ origins: ['https://target.example.test/*'] });
    expect(stub.cookies.getAll).not.toHaveBeenCalled();
  });

  it('maps Cookie API read permission failures to COOKIE_PERMISSION_DENIED', async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue([
      { result: { localStorage: { ok: true, items: [] }, sessionStorage: { ok: true, items: [] } } },
    ]);
    stub.cookies.getAll.mockRejectedValue(new Error('permission denied'));
    const { runtime } = await loadRuntime(stub);

    const response = await runtime.handleRuntimeMessage({ type: 'GET_SNAPSHOT' });

    expect(response).toMatchObject({ ok: false, error: { code: 'COOKIE_PERMISSION_DENIED' } });
  });

  it('reads a snapshot for the original tab after the migration page opens', async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue([
      { result: { localStorage: { ok: true, items: [] }, sessionStorage: { ok: true, items: [] } } },
    ]);
    const { runtime } = await loadRuntime(stub);

    const response = await runtime.handleRuntimeMessage({ type: 'GET_SNAPSHOT_FOR_TAB', context });

    expect(response).toMatchObject({ ok: true, data: { context: { tabId: 7 }, localStorage: [], sessionStorage: [] } });
    expect(stub.tabs.get).toHaveBeenCalledWith(7);
    expect(stub.tabs.query).not.toHaveBeenCalled();
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

  it('maps cookie permission failures to COOKIE_PERMISSION_DENIED while keeping preflight errors visible', async () => {
    const invalidItem: DiffItem = {
      id: 'cookie:error',
      type: 'cookie',
      key: '__Host-bad',
      status: 'error',
      incoming: {
        name: '__Host-bad', value: '', domain: '.source.test', path: '/x', secure: true,
        httpOnly: true, sameSite: 'lax', session: true,
      },
      error: { code: 'COOKIE_CONSTRAINT_INVALID', message: 'invalid' },
    };
    const cookieItem: DiffItem = {
      id: 'cookie:sid|.target.example.test|/|',
      type: 'cookie',
      key: 'sid',
      status: 'update',
      targetUrl: 'https://target.example.test/',
      incoming: {
        name: 'sid', value: 'secret-cookie', domain: '.target.example.test', path: '/', secure: true,
        httpOnly: true, sameSite: 'lax', session: true,
      },
    };
    const stub = chromeStub();
    stub.cookies.set.mockRejectedValue(new Error('permission denied'));
    const { runtime } = await loadRuntime(stub);

    const response = await runtime.handleRuntimeMessage({
      type: 'APPLY_PLAN',
      context,
      items: [invalidItem, cookieItem],
    });

    expect(response).toMatchObject({
      ok: true,
      data: {
        counts: { succeeded: 0, skipped: 0, failed: 2 },
        results: [
          { id: 'cookie:error', status: 'failed', error: { code: 'COOKIE_CONSTRAINT_INVALID' } },
          { id: cookieItem.id, status: 'failed', error: { code: 'COOKIE_PERMISSION_DENIED' } },
        ],
      },
    });
  });

  it('omits the domain field when restoring a host-only cookie', async () => {
    const hostOnly: DiffItem = {
      id: 'cookie:sid|target.example.test|/|',
      type: 'cookie',
      key: 'sid',
      status: 'add',
      targetUrl: context.pageUrl,
      incoming: {
        name: 'sid', value: 'secret', domain: 'target.example.test', path: '/', secure: true,
        httpOnly: true, sameSite: 'lax', session: true, hostOnly: true,
      },
    };
    const stub = chromeStub();
    const { runtime } = await loadRuntime(stub);

    await runtime.handleRuntimeMessage({ type: 'APPLY_PLAN', context, items: [hostOnly] });

    expect(stub.cookies.set).toHaveBeenCalledWith(expect.not.objectContaining({ domain: expect.anything() }));
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

  it('mutates local and session storage only after target validation', async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue([{ result: [{ id: 'localStorage:theme', ok: true }] }]);
    const { runtime } = await loadRuntime(stub);

    const local = await runtime.handleRuntimeMessage({
      type: 'MUTATE_ITEM',
      context,
      mutation: { type: 'localStorage', operation: 'set', key: 'theme', value: 'light' },
    });
    expect(local).toMatchObject({ ok: true });
    expect(stub.scripting.executeScript).toHaveBeenCalled();
  });

  it('sets and removes a cookie through the current target URL', async () => {
    const stub = chromeStub();
    const { runtime } = await loadRuntime(stub);
    const cookie = {
      name: 'sid', value: 'secret', domain: 'target.example.test', path: '/', secure: true,
      httpOnly: true, sameSite: 'lax' as const, session: true, hostOnly: true,
    };

    expect(await runtime.handleRuntimeMessage({
      type: 'MUTATE_ITEM', context, mutation: { type: 'cookie', operation: 'set', key: 'sid', cookie },
    })).toMatchObject({ ok: true });
    expect(stub.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      name: 'sid',
      value: 'secret',
      url: 'https://target.example.test/',
    }));

    expect(await runtime.handleRuntimeMessage({
      type: 'MUTATE_ITEM', context, mutation: { type: 'cookie', operation: 'remove', key: 'sid', cookie },
    })).toMatchObject({ ok: true });
    expect(stub.cookies.remove).toHaveBeenCalledWith(expect.objectContaining({
      name: 'sid',
      url: 'https://target.example.test/',
    }));
  });
});
