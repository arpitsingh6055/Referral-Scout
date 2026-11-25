import { access, readFile, rename, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(manifest.version, pkg.version, 'Run pnpm build so dist/manifest.json matches package.json version.');

await access('dist/workbench.html');
await access('dist/sidepanel.html');
await rm('referral-scout.zip.pending', { force: true });

if (process.platform === 'win32') {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::CreateFromDirectory((Join-Path (Get-Location) 'dist'), (Join-Path (Get-Location) 'referral-scout.zip.pending'))",
    ],
    { stdio: 'inherit' },
  );
} else {
  execFileSync('zip', ['-qr', '../referral-scout.zip.pending', '.'], { cwd: 'dist', stdio: 'inherit' });
}

await access('referral-scout.zip.pending');
await rm('referral-scout.zip', { force: true });
await rename('referral-scout.zip.pending', 'referral-scout.zip');

const zipBytes = await readFile('referral-scout.zip');
const zipStat = await stat('referral-scout.zip');
const sha256 = createHash('sha256').update(zipBytes).digest('hex');

console.log(`Created referral-scout.zip (v${manifest.version}, ${(zipStat.size / 1024).toFixed(1)} kB, sha256:${sha256})`);
