import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newCampaign } from '../src/shared/domain/campaign';
import { emptyProfile } from '../src/shared/domain/profile';
import type { Ctx } from '../src/ui/workbench/shell';
import { overview, overviewHeader } from '../src/ui/workbench/screens/overview';
import { jobs } from '../src/ui/workbench/screens/jobs';
import { needsYou } from '../src/ui/workbench/screens/needs-you';
import { answers } from '../src/ui/workbench/screens/answers';
import { profile } from '../src/ui/workbench/screens/profile';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  const baseProfile = emptyProfile();
  baseProfile.identity.profileUrl = 'https://www.linkedin.com/in/example/';
  baseProfile.identity.portfolioLinks = ['https://github.com/example'];
  baseProfile.narrative = { strengths: 'Product analytics & SQL', careerGoal: 'PM internship' };
  const base: Ctx = {
    view: {
      campaign: newCampaign({ name: 'PM Search', targetRoles: ['PM Intern'], location: 'India' }),
      counts: { total: 0, queued: 0, active: 0, needsYou: 0, uncertain: 0, submitted: 0, failed: 0 },
      inboxCounts: { total: 0, open: 0, high: 0 },
      queue: [],
      inbox: [],
      factSections: [{ section: 'identity', label: 'Personal', filled: 1, total: 2, status: 'needs-review' }],
      completeness: { complete: 1, total: 5, missing: ['Email'] },
      stages: [],
      events: [],
      workers: { active: 0, limit: 1 },
      peopleIdentified: 0,
      replies: 0,
    },
    workspace: {
      profile: baseProfile,
      conflicts: [],
      facts: [
        {
          key: 'full_name',
          label: 'Full name',
          section: 'identity',
          value: '',
          status: 'empty',
          scope: 'global',
          selfDeclared: false,
          type: 'text',
        },
      ],
      factSections: [{ section: 'identity', label: 'Personal', filled: 1, total: 2, status: 'needs-review' }],
      completeness: { complete: 1, total: 5, missing: ['Email'] },
      jobs: [],
      contacts: [],
      connections: { linkedin: true, ai: false, gmail: false, cv: false },
      surface: 'panel',
      cv: { hasText: false, imported: false },
      usageReporting: false,
      outreachAutomatic: false,
      storage: { jobs: 0, applications: 0, contacts: 0, events: 0, facts: 0 },
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
    ...overrides,
  } as unknown as Ctx;
  return base;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('overviewHeader suggests queueing shortlisted jobs or reviewing discovered jobs before re-searching', () => {
  const ctx = makeCtx();
  ctx.workspace!.jobs = [
    {
      id: 'job:1',
      company: 'Acme',
      title: 'PM Intern',
      location: 'India',
      url: 'https://www.linkedin.com/jobs/view/1/',
      source: 'LinkedIn Jobs',
      applyType: 'easy-apply',
      fit: 85,
      fitAssessed: true,
      tier: 'strong',
      eligibility: 'eligible',
      freshness: 'fresh',
      evidence: [],
      checks: [],
      rejectionReasons: [],
      preferenceNotes: [],
      judgement: 'none',
      rank: 85,
    },
  ];
  expect(overviewHeader(ctx).actions[0]!.textContent).toBe('Review 1 jobs');

  ctx.workspace!.jobs[0]!.judgement = 'shortlisted';
  expect(overviewHeader(ctx).actions[0]!.textContent).toBe('Queue 1 shortlisted');

  ctx.view.inbox = [
    {
      id: 'exc-1',
      kind: 'reusable-fact',
      kindLabel: 'Fact needed',
      prompt: 'Expected stipend?',
      resolution: 'answer',
      affected: [{ applicationId: 'app-1', company: 'Acme', title: 'PM Intern' }],
      createdAt: Date.now(),
    },
  ];
  ctx.view.inboxCounts.open = 1;
  document.body.append(overview(ctx));
  const clickable = document.querySelector<HTMLElement>('.row-clickable');
  expect(clickable).toBeTruthy();
  clickable!.click();
  expect(ctx.go).toHaveBeenCalledWith('needs-you');
});

it('jobs screen guides disconnected users to Candidate profile and flags queued/dismissed jobs cleanly', async () => {
  const ctx = makeCtx();
  ctx.workspace!.connections.linkedin = false;
  document.body.replaceChildren(jobs(ctx));
  expect(document.body.textContent).toContain('Connect LinkedIn first');
  const openProfile = [...document.querySelectorAll('button')].find(b => b.textContent === 'Open Candidate profile');
  expect(openProfile).toBeTruthy();

  ctx.workspace!.connections.linkedin = true;
  ctx.workspace!.jobs = [
    {
      id: 'job:1',
      company: 'Acme',
      title: 'PM Intern',
      location: 'India',
      url: 'https://www.linkedin.com/jobs/view/1/',
      source: 'LinkedIn Jobs',
      applyType: 'easy-apply',
      fit: 85,
      fitAssessed: true,
      tier: 'strong',
      eligibility: 'eligible',
      freshness: 'fresh',
      evidence: [],
      checks: [],
      rejectionReasons: [],
      preferenceNotes: [],
      judgement: 'rejected',
      rank: 85,
    },
  ];
  ctx.view.queue = [
    {
      id: 'app:1',
      jobId: 'job:1',
      url: 'https://www.linkedin.com/jobs/view/1/',
      company: 'Acme',
      title: 'PM Intern',
      ats: '',
      source: 'LinkedIn Jobs',
      route: 'easy-apply',
      fit: 85,
      state: 'queued',
      stateLabel: 'Queued',
      note: '',
      percent: 10,
      progressLabel: 'Queued',
      updatedAt: Date.now(),
      canRetry: true,
      blocked: 0,
    },
  ];
  document.body.replaceChildren(jobs(ctx));
  expect(document.body.textContent).toContain('In queue');
  const why = [...document.querySelectorAll('button')].find(b => b.textContent === 'Why?')!;
  why.click();
  await vi.waitFor(() => expect(ctx.redraw).toHaveBeenCalled());
  document.body.replaceChildren(jobs(ctx));
  expect([...document.querySelectorAll('button')].find(b => b.textContent === 'View in queue')).toBeTruthy();
  expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Restore job')).toBeTruthy();
});

it('needsYou and answers validate empty saves and support Enter-to-save', async () => {
  const ctx = makeCtx();
  ctx.view.inbox = [
    {
      id: 'exc-1',
      kind: 'reusable-fact',
      kindLabel: 'Fact needed',
      prompt: 'Notice period?',
      resolution: 'answer',
      affected: [{ applicationId: 'app-1', company: 'Acme', title: 'PM Intern' }],
      createdAt: Date.now(),
    },
  ];
  document.body.replaceChildren(needsYou(ctx));
  const inputEl = document.querySelector<HTMLInputElement>('input[aria-label="Notice period?"]')!;
  const saveBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Save')!;
  saveBtn.click();
  await vi.waitFor(() => expect(ctx.fail).toHaveBeenCalledWith('Enter an answer before saving.'));

  inputEl.value = 'Immediate';
  inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await vi.waitFor(() =>
    expect(ctx.run).toHaveBeenCalledWith({
      kind: 'campaign',
      action: 'resolve',
      exceptionId: 'exc-1',
      value: 'Immediate',
      applyTo: ['app-1'],
      saveToBank: true,
      then: 'resume',
    }),
  );

  document.body.replaceChildren(answers(ctx));
  const factInput = document.querySelector<HTMLInputElement>('input[aria-label="Full name"]')!;
  factInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(ctx.fail).toHaveBeenCalledWith('Enter a value before saving, or choose Clear to remove it.');
});

it('profile screen exposes profileUrl, portfolioLinks, and narrative summary', async () => {
  const ctx = makeCtx();
  document.body.replaceChildren(profile(ctx));
  expect(document.body.textContent).toContain('Profile summary (from ChatGPT reconciliation)');
  expect(document.body.textContent).toContain('Product analytics & SQL');
  expect(document.querySelector<HTMLInputElement>('input[data-k="linkedin-profile-url"]')?.value).toBe(
    'https://www.linkedin.com/in/example/',
  );
  expect(document.querySelector<HTMLInputElement>('input[data-k="portfolio-or-github-links-comma-separated"]')?.value).toBe(
    'https://github.com/example',
  );
  const saveIdentity = [...document.querySelectorAll('button')].find(b => b.textContent === 'Save')!;
  saveIdentity.click();
  await vi.waitFor(() =>
    expect(ctx.run).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'workspace',
        action: 'identity',
        identity: expect.objectContaining({
          profileUrl: 'https://www.linkedin.com/in/example/',
          portfolioLinks: ['https://github.com/example'],
        }),
      }),
    ),
  );
});

it('withHint points to chatgpt.com instead of legacy menus, and campaign card re-enables button on failure', async () => {
  document.body.innerHTML = '<main id="app"></main>';
  const { withHint } = await import('../src/ui/core');
  const { renderCampaignCard } = await import('../src/ui/side-panel/campaign-card');
  expect(withHint('Reply cannot be verified.')).toContain('chatgpt.com');
  expect(withHint('Reply cannot be verified.')).not.toContain('Personalise with ChatGPT');

  const campaignView = makeCtx().view;
  campaignView.counts.queued = 2;
  const host = document.createElement('div');
  document.body.append(host);
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (req: { action?: string }) =>
        req.action === 'control' ? { ok: false, error: 'Background unavailable' } : { ok: true, view: campaignView },
      ),
    },
  });
  await renderCampaignCard(host, true);
  const btn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Start application queue')!;
  btn.click();
  await vi.waitFor(() => expect(btn.disabled).toBe(false));
  expect(document.body.textContent).toContain('Background unavailable');
});
