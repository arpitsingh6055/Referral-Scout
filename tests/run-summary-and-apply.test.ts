import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyNetwork } from '../src/shared/network';
import { deriveRunSummary, EMPTY_SEARCH_SUGGESTIONS } from '../src/shared/run-summary';
import { resolveJobApplyStatus } from '../src/shared/apply-status';
import { stageCounts } from '../src/ui/pipeline';
import { migrateV4ToV5, V5_MIGRATED_KEY } from '../src/background/migration-v5';
import { HISTORY_KEY } from '../src/background/apply';
import { updateNetwork, getNetwork } from '../src/background/network';
import { read, write } from '../src/storage/state';
import { clearDatabase } from '../src/storage/database';

describe('RunSummary & Unified Apply Status', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('derives shortlist success and empty suggestions deterministically', () => {
    const s = emptyNetwork();
    s.jobSearch = {
      status: 'choosing',
      cursor: 4,
      startedAt: 1000,
      found: [
        {
          id: '101',
          url: 'https://www.linkedin.com/jobs/view/101/',
          title: 'Product Intern',
          company: 'Acme',
          location: 'Remote',
          insight: '',
          term: 'product intern',
          score: 80,
          fit: 88,
          prioritized: true,
          why: 'Matches your product internship background',
          picked: true,
        },
      ],
      dropped: [{ title: 'Ad', company: 'Spam', why: 'Promoted advert' }],
    };

    const summary = deriveRunSummary(s, 5000);
    expect(summary).toBeDefined();
    expect(summary?.phase).toBe('shortlist');
    expect(summary?.outcome).toBe('success');
    expect(summary?.jobsRead).toBe(2);
    expect(summary?.companiesFound).toBe(1);
    expect(summary?.strongMatches).toBe(1);
    expect(summary?.topMatches?.[0]?.why).toContain('product internship');

    s.jobSearch.found = [];
    const empty = deriveRunSummary(s, 6000);
    expect(empty?.outcome).toBe('empty');
    expect(empty?.suggestions).toEqual([...EMPTY_SEARCH_SUGGESTIONS]);
  });

  it('preserves dismissedAt while staying in the same phase and outcome', () => {
    const s = emptyNetwork();
    s.jobSearch = {
      status: 'choosing',
      cursor: 2,
      startedAt: 1000,
      found: [
        {
          id: '101',
          url: 'https://www.linkedin.com/jobs/view/101/',
          title: 'Analyst',
          company: 'Beta',
          location: 'Bengaluru',
          insight: '',
          term: 'analyst',
          score: 70,
          picked: true,
        },
      ],
    };
    const first = deriveRunSummary(s, 2000)!;
    s.lastRun = { ...first, dismissedAt: 2500 };

    const again = deriveRunSummary(s, 3000)!;
    expect(again.dismissedAt).toBe(2500);
  });

  it('resolves unified application status across session, history, manual flag, and Gmail', () => {
    const job = {
      url: 'https://www.linkedin.com/jobs/view/555/',
      company: 'Gamma Corp',
    };

    expect(resolveJobApplyStatus(job).stage).toBe('not-started');

    expect(
      resolveJobApplyStatus(job, {
        session: { url: job.url, stage: 'review', askCount: 1 },
      }).stage,
    ).toBe('needs-review');

    expect(
      resolveJobApplyStatus(job, {
        history: [{ title: 'PM', company: 'Gamma Corp', url: 'https://www.linkedin.com/jobs/view/555', at: 12345 }],
      }),
    ).toEqual({
      stage: 'applied',
      label: 'Applied',
      appliedAt: 12345,
      source: 'autofill',
    });

    expect(resolveJobApplyStatus({ ...job, applied: 9999 }, {})).toEqual({
      stage: 'applied',
      label: 'Applied',
      appliedAt: 9999,
      source: 'manual',
    });

    expect(
      resolveJobApplyStatus(job, {
        gmailConfirmedCompanyKeys: new Set(['gamma corp']),
      }).gmailSuggested,
    ).toBe(true);
  });

  it('merges apply-history into Pipeline stageCounts', () => {
    const counts = stageCounts(
      [],
      [
        {
          url: 'https://www.linkedin.com/jobs/view/1/',
          title: 'Role A',
          company: 'Co A',
          location: '',
          mode: 'referral',
          addedAt: 1,
          cursor: 0,
          found: 0,
        },
        {
          url: 'https://www.linkedin.com/jobs/view/2/',
          title: 'Role B',
          company: 'Co B',
          location: '',
          mode: 'referral',
          addedAt: 1,
          cursor: 0,
          found: 0,
          applied: 500,
        },
      ],
      [{ title: 'Role A', company: 'Co A', url: 'https://www.linkedin.com/jobs/view/1/', at: 800 }],
    );
    expect(counts[4]).toBe(2);
  });

  it('runs idempotent v4 -> v5 migration without losing existing data', async () => {
    const s = emptyNetwork();
    s.referralJobs = [
      {
        url: 'https://www.linkedin.com/jobs/view/777/',
        title: 'SDE Intern',
        company: 'Delta',
        location: 'Remote',
        mode: 'referral',
        addedAt: 100,
        cursor: 1,
        found: 0,
        finishedAt: 200,
      },
    ];
    await updateNetwork(() => s);
    await write(HISTORY_KEY, [{ title: 'SDE Intern', company: 'Delta', url: 'https://www.linkedin.com/jobs/view/777/', at: 900 }]);

    const res1 = await migrateV4ToV5(1000);
    expect(res1.syncedApplied).toBe(1);
    expect(await read<boolean>(V5_MIGRATED_KEY)).toBe(true);

    const updated = await getNetwork();
    expect(updated.referralJobs?.[0]?.applied).toBe(900);
    expect(updated.lastRun).toBeDefined();

    const res2 = await migrateV4ToV5(2000);
    expect(res2).toEqual({ syncedApplied: 0, backfilledRun: false });
  });
});
