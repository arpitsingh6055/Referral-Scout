import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDatabase } from '../src/storage/database';
import { emptyNetwork } from '../src/shared/network';
import { updateNetwork } from '../src/background/network';
import { importJobs, ensureDefaultCampaignFromNetwork } from '../src/background/bridge';
import { migrateV5ToV6, V6_MIGRATED_KEY } from '../src/background/migration-v6';
import { allJobs, activeCampaign } from '../src/shared/persistence/campaign-store';
import { read } from '../src/storage/state';
import { copyLinkButton, errorStateWithRetry, externalLink, paginateControls } from '../src/ui/workbench/dom';
import { buildDiagnosticsSummary } from '../src/ui/workbench/screens/settings';
import type { Ctx } from '../src/ui/workbench/shell';

describe('Unified Dashboard, Bridge & Accessibility Helpers', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('bridges referralJobs (including applied status) and auto-provisions default Campaign', async () => {
    const s = emptyNetwork();
    s.targetSet = true;
    s.target = 'Product Intern';
    s.location = 'Bengaluru';
    s.referralJobs = [
      {
        url: 'https://www.linkedin.com/jobs/view/9001/',
        title: 'Product Management Intern',
        company: 'Acme Labs',
        location: 'Bengaluru',
        mode: 'referral',
        addedAt: 1000,
        cursor: 2,
        found: 3,
        finishedAt: 2000,
        applied: 2500,
      },
    ];
    await updateNetwork(() => s);

    const report = await migrateV5ToV6(3000);
    expect(report.jobsAdded).toBe(1);
    expect(await read<boolean>(V6_MIGRATED_KEY)).toBe(true);

    const campaign = await activeCampaign();
    expect(campaign).toBeDefined();
    expect(campaign?.targetRoles).toContain('Product Management internship');

    const jobs = await allJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.userJudgement).toBe('applied');

    // Idempotent second call
    const second = await migrateV5ToV6(4000);
    expect(second).toEqual({ jobsAdded: 0, jobsUpdated: 0, contactsAdded: 0 });
    expect(await ensureDefaultCampaignFromNetwork()).toBeDefined();
    expect(await importJobs()).toBeDefined();
  });

  it('renders validated external links with rel=noopener noreferrer and graceful missing-URL fallback', () => {
    const valid = externalLink('Product Intern', 'https://www.linkedin.com/jobs/view/123/');
    expect(valid.tagName).toBe('A');
    expect(valid.getAttribute('href')).toBe('https://www.linkedin.com/jobs/view/123/');
    expect(valid.getAttribute('target')).toBe('_blank');
    expect(valid.getAttribute('rel')).toBe('noopener noreferrer');

    const bad = externalLink('Broken Job', 'javascript:alert(1)');
    expect(bad.tagName).toBe('SPAN');
    expect(bad.getAttribute('href')).toBeNull();

    const missing = externalLink('No Link', undefined);
    expect(missing.tagName).toBe('SPAN');

    expect(copyLinkButton('https://www.linkedin.com/in/someone/', 'Copy')).not.toBeNull();
    expect(copyLinkButton('javascript:void(0)', 'Copy')).toBeNull();
  });

  it('paginates large datasets (200+ items) and renders recoverable retry error states', async () => {
    let pageSeen = 1;
    const pager = paginateControls(200, 2, 50, next => {
      pageSeen = next;
    });
    expect(pager).not.toBeNull();
    expect(pager?.textContent).toContain('Showing 51–100 of 200');
    expect(pager?.textContent).toContain('Page 2 of 4');
    const nextBtn = [...pager!.querySelectorAll('button')].find(b => b.textContent === 'Next')!;
    nextBtn.click();
    await vi.waitFor(() => expect(pageSeen).toBe(3));

    let retried = false;
    const err = errorStateWithRetry('Could not load', 'Local store timed out.', () => {
      retried = true;
    });
    err.querySelector('button')!.click();
    await vi.waitFor(() => expect(retried).toBe(true));
  });

  it('produces non-PII diagnostics summary without emails, names, or CV text', () => {
    const fakeCtx = {
      theme: 'dark',
      view: {
        campaign: { status: 'running' },
        counts: { total: 12, submitted: 3, needsYou: 1, failed: 0 },
        events: new Array(9).fill({}),
      },
      workspace: {
        connections: { linkedin: true, gmail: false, ai: false, cv: true },
        cv: { hasText: true, imported: false },
        jobs: new Array(40).fill({}),
        contacts: new Array(18).fill({}),
        profile: { email: 'secret@example.com', fullName: 'Arpit Singh' },
      },
    } as unknown as Ctx;

    const json = buildDiagnosticsSummary(fakeCtx);
    expect(json).not.toContain('secret@example.com');
    expect(json).not.toContain('Arpit Singh');
    expect(json).toContain('"jobs": 40');
    expect(json).toContain('"queueSubmitted": 3');
  });
});
