import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const fail = (message) => { throw new Error(`Release audit failed: ${message}`); };
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const existsFile = async (path) => (await stat(path).catch(() => undefined))?.isFile() === true;

if (!await existsFile(resolve(dist, 'manifest.json'))) fail('dist/manifest.json is missing');
const manifest = await readJson(resolve(dist, 'manifest.json'));
const pkg = await readJson(resolve(root, 'package.json'));
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (manifest.default_locale !== 'en') fail('default_locale must be en');
if (manifest.version !== pkg.version) fail('manifest and package versions differ');
if (Object.hasOwn(manifest, 'host_permissions')) fail('host_permissions must be absent for current-tab scope');
for (const permission of ['activeTab', 'scripting', 'cookies', 'downloads']) {
  if (!manifest.permissions?.includes(permission)) fail(`missing permission ${permission}`);
}
for (const file of ['popup.html', 'popup.js', 'migration.html', 'migration.js', 'background.js']) {
  if (!await existsFile(resolve(dist, file))) fail(`missing dist/${file}`);
}
const iconMap = { '16': 'icons/icon16.png', '32': 'icons/icon32.png', '48': 'icons/icon48.png', '128': 'icons/icon128.png' };
for (const [size, path] of Object.entries(iconMap)) {
  if (manifest.icons?.[size] !== path || manifest.action?.default_icon?.[size] !== path) fail(`icon ${size} is not declared twice`);
  if (!await existsFile(resolve(dist, path))) fail(`missing ${path}`);
  const png = await readFile(resolve(dist, path));
  if (png.readUInt32BE(16) !== Number(size) || png.readUInt32BE(20) !== Number(size)) fail(`${path} has the wrong dimensions`);
}
let localeKeys;
for (const locale of ['en', 'zh_CN', 'zh_TW']) {
  const messages = await readJson(resolve(dist, '_locales', locale, 'messages.json'));
  if (!messages.appName?.message) fail(`${locale} catalog is missing appName`);
  const keys = Object.keys(messages).sort();
  localeKeys ??= keys;
  if (JSON.stringify(keys) !== JSON.stringify(localeKeys)) fail(`${locale} catalog keys differ from en`);
}
const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
};
for (const file of await walk(dist)) {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (/(?:src|href)=["']https?:\/\//i.test(text) || /(?:import\s*\(|from\s*)["'`]?https?:\/\//i.test(text)) {
    fail(`remote script or module found in ${relative(root, file)}`);
  }
  if (file.endsWith('.map')) fail(`source map found in ${relative(root, file)}`);
}
console.log('StateFerry release audit passed');
