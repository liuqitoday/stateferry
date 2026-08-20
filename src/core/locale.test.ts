import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber, normalizeLocale } from './locale';

describe('locale helpers', () => {
  it('normalizes simplified Chinese variants', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh-SG')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans')).toBe('zh-CN');
    expect(normalizeLocale('zh')).toBe('zh-CN');
  });

  it('normalizes traditional Chinese variants', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh-TW');
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeLocale('zh-MO')).toBe('zh-TW');
  });

  it('falls back to English for all other or missing locales', () => {
    expect(normalizeLocale('de-DE')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
  });

  it('formats counts and dates with the normalized locale', () => {
    expect(formatNumber(1234567, 'zh-CN')).toContain('1,234,567');
    expect(formatDate('2026-08-20T06:30:00.000Z', 'en')).toMatch(/2026/);
  });
});
