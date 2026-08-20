import type { ApplyReport, CurrentSnapshot, DiffItem, RuntimeResponse, TabContext } from '../core/types';
import type { RuntimeMessage } from './service-worker';

async function send<T>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}

export function getCurrentContext(): Promise<RuntimeResponse<TabContext>> {
  return send({ type: 'GET_CONTEXT' });
}

export function getCurrentSnapshot(): Promise<RuntimeResponse<CurrentSnapshot>> {
  return send({ type: 'GET_SNAPSHOT' });
}

export function applyPlan(context: TabContext, items: DiffItem[]): Promise<RuntimeResponse<ApplyReport>> {
  return send({ type: 'APPLY_PLAN', context, items });
}

export function downloadText(filename: string, text: string, mimeType = 'application/json'): Promise<RuntimeResponse<{ downloadId: number }>> {
  return send({ type: 'DOWNLOAD_TEXT', filename, text, mimeType });
}

export function openMigrationPage(context: TabContext): Promise<RuntimeResponse<{ tabId?: number }>> {
  return send({ type: 'OPEN_MIGRATION', context });
}

