import { readFile, access, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, pkg.version, `Version mismatch: dist/manifest.json (${manifest.version}) !== package.json (${pkg.version})`);
assert.ok(manifest.minimum_chrome_version, 'minimum_chrome_version must be set');
assert.ok(manifest.description && manifest.description.length <= 132, 'manifest description must be <= 132 chars for store compliance');
assert.equal(
  manifest.content_security_policy?.extension_pages,
  "script-src 'self'; object-src 'none'; base-uri 'none'",
  'Strict MV3 CSP must be preserved',
);
assert.deepEqual(manifest.host_permissions, [
  'https://www.linkedin.com/*',
  'https://linkedin.com/*',
  'https://chatgpt.com/*',
  // Gmail is driven through the person's own signed-in tab rather than the Gmail API: its restricted read scopes
  // would require a third-party security assessment before the extension could ship.
  'https://mail.google.com/*',
]);
// Nothing broad is granted at install. Optional sites are asked for one at a time, when the person acts: the OpenAI API
// when they save an API key, LinkedIn's image server when they choose to use their profile photo, and one job site's
// address when they press "Fill this application" there (the pattern only allows asking; each site is its own grant).
assert.deepEqual(
  manifest.optional_host_permissions ?? [],
  ['https://api.openai.com/*', 'https://media.licdn.com/*', 'https://*/*', 'http://*/*'],
  'Unexpected optional website access',
);
assert.ok(!(manifest.host_permissions ?? []).some(h => h.includes('*://*') || h === '<all_urls>'), 'Broad access must never be required');

for (const size of ['16', '32', '48', '128']) {
  assert.ok(manifest.icons?.[size], `Missing icon size ${size} in manifest.json`);
}

for (const file of [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  ...manifest.content_scripts.flatMap(s => s.js),
  ...Object.values(manifest.icons ?? {}),
  'apply.js',
  // The workbench is an extension-hosted page, not a separate web app: it must ship inside the package.
  'workbench.html',
  'workbench.js',
]) {
  await access(`dist/${file}`);
}

let hasPdfWorker = false;
async function inspect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${item.name}`;
    if (item.isDirectory()) {
      await inspect(file);
      continue;
    }
    assert.ok(!file.endsWith('.map'), `Source map leaked into dist package: ${file}`);
    if (/pdf\.worker\.min.*\.mjs$/.test(item.name)) hasPdfWorker = true;
    if (file.endsWith('.js')) {
      const code = await readFile(file, 'utf8');
      assert(!/\beval\s*\(|new\s+Function\s*\(|import\s*\(\s*['"]https?:/.test(code), `Unsafe code in ${file}`);
    }
  }
}
await inspect('dist');
assert.ok(hasPdfWorker, 'Bundled PDF.js worker asset missing from dist/assets/');
console.log(`MV3 build v${manifest.version} verified: entry points, icons, PDF worker, CSP, zero source maps or unsafe code.`);
