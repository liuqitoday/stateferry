import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { downloadText, getCurrentSnapshot, mutateItem, openMigrationPage, requestCookieAccess } from '../background/runtime-client';
import { createBackup } from '../core/backup-builder';
import { serializeBackup } from '../core/backup-schema';
import { cookieIdentity } from '../core/cookie-rules';
import type { CookieRecord, CookieSameSite, CurrentSnapshot, ItemMutation, StorageItem } from '../core/types';
import { backupFilename, MASKED_VALUE } from '../ui/format';
import { getMessage } from '../ui/i18n';
import './styles.css';

type ActiveType = 'cookies' | 'localStorage' | 'sessionStorage';
type DisplayRow = {
  id: string;
  key: string;
  value: string;
  meta: string;
  source: CookieRecord | StorageItem;
};

type EditorState = {
  mode: 'add' | 'edit';
  row?: DisplayRow;
  key: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: CookieSameSite;
  session: boolean;
  expiration: string;
};

function expirationInput(value?: number): string {
  if (!value) return '';
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16);
}

function rowsFor(snapshot: CurrentSnapshot, type: ActiveType): DisplayRow[] {
  if (type === 'cookies') {
    return snapshot.cookies.map((cookie) => ({
      id: `cookie:${cookieIdentity(cookie)}`,
      key: cookie.name,
      value: cookie.value,
      meta: cookie.httpOnly ? 'HttpOnly' : cookie.sameSite,
      source: cookie,
    }));
  }
  return snapshot[type].map((item) => ({
    id: `${type}:${item.key}`,
    key: item.key,
    value: item.value,
    meta: `${new TextEncoder().encode(item.value).length} B`,
    source: item,
  }));
}

export function Popup() {
  const [snapshot, setSnapshot] = useState<CurrentSnapshot>();
  const [error, setError] = useState<string>();
  const [active, setActive] = useState<ActiveType>('cookies');
  const [query, setQuery] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [includeValues, setIncludeValues] = useState(true);
  const [exportTypes, setExportTypes] = useState({ cookies: true, localStorage: true, sessionStorage: true });
  const [editor, setEditor] = useState<EditorState>();
  const [mutationError, setMutationError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [requestingCookieAccess, setRequestingCookieAccess] = useState(false);

  const refreshSnapshot = async () => {
    try {
      const result = await getCurrentSnapshot();
      if (result.ok) {
        setSnapshot(result.data);
        setError(undefined);
      }
      else setError(result.error.code === 'UNSUPPORTED_PAGE' ? getMessage('unsupportedPage') : result.error.message);
    } catch {
      setError('The extension runtime is unavailable. Reload the extension and try again.');
    }
  };

  useEffect(() => {
    void refreshSnapshot();
  }, []);

  const rows = useMemo(() => snapshot ? rowsFor(snapshot, active).filter((row) => row.key.toLowerCase().includes(query.toLowerCase())) : [], [snapshot, active, query]);

  const allowCookieAccess = async () => {
    if (!snapshot) return;
    setRequestingCookieAccess(true);
    setMutationError(undefined);
    try {
      const granted = await requestCookieAccess(snapshot.context);
      if (!granted) {
        setMutationError(getMessage('cookieAccessDenied'));
        return;
      }
      await refreshSnapshot();
    } catch {
      setMutationError(getMessage('cookieAccessDenied'));
    } finally {
      setRequestingCookieAccess(false);
    }
  };

  const chooseTab = (type: ActiveType) => {
    setActive(type);
    setQuery('');
    setSelected(new Set());
    setRevealed(new Set());
    setEditor(undefined);
    setMutationError(undefined);
  };

  const openAddEditor = () => {
    if (!snapshot) return;
    setMutationError(undefined);
    setEditor({
      mode: 'add',
      key: '',
      value: '',
      path: '/',
      secure: new URL(snapshot.context.pageUrl).protocol === 'https:',
      httpOnly: false,
      sameSite: 'lax',
      session: true,
      expiration: '',
    });
  };

  const openEditEditor = (row: DisplayRow) => {
    const cookie = active === 'cookies' ? row.source as CookieRecord : undefined;
    setMutationError(undefined);
    setEditor({
      mode: 'edit',
      row,
      key: row.key,
      value: row.value,
      path: cookie?.path ?? '/',
      secure: cookie?.secure ?? false,
      httpOnly: cookie?.httpOnly ?? false,
      sameSite: cookie?.sameSite ?? 'lax',
      session: cookie?.session ?? true,
      expiration: expirationInput(cookie?.expirationDate),
    });
  };

  const runMutation = async (mutation: ItemMutation) => {
    if (!snapshot) return undefined;
    try {
      return await mutateItem({ context: snapshot.context, mutation });
    } catch {
      return undefined;
    }
  };

  const saveEditor = async () => {
    if (!snapshot || !editor || !editor.key.trim()) return;
    const key = editor.key.trim();
    let mutation: ItemMutation;
    if (active === 'cookies') {
      const originalCookie = editor.row?.source as CookieRecord | undefined;
      const expirationDate = editor.session || !editor.expiration
        ? undefined
        : new Date(editor.expiration).getTime() / 1000;
      const cookie: CookieRecord = {
        ...(originalCookie ?? {}),
        name: key,
        value: editor.value,
        domain: snapshot.context.hostname,
        path: editor.path.startsWith('/') ? editor.path : `/${editor.path}`,
        secure: editor.secure,
        httpOnly: editor.httpOnly,
        sameSite: editor.sameSite,
        session: editor.session,
        hostOnly: originalCookie?.hostOnly ?? true,
        ...(expirationDate ? { expirationDate } : {}),
      };
      if (editor.session) delete cookie.expirationDate;
      mutation = { type: 'cookie', operation: 'set', key, cookie, ...(originalCookie ? { originalCookie } : {}) };
    } else {
      mutation = { type: active, operation: 'set', key, value: editor.value };
    }

    setSaving(true);
    setMutationError(undefined);
    const result = await runMutation(mutation);
    setSaving(false);
    if (!result?.ok) {
      setMutationError(result?.error.message ?? getMessage('mutationFailed'));
      return;
    }
    setEditor(undefined);
    await refreshSnapshot();
  };

  const deleteRow = async (row: DisplayRow) => {
    if (!snapshot || !window.confirm(getMessage('deleteConfirm'))) return;
    const mutation: ItemMutation = active === 'cookies'
      ? { type: 'cookie', operation: 'remove', key: row.key, cookie: row.source as CookieRecord }
      : { type: active, operation: 'remove', key: row.key };
    const result = await runMutation(mutation);
    if (!result?.ok) {
      setMutationError(result?.error.message ?? getMessage('mutationFailed'));
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      next.delete(row.id);
      return next;
    });
    await refreshSnapshot();
  };

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportSelected = async () => {
    if (!snapshot || selected.size === 0) return;
    const ids = rowsFor(snapshot, active).filter((row) => selected.has(row.id)).map((row) => row.id.slice(row.id.indexOf(':') + 1));
    const backup = createBackup(snapshot, {
      includeValues: true,
      selection: active === 'cookies' ? { cookies: ids } : active === 'localStorage' ? { localStorage: ids } : { sessionStorage: ids },
    });
    await downloadText(backupFilename(snapshot.context.hostname), serializeBackup(backup), 'application/json');
  };

  const exportBackup = async () => {
    if (!snapshot) return;
    const backup = createBackup(snapshot, {
      includeValues,
      selection: {
        cookies: exportTypes.cookies ? undefined : [],
        localStorage: exportTypes.localStorage ? undefined : [],
        sessionStorage: exportTypes.sessionStorage ? undefined : [],
      },
    });
    await downloadText(backupFilename(snapshot.context.hostname), serializeBackup(backup), 'application/json');
    setExportOpen(false);
  };

  if (!snapshot) {
    return (
      <div className="popup-shell state-shell">
        <div className="brand-mark">SF</div>
        <h1>{getMessage('popupTitle')}</h1>
        <p className={error ? 'error-copy' : 'loading-copy'}>{error ?? getMessage('loading')}</p>
        <button className="button primary" disabled>{getMessage('openWorkspace')}</button>
      </div>
    );
  }

  const tabs: Array<{ id: ActiveType; label: string; count: number }> = [
    { id: 'cookies', label: getMessage('cookies'), count: snapshot.cookies.length },
    { id: 'localStorage', label: getMessage('localStorage'), count: snapshot.localStorage.length },
    { id: 'sessionStorage', label: getMessage('sessionStorage'), count: snapshot.sessionStorage.length },
  ];

  return (
    <div className="popup-shell">
      <header className="app-header">
        <div className="brand-row"><span className="brand-mark">SF</span><span>StateFerry</span></div>
        <span className="live-indicator"><i /> LIVE</span>
      </header>
      <section className="site-card">
        <strong>{snapshot.context.hostname}</strong>
        <span>{snapshot.context.pageUrl}</span>
      </section>
      <div className="tabs" role="tablist" aria-label={getMessage('popupTitle')}>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={active === tab.id ? 'tab active' : 'tab'} onClick={() => chooseTab(tab.id)}>
            {tab.label} <b>{tab.count}</b>
          </button>
        ))}
      </div>
      <div className="storage-toolbar">
        <input className="search" type="search" role="searchbox" placeholder={getMessage('search')} value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="add-button" aria-label={getMessage('addItem')} title={getMessage('addItem')} disabled={active === 'cookies' && snapshot.cookieAccess === 'required'} onClick={openAddEditor}>+</button>
      </div>
      {mutationError && <p className="mutation-error" role="alert">{mutationError}</p>}
      <section className="data-list" aria-live="polite">
        {active === 'cookies' && snapshot.cookieAccess === 'required' ? <div className="permission-state">
          <strong>{getMessage('cookieAccessTitle')}</strong>
          <p>{getMessage('cookieAccessDescription')}</p>
          <button type="button" className="button primary" disabled={requestingCookieAccess} onClick={() => void allowCookieAccess()}>{getMessage('allowCookieAccess')}</button>
        </div> : rows.length === 0 ? <p className="empty-state">{getMessage('empty')}</p> : rows.map((row) => (
          <article className="data-row" key={row.id}>
            <input type="checkbox" aria-label={`${getMessage('select')} ${row.key}`} checked={selected.has(row.id)} onChange={() => toggleSet(setSelected, row.id)} />
            <div className="data-copy">
              <strong>{row.key}</strong>
              <code>{revealed.has(row.id) ? row.value : MASKED_VALUE}</code>
            </div>
            <div className="row-actions">
              <span>{row.meta}</span>
              <button type="button" aria-label={`${revealed.has(row.id) ? getMessage('hide') : getMessage('reveal')} ${row.key}`} onClick={() => toggleSet(setRevealed, row.id)}>{revealed.has(row.id) ? '×' : '◉'}</button>
              <button type="button" aria-label={`${getMessage('copy')} ${row.key}`} onClick={() => void navigator.clipboard?.writeText(row.value)}>⧉</button>
              <button type="button" aria-label={`${getMessage('edit')} ${row.key}`} title={getMessage('edit')} onClick={() => openEditEditor(row)}>✎</button>
              <button type="button" className="danger-action" aria-label={`${getMessage('delete')} ${row.key}`} title={getMessage('delete')} onClick={() => void deleteRow(row)}>×</button>
            </div>
          </article>
        ))}
      </section>
      <div className="action-grid">
        <button type="button" className="button primary" disabled={selected.size === 0} onClick={() => void exportSelected()}>{getMessage('exportSelected')}</button>
        <button type="button" className="button tertiary" onClick={() => setExportOpen(true)}>{getMessage('exportBackup')}</button>
        <button type="button" className="button secondary" onClick={() => void openMigrationPage(snapshot.context)}>{getMessage('importBackup')}</button>
      </div>
      <button type="button" className="workspace-link" onClick={() => void openMigrationPage(snapshot.context)}>{getMessage('openWorkspace')} →</button>
      {editor && <div className="export-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <form className="export-dialog editor-dialog" onSubmit={(event) => { event.preventDefault(); void saveEditor(); }}>
          <div className="export-dialog-head">
            <h2 id="editor-title">{editor.mode === 'add' ? getMessage('addItem') : `${getMessage('edit')} ${editor.row?.key ?? ''}`}</h2>
            <button type="button" aria-label={getMessage('close')} onClick={() => setEditor(undefined)}>×</button>
          </div>
          <p className="export-help">{getMessage(editor.mode === 'add' ? 'addItemHint' : 'editItemHint')}</p>
          <label className="field-label">
            <span>{getMessage('key')}</span>
            <input aria-label={getMessage('key')} required value={editor.key} onChange={(event) => setEditor({ ...editor, key: event.target.value })} />
          </label>
          <label className="field-label">
            <span>{getMessage('value')}</span>
            <textarea aria-label={getMessage('value')} rows={4} value={editor.value} onChange={(event) => setEditor({ ...editor, value: event.target.value })} />
          </label>
          {active === 'cookies' && <div className="cookie-fields">
            <label className="field-label field-path"><span>{getMessage('path')}</span><input value={editor.path} onChange={(event) => setEditor({ ...editor, path: event.target.value })} /></label>
            <label className="field-label"><span>{getMessage('sameSite')}</span><select value={editor.sameSite} onChange={(event) => setEditor({ ...editor, sameSite: event.target.value as CookieSameSite })}><option value="lax">Lax</option><option value="strict">Strict</option><option value="no_restriction">None</option><option value="unspecified">Unspecified</option></select></label>
            <label className="check-field"><input type="checkbox" checked={editor.secure} onChange={(event) => setEditor({ ...editor, secure: event.target.checked })} /> {getMessage('secure')}</label>
            <label className="check-field"><input type="checkbox" checked={editor.httpOnly} onChange={(event) => setEditor({ ...editor, httpOnly: event.target.checked })} /> {getMessage('httpOnly')}</label>
            <label className="check-field"><input type="checkbox" checked={editor.session} onChange={(event) => setEditor({ ...editor, session: event.target.checked })} /> {getMessage('sessionCookie')}</label>
            {!editor.session && <label className="field-label expiration-field"><span>{getMessage('expires')}</span><input type="datetime-local" value={editor.expiration} onChange={(event) => setEditor({ ...editor, expiration: event.target.value })} /></label>}
          </div>}
          {mutationError && <p className="mutation-error" role="alert">{mutationError}</p>}
          <div className="export-dialog-actions">
            <button type="button" className="button muted" onClick={() => setEditor(undefined)}>{getMessage('cancel')}</button>
            <button type="submit" className="button primary" disabled={saving || !editor.key.trim()}>{getMessage('saveItem')}</button>
          </div>
        </form>
      </div>}
      {exportOpen && <div className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="export-dialog">
          <div className="export-dialog-head"><h2 id="export-title">{getMessage('exportBackup')}</h2><button type="button" aria-label={getMessage('close')} onClick={() => setExportOpen(false)}>×</button></div>
          <p className="export-help">{getMessage('chooseTypes')}</p>
          <div className="export-types">
            {(['cookies', 'localStorage', 'sessionStorage'] as const).map((type) => <label key={type}><input type="checkbox" checked={exportTypes[type]} onChange={() => setExportTypes((current) => ({ ...current, [type]: !current[type] }))} /> {getMessage(type === 'cookies' ? 'cookies' : type)}</label>)}
          </div>
          <label className="include-values"><input type="checkbox" aria-label={getMessage('includeSensitiveValues')} checked={includeValues} onChange={(event) => setIncludeValues(event.target.checked)} /> {getMessage('includeSensitiveValues')}</label>
          <div className="export-dialog-actions"><button type="button" className="button muted" onClick={() => setExportOpen(false)}>{getMessage('cancel')}</button><button type="button" className="button primary" disabled={!Object.values(exportTypes).some(Boolean)} onClick={() => void exportBackup()}>{getMessage('downloadBackup')}</button></div>
        </div>
      </div>}
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><Popup /></StrictMode>);
