import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { put, get, all, closeDatabase, clearDatabase } from '../src/storage/database';
afterEach(async () => {
  await clearDatabase();
  await closeDatabase();
});
it('persists records across database reconnects', async () => {
  await put('meta', { id: 'job', value: { state: 'awaiting_reply' } });
  await closeDatabase();
  expect(await get('meta', 'job')).toEqual({ id: 'job', value: { state: 'awaiting_reply' } });
});
it('updates by key without duplicates and clears every store', async () => {
  await put('aiJobs', { id: 'job1', owner: 'me', createdAt: 1, stage: 'queued' });
  await put('aiJobs', { id: 'job1', owner: 'me', createdAt: 1, stage: 'done' });
  expect(await all('aiJobs')).toEqual([{ id: 'job1', owner: 'me', createdAt: 1, stage: 'done' }]);
  await put('meta', { id: 'test', value: true });
  await clearDatabase();
  expect(await all('aiJobs')).toEqual([]);
  expect(await get('meta', 'test')).toBeUndefined();
});

it('removes finished ChatGPT tasks after two weeks but keeps running ones and the newest dossier', async () => {
  const { pruneAiJobs } = await import('../src/background/network-ai');
  const day = 86400000,
    now = 100 * day;
  const job = (id: string, kind: string, stage: string, age: number) => ({
    id,
    owner: 'me',
    kind,
    stage,
    createdAt: now - age,
    updatedAt: now - age,
  });
  for (const j of [
    job('old-fill', 'FILL_APPLICATION', 'response_extracted', 20 * day),
    job('old-failed', 'WRITE_INVITATION_NOTE', 'failed', 30 * day),
    job('recent', 'FILL_APPLICATION', 'response_extracted', 2 * day),
    job('running', 'FILL_APPLICATION', 'assistant_streaming', 40 * day),
    job('dossier', 'BUILD_DOSSIER', 'response_extracted', 60 * day),
  ]) {
    await put('aiJobs', j);
    await put('meta', { id: `network-ai:${j.id}`, value: j });
  }
  expect(await pruneAiJobs(now)).toBe(2);
  expect((await all('aiJobs')).map(j => j.id).sort()).toEqual(['dossier', 'recent', 'running']);
  expect(await get('meta', 'network-ai:old-fill')).toBeUndefined();
});
