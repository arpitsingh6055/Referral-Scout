/**
 * The workbench shell: responsive sidebar rail, mobile slide-over drawer, breadcrumb header,
 * skeleton boot loader, unified action runner, and live background synchronization.
 */

import './tokens.css';
import './app.css';
import { createToaster } from '../toast';
import * as api from './api';
import { send, sendNetwork, sendWorkspace, view, workspace, type CampaignView, type Request, type WorkspaceView } from './api';
import type { NetworkRequest } from '../../shared/network';
import { button, div, el, icon, isEditing, pageSkeleton, restoreForm, snapshotForm, text } from './dom';
import { computeHudState, createFloatingHud, type HudState } from './components/floating-hud';
import { getReviewProgressSnapshot, resetReviewSession } from './components/guided-review';
import {
  clearProgressTask,
  getCachedProgressTasks,
  publishProgressTask,
  readProgressTasks,
  subscribeProgressTasks,
  type ProcessId,
  type ProgressTask,
} from '../../shared/progress-store';
import { overview, overviewHeader } from './screens/overview';
import { applications, applicationsHeader } from './screens/applications';
import { needsYou, needsYouHeader } from './screens/needs-you';
import { referrals, referralsHeader } from './screens/referrals';
import { activity, activityHeader } from './screens/activity';
import { setup, setupHeader } from './screens/setup';
import { jobs, jobsHeader } from './screens/jobs';
import { people, peopleHeader } from './screens/people';
import { profile, profileHeader } from './screens/profile';
import { answers, answersHeader } from './screens/answers';
import { settings, settingsHeader } from './screens/settings';
import { welcome, welcomeHeader } from './screens/welcome';

export type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'rs-theme';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private windows can refuse storage.
  }
}

export function currentTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Fall through to system default.
  }
  return 'system';
}

export type Route =
  | 'overview'
  | 'applications'
  | 'referrals'
  | 'jobs'
  | 'people'
  | 'activity'
  | 'needs-you'
  | 'profile'
  | 'answers'
  | 'setup'
  | 'settings'
  | 'welcome';

export interface Ctx {
  view: CampaignView;
  workspace: WorkspaceView | null;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  run: (request: Request) => Promise<void>;
  runNetwork: (request: NetworkRequest) => Promise<void>;
  openExternal: (url: string) => void;
  inform: (message: string) => void;
  go: (route: Route) => void;
  openPanel: (url?: string) => void;
  redraw: () => void;
  refresh: () => Promise<void>;
  fail: (message: string) => void;
  busyAction: string;
  busyMessage?: string;
  cvLiveMessage?: string;
  aiError?: string;
}

const EXTRA_ROUTES: Route[] = ['welcome'];

const NAV: { route: Route; label: string; icon: string; section: 'Workspace' | 'Candidate' | 'System' }[] = [
  { route: 'overview', label: 'Overview', icon: 'home', section: 'Workspace' },
  { route: 'jobs', label: 'Jobs', icon: 'briefcase', section: 'Workspace' },
  { route: 'applications', label: 'Applications', icon: 'list', section: 'Workspace' },
  { route: 'needs-you', label: 'Needs you', icon: 'bell', section: 'Workspace' },
  { route: 'referrals', label: 'Referrals', icon: 'target', section: 'Workspace' },
  { route: 'people', label: 'People', icon: 'people', section: 'Workspace' },
  { route: 'activity', label: 'Outcomes', icon: 'activity', section: 'Workspace' },
  { route: 'profile', label: 'Profile', icon: 'person', section: 'Candidate' },
  { route: 'answers', label: 'Answer Bank', icon: 'check', section: 'Candidate' },
  { route: 'setup', label: 'Campaign', icon: 'target', section: 'System' },
  { route: 'settings', label: 'Settings', icon: 'gear', section: 'System' },
];

let current: Route = 'overview';
let state: CampaignView | null = null;
let shop: WorkspaceView | null = null;
let error = '';
let note = '';
let busyAction = '';
let busyMessage = '';
let busyStartedAt = 0;
let aiError = '';
let cvProgress = { active: false, percent: 0, label: '', startedAt: 0 };
let persistedTasks: Partial<Record<ProcessId, ProgressTask>> = getCachedProgressTasks();
let drawn = '';
let deferred: { view: CampaignView; workspace: WorkspaceView | null } | null = null;
let mobileDrawerOpen = false;

const root = document.getElementById('app')!;
const floatingToasts = createToaster(document.body);
const floatingHud = createFloatingHud(document.body);

const resetToWelcome = (push = false): void => {
  try {
    localStorage.removeItem('rs-apply-setup-skipped');
  } catch {
    // Ignore storage restrictions.
  }
  current = 'welcome';
  mobileDrawerOpen = false;
  if (push) history.pushState({ route: 'welcome' }, '', '#welcome');
  else history.replaceState({ route: 'welcome' }, '', '#welcome');
  window.scrollTo({ top: 0 });
};

function rail(ctx: Ctx): { aside: HTMLElement; backdrop: HTMLElement } {
  const nav = el('nav', { class: 'nav', 'aria-label': 'Sections' });
  const items = ctx.view.campaign
    ? NAV
    : [
        { route: 'welcome' as const, label: 'Get started', icon: 'check', section: 'Workspace' as const },
        { route: 'profile' as const, label: 'Candidate profile', icon: 'person', section: 'Candidate' as const },
        { route: 'setup' as const, label: 'Campaign', icon: 'target', section: 'System' as const },
        { route: 'settings' as const, label: 'Settings', icon: 'gear', section: 'System' as const },
      ];

  let lastSection = '';
  for (const item of items) {
    if (ctx.view.campaign && item.section !== lastSection) {
      lastSection = item.section;
      nav.append(text('div', 'nav-section', item.section));
    }
    const b = button(
      item.label,
      'nav-item',
      () => {
        mobileDrawerOpen = false;
        ctx.go(item.route);
      },
      { 'data-allow-during-action': true },
    );
    b.prepend(icon(item.icon, 17));
    if (current === item.route) b.setAttribute('aria-current', 'page');
    if (item.route === 'needs-you' && ctx.view.inboxCounts.open)
      b.append(el('span', { class: 'nav-badge' }, [String(ctx.view.inboxCounts.open)]));
    if (item.route === 'profile' && ctx.workspace?.reviewMeta?.status === 'draft')
      b.append(el('span', { class: 'nav-badge nav-badge-draft' }, ['Draft']));
    else if (item.route === 'profile' && ctx.workspace?.reviewMeta?.status === 'finalized')
      b.append(el('span', { class: 'nav-badge nav-badge-ready', 'aria-label': 'Finalized profile' }, ['✓']));
    nav.append(b);
  }

  const c = ctx.view.campaign;
  const running = c?.status === 'running' || c?.status === 'stopping';
  const done = ctx.view.counts.total ? Math.round((ctx.view.counts.submitted / ctx.view.counts.total) * 100) : 0;

  const themes: [Theme, string][] = [
    ['system', 'Auto'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ];
  const themeRow = div('rail-theme');
  themeRow.setAttribute('role', 'group');
  themeRow.setAttribute('aria-label', 'Appearance');
  for (const [value, label] of themes) {
    const b = button(label, 'rail-theme-btn', () => ctx.setTheme(value), { 'data-allow-during-action': true });
    if (ctx.theme === value) b.setAttribute('aria-pressed', 'true');
    themeRow.append(b);
  }

  const closeBtn = button(
    '',
    'btn btn-ghost btn-sm btn-icon rail-close',
    () => {
      mobileDrawerOpen = false;
      render(true);
    },
    { 'aria-label': 'Close navigation menu', 'data-allow-during-action': true },
  );
  closeBtn.replaceChildren(icon('close', 17));

  const aside = el('aside', { class: mobileDrawerOpen ? 'rail is-open' : 'rail' }, [
    div('rail-top', [
      div('brand', [
        div('brand-mark', ['R']),
        div('', [text('div', 'brand-name', 'Referral Scout'), text('div', 'brand-tag', 'Apply · Connect · Refer')]),
      ]),
      closeBtn,
    ]),
    nav,
    c
      ? div('rail-foot', [
          div('rail-foot-label', [
            el('span', {
              class: running
                ? 'dot dot-running'
                : ctx.view.inboxCounts.open
                  ? 'dot dot-attention'
                  : c.status === 'paused'
                    ? 'dot dot-paused'
                    : 'dot dot-ready',
            }),
            running
              ? 'Campaign active'
              : ctx.view.inboxCounts.open
                ? 'Needs you'
                : c.status === 'paused'
                  ? 'Paused'
                  : c.status === 'completed'
                    ? 'Completed'
                    : 'Ready to start',
          ]),
          text('div', 'rail-foot-name', c.name),
          text(
            'div',
            'rail-foot-meta',
            `${c.location} · ${c.employmentType} · ${c.sources.length} source${c.sources.length === 1 ? '' : 's'}`,
          ),
          div('rail-bar', [el('span', { style: `width:${done}%` })]),
        ])
      : div('rail-foot', [
          text('div', 'rail-foot-label', 'Setup in progress'),
          text(
            'div',
            'rail-foot-meta',
            ctx.workspace?.connections.linkedin ? `Signed in: ${ctx.workspace.linkedinProfileName || 'LinkedIn'}` : 'Ready when you are.',
          ),
        ]),
    themeRow,
  ]);

  const backdrop = div(mobileDrawerOpen ? 'rail-backdrop is-open' : 'rail-backdrop');
  backdrop.addEventListener('click', () => {
    mobileDrawerOpen = false;
    render(true);
  });

  return { aside, backdrop };
}

interface Header {
  title: string;
  sub: string;
  status?: HTMLElement;
  actions?: HTMLElement[];
}

function screenFor(ctx: Ctx): { header: Header; body: HTMLElement } {
  switch (current) {
    case 'applications':
      return { header: applicationsHeader(), body: applications(ctx) };
    case 'needs-you':
      return { header: needsYouHeader(ctx), body: needsYou(ctx) };
    case 'referrals':
      return { header: referralsHeader(ctx), body: referrals(ctx) };
    case 'activity':
      return { header: activityHeader(ctx), body: activity(ctx) };
    case 'setup':
      return { header: setupHeader(), body: setup(ctx) };
    case 'jobs':
      return { header: jobsHeader(ctx), body: jobs(ctx) };
    case 'people':
      return { header: peopleHeader(ctx), body: people(ctx) };
    case 'profile':
      return { header: profileHeader(ctx), body: profile(ctx) };
    case 'answers':
      return { header: answersHeader(ctx), body: answers(ctx) };
    case 'settings':
      return { header: settingsHeader(), body: settings(ctx) };
    case 'welcome':
      return { header: welcomeHeader(), body: welcome(ctx) };
    default:
      return { header: overviewHeader(ctx), body: overview(ctx) };
  }
}

const signature = (): string =>
  JSON.stringify([
    current,
    error,
    note,
    busyAction,
    busyMessage,
    aiError,
    cvProgress.active,
    cvProgress.label,
    mobileDrawerOpen,
    state,
    shop,
  ]);

function actionProgress(action: string): string {
  const labels: Record<string, string> = {
    save: 'Saving your campaign preferences…',
    create: 'Creating your campaign…',
    update: 'Updating your campaign…',
    rules: 'Saving your automation rules…',
    preferences: 'Saving your preferences…',
    eligibility: 'Saving your eligibility details…',
    identity: 'Saving your identity and contact details…',
    education: 'Saving education record…',
    employment: 'Saving work experience and re-checking jobs…',
    project: 'Saving project and re-checking jobs…',
    skills: 'Saving skills and re-checking jobs…',
    removeRecord: 'Removing record and re-checking jobs…',
    saveFact: 'Saving answer to your profile & Answer Bank…',
    applyStudentDefaults: 'Applying Student / Fresher Smart-Defaults…',
    clearFact: 'Clearing answer from your Answer Bank…',
    clearLearnedAnswer: 'Removing learned answer…',
    pinCompany: 'Updating company boost priority…',
    judgeJob: 'Updating your job shortlist decision…',
    requalify: 'Re-checking discovered jobs against your profile…',
    enqueueShortlisted: 'Adding shortlisted jobs to your application queue…',
    suppressContact: 'Marking contact as do-not-contact…',
    surface: 'Updating default toolbar surface…',
    testAi: 'Checking your ChatGPT connection…',
    testApi: 'Testing your OpenAI API key…',
    saveApi: 'Saving your OpenAI API key…',
    clearApi: 'Removing your OpenAI API key…',
    deleteCv: 'Deleting your CV from this device…',
    processProfileWithChatGPT: 'Asking ChatGPT to reconcile your CV and LinkedIn evidence… Nothing is being added to your profile yet.',
    approveAiProfileDraft: 'Adding the approved ChatGPT suggestions to your candidate profile…',
    start: 'Starting the application queue…',
    control: 'Updating application queue state…',
    enqueue: 'Adding job to the application queue…',
    retry: 'Putting application back in the queue…',
    skip: 'Skipping application…',
    confirm: 'Recording your submission confirmation…',
    resolve: 'Saving your answer and resuming affected applications…',
    findJobs: 'Starting LinkedIn Jobs search and preparing related role titles…',
    finishJobSearch: 'Finishing the current search and preparing the jobs for review…',
    pause: 'Pausing the workflow…',
    clear: 'Deleting all local data from this device…',
  };
  return labels[action] ?? 'Working…';
}

function render(force = false): void {
  if (!state) return;
  const next = signature();
  if (!force && next === drawn) return;
  drawn = next;

  const snap = snapshotForm(root);
  const ctx: Ctx = {
    view: state,
    workspace: shop,
    theme: currentTheme(),
    setTheme: theme => {
      applyTheme(theme);
      render(true);
    },
    run: async request => {
      if (busyAction) return;
      busyAction = `${request.kind}:${request.action}`;
      busyMessage = actionProgress(request.action);
      busyStartedAt = Date.now();
      if (request.action === 'processProfileWithChatGPT') aiError = '';
      note = '';
      error = '';
      render(true);
      try {
        if (request.kind === 'workspace') {
          shop = await sendWorkspace(request);
          note = api.lastMessage;
        } else state = await send(request);
        const [a, b] = await Promise.all([view(), workspace().catch(() => shop)]);
        state = a;
        shop = b;
        if (request.kind === 'workspace' && request.action === 'clear') resetToWelcome(true);
        if (request.action === 'processProfileWithChatGPT') aiError = '';
        error = '';
      } catch (e) {
        error = e instanceof Error ? e.message : 'Something went wrong.';
        if (request.action === 'processProfileWithChatGPT') aiError = error;
      } finally {
        busyAction = '';
        busyMessage = '';
        busyStartedAt = 0;
      }
      render(true);
    },
    runNetwork: async request => {
      if (busyAction) return;
      busyAction = `network:${request.action}`;
      busyStartedAt = Date.now();
      busyMessage =
        request.action === 'import'
          ? 'Reading your LinkedIn profile… Keep this dashboard open. Referral Scout is saving it as source evidence; ChatGPT will reconcile it with your CV before anything enters your candidate profile.'
          : actionProgress(request.action);
      note = '';
      error = '';
      render(true);
      try {
        const result = await sendNetwork(request);
        if (request.action === 'import') {
          if (!result.profile || !result.profileCapturedAt) {
            throw new Error(
              'LinkedIn did not return a verified profile. Check that you are signed in to the correct account, then try again.',
            );
          }
        } else if (request.action === 'findJobs') {
          note = 'Searching LinkedIn jobs in background…';
          void publishProgressTask({
            id: 'job_search',
            status: 'running',
            percent: 16,
            label: 'Searching LinkedIn Jobs…',
            detail: 'Scanning your target roles in a background LinkedIn tab',
            ctaLabel: 'View jobs →',
            targetRoute: 'jobs',
            etaSeconds: 30,
          });
        } else {
          note =
            request.action === 'consent'
              ? 'Optional usage counting is enabled.'
              : request.action === 'revokeConsent'
                ? 'Optional usage counting is disabled.'
                : result.status || 'Connection preference saved.';
        }
        const [a, b] = await Promise.all([
          view().catch(() => state!),
          workspace()
            .then(value => ({ value, failed: false as const }))
            .catch(() => ({ value: shop, failed: true as const })),
        ]);
        state = a;
        shop = b.value;
        if (request.action === 'import') {
          note = b.failed
            ? `${result.profile!.name || 'LinkedIn'} saved · Reopen Profile to run AI review.`
            : `${result.profile!.name || 'LinkedIn'} saved · Add CV next.`;
        }
        error = '';
      } catch (e) {
        error = e instanceof Error ? e.message : 'Something went wrong.';
      } finally {
        busyAction = '';
        busyMessage = '';
        busyStartedAt = 0;
      }
      render(true);
    },
    openExternal: url => {
      try {
        const parsed = new URL(url);
        if (!['https:'].includes(parsed.protocol)) throw new Error('Only secure links can be opened.');
        void chrome.tabs.create({ url: parsed.toString(), active: true }).catch(() => {
          error = 'The page could not be opened. Check your browser settings and try again.';
          render(true);
        });
      } catch (e) {
        error = e instanceof Error ? e.message : 'This link could not be opened.';
        render(true);
      }
    },
    inform: message => {
      note = message;
      error = '';
      floatingToasts.show('success', message);
      render(true);
    },
    openPanel: (url?: string) => {
      void chrome.runtime
        .sendMessage(url ? { kind: 'surface', action: 'open-linkedin-panel', url } : { kind: 'surface', action: 'open-panel' })
        .then(res => {
          const reply = res as { opened?: boolean } | undefined;
          if (reply && reply.opened === false) {
            floatingToasts.show('info', 'LinkedIn opened — click the Referral Scout icon if Side Panel stays closed.');
          }
        })
        .catch(() => {
          if (url) ctx.openExternal(url);
        });
    },
    go: route => {
      mobileDrawerOpen = false;
      if (route === current) {
        render(true);
        return;
      }
      current = route;
      error = '';
      note = '';
      history.pushState({ route }, '', `#${route}`);
      render(true);
      window.scrollTo({ top: 0 });
    },
    redraw: () => render(true),
    refresh: async () => {
      try {
        const [a, b] = await Promise.all([view(), workspace().catch(() => shop)]);
        state = a;
        shop = b;
        error = '';
      } catch (e) {
        error = e instanceof Error ? e.message : 'Something went wrong.';
      }
      render(true);
    },
    fail: message => {
      error = message;
      floatingToasts.show('error', message);
      render(true);
    },
    busyAction,
    ...(busyMessage ? { busyMessage } : {}),
    ...(cvProgress.active ? { cvLiveMessage: cvProgress.label } : {}),
    ...(aiError ? { aiError } : {}),
  };

  const syncFloatingHud = (): void => {
    if (!state) {
      floatingHud.update(null, () => undefined);
      return;
    }
    const hudState = computeHudState({
      route: current,
      view: state,
      workspace: shop,
      busyAction,
      busyMessage,
      busyStartedAt,
      persistedTasks,
      ...(cvProgress.active ? { cvProgress } : {}),
      reviewProgress: getReviewProgressSnapshot(shop),
    });
    const navigateHud = (target: HudState): void => {
      if (target.inspectTabId !== undefined || target.inspectTabUrl) {
        void chrome.runtime
          .sendMessage({
            kind: 'surface',
            action: 'focus-tab',
            ...(target.inspectTabId !== undefined ? { tabId: target.inspectTabId } : {}),
            ...(target.inspectTabUrl ? { url: target.inspectTabUrl } : {}),
          })
          .catch(() => {
            if (target.inspectTabUrl) ctx.openExternal(target.inspectTabUrl);
          });
        return;
      }
      if (target.mode === 'error' && target.retryTaskId) {
        void clearProgressTask(target.retryTaskId);
        if (target.retryTaskId === 'cv_ai_review') {
          if (current !== 'profile') ctx.go('profile');
          void ctx.run({ kind: 'workspace', action: 'processProfileWithChatGPT' });
          return;
        }
        if (target.retryTaskId === 'linkedin_import') {
          if (current !== 'profile') ctx.go('profile');
          void ctx.runNetwork({ kind: 'network', action: 'import' });
          return;
        }
      }
      if (target.command === 'findJobs') {
        if (current !== 'jobs') ctx.go('jobs');
        void ctx.runNetwork({ kind: 'network', action: 'findJobs' });
        return;
      }
      if (target.command === 'openPanel' || (target.mode === 'ready' && target.targetRoute === 'overview' && !shop?.jobs.length)) {
        ctx.openPanel();
        return;
      }
      const focusSelector = (): void => {
        if (!target.targetSelector) return;
        const node = root.querySelector<HTMLElement>(target.targetSelector);
        if (!node) return;
        node.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        node.classList.remove('is-hud-spotlight');
        void node.offsetWidth;
        node.classList.add('is-hud-spotlight');
        setTimeout(() => node.classList.remove('is-hud-spotlight'), 1400);
        const focusEl = node.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), label.btn');
        focusEl?.focus({ preventScroll: true });
      };
      if (target.targetRoute !== current) {
        ctx.go(target.targetRoute);
        requestAnimationFrame(focusSelector);
      } else {
        focusSelector();
      }
    };
    floatingHud.update(hudState, navigateHud);
  };

  const { header, body } = screenFor(ctx);
  document.title = `${header.title} · Referral Scout`;

  const head = div('page-head', [
    div('', [text('h1', 'page-title', header.title), text('p', 'page-sub', header.sub)]),
    div('page-actions', [header.status, ...(header.actions ?? [])].filter(Boolean) as HTMLElement[]),
  ]);

  const dismissBanner = (kind: 'error' | 'note'): HTMLButtonElement =>
    button(
      '×',
      'banner-dismiss',
      () => {
        if (kind === 'error') error = '';
        else note = '';
        render(true);
      },
      { 'aria-label': kind === 'error' ? 'Dismiss error' : 'Dismiss notice', 'data-allow-during-action': true },
    );

  const crumbItems: (Node | string)[] = [];
  if (state.campaign) {
    const campBtn = el('button', { class: 'crumb-link', type: 'button' }, [state.campaign.name]);
    campBtn.addEventListener('click', () => ctx.go('overview'));
    crumbItems.push(campBtn, icon('chevronRight', 13), text('span', 'crumb-current', header.title));
  } else {
    crumbItems.push(text('span', 'crumb-current', header.title));
  }

  const page = el('main', { class: 'page' }, [
    div('crumb', crumbItems),
    head,
    busyMessage
      ? el('div', { class: 'banner banner-progress', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, [
          icon('clock', 18),
          text('span', 'progress-copy', busyMessage),
        ])
      : null,
    error ? div('banner banner-error', [icon('alert', 18), el('span', { class: 'banner-copy' }, [error]), dismissBanner('error')]) : null,
    note ? div('banner banner-note', [icon('check', 18), el('span', { class: 'banner-copy' }, [note]), dismissBanner('note')]) : null,
    body,
  ]);

  const menuBtn = button(
    '',
    'btn btn-ghost btn-sm btn-icon',
    () => {
      mobileDrawerOpen = true;
      render(true);
    },
    { 'aria-label': 'Open navigation menu', 'aria-expanded': String(mobileDrawerOpen), 'data-allow-during-action': true },
  );
  menuBtn.replaceChildren(icon('menu', 18));

  const mobileBar = el('header', { class: 'mobile-bar' }, [
    menuBtn,
    div('brand-mark', ['R']),
    text('span', 'mobile-bar-title', header.title),
    header.status ? header.status.cloneNode(true) : null,
  ]);

  const { aside, backdrop } = rail(ctx);
  root.replaceChildren(div('app', [aside, backdrop, div('page-wrap', [mobileBar, page])]));
  restoreForm(root, snap);
  syncFloatingHud();
}

const routeFor = (hash: string): Route | undefined => {
  const value = hash.replace(/^#/, '') as Route;
  return NAV.some(n => n.route === value) || EXTRA_ROUTES.includes(value) ? value : undefined;
};

function routeFromHash(): void {
  const route = routeFor(location.hash);
  if (!route || route === current) return;
  current = route;
  error = '';
  render(true);
  window.scrollTo({ top: 0 });
}

function flushDeferred(): void {
  if (!deferred || isEditing(root)) return;
  state = deferred.view;
  shop = deferred.workspace;
  deferred = null;
  render();
}

export async function mount(): Promise<void> {
  applyTheme(currentTheme());
  const hash = routeFor(location.hash);
  if (hash) current = hash;
  root.replaceChildren(div('page', [pageSkeleton()]));
  try {
    const [a, b, tasks] = await Promise.all([
      view(),
      workspace().catch((e: unknown) => {
        error = `Your profile and jobs could not be loaded: ${e instanceof Error ? e.message : 'unknown error'}`;
        return null;
      }),
      readProgressTasks().catch(() => ({})),
    ]);
    state = a;
    shop = b;
    persistedTasks = tasks;
  } catch (e) {
    root.replaceChildren(
      div('page', [
        div('banner banner-error', [
          icon('alert', 18),
          el('span', { class: 'banner-copy' }, [
            e instanceof Error ? e.message : 'Referral Scout could not connect to its background service.',
          ]),
          button('Retry', 'btn btn-sm', () => void mount(), { 'data-allow-during-action': true }),
        ]),
      ]),
    );
    return;
  }
  if (!state.campaign && !location.hash) current = 'welcome';
  render(true);

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void Promise.all([view(), workspace().catch(() => shop)])
      .then(([a, b]) => {
        if (isEditing(root)) {
          deferred = { view: a, workspace: b };
          return;
        }
        if (state?.campaign && !a.campaign && !['welcome', 'profile', 'setup', 'settings'].includes(current)) resetToWelcome();
        state = a;
        shop = b;
        if (busyAction === 'generic') return;
        render();
      })
      .catch(() => undefined);
  }, 5000);

  root.addEventListener('focusout', () => setTimeout(flushDeferred, 150));

  addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileDrawerOpen) {
      mobileDrawerOpen = false;
      render(true);
    }
  });

  addEventListener('storage', e => {
    if (e.key === THEME_KEY) {
      applyTheme(currentTheme());
      render(true);
    }
  });

  const replaceTransientBanner = (kind: 'progress' | 'error', message: string): void => {
    const page = root.querySelector<HTMLElement>('.page');
    const head = page?.querySelector('.page-head');
    if (!page || !head) return;
    page.querySelectorAll('.banner-progress, .banner-error, .banner-note').forEach(node => node.remove());
    const banner =
      kind === 'progress'
        ? el('div', { class: 'banner banner-progress', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, [
            icon('clock', 18),
            text('span', 'progress-copy', message),
          ])
        : div('banner banner-error', [icon('alert', 18), el('span', { class: 'banner-copy' }, [message])]);
    head.after(banner);
  };

  addEventListener('referral-scout-action-start', event => {
    if (busyAction) return;
    busyAction = 'generic';
    busyMessage = (event as CustomEvent<string>).detail || 'Working…';
    busyStartedAt = Date.now();
    note = '';
    error = '';
    replaceTransientBanner('progress', busyMessage);
  });
  addEventListener('referral-scout-action-end', () => {
    if (busyAction === 'generic') {
      busyAction = '';
      busyMessage = '';
      busyStartedAt = 0;
    }
    render(true);
  });

  addEventListener('referral-scout-cv-progress', event => {
    const detail = (event as CustomEvent<{ active?: boolean; percent?: number; label?: string }>).detail;
    if (!detail) return;
    cvProgress = {
      active: !!detail.active,
      percent: detail.percent ?? 0,
      label: detail.label ?? '',
      startedAt: detail.active ? (cvProgress.active ? cvProgress.startedAt : Date.now()) : 0,
    };
    render(true);
  });

  addEventListener('referral-scout-review-change', () => {
    if (state) render(true);
  });

  subscribeProgressTasks(tasks => {
    persistedTasks = tasks;
    if (state) render(true);
  });

  addEventListener('referral-scout-action-error', event => {
    if (busyAction && busyAction !== 'generic') return;
    const message = (event as CustomEvent<string>).detail;
    error = typeof message === 'string' && message ? message : 'That action could not be completed. Please try again.';
    busyAction = '';
    busyMessage = '';
    busyStartedAt = 0;
    replaceTransientBanner('error', error);
  });

  chrome.runtime?.onMessage?.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
    const payload = message as { kind?: unknown; scope?: unknown; message?: unknown; tone?: unknown; title?: unknown };
    if (payload.kind === 'ui.cleared') {
      deferred = null;
      error = '';
      aiError = '';
      busyAction = '';
      busyMessage = '';
      busyStartedAt = 0;
      cvProgress = { active: false, percent: 0, label: '', startedAt: 0 };
      resetReviewSession();
      note = 'All local data was deleted from this device.';
      resetToWelcome();
      sendResponse({ shown: document.visibilityState === 'visible' });
      void Promise.all([view(), workspace().catch(() => null)])
        .then(([a, b]) => {
          state = a;
          shop = b;
          render(true);
        })
        .catch(() => undefined);
      return false;
    }
    if (payload.kind === 'ui.profileSynced') {
      void Promise.all([view(), workspace().catch(() => shop)])
        .then(([a, b]) => {
          state = a;
          shop = b;
          render(true);
        })
        .catch(() => undefined);
      sendResponse({ shown: document.visibilityState === 'visible' });
      return false;
    }
    if (payload.kind === 'ui.toast' && typeof payload.message === 'string') {
      floatingToasts.show(
        payload.tone === 'error' ? 'error' : payload.tone === 'info' ? 'info' : 'success',
        `${typeof payload.title === 'string' ? `${payload.title}: ` : ''}${payload.message}`,
      );
      sendResponse({ shown: document.visibilityState === 'visible' });
      return false;
    }
    if (
      payload.kind !== 'ui.progress' ||
      !['network-import', 'profile-ai'].includes(String(payload.scope)) ||
      typeof payload.message !== 'string'
    )
      return false;
    if (payload.scope === 'network-import' && busyAction !== 'network:import') return false;
    if (payload.scope === 'profile-ai' && busyAction !== 'workspace:processProfileWithChatGPT') return false;
    busyMessage = payload.message;
    const copy = root.querySelector<HTMLElement>('.banner-progress .progress-copy');
    if (copy) copy.textContent = busyMessage;
    render(true);
    sendResponse({ shown: document.visibilityState === 'visible' });
    return false;
  });

  addEventListener('popstate', routeFromHash);
  addEventListener('hashchange', routeFromHash);
}
