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
