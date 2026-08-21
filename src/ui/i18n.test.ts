import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessage } from './i18n';

describe('UI translations', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses simplified Chinese for zh-SG even when Chrome falls back to an English message', () => {
    vi.stubGlobal('chrome', {
      i18n: {
        getUILanguage: vi.fn(() => 'zh-SG'),
        getMessage: vi.fn(() => 'Current site storage'),
      },
    });

    expect(getMessage('popupTitle')).toBe('当前站点存储');
  });

  it('uses traditional Chinese for zh-HK and English for other locales', () => {
    vi.stubGlobal('chrome', { i18n: { getUILanguage: vi.fn(() => 'zh-HK'), getMessage: vi.fn(() => '') } });
    expect(getMessage('popupTitle')).toBe('目前網站儲存空間');

    vi.stubGlobal('chrome', { i18n: { getUILanguage: vi.fn(() => 'fr-FR'), getMessage: vi.fn(() => '') } });
    expect(getMessage('popupTitle')).toBe('Current site storage');
  });
});
