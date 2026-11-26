import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDatabase, openDatabase } from '../src/storage/database';
import { read, write } from '../src/storage/state';
import { allTasks } from '../src/shared/persistence/campaign-store';
import { emptyNetwork, networkKey, type NetworkState } from '../src/shared/network';
import { migrateV6ToV7, V7_MIGRATED_KEY } from '../src/background/migration-v7';

describe('v6 -> v7 unified queue migration', () => {
  beforeEach(async () => {
    await openDatabase();
    await clearDatabase();
  });

  it('migrates legacy applyQueue, apply-history, and referralJobs.applied into applications store idempotently', async () => {
    const net: NetworkState = {
      ...emptyNetwork(),
      target: 'Software Engineer',
      targetSet: true,
      location: 'India',
      applyQueue: ['https://www.linkedin.com/jobs/view/111/'],
      referralJobs: [
        {
          url: 'https://www.linkedin.com/jobs/view/111/',
          title: 'Backend Intern',
          company: 'Acme Corp',
          location: 'Bengaluru',
          mode: 'referral',
          cursor: 0,
          addedAt: 1000,
          found: 0,
        },
        {
          url: 'https://www.linkedin.com/jobs/view/222/',
          title: 'Frontend Intern',
          company: 'Beta Labs',
          location: 'Remote',
          mode: 'referral',
          cursor: 0,
          addedAt: 1000,
          found: 0,
          applied: 2000,
        },
      ],
    };
    await write(networkKey, net);
    await write('apply-history', [{ title: 'Data Intern', company: 'Gamma AI', url: 'https://www.linkedin.com/jobs/view/333/', at: 3000 }]);

    const first = await migrateV6ToV7(5000);
    expect(first.migratedQueued).toBe(1);
    expect(first.migratedSubmitted).toBe(2);

    const tasks = await allTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks.find(t => t.url.includes('111'))?.state).toBe('queued');
    expect(tasks.find(t => t.url.includes('222'))?.state).toBe('submitted');
    expect(tasks.find(t => t.url.includes('333'))?.state).toBe('submitted');

    const updatedNet = await read<NetworkState>(networkKey);
    expect(updatedNet?.applyQueue).toEqual([]);
    expect(await read<boolean>(V7_MIGRATED_KEY)).toBe(true);

    // Second run is a no-op
    const second = await migrateV6ToV7(6000);
    expect(second).toEqual({ migratedQueued: 0, migratedSubmitted: 0 });
  });
});
