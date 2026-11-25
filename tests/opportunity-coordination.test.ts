import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  checkOutreachCollision,
  deriveOpportunityStage,
  evaluateReadiness,
  matchConversationOpportunity,
  reconcileActions,
} from '../src/shared/domain/opportunity';
import { makeFact } from '../src/shared/domain/facts';
import { computeAnalyticsSummary } from '../src/shared/analytics';
import { clearDatabase, DB_VERSION, openDatabase } from '../src/storage/database';
import { newCampaign } from '../src/shared/domain/campaign';
import { emptyProfile } from '../src/shared/domain/profile';
import { opportunityWorkspace } from '../src/ui/workbench/components/opportunity-workspace';
import { overview } from '../src/ui/workbench/screens/overview';
import { people } from '../src/ui/workbench/screens/people';
import type { Ctx } from '../src/ui/workbench/shell';

beforeEach(async () => {
  document.body.innerHTML = '';
  await clearDatabase().catch(() => undefined);
});

it('upgrades IndexedDB to v4 with conversations, actionItems, and opportunityNotes stores', async () => {
  expect(DB_VERSION).toBe(4);
  const db = await openDatabase();
  expect(db.objectStoreNames.contains('conversations')).toBe(true);
  expect(db.objectStoreNames.contains('actionItems')).toBe(true);
  expect(db.objectStoreNames.contains('opportunityNotes')).toBe(true);
});

it('derives Opportunity lifecycle while preserving parallel Applying and Networking flags', () => {
  const res = deriveOpportunityStage({
    job: { availability: 'open', userJudgement: 'shortlisted' },
    application: { state: 'filling' },
    outreach: [{ state: 'sent' }],
  });
  expect(res.stage).toBe('application-in-progress');
  expect(res.isApplying).toBe(true);
  expect(res.isNetworking).toBe(true);

  const closed = deriveOpportunityStage({
    job: { availability: 'closed', userJudgement: 'shortlisted' },
    application: { state: 'filling' },
    outreach: [{ state: 'sent' }],
  });
  expect(closed.stage).toBe('closed');
});

it('prevents duplicate outreach to same contact for same role and warns across multiple roles at same company', () => {
  const contact = { id: 'contact:li:neha', name: 'Neha Rao' };
  const existing = [
    {
      id: 'out:1',
      campaignId: 'camp:1',
      contactId: 'contact:li:neha',
      jobId: 'job:ms-1',
      channel: 'linkedin-invite' as const,
      state: 'sent' as const,
      messageVersion: 1,
      followUps: [],
      createdAt: 1,
      updatedAt: 1,
      history: [],
    },
  ];
  const sameRole = checkOutreachCollision({ contact, opportunityId: 'job:ms-1', existingTasks: existing });
  expect(sameRole.blocked).toBe(true);

  const secondRole = checkOutreachCollision({
    contact,
    opportunityId: 'job:ms-2',
    existingTasks: existing,
    companyJobIds: new Set(['job:ms-1', 'job:ms-2']),
  });
  expect(secondRole.blocked).toBe(false);
  expect(secondRole.warning).toContain('active outreach thread');

  const suppressed = checkOutreachCollision({
    contact: { ...contact, suppressed: { at: 1, reason: 'Opted out' } },
    opportunityId: 'job:ms-2',
    existingTasks: [],
  });
  expect(suppressed.blocked).toBe(true);
});

it('attributes conversations accurately and flags multi-role company threads as ambiguous', () => {
  const jobs = [
    { id: 'job:1', companyName: 'Microsoft', title: 'Product Manager Intern' },
    { id: 'job:2', companyName: 'Microsoft', title: 'Program Manager Intern' },
  ];
  const ambiguous = matchConversationOpportunity('Microsoft', 'Thanks for reaching out about the internship!', jobs);
  expect(ambiguous.state).toBe('ambiguous');
  expect(ambiguous.opportunityIds).toEqual(['job:1', 'job:2']);

  const exact = matchConversationOpportunity('Microsoft', 'Regarding Product Manager Intern requisition', jobs);
  expect(exact.state).toBe('confirmed');
  expect(exact.opportunityIds).toEqual(['job:1']);
});

it('evaluates pre-flight Application Readiness from Answer Bank facts and CV', () => {
  const empty = evaluateReadiness([], false);
  expect(empty.ready).toBe(false);
  expect(empty.missing.length).toBe(7);

  const facts = [
    makeFact({ canonicalKey: 'full_name', value: 'Arpit Singh', source: 'user' }),
    makeFact({ canonicalKey: 'email', value: 'arpit@example.com', source: 'user' }),
    makeFact({ canonicalKey: 'phone', value: '+91 9999999999', source: 'user' }),
    makeFact({ canonicalKey: 'city', value: 'Bengaluru', source: 'user' }),
    makeFact({ canonicalKey: 'work_authorization', value: 'Yes', source: 'user' }),
    makeFact({ canonicalKey: 'notice_period', value: 'Immediate', source: 'user' }),
  ];
  const full = evaluateReadiness(facts, true);
  expect(full.ready).toBe(true);
  expect(full.score).toBe(100);
});

it('reconciles Today actions in priority order and suppresses follow-ups on closed jobs', () => {
  const now = 1_700_000_000_000;
  const actions = reconcileActions({
    campaignId: 'camp:1',
    jobs: [
      {
        id: 'job:open',
        sourceId: '1',
        sourceName: 'LinkedIn',
        canonicalUrl: 'https://linkedin.com/jobs/view/1',
        alternateUrls: [],
        duplicateGroupId: 'd1',
        companyName: 'Acme',
        title: 'PM Intern',
        normalizedTitle: 'pm',
        seniority: 'intern',
        employmentType: 'internship',
        location: 'India',
        workMode: 'remote',
        observedAt: now,
        availability: 'open',
        requirements: [],
        responsibilities: [],
        applyType: 'easy-apply',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'job:closed',
        sourceId: '2',
        sourceName: 'LinkedIn',
        canonicalUrl: 'https://linkedin.com/jobs/view/2',
        alternateUrls: [],
        duplicateGroupId: 'd2',
        companyName: 'ClosedCo',
        title: 'Ops Intern',
        normalizedTitle: 'ops',
        seniority: 'intern',
        employmentType: 'internship',
        location: 'India',
        workMode: 'remote',
        observedAt: now,
        availability: 'closed',
        requirements: [],
        responsibilities: [],
        applyType: 'easy-apply',
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [],
    exceptions: [
      {
        id: 'exc:1',
        campaignId: 'camp:1',
        kind: 'submission-uncertain',
        applicationId: 'app:1',
        prompt: 'Did submit succeed?',
        affected: [{ applicationId: 'app:1', company: 'Acme', title: 'PM Intern' }],
        scope: 'job',
        status: 'open',
        createdAt: now,
        updatedAt: now,
      },
    ],
    outreach: [
      {
        id: 'out:closed',
        campaignId: 'camp:1',
        contactId: 'c:1',
        jobId: 'job:closed',
        channel: 'linkedin-invite',
        state: 'sent',
        messageVersion: 1,
        followUps: [],
        nextFollowUpAt: now - 1000,
        createdAt: now,
        updatedAt: now,
        history: [],
      },
    ],
    contacts: [],
    conversations: [
      {
        id: 'conv:1',
        contactId: 'c:2',
        contactName: 'Priya',
        companyName: 'Acme',
        channel: 'gmail',
        threadId: 'th:1',
        attributedOpportunityIds: ['job:open'],
        attributionState: 'confirmed',
        status: 'needs-reply',
        lastMessageAt: now,
        lastSender: 'them',
        snippets: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    now,
  });
  expect(actions[0]!.kind).toBe('submission-uncertain');
  expect(actions[1]!.kind).toBe('reply-needs-response');
  expect(actions.some(a => a.outreachId === 'out:closed')).toBe(false);
});

it('computes privacy-safe analytics summary with sample-size reliability guard', () => {
  const now = 1_700_000_000_000;
  const summary = computeAnalyticsSummary({
    profileReady: true,
    jobs: [],
    tasks: [],
    outreach: [],
    events: [
      {
        id: 'evt:1',
        campaignId: 'camp:1',
        entityId: 'job:1',
        entityKind: 'application',
        type: 'submitted',
        company: 'Acme',
        source: 'site',
        occurredAt: now - 1000,
        observedAt: now - 1000,
        confidence: 'verified',
      },
    ],
    now,
  });
  expect(summary.weeklyProgressedOpportunities).toBe(1);
  expect(summary.sampleReliable).toBe(false);
});

it('renders Opportunity Workspace, Today Priorities, and People Conversations tab interactively', async () => {
  const campaign = newCampaign({ name: 'PM Search', targetRoles: ['PM Intern'], location: 'India' });
  const ctx = {
    view: {
      campaign,
      counts: { total: 0, queued: 0, active: 0, needsYou: 0, uncertain: 0, submitted: 0, failed: 0 },
      inboxCounts: { total: 0, open: 0, urgent: 0, facts: 0, reviews: 0, blocked: 0 },
      queue: [],
      inbox: [],
      facts: [],
      factSections: [],
      completeness: { complete: 0, total: 5, missing: [] },
      stages: [],
      events: [],
      workers: { active: 0, limit: 1 },
      peopleIdentified: 1,
      replies: 1,
      actions: [
        {
          id: 'act:1',
          campaignId: campaign.id,
          kind: 'reply-needs-response',
          companyName: 'Acme',
          title: 'Reply to Neha (Acme)',
          reason: 'New Gmail reply',
          ctaLabel: 'Open thread',
          priorityScore: 86,
          status: 'open',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      conversations: [
        {
          id: 'conv:1',
          contactId: 'contact:1',
          contactName: 'Neha Rao',
          companyName: 'Acme',
          channel: 'gmail',
          threadId: 'th:1',
          subject: 'PM Intern referral',
          attributedOpportunityIds: ['job:1'],
          attributionState: 'ambiguous',
          attributionEvidence: '2 open roles at Acme',
          status: 'needs-reply',
          lastMessageAt: Date.now(),
          lastSender: 'them',
          snippets: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    },
    workspace: {
      profile: emptyProfile(),
      conflicts: [],
      facts: [],
      factSections: [],
      completeness: { complete: 0, total: 5, missing: [] },
      jobs: [
        {
          id: 'job:1',
          company: 'Acme',
          title: 'PM Intern',
          location: 'India',
          url: 'https://www.linkedin.com/jobs/view/1/',
          source: 'LinkedIn Jobs',
          applyType: 'easy-apply',
          fit: 88,
          fitAssessed: true,
          tier: 'strong',
          eligibility: 'eligible',
          freshness: 'fresh',
          evidence: [],
          checks: [],
          rejectionReasons: [],
          preferenceNotes: [],
          judgement: 'shortlisted',
          rank: 88,
        },
      ],
      contacts: [
        {
          id: 'contact:1',
          name: 'Neha Rao',
          company: 'Acme',
          role: 'Recruiter',
          relationship: 'alumni',
          category: 'recruiter',
          confidence: 0.9,
          emailConfidence: 'unknown',
        },
      ],
      connections: { linkedin: true, ai: true, gmail: true, cv: true },
      surface: 'tab',
      cv: { hasText: true, imported: true },
      usageReporting: false,
      outreachAutomatic: false,
      storage: { jobs: 1, applications: 0, contacts: 1, events: 0, facts: 0 },
    },
    theme: 'system',
    setTheme: vi.fn(),
    run: vi.fn().mockResolvedValue(undefined),
    runNetwork: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn(),
    inform: vi.fn(),
    go: vi.fn(),
    openPanel: vi.fn(),
    redraw: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn(),
    busyAction: '',
  } as unknown as Ctx;

  document.body.replaceChildren(overview(ctx));
  expect(document.body.textContent).toContain("Today's Priorities");
  expect(document.body.textContent).toContain('Reply to Neha (Acme)');

  document.body.replaceChildren(opportunityWorkspace(ctx.workspace!.jobs[0]!, ctx));
  expect(document.body.textContent).toContain('Pre-Flight Application Readiness');
  expect(document.body.querySelectorAll('.opp-tabs [role="tab"]').length).toBe(6);

  document.body.replaceChildren(people(ctx));
  const convTab = [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent?.startsWith('Conversations')) as HTMLElement;
  expect(convTab).toBeTruthy();
  convTab.click();
  await vi.waitFor(() => expect(ctx.redraw).toHaveBeenCalled());
  document.body.replaceChildren(people(ctx));
  expect(document.body.textContent).toContain('Sync Gmail Replies');
  expect(document.body.textContent).toContain('Assign: PM Intern');
});
