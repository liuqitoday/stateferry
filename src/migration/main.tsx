import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPlan, downloadText, getCurrentSnapshot, getSnapshotForTab } from '../background/runtime-client';
import { createBackup } from '../core/backup-builder';
import { buildDiff } from '../core/diff-engine';
import { parseBackup } from '../core/backup-schema';
import type { ApplyReport, BackupDocument, CurrentSnapshot, DiffItem, ImportStrategy, TabContext } from '../core/types';
import { backupFilename } from '../ui/format';
import { getMessage } from '../ui/i18n';
import './styles.css';

type MigrationStep = 'file' | 'review' | 'report';

function queryContext(): TabContext | undefined {
  const params = new URLSearchParams(window.location.search);
  const tabId = Number(params.get('tabId'));
  const pageUrl = params.get('pageUrl');
  const origin = params.get('origin');
  if (!Number.isInteger(tabId) || !pageUrl || !origin) return undefined;
  try {
    return { tabId, pageUrl, origin, hostname: new URL(pageUrl).hostname, capturedAt: new Date().toISOString() };
  } catch {
    return undefined;
  }
}

function itemLabel(item: DiffItem): string {
  if (item.type === 'cookie') return `${getMessage('cookies')} · ${item.key}`;
  return `${item.type === 'localStorage' ? getMessage('localStorage') : getMessage('sessionStorage')} · ${item.key}`;
}

function reportJson(report: ApplyReport): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: report.finishedAt,
    context: { origin: report.context.origin, pageUrl: report.context.pageUrl },
    counts: report.counts,
    errors: report.results.filter((result) => result.status === 'failed').map((result) => ({
      id: result.id,
      errorCode: result.error?.code ?? 'UNKNOWN_ERROR',
      message: result.error?.message ?? 'Unknown error',
    })),
  }, null, 2)}\n`;
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsText(file);
  });
}

export function Migration({ initialContext = queryContext() }: { initialContext?: TabContext }) {
  const [context, setContext] = useState<TabContext | undefined>(initialContext);
  const [snapshot, setSnapshot] = useState<CurrentSnapshot>();
  const [step, setStep] = useState<MigrationStep>('file');
  const [backup, setBackup] = useState<BackupDocument>();
  const [plan, setPlan] = useState<ReturnType<typeof buildDiff>>();
  const [strategy, setStrategy] = useState<ImportStrategy>('merge');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<ApplyReport>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [includeValues, setIncludeValues] = useState(true);

  useEffect(() => {
    const load = initialContext ? getSnapshotForTab(initialContext) : getCurrentSnapshot();
    void load.then((result) => {
      if (result.ok) {
        setSnapshot(result.data);
        setContext((current) => current ?? result.data.context);
      } else setError(result.error.message);
      setLoading(false);
    }).catch(() => { setError('The extension runtime is unavailable. Reload the extension and try again.'); setLoading(false); });
  }, []);

  const reviewPlan = useMemo(() => {
    if (!backup || !snapshot) return undefined;
    return buildDiff(backup, snapshot, { strategy });
  }, [backup, snapshot, strategy]);

  useEffect(() => {
    if (!reviewPlan) return;
    setPlan(reviewPlan);
    setSelected(new Set(reviewPlan.items.filter((item) => item.status === 'add' || item.status === 'update').map((item) => item.id)));
  }, [reviewPlan]);

  const parseFile = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    if (file.size > 10 * 1024 * 1024) {
      setError('The selected file is larger than 10 MB.');
      return;
    }
    try {
      const result = parseBackup(await readFileText(file));
      if (!result.ok) {
        setError(result.error.code === 'UNSUPPORTED_SCHEMA_VERSION' ? 'This backup requires a newer extension.' : result.error.message);
        return;
      }
      setBackup(result.backup);
      setStep('review');
    } catch {
      setError('The selected file could not be read.');
    }
  };

  const applySelected = async () => {
    if (!context || !plan) return;
    setStep('report');
    const itemsForReport = plan.items.filter((item) => item.status === 'skip' || item.status === 'error' || selected.has(item.id));
    const result = await applyPlan(context, itemsForReport);
    if (result.ok) setReport(result.data);
    else setError(result.error.message);
  };

  const exportCurrent = async () => {
    if (!snapshot) return;
    const backup = createBackup(snapshot, { includeValues });
    await downloadText(backupFilename(snapshot.context.hostname), `${JSON.stringify(backup, null, 2)}\n`, 'application/json');
  };

  const downloadErrors = async () => {
    if (!report) return;
    await downloadText(`stateferry-errors-${report.context.hostname}.json`, reportJson(report), 'application/json');
  };

  if (loading || !snapshot || !context) {
    return <div className="migration-shell centered"><div className="brand-mark">SR</div><p>{loading ? getMessage('loading') : error}</p></div>;
  }

  return (
    <div className="migration-shell">
      <header className="migration-header">
        <div className="brand-row"><span className="brand-mark">SF</span><div><strong>StateFerry</strong><span> / {getMessage('importBackup')}</span></div></div>
        <div className="target-chip"><i /> {context.hostname}</div>
      </header>
      <section className="target-line"><strong>{context.origin}</strong><span>{context.pageUrl}</span></section>
      <div className="stepper" aria-label={getMessage('migrationSteps')}>
        <span className={step === 'file' ? 'step active' : 'step'}><b>1</b> {getMessage('fileStep')}</span>
        <span className={step === 'review' ? 'step active' : 'step'}><b>2</b> {getMessage('reviewStep')}</span>
        <span className={step === 'report' ? 'step active' : 'step'}><b>3</b> {getMessage('applyStep')}</span>
      </div>

      {step === 'file' && (
        <section className="panel file-panel">
          <div className="panel-heading"><div><h1>{getMessage('importBackup')}</h1><p>{getMessage('importDescription')}</p></div><span className="status-pill">{getMessage('currentTab')}</span></div>
          <div className="security-alert"><b>!</b><span>{getMessage('securityWarning')}</span></div>
          <div className="export-current">
            <div><strong>{getMessage('exportCurrent')}</strong><span>{getMessage('exportCurrentHint')}</span></div>
            <label><input type="checkbox" checked={includeValues} onChange={(event) => setIncludeValues(event.target.checked)} /> {getMessage('includeSensitiveValues')}</label>
            <button type="button" className="button tertiary" onClick={() => void exportCurrent()}>{getMessage('exportCurrent')}</button>
          </div>
          <label className="dropzone" htmlFor="backup-file">
            <span className="drop-icon">↥</span>
            <strong>{getMessage('chooseBackup')}</strong>
            <small>{getMessage('backupLimit')}</small>
            <input id="backup-file" aria-label={getMessage('chooseBackupFile')} type="file" accept="application/json,.json" onChange={(event) => void parseFile(event.target.files?.[0])} />
          </label>
          {error && <p className="inline-error">{error}</p>}
          <div className="panel-footer"><button type="button" className="button muted" disabled>{getMessage('cancel')}</button><button type="button" className="button primary" disabled>{getMessage('reviewFile')}</button></div>
        </section>
      )}

      {step === 'review' && plan && (
        <section className="panel review-panel">
          <div className="panel-heading"><div><h1>{getMessage('reviewIncoming')}</h1><p>{backup?.source.origin} → {context.origin}</p></div><span className="status-pill">{plan.counts.total} {getMessage('items')}</span></div>
          <div className="security-alert"><b>!</b><span>{getMessage('securityWarning')}</span></div>
          <div className="metric-grid"><div><strong>{plan.counts.total}</strong><span>{getMessage('itemsFound')}</span></div><div className="good"><strong>{plan.counts.add}</strong><span>{getMessage('newValues')}</span></div><div className="warn"><strong>{plan.counts.update}</strong><span>{getMessage('willUpdate')}</span></div><div className="bad"><strong>{plan.counts.error}</strong><span>{getMessage('errors')}</span></div></div>
          <fieldset className="strategy"><legend>{getMessage('conflictStrategy')}</legend><label><input type="radio" name="strategy" value="merge" checked={strategy === 'merge'} onChange={() => setStrategy('merge')} /> {getMessage('merge')}</label><label><input type="radio" name="strategy" value="overwrite" checked={strategy === 'overwrite'} onChange={() => setStrategy('overwrite')} /> {getMessage('overwrite')}</label></fieldset>
          <div className="diff-list" aria-label={getMessage('importDifferences')}>
            {plan.items.map((item) => <label className={`diff-row ${item.status}`} key={item.id}><input type="checkbox" aria-label={`${item.status} ${itemLabel(item)}`} checked={selected.has(item.id)} disabled={item.status === 'error' || item.status === 'skip'} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span className="diff-dot" /><span className="diff-name">{itemLabel(item)}<small>{item.error?.message ?? (item.domainRemapped ? getMessage('domainRemapped') : '')}</small></span><b>{item.status.toUpperCase()}</b></label>)}
          </div>
          {error && <p className="inline-error">{error}</p>}
          <div className="panel-footer"><button type="button" className="button muted" onClick={() => setStep('file')}>{getMessage('cancel')}</button><button type="button" className="button primary" disabled={selected.size === 0} onClick={() => void applySelected()}>{getMessage('applySelected')} ({selected.size})</button></div>
        </section>
      )}

      {step === 'report' && (
        <section className="panel report-panel">
            {!report ? <div className="centered"><p>{error ?? getMessage('applyingChanges')}</p></div> : <>
            <div className="report-heading"><div className="success-mark">✓</div><div><h1>{getMessage('migrationComplete')}</h1><p>{context.hostname} · {getMessage('justNow')}</p></div><span className="status-pill success">LIVE</span></div>
            <div className="report-metrics"><div aria-label={`${report.counts.succeeded} ${getMessage('succeeded')}`}><strong>{report.counts.succeeded}</strong><span>{getMessage('succeeded')}</span></div><div aria-label={`${report.counts.skipped} ${getMessage('skipped')}`}><strong>{report.counts.skipped}</strong><span>{getMessage('skipped')}</span></div><div className="bad" aria-label={`${report.counts.failed} ${getMessage('failed')}`}><strong>{report.counts.failed}</strong><span>{getMessage('failed')}</span></div></div>
            <div className="result-list">{report.results.map((result) => <div className={`result-row ${result.status}`} key={result.id}><span>{result.id}</span><b>{result.status.toUpperCase()}</b></div>)}</div>
            {report.counts.failed > 0 && <div className="report-callout"><span>{report.counts.failed} {getMessage('itemsNeedAttention')}</span><button type="button" className="button secondary" onClick={() => void downloadErrors()}>{getMessage('downloadReport')}</button></div>}
          </>}
        </section>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><Migration /></StrictMode>);
