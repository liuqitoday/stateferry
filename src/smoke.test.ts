import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension manifest', () => {
  it('uses the StateFerry product identity', () => {
    const locales = JSON.parse(readFileSync(resolve(process.cwd(), 'public/_locales/en/messages.json'), 'utf8')) as Record<string, { message: string }>;
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { name: string; version: string };
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')) as { version: string };
    expect(locales.appName.message).toBe('StateFerry');
    expect(locales.appDescription.message).toMatch(/current tab/i);
    expect(packageJson.name).toBe('stateferry');
    expect(manifest.version).toBe(packageJson.version);
  });

  it('declares every Chrome extension icon size', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')) as {
      icons?: Record<string, string>;
      action?: { default_icon?: Record<string, string> };
    };
    const expected = {
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    };

    expect(manifest.icons).toEqual(expected);
    expect(manifest.action?.default_icon).toEqual(expected);
    for (const path of Object.values(expected)) {
      expect(existsSync(resolve(process.cwd(), 'public', path))).toBe(true);
    }
  });

  it('declares the current-tab MV3 runtime without broad host permissions', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.default_locale).toBe('en');
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['activeTab', 'scripting', 'cookies', 'downloads']),
    );
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect((manifest.action as Record<string, unknown>).default_popup).toBe('popup.html');
    expect((manifest.background as Record<string, unknown>).service_worker).toBe('background.js');
  });

  it('keeps manifest targets at the build root', () => {
    if (!existsSync(resolve(process.cwd(), 'dist/manifest.json'))) return;

    expect(existsSync(resolve(process.cwd(), 'dist/popup.html'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'dist/migration.html'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'dist/background.js'))).toBe(true);
  });
});
