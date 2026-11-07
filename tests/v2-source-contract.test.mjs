import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const src = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const manifest = JSON.parse(src('manifest.json'));
const pkg = JSON.parse(src('package.json'));
test('manifest and source versions are unified', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(pkg.version, manifest.version);
  assert.deepEqual(manifest.host_permissions, ['https://www.linkedin.com/*', 'https://linkedin.com/*', 'https://chatgpt.com/*']);
});
test('ChatGPT DOM job stages are persistently acknowledged', () => {
  const bg=src('src/background/network-ai.ts'), page=src('src/content/network-ai.ts');
  for (const tag of ['network.ai.event','aiJobs','documentId','response_extracted']) assert.match(bg, new RegExp(tag.replace('.', '\\.')));
  for (const tag of ['COLD_CONTACT_JOB','prompt_inserted','insertion_verified','user_turn_verified','assistant_streaming']) assert.ok(page.includes(tag), tag);
});
test('own-profile import does not call dossier generation', () => {
  const code=src('src/background/network-messages.ts');
  const imp=code.slice(code.indexOf('async function importProfile'),code.indexOf('async function clearAllNetwork'));
  assert.doesNotMatch(imp, /prepareDossier|askChatGpt/);
});
test('CV save contract does not accept raw binary or base64', () => {
  const code=src('src/shared/network.ts'), page=src('src/content/network.ts');
  assert.match(code,/action:z\.literal\('saveCv'\).*?text:z\.string\(\)/);
  assert.doesNotMatch(page,/input\[type=['"]file|\.files\[|\.base64/);
});
test('jobs and people search paths are present', () => {
  assert.match(src('src/background/network.ts'),/jobs\/search\//);
  assert.match(src('src/background/network.ts'),/search\/results\/people\//);
  assert.match(src('src/parsers/network.ts'),/networkJobs/);
});
test('invitation note uses visible modal, not forced no-note shortcut', () => {
  const code=src('src/content/network.ts');
  assert.match(code,/add a note/);
  assert.match(code,/Pending|pending/);
  assert.doesNotMatch(code,/button\([^)]*\/\^send without a note\$/);
});
test('acceptance has explicit 24-hour due-time tracking', () => {
  const code=src('src/background/network.ts');
  assert.match(code,/nextCheckAt=now\+DAY/);
  assert.match(code,/nextCheckAt=p\.requestedAt\+DAY/);
  assert.match(src('src/shared/network.ts'),/now>=\(p\.nextCheckAt/);
});
test('default settings are conservative, and every limit can still be cleared by the user', () => {
  const code=src('src/shared/network.ts');
  assert.match(code,/dailyInvites:15,dailyMessages:20,maxPending:100/);
  assert.match(code,/weeklyInvites:80/);
  assert.match(code,/outreachMode:'review'/);
  // limits stay optional in the schema, so "blank = none" remains an explicit user choice
  assert.match(code,/dailyInvites:z\.number\(\)\.int\(\)\.positive\(\)\.nullable\(\)/);
});
test('different ChatGPT invitation and follow-up prompt kinds exist', () => {
  const code=src('src/background/network-ai.ts');
  assert.match(code,/WRITE_INVITATION_NOTE/);
  assert.match(code,/WRITE_ACCEPTANCE_FOLLOWUP/);
});
