import type { SupportedLocale } from './types';

export function normalizeLocale(uiLanguage: string | undefined): SupportedLocale {
  if (!uiLanguage) return 'en';

  const normalized = uiLanguage.replace('_', '-').toLowerCase();
  if (['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant'].some((value) => normalized.startsWith(value))) {
    return 'zh-TW';
  }
  if (normalized === 'zh' || normalized.startsWith('zh-cn') || normalized.startsWith('zh-sg') || normalized.startsWith('zh-hans')) {
    return 'zh-CN';
  }
  return 'en';
}

export function formatNumber(value: number, uiLanguage?: string): string {
  return new Intl.NumberFormat(normalizeLocale(uiLanguage)).format(value);
}

export function formatDate(value: string | number | Date, uiLanguage?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(normalizeLocale(uiLanguage), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

