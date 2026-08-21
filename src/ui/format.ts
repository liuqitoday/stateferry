import { currentLocale } from './i18n';

export const MASKED_VALUE = '••••••••••••';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

export function textBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function backupFilename(hostname: string, now = new Date()): string {
  return `stateferry-backup-${hostname}-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}
