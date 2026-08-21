import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplyReport, CurrentSnapshot, RuntimeResponse } from '../core/types';
import { Migration } from './main';

const context = {
  tabId: 7,
  pageUrl: 'https://target.example.test/cart',
  origin: 'https://target.example.test',
  hostname: 'target.example.test',
  capturedAt: '2026-08-20T06:30:00.000Z',
};

const snapshot: CurrentSnapshot = {
  context,
  cookies: [
    {
      name: 'sid', value: 'current', domain: 'target.example.test', path: '/', secure: true,
      httpOnly: true, sameSite: 'lax', session: true, hostOnly: true,
    },
  ],
  localStorage: [{ key: 'theme', value: 'light' }],
  sessionStorage: [{ key: 'step', value: '1' }],
};

const report: ApplyReport = {
  startedAt: context.capturedAt,
  finishedAt: '2026-08-20T06:31:00.000Z',
  context,
  results: [
    { id: 'localStorage:https://target.example.test:theme', status: 'succeeded' },
    { id: 'cookie:sid|.target.example.test|/|', status: 'failed', error: { code: 'COOKIE_CONSTRAINT_INVALID', message: 'bad cookie' } },
  ],
  counts: { succeeded: 1, skipped: 0, failed: 1 },
};

const api = vi.hoisted(() => ({
  getSnapshotForTab: vi.fn<() => Promise<RuntimeResponse<CurrentSnapshot>>>(),
  getCurrentSnapshot: vi.fn<() => Promise<RuntimeResponse<CurrentSnapshot>>>(),
  applyPlan: vi.fn<() => Promise<RuntimeResponse<ApplyReport>>>(),
  downloadText: vi.fn().mockResolvedValue({ ok: true, data: { downloadId: 1 } }),
}));

vi.mock('../background/runtime-client', () => api);

function fileFromBackup(overrides: Record<string, unknown> = {}) {
  const backup = {
    schemaVersion: 1,
    exportedAt: '2026-08-20T06:00:00.000Z',
    source: { origin: 'https://source.example.test', pageUrl: 'https://source.example.test/cart' },
    scope: { cookies: 'current-url-match', localStorage: 'exact-origin', sessionStorage: 'current-tab' },
    cookies: [{ name: 'sid', value: 'incoming', domain: 'source.example.test', path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true, hostOnly: true }],
    localStorage: [{ key: 'theme', value: 'dark' }, { key: 'newKey', value: 'yes' }],
    sessionStorage: [{ key: 'step', value: '2' }],
    ...overrides,
  };
  return new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
}

describe('Migration', () => {
beforeEach(() => {
    api.getSnapshotForTab.mockResolvedValue({ ok: true, data: snapshot });
    api.getCurrentSnapshot.mockResolvedValue({ ok: true, data: snapshot });
    api.applyPlan.mockResolvedValue({ ok: true, data: report });
    api.downloadText.mockClear();
  });

  it('loads the current target and shows the file step with security warning', async () => {
    render(<Migration initialContext={context} />);

    expect(await screen.findByText('Import backup')).toBeInTheDocument();
    expect(screen.getByText('target.example.test')).toBeInTheDocument();
    expect(screen.getByText(/login tokens/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review file/i })).toBeDisabled();
    expect(api.getSnapshotForTab).toHaveBeenCalledWith(context);
  });

  it('parses a file and renders Add, Skip, and Error review state under Merge', async () => {
    render(<Migration initialContext={context} />);
    await screen.findByText('Import backup');

    fireEvent.change(screen.getByLabelText(/Choose backup file/i), { target: { files: [fileFromBackup()] } });
    expect(await screen.findByText('Review incoming state')).toBeInTheDocument();
    expect(screen.getByText(/items found/i)).toBeInTheDocument();
    expect(screen.getAllByText('ADD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SKIP').length).toBeGreaterThan(0);
  });

  it('switches Merge and Overwrite strategies and applies only selected compatible items', async () => {
    render(<Migration initialContext={context} />);
    await screen.findByText('Import backup');
    fireEvent.change(screen.getByLabelText(/Choose backup file/i), { target: { files: [fileFromBackup()] } });
    await screen.findByText('Review incoming state');

    fireEvent.click(screen.getByRole('radio', { name: /Overwrite matching items/i }));
    expect(screen.getByRole('radio', { name: /Overwrite matching items/i })).toBeChecked();
    expect(screen.getAllByText('UPDATE').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Apply selected/i }));
    await waitFor(() => expect(api.applyPlan).toHaveBeenCalledWith(context, expect.arrayContaining([expect.objectContaining({ status: 'update' })])));
    expect(await screen.findByText('Migration complete')).toBeInTheDocument();
    expect(screen.getByLabelText('1 succeeded')).toBeInTheDocument();
    expect(screen.getByLabelText('1 failed')).toBeInTheDocument();
  });

  it('sends preflight errors and deselected compatible items to the final report', async () => {
    render(<Migration initialContext={context} />);
    await screen.findByText('Import backup');
    fireEvent.change(screen.getByLabelText(/Choose backup file/i), {
      target: { files: [fileFromBackup({ redacted: true })] },
    });
    await screen.findByText('Review incoming state');

    expect(screen.getAllByText('ERROR').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Apply selected/i })).toBeDisabled();
  });

  it('downloads a fixed-schema error report after a partial failure', async () => {
    render(<Migration initialContext={context} />);
    await screen.findByText('Import backup');
    fireEvent.change(screen.getByLabelText(/Choose backup file/i), { target: { files: [fileFromBackup()] } });
    await screen.findByText('Review incoming state');
    fireEvent.click(screen.getByRole('button', { name: /Apply selected/i }));
    await screen.findByText('Migration complete');

    fireEvent.click(screen.getByRole('button', { name: /Download error report/i }));
    expect(api.downloadText).toHaveBeenCalledWith(expect.stringContaining('stateferry-errors'), expect.stringContaining('COOKIE_CONSTRAINT_INVALID'), 'application/json');
  });

  it('shows a localized security warning when the browser locale is Chinese', async () => {
    vi.stubGlobal('chrome', { i18n: { getUILanguage: vi.fn(() => 'zh-CN'), getMessage: vi.fn(() => '') } });
    render(<Migration initialContext={context} />);
    expect(await screen.findByText(/此文件可能包含登录令牌/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
