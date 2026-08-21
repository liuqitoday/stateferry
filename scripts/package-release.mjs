import { mkdir, rm, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = process.cwd();
const releaseDir = resolve(root, 'release');
const staging = resolve(releaseDir, 'stateferry');
const version = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(root, 'package.json'), 'utf8')).version;
await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
await cp(resolve(root, 'dist'), staging, { recursive: true });
const archive = resolve(releaseDir, `stateferry-${version}.zip`);
await exec('zip', ['-qr', archive, '.'], { cwd: staging });
await rm(staging, { recursive: true, force: true });
console.log(`Created ${archive}`);
