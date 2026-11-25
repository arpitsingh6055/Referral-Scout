import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newCampaign } from '../src/shared/domain/campaign';
import { emptyProfile } from '../src/shared/domain/profile';
import type { Ctx } from '../src/ui/workbench/shell';
import { overview, overviewHeader } from '../src/ui/workbench/screens/overview';
import { jobs } from '../src/ui/workbench/screens/jobs';
import { needsYou } from '../src/ui/workbench/screens/needs-you';
import { referrals } from '../src/ui/workbench/screens/referrals';
import { people } from '../src/ui/workbench/screens/people';
import { answers } from '../src/ui/workbench/screens/answers';
import { profile } from '../src/ui/workbench/screens/profile';
import { confirmModal, field, pageSkeleton, setFieldError } from '../src/ui/workbench/dom';
import { computeHudState, createFloatingHud } from '../src/ui/workbench/components/floating-hud';
import { guidedReviewWorkspace, resetReviewSession } from '../src/ui/workbench/components/guided-review';
import {
  clearAllProgressTasks,
  publishProgressTask,
  readProgressTasks,
  resolveMacroJourney,
  selectPrimaryProgressTask,
} from '../src/shared/progress-store';
import { computePanelHudState, createSidePanelHud } from '../src/ui/side-panel/floating-hud';

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
  expect(document.body.textContent).toContain('AI Career Summary');
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

it('design system primitives support skeletons, Esc modal dismissal, inline field errors, and jobs live search', async () => {
  const sk = pageSkeleton();
  expect(sk.getAttribute('aria-busy')).toBe('true');
  expect(sk.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(4);

  const input = document.createElement('input');
  input.className = 'input';
  const wrapped = field('Target role', input);
  document.body.replaceChildren(wrapped);
  setFieldError(input, 'Required field');
  expect(input.classList.contains('is-invalid')).toBe(true);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(wrapped.querySelector('.field-error')?.textContent).toBe('Required field');
  setFieldError(input);
  expect(input.classList.contains('is-invalid')).toBe(false);
  expect(wrapped.querySelector<HTMLElement>('.field-error')?.hidden).toBe(true);

  const modalPromise = confirmModal({
    title: 'Delete CV',
    description: 'Remove parsed CV text?',
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(await modalPromise).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  const ctx = makeCtx();
  ctx.workspace!.jobs = [
    {
      id: 'job:1',
      url: 'https://www.linkedin.com/jobs/view/1/',
      company: 'Acme',
      title: 'PM Intern',
      location: 'India',
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
    {
      id: 'job:2',
      url: 'https://www.linkedin.com/jobs/view/2/',
      company: 'Beta',
      title: 'Design Fellow',
      location: 'India',
      source: 'LinkedIn Jobs',
      applyType: 'easy-apply',
      fit: 79,
      fitAssessed: true,
      tier: 'strong',
      eligibility: 'eligible',
      freshness: 'fresh',
      evidence: [],
      checks: [],
      rejectionReasons: [],
      preferenceNotes: [],
      judgement: 'shortlisted',
      rank: 79,
    },
  ];
  document.body.replaceChildren(jobs(ctx));
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = 'Beta';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  const rowsText = document.querySelector('.rows')?.textContent ?? '';
  expect(rowsText).toContain('Design Fellow');
  expect(rowsText).not.toContain('PM Intern');
});

it('FloatingProgressHUD tracks active processing, setup completeness, ready state, and collapse toggle', async () => {
  const ctx = makeCtx();
  const processing = computeHudState({
    route: 'profile',
    view: ctx.view,
    workspace: ctx.workspace,
    busyAction: 'workspace:processProfileWithChatGPT',
    busyMessage: 'ChatGPT is drafting your structured profile…',
    busyStartedAt: 1000,
    now: 5000,
  })!;
  expect(processing.mode).toBe('processing');
  expect(processing.percent).toBeGreaterThanOrEqual(80);
  expect(processing.etaText).toMatch(/^~\d+s left$/);

  const partial = computeHudState({
    route: 'welcome',
    view: ctx.view,
    workspace: ctx.workspace,
    busyAction: '',
    busyMessage: '',
  })!;
  expect(partial.mode).toBe('completion');
  expect(partial.title).toContain('% Complete');

  ctx.workspace!.connections.linkedin = true;
  ctx.workspace!.cv.hasText = true;
  ctx.workspace!.cv.imported = true;
  ctx.workspace!.completeness = { complete: 5, total: 5, missing: [] };
  const missingIdHud = computeHudState({
    route: 'profile',
    view: ctx.view,
    workspace: ctx.workspace,
    busyAction: '',
    busyMessage: '',
  })!;
  expect(missingIdHud.ctaLabel).toBe('Add Full Name →');
  expect(missingIdHud.targetSelector).toBe('[data-hud-target="identity"]');

  ctx.workspace!.profile.identity.fullName = 'Arpit Singh';
  ctx.workspace!.profile.identity.email = 'a@b.com';
  const ready = computeHudState({
    route: 'profile',
    view: ctx.view,
    workspace: ctx.workspace,
    busyAction: '',
    busyMessage: '',
  })!;
  expect(ready.mode).toBe('ready');
  expect(ready.percent).toBe(100);
  expect(ready.ctaLabel).toBe('Find Jobs on LinkedIn →');

  const host = document.createElement('div');
  const hud = createFloatingHud(host);
  const onJump = vi.fn();
  hud.update(ready, onJump);
  expect(host.textContent).toContain('100%');
  host.querySelector<HTMLButtonElement>('.hud-minimize')!.click();
  await vi.waitFor(() => expect(host.querySelector('.hud-chip-expand')?.getAttribute('aria-expanded')).toBe('false'));
  host.querySelector<HTMLButtonElement>('.hud-chip-expand')!.click();
  const cta = await vi.waitFor(() => {
    const b = [...host.querySelectorAll('button')].find(btn => btn.textContent?.includes('Find Jobs on LinkedIn'));
    if (!b) throw new Error('waiting for expanded HUD CTA');
    return b;
  });
  cta.click();
  await vi.waitFor(() => expect(onJump).toHaveBeenCalledWith(ready));
});

it('GuidedReviewWorkspace walks through live bridge, Before/After diffs, and 1-click approve flow', async () => {
  resetReviewSession();
  const ctx = makeCtx();
  ctx.workspace!.connections.linkedin = true;
  ctx.workspace!.cv.hasText = true;
  ctx.workspace!.cv.imported = false;
  ctx.workspace!.cvName = 'Arpit_CV.pdf';

  const pre = guidedReviewWorkspace(ctx)!;
  expect(pre.textContent).toContain('Start Guided AI Review');

  ctx.busyAction = 'workspace:processProfileWithChatGPT';
  const bridge = guidedReviewWorkspace(ctx, { busyMessage: 'ChatGPT is drafting your structured profile…' })!;
  expect(bridge.textContent).toContain('Preparing your guided review plan');
  expect(bridge.querySelectorAll('.bridge-step').length).toBe(3);

  ctx.busyAction = '';
  ctx.workspace!.aiProfileDraft = {
    schemaVersion: 3,
    identity: { fullName: 'Arpit Singh', email: 'a@b.com', phone: '', city: 'Delhi', state: '', country: 'India', profileUrl: '' },
    education: [
      {
        level: 'Masters',
        institution: 'IMT',
        qualification: 'PGDM',
        field: 'Marketing',
        startDate: '2026-06',
        endDate: '2028-04',
        grade: '8.4',
        gradeScale: '10',
      },
    ],
    employment: [
      {
        employer: 'TBX',
        title: 'Product Intern',
        location: 'Gurugram',
        startDate: '2025-05',
        endDate: '2025-08',
        current: false,
        responsibilities: ['Led onboarding'],
        achievements: ['Grew activation 12%'],
        technologies: ['SQL'],
      },
    ],
    projects: [],
    skills: ['SQL', 'Figma'],
    narrative: { strengths: 'Analytics', careerGoal: 'PM' },
    conflicts: [{ field: 'Location', cvValue: 'Delhi, India', linkedinValue: 'Mumbai', resolution: 'CV preferred' }],
    missingInformation: [],
  };

  document.body.replaceChildren(guidedReviewWorkspace(ctx)!);
  expect(document.body.querySelector('del.diff-strike')?.textContent).toBe('Mumbai');
  expect(document.body.querySelector('ins.diff-add')?.textContent).toBe('Delhi, India');

  const acceptConflict = [...document.querySelectorAll('button')].find(b => b.textContent === 'Accept CV Change')!;
  acceptConflict.click();
  await vi.waitFor(() => expect(ctx.redraw).toHaveBeenCalled());

  const nextStepBtn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Confirm & Review Improvements'))!;
  nextStepBtn.click();
  await new Promise(r => setTimeout(r, 10));

  document.body.replaceChildren(guidedReviewWorkspace(ctx)!);
  expect(document.body.textContent).toContain('Step 2 of 3: Accept & Apply Improvements');
  expect(document.body.textContent).toContain('Arpit Singh');
  expect(document.body.textContent).toContain('a@b.com');
  const applyBtn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Accept & Apply Changes'))!;
  applyBtn.click();
  await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledWith({ kind: 'workspace', action: 'approveAiProfileDraft' }));

  delete ctx.workspace!.aiProfileDraft;
  ctx.workspace!.cv.imported = true;
  ctx.workspace!.profile.identity.fullName = 'Arpit Singh';
  ctx.workspace!.profile.identity.email = 'a@b.com';
  document.body.replaceChildren(guidedReviewWorkspace(ctx)!);
  expect(document.body.textContent).toContain('Step 3 of 3: Saved to Your Profile ✓');
  expect(document.body.textContent).toContain('Saved to Profile ✓');
  expect(document.body.textContent).toContain('Arpit Singh');
});

it('progress-store rehydrates chrome.storage.local and SidePanel HUD prioritizes active jobs', async () => {
  await clearAllProgressTasks();
  const backing: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: backing[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(backing, patch)),
        remove: vi.fn(async (key: string) => {
          delete backing[key];
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });

  await publishProgressTask({
    id: 'cv_ai_review',
    status: 'running',
    percent: 62,
    label: 'ChatGPT is analysing your documents…',
    etaSeconds: 18,
    targetRoute: 'profile',
  });
  // Monotonic guard preserves higher %, preventing accidental regression on unordered events.
  await publishProgressTask({
    id: 'cv_ai_review',
    status: 'running',
    percent: 45,
    label: 'ChatGPT is drafting your structured profile…',
  });

  const rehydrated = await readProgressTasks();
  const primary = selectPrimaryProgressTask(rehydrated)!;
  expect(primary.percent).toBeGreaterThanOrEqual(62);

  const ctx = makeCtx();
  const panelState = computePanelHudState({
    network: null,
    campaign: ctx.view,
    persistedTasks: rehydrated,
  })!;
  expect(panelState.mode).toBe('processing');
  expect(panelState.title).toContain('62%');

  const host = document.createElement('div');
  const spHud = createSidePanelHud(host);
  spHud.update(panelState, vi.fn());
  expect(host.querySelector('.sp-hud-pct')?.textContent).toBe('62%');
  host.querySelector<HTMLButtonElement>('.sp-hud-min')!.click();
  expect(host.querySelector('.sp-hud-chip')?.textContent).toContain('62%');

  await clearAllProgressTasks();
  expect(Object.keys(await readProgressTasks())).toHaveLength(0);
});

it('overview renders guided Launchpad instead of empty zeros and shows LinkedIn cross-tab handoff when searching', () => {
  const ctx = makeCtx();
  expect(overviewHeader(ctx).status?.textContent).toBe('Ready to start');

  document.body.replaceChildren(overview(ctx));
  expect(document.body.textContent).toContain('You’re all set to find your first roles.');
  expect(document.body.textContent).toContain('Find Jobs on LinkedIn');
  expect(document.body.textContent).not.toContain('two engines run independently');

  ctx.workspace!.jobSearch = { status: 'finding', cursor: 1, totalTerms: 4, found: 3 };
  document.body.replaceChildren(overview(ctx));
  expect(document.body.textContent).toContain('Searching LinkedIn in another tab');
  expect(document.body.textContent).toContain('Open LinkedIn Tab');
});

it('referrals, jobs, people and HUD surface company rank breakdowns, pin boosts and urgent Needs you jumps', async () => {
  const ctx = makeCtx();
  ctx.workspace!.jobs = [
    {
      id: 'job:acme',
      company: 'Acme Pvt Ltd',
      title: 'Product Intern',
      location: 'Bengaluru',
      url: 'https://www.linkedin.com/jobs/view/11/',
      source: 'LinkedIn Jobs',
      applyType: 'easy-apply',
      fit: 92,
      fitAssessed: true,
      tier: 'strong',
      eligibility: 'eligible',
      freshness: 'fresh',
      evidence: [],
      checks: [],
      rejectionReasons: [],
      preferenceNotes: [],
      judgement: 'shortlisted',
      rank: 92,
    },
  ];
  ctx.workspace!.contacts = [
    {
      id: 'c:1',
      name: 'Neha Rao',
      company: 'Acme',
      role: 'Talent Partner',
      relationship: 'alumni',
      category: 'recruiter',
      confidence: 0.9,
      channel: 'email',
      email: 'neha@acme.com',
      emailConfidence: 'verified',
      profileUrl: 'https://linkedin.com/in/neha',
    },
  ];

  document.body.replaceChildren(referrals(ctx));
  expect(document.body.textContent).toContain('Company ranking & boost priority');
  expect(document.body.textContent).toContain('Role fit 92/100');
  const pinRefBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Pin company')!;
  pinRefBtn.click();
  await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledWith({ kind: 'campaign', action: 'pinCompany', company: 'Acme', pinned: true }));

  ctx.view.campaign!.referral.pinnedCompanies = ['acme'];
  document.body.replaceChildren(jobs(ctx));
  const jobSearchInput = document.querySelector<HTMLInputElement>('input[type="search"]');
  if (jobSearchInput && jobSearchInput.value) {
    jobSearchInput.value = '';
    jobSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  expect(document.body.textContent).toContain('Pinned');

  document.body.replaceChildren(people(ctx));
  expect(document.body.textContent).toContain('Pinned ★');

  ctx.view.inboxCounts = { open: 1, urgent: 1, facts: 0, reviews: 0, blocked: 1 };
  ctx.view.inbox = [
    {
      id: 'exc:sec',
      kind: 'security',
      kindLabel: 'Security check',
      prompt: 'Complete verification challenge on the open tab.',
      resolution: 'open-tab',
      affected: [{ applicationId: 'app:9', company: 'Acme', title: 'Product Intern' }],
      createdAt: Date.now(),
    },
  ];
  const hudState = computeHudState({
    route: 'overview',
    view: ctx.view,
    workspace: ctx.workspace,
    busyAction: '',
    busyMessage: '',
  })!;
  expect(hudState.mode).toBe('error');
  expect(hudState.ctaLabel).toBe('Resolve now →');
  expect(hudState.targetRoute).toBe('needs-you');

  ctx.workspace!.jobSearch = { status: 'choosing', cursor: 2, totalTerms: 2, found: 1 };
  document.body.replaceChildren(needsYou(ctx));
  expect(document.body.textContent).toContain('Referral Scout never solves security checks');
  expect(document.body.textContent).toContain('1 discovered roles are waiting for your shortlist picks');
  expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Skip')).toBeTruthy();
});

it('resolveMacroJourney transitions cleanly across all 6 stages and GuidedReview supports conflict-free fast path', async () => {
  const s1 = resolveMacroJourney({
    route: 'welcome',
    linkedinConnected: false,
    cvHasText: false,
    cvImported: false,
    hasAiDraft: false,
    pendingConflictsCount: 0,
    missingRequiredIdentity: null,
    hasCampaign: false,
    jobsCount: 0,
    shortlistedCount: 0,
    queuedCount: 0,
    submittedCount: 0,
    inboxOpen: 0,
    inboxUrgent: 0,
    peopleCount: 0,
  });
  expect(s1.stage).toBe(1);
  expect(s1.ctaLabel).toBe('Connect LinkedIn →');

  const s3 = resolveMacroJourney({
    route: 'profile',
    linkedinConnected: true,
    cvHasText: true,
    cvImported: true,
    hasAiDraft: false,
    pendingConflictsCount: 0,
    missingRequiredIdentity: null,
    hasCampaign: false,
    jobsCount: 0,
    shortlistedCount: 0,
    queuedCount: 0,
    submittedCount: 0,
    inboxOpen: 0,
    inboxUrgent: 0,
    peopleCount: 0,
  });
  expect(s3.stage).toBe(3);
  expect(s3.ctaLabel).toBe('Set Target Role →');

  const s6 = resolveMacroJourney({
    route: 'applications',
    linkedinConnected: true,
    cvHasText: true,
    cvImported: true,
    hasAiDraft: false,
    pendingConflictsCount: 0,
    missingRequiredIdentity: null,
    hasCampaign: true,
    jobsCount: 4,
    shortlistedCount: 2,
    queuedCount: 2,
    submittedCount: 1,
    inboxOpen: 0,
    inboxUrgent: 0,
    peopleCount: 3,
  });
  expect(s6.stage).toBe(6);
  expect(s6.ctaLabel).toBe('Open Referrals →');

  resetReviewSession();
  const ctx = makeCtx();
  ctx.workspace!.connections.linkedin = true;
  ctx.workspace!.cv.hasText = true;
  ctx.workspace!.aiProfileDraft = {
    schemaVersion: 3,
    identity: { fullName: 'Arpit Singh', email: 'a@b.com', phone: '', city: 'Delhi', state: '', country: 'India', profileUrl: '' },
    education: [],
    employment: [],
    projects: [],
    skills: ['SQL'],
    narrative: { strengths: 'Product analytics', careerGoal: 'PM' },
    conflicts: [],
    missingInformation: ['Current PIN code'],
  };
  document.body.replaceChildren(guidedReviewWorkspace(ctx)!);
  expect(document.body.textContent).toContain('Step 2 of 3: Accept & Apply Improvements');
  expect(document.querySelector('details.review-details')).toBeTruthy();
  const fastBtn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Accept & Apply Changes'))!;
  fastBtn.click();
  await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledWith({ kind: 'workspace', action: 'approveAiProfileDraft' }));
});

it('Answer Bank renders 3-tier layout, Student Smart-Fill preset, 1-click pill presets, and learned answers accordion', async () => {
  const ctx = makeCtx();
  ctx.workspace!.facts = [
    {
      key: 'full_name',
      label: 'Full name',
      section: 'identity',
      value: 'Arpit Singh',
      status: 'verified',
      scope: 'global',
      selfDeclared: false,
      type: 'text',
    },
    {
      key: 'work_authorization',
      label: 'Work authorisation',
      section: 'eligibility',
      value: '',
      status: 'empty',
      scope: 'country',
      selfDeclared: false,
      type: 'choice',
    },
    {
      key: 'notice_period',
      label: 'Notice period',
      section: 'work',
      value: '',
      status: 'empty',
      scope: 'global',
      selfDeclared: false,
      type: 'duration',
    },
    {
      key: 'start_date',
      label: 'Earliest start date',
      section: 'work',
      value: '',
      status: 'empty',
      scope: 'global',
      selfDeclared: false,
      type: 'date',
    },
    {
      key: 'relocate',
      label: 'Willing to relocate',
      section: 'preferences',
      value: '',
      status: 'empty',
      scope: 'job',
      selfDeclared: false,
      type: 'choice',
    },
    {
      key: 'expected_ctc',
      label: 'Expected CTC / stipend',
      section: 'work',
      value: '',
      status: 'empty',
      scope: 'campaign',
      selfDeclared: false,
      type: 'money',
    },
    {
      key: 'current_ctc',
      label: 'Current CTC / salary',
      section: 'work',
      value: '',
      status: 'empty',
      scope: 'global',
      selfDeclared: false,
      type: 'money',
    },
  ];
  ctx.workspace!.learnedAnswers = [{ label: 'how did you hear about us', value: 'LinkedIn' }];

  document.body.replaceChildren(answers(ctx));
  expect(document.body.textContent).toContain('You don’t need to fill everything now.');
  expect(document.body.textContent).toContain('Student / Fresher Mode Active');
  expect(document.body.textContent).toContain('how did you hear about us');

  const applyDefaultsBtn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Apply Student Smart-Defaults'))!;
  applyDefaultsBtn.click();
  await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledWith({ kind: 'workspace', action: 'applyStudentDefaults' }));

  const immediateChip = [...document.querySelectorAll<HTMLButtonElement>('button.preset-chip')].find(b => b.textContent === 'Immediate')!;
  immediateChip.click();
  await vi.waitFor(() =>
    expect(ctx.run).toHaveBeenCalledWith({ kind: 'workspace', action: 'saveFact', key: 'notice_period', value: 'Immediate' }),
  );

  const forgetBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Forget')!;
  forgetBtn.click();
  await vi.waitFor(() =>
    expect(ctx.run).toHaveBeenCalledWith({ kind: 'workspace', action: 'clearLearnedAnswer', label: 'how did you hear about us' }),
  );
});

it('overview Command Center & jobs company grouping launch Side Panel on LinkedIn in 1 click', async () => {
  const ctx = makeCtx();
  ctx.workspace!.jobs = [
    {
      id: 'job:1',
      url: 'https://www.linkedin.com/jobs/view/101/',
      company: 'Stripe',
      title: 'Product Intern',
      location: 'Remote',
      source: 'LinkedIn Jobs',
      applyType: 'easy-apply',
      fit: 92,
      fitAssessed: true,
      tier: 'strong',
      eligibility: 'eligible',
      freshness: 'fresh',
      evidence: [],
      checks: [],
      rejectionReasons: [],
      preferenceNotes: [],
      judgement: 'shortlisted',
      rank: 92,
    },
    {
      id: 'job:2',
      url: 'https://www.linkedin.com/jobs/view/102/',
      company: 'Figma',
      title: 'Design Intern',
      location: 'Bengaluru',
      source: 'LinkedIn Jobs',
      applyType: 'easy-apply',
      fit: 78,
      fitAssessed: true,
      tier: 'possible',
      eligibility: 'eligible',
      freshness: 'fresh',
      evidence: [],
      checks: [],
      rejectionReasons: [],
      preferenceNotes: [],
      judgement: 'none',
      rank: 78,
    },
  ];
  ctx.view.queue = [
    {
      id: 'app:1',
      jobId: 'job:1',
      url: 'https://www.linkedin.com/jobs/view/101/',
      company: 'Stripe',
      title: 'Product Intern',
      ats: '',
      source: 'LinkedIn Jobs',
      route: 'easy-apply',
      fit: 92,
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

  const header = overviewHeader(ctx);
  expect(header.actions.some(a => a.textContent === 'Side Panel on LinkedIn')).toBe(true);

  document.body.replaceChildren(overview(ctx));
  expect(document.body.textContent).toContain('Shortlisted & Target Companies');
  expect(document.body.textContent).toContain('#1 · 92/100');
  const launchBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Side Panel on LinkedIn →')!;
  launchBtn.click();
  await vi.waitFor(() => expect(ctx.openPanel).toHaveBeenCalledWith('https://www.linkedin.com/jobs/'));

  document.body.replaceChildren(jobs(ctx));
  const groups = document.querySelectorAll('.company-group');
  expect(groups.length).toBe(2);
  expect(document.querySelector('.company-group-head .company-monogram')?.textContent).toBe('S');

  const panelBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Side Panel →')!;
  panelBtn.click();
  await vi.waitFor(() => expect(ctx.openPanel).toHaveBeenCalledWith('https://www.linkedin.com/jobs/view/101/'));

  const pinOverflowBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Boost priority (Pin)')!;
  pinOverflowBtn.click();
  await vi.waitFor(() => expect(ctx.run).toHaveBeenCalledWith({ kind: 'campaign', action: 'pinCompany', company: 'Stripe', pinned: true }));
});
