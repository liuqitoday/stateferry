import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentSnapshot, RuntimeResponse } from '../core/types';
import { Popup } from './main';

const snapshot: CurrentSnapshot = {
  context: {
    tabId: 7,
    pageUrl: 'https://app.example.test/account',
    origin: 'https://app.example.test',
    hostname: 'app.example.test',
    capturedAt: '2026-08-20T06:30:00.000Z',
  },
  cookies: [
    {
      name: 'session_token',
      value: 'secret-cookie',
      domain: 'app.example.test',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      session: true,
      hostOnly: true,
    },
  ],
  localStorage: [
    { key: 'theme', value: 'dark' },
    { key: 'cart', value: '{"items":2}' },
  ],
  sessionStorage: [{ key: 'checkoutStep', value: '2' }],
};

const api = vi.hoisted(() => ({
  getCurrentSnapshot: vi.fn<() => Promise<RuntimeResponse<CurrentSnapshot>>>(),
  downloadText: vi.fn().mockResolvedValue({ ok: true, data: { downloadId: 1 } }),
  openMigrationPage: vi.fn().mockResolvedValue({ ok: true, data: { tabId: 8 } }),
  mutateItem: vi.fn().mockResolvedValue({ ok: true, data: { id: 'localStorage:theme' } }),
}));

vi.mock('../background/runtime-client', () => api);

describe('Popup', () => {
  beforeEach(() => {
    api.getCurrentSnapshot.mockResolvedValue({ ok: true, data: snapshot });
    api.downloadText.mockClear();
    api.openMigrationPage.mockClear();
    api.mutateItem.mockClear();
  });

  it('renders the current host, tabs, counts, and masked sensitive values', async () => {
    render(<Popup />);

    expect(screen.getByText('Loading current tab…')).toBeInTheDocument();
    expect(await screen.findByText('app.example.test')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Cookies 1/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Local storage 2/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Session storage 1/i })).toBeInTheDocument();
    expect(screen.getByText('••••••••••••')).toBeInTheDocument();
    expect(screen.queryByText('secret-cookie')).not.toBeInTheDocument();
  });

  it('switches storage tabs and filters rows', async () => {
    render(<Popup />);
    await screen.findByText('app.example.test');

    fireEvent.click(screen.getByRole('tab', { name: /Local storage 2/i }));
    expect(screen.getByText('theme')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cart' } });
    expect(screen.getByText('cart')).toBeInTheDocument();
    expect(screen.queryByText('theme')).not.toBeInTheDocument();
  });

  it('reveals a value only after an explicit action', async () => {
    render(<Popup />);
    await screen.findByText('app.example.test');

    fireEvent.click(screen.getByRole('button', { name: /Reveal session_token/i }));
    expect(screen.getByText('secret-cookie')).toBeInTheDocument();
  });

  it('exports selected rows and opens the migration workspace', async () => {
    render(<Popup />);
    await screen.findByText('app.example.test');

    fireEvent.click(screen.getByRole('checkbox', { name: /Select session_token/i }));
    fireEvent.click(screen.getByRole('button', { name: /Export selected/i }));
    await waitFor(() => expect(api.downloadText).toHaveBeenCalledWith(expect.stringContaining('stateferry-backup-app.example.test'), expect.stringContaining('session_token'), 'application/json'));
    fireEvent.click(screen.getByRole('button', { name: /Open migration workspace/i }));
    expect(api.openMigrationPage).toHaveBeenCalledWith(snapshot.context);
  });

  it('exports a full three-type backup and can make it redacted', async () => {
    render(<Popup />);
    await screen.findByText('app.example.test');

    fireEvent.click(screen.getByRole('button', { name: /Export backup/i }));
    expect(screen.getByRole('checkbox', { name: /Cookies/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Local storage/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Session storage/i })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Include sensitive values/i }));
    fireEvent.click(screen.getByRole('button', { name: /Download backup/i }));

    await waitFor(() => expect(api.downloadText).toHaveBeenCalled());
    const json = api.downloadText.mock.calls.at(-1)?.[1] as string;
    const backup = JSON.parse(json);
    expect(backup).toMatchObject({ redacted: true });
    expect(backup.cookies).toHaveLength(1);
    expect(backup.localStorage).toHaveLength(2);
    expect(backup.sessionStorage).toHaveLength(1);
    expect(backup.cookies[0].value).toBe('');
  });

  it('shows an explicit unsupported-page state', async () => {
    api.getCurrentSnapshot.mockResolvedValue({ ok: false, error: { code: 'UNSUPPORTED_PAGE', message: 'blocked' } });
    render(<Popup />);

    expect(await screen.findByText('This page cannot be accessed by extensions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open migration workspace/i })).toBeDisabled();
  });

  it('edits an existing local-storage value and refreshes the snapshot', async () => {
    render(<Popup />);
    await screen.findByText('app.example.test');
    fireEvent.click(screen.getByRole('tab', { name: /Local storage 2/i }));
    fireEvent.click(screen.getByRole('button', { name: /Edit theme/i }));
    fireEvent.change(screen.getByLabelText(/Value/i), { target: { value: 'light' } });
    fireEvent.click(screen.getByRole('button', { name: /Save item/i }));
    await waitFor(() => expect(api.mutateItem).toHaveBeenCalledWith(expect.objectContaining({
      context: snapshot.context,
      mutation: { type: 'localStorage', operation: 'set', key: 'theme', value: 'light' },
    })));
  });

  it('adds an item to the selected storage type', async () => {
    render(<Popup />);
    await screen.findByText('app.example.test');
    fireEvent.click(screen.getByRole('tab', { name: /Session storage 1/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add item/i }));
    fireEvent.change(screen.getByLabelText(/Key/i), { target: { value: 'draft' } });
    fireEvent.change(screen.getByLabelText(/Value/i), { target: { value: 'ready' } });
    fireEvent.click(screen.getByRole('button', { name: /Save item/i }));
    await waitFor(() => expect(api.mutateItem).toHaveBeenCalledWith(expect.objectContaining({
      context: snapshot.context,
      mutation: { type: 'sessionStorage', operation: 'set', key: 'draft', value: 'ready' },
    })));
  });

  it('confirms deletion before removing a cookie', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<Popup />);
    await screen.findByText('app.example.test');
    fireEvent.click(screen.getByRole('button', { name: /Delete session_token/i }));
    await waitFor(() => expect(api.mutateItem).toHaveBeenCalledWith(expect.objectContaining({
      mutation: expect.objectContaining({ type: 'cookie', operation: 'remove', key: 'session_token' }),
    })));
    vi.unstubAllGlobals();
  });
});
