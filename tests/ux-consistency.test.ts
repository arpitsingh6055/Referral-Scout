import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classify } from '../src/shared/targeting';
import { resolveMacroJourney } from '../src/shared/progress-store';
import { applications } from '../src/ui/workbench/screens/applications';
import { overview, overviewHeader } from '../src/ui/workbench/screens/overview';
import { newCampaign } from '../src/shared/domain/campaign';
import { emptyProfile } from '../src/shared/domain/profile';
import type { Ctx } from '../src/ui/workbench/shell';

describe('UI/UX & functional review fixes (v0.61.0)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('never misclassifies curly-apostrophe "Founder’s Office Associate" as a Founder', () => {
    const verdict = classify(
      {
        headline: 'Lawyer || Founder’s Office Associate || Cross-border Advisory',
        degree: 2,
      },
      { roles: ["Founder's Office Intern"] },
    );
    expect(verdict).toBeNull();
  });

  it('does not show 100% progress before any job is queued or submitted', () => {
    const stage5 = resolveMacroJourney({
      route: 'applications',
      linkedinConnected: true,
      cvHasText: true,
      cvImported: true,
      hasAiDraft: false,
      pendingConflictsCount: 0,
      missingRequiredIdentity: null,
      hasCampaign: true,
      jobsCount: 63,
      shortlistedCount: 13,
      queuedCount: 0,
      submittedCount: 0,
      inboxOpen: 0,
      inboxUrgent: 0,
      peopleCount: 59,
    });
    expect(stage5.percent).toBeLessThan(100);
    expect(stage5.mode).toBe('completion');
    expect(stage5.title).toContain('13 Shortlisted');
  });

  it('offers "Queue N shortlisted" as primary action on empty Application queue when shortlisted jobs exist', () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const campaign = newCampaign({ name: "FOUNDER'S OFFICE search", targetRoles: ["FOUNDER'S OFFICE"], location: 'REMOTE' });
    const ctx = {
      view: {
        campaign,
        counts: { queued: 0, running: 0, needsYou: 0, submitted: 0, uncertain: 0, failed: 0, skipped: 0, total: 0 },
        inbox: [],
        inboxCounts: { open: 0, urgent: 0, blocked: 0, questions: 0 },
        queue: [],
        facts: [],
        factSections: [],
        completeness: { complete: 4, total: 15, missing: [] },
        stages: [],
        events: [],
        workers: { active: 0, limit: 1 },
        peopleIdentified: 59,
        replies: 2,
      },
      workspace: {
        profile: emptyProfile(),
        conflicts: [],
        facts: [],
        factSections: [],
        completeness: { complete: 4, total: 15, missing: [] },
        jobs: [
          {
            id: 'j1',
            company: 'Revolut',
            title: "Founder's Office Intern",
            location: 'Remote',
            url: 'https://www.linkedin.com/jobs/view/1/',
            source: 'LinkedIn Jobs',
            applyType: 'unknown',
            fit: 0,
            fitAssessed: false,
            tier: 'weak',
            eligibility: 'unknown',
            freshness: 'unknown',
            evidence: [],
            checks: [],
            rejectionReasons: [],
            preferenceNotes: [],
            judgement: 'shortlisted',
            rank: 1,
          },
        ],
        contacts: [],
        connections: { linkedin: true, ai: false, gmail: false, cv: true },
        surface: 'panel',
        cv: { hasText: true, imported: true },
        usageReporting: false,
        outreachAutomatic: false,
        storage: { jobs: 1, applications: 0, contacts: 0, events: 0, facts: 0 },
      },
      theme: 'system',
      setTheme: vi.fn(),
      run,
      runNetwork: vi.fn(),
      openExternal: vi.fn(),
      inform: vi.fn(),
      go: vi.fn(),
      openPanel: vi.fn(),
      redraw: vi.fn(),
      refresh: vi.fn(),
      busyAction: '',
    } as unknown as Ctx;

    const appScreen = applications(ctx);
    expect(appScreen.textContent).toContain('Queue 1 shortlisted');

    const ovHeader = overviewHeader(ctx);
    expect(ovHeader.title).toBe('Overview');
    const ovScreen = overview(ctx);
    expect(ovScreen.textContent).toContain('Shortlisted jobs');
    expect(ovScreen.textContent).toContain('Unscored');
  });
});
