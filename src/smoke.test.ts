import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension manifest', () => {
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
