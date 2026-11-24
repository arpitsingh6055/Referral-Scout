/**
 * The workbench shell: the navigation rail, the routing and the one redraw that every screen shares.
 *
 * The page holds no state of its own beyond which screen is open. Every action sends a message and redraws from
 * the view that comes back, so what this page shows is always what the background believes — there is no local
 * copy to drift out of date while a worker is filling a form in another tab.
 */

import './tokens.css';
import './app.css';
import { createToaster } from '../toast';
import * as api from './api';
import { send, sendNetwork, sendWorkspace, view, workspace, type CampaignView, type Request, type WorkspaceView } from './api';
import type { NetworkRequest } from '../../shared/network';
import { button, div, el, icon, isEditing, restoreForm, snapshotForm, text } from './dom';
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

/**
 * The theme lives in localStorage rather than the background, because it must be applied before the first paint
 * and a round-trip to the service worker would show a flash of the wrong one.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private windows can refuse storage; the theme simply does not persist there.
  }
}

export function currentTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Fall through to the system default.
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
  /** The person's own records. Loaded alongside the campaign so a screen never has to wait for a second round-trip. */
  workspace: WorkspaceView | null;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** One call for both services; the request's `kind` decides which one answers. */
  run: (request: Request) => Promise<void>;
  runNetwork: (request: NetworkRequest) => Promise<void>;
  openExternal: (url: string) => void;
  inform: (message: string) => void;
  go: (route: Route) => void;
  openPanel: () => void;
  redraw: () => void;
  refresh: () => Promise<void>;
  fail: (message: string) => void;
  /** True while a background action is running; screens use it to label and disable the relevant control. */
  busyAction: string;
}

/** Routes reachable by link but not shown in the rail. */
const EXTRA_ROUTES: Route[] = ['welcome'];

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'overview', label: 'Overview', icon: 'home' },
  { route: 'jobs', label: 'Jobs', icon: 'briefcase' },
  { route: 'applications', label: 'Applications', icon: 'list' },
  { route: 'needs-you', label: 'Needs you', icon: 'bell' },
  { route: 'referrals', label: 'Referrals', icon: 'target' },
  { route: 'people', label: 'People', icon: 'people' },
  { route: 'activity', label: 'Activity', icon: 'activity' },
  { route: 'profile', label: 'Profile', icon: 'person' },
  { route: 'answers', label: 'Answer Bank', icon: 'check' },
  { route: 'setup', label: 'Campaign', icon: 'target' },
  { route: 'settings', label: 'Settings', icon: 'gear' },
];

let current: Route = 'overview';
let state: CampaignView | null = null;
let shop: WorkspaceView | null = null;
let error = '';
/** A short confirmation of what just happened, cleared on the next action. */
let note = '';
/** Visible, accessible progress state. Never leave a person wondering whether a click registered. */
let busyAction = '';
let busyMessage = '';
/** What the last render drew, so a refresh that changes nothing does not rebuild the page. */
let drawn = '';
/** State that arrived while the person was typing, applied once they stop. */
let deferred: { view: CampaignView; workspace: WorkspaceView | null } | null = null;

const root = document.getElementById('app')!;
const floatingToasts = createToaster(document.body);

function rail(ctx: Ctx): HTMLElement {
  const nav = el('nav', { class: 'nav', 'aria-label': 'Sections' });
  // A first-time user should not see ten empty destinations before creating a campaign. Keep the rail focused
  // on the few places that help them complete setup; the full workbench appears as soon as a campaign exists.
  const items = ctx.view.campaign
    ? NAV
    : [
        { route: 'welcome' as const, label: 'Get started', icon: 'check' },
        { route: 'profile' as const, label: 'Candidate profile', icon: 'person' },
        { route: 'setup' as const, label: 'Campaign', icon: 'target' },
        { route: 'settings' as const, label: 'Settings', icon: 'gear' },
      ];
  for (const item of items) {
    const b = button(item.label, 'nav-item', () => ctx.go(item.route), { 'data-allow-during-action': true });
    b.prepend(icon(item.icon));
    if (current === item.route) b.setAttribute('aria-current', 'page');
    if (item.route === 'needs-you' && ctx.view.inboxCounts.open)
      b.append(el('span', { class: 'nav-badge' }, [String(ctx.view.inboxCounts.open)]));
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

  return el('aside', { class: 'rail' }, [
    div('brand', [
      div('brand-mark', ['R']),
      div('', [text('div', 'brand-name', 'Referral Scout'), text('div', 'brand-tag', 'Apply · Connect · Get hired')]),
    ]),
    nav,
    c
      ? div('rail-foot', [
          div('rail-foot-label', [
            el('span', { class: running ? 'dot dot-running' : ctx.view.inboxCounts.open ? 'dot dot-attention' : 'dot dot-paused' }),
            running ? 'Campaign active' : ctx.view.inboxCounts.open ? 'Needs you' : 'Paused',
          ]),
          text('div', 'rail-foot-name', c.name),
          text(
            'div',
            'rail-foot-meta',
            `${c.location} · ${c.employmentType} · ${c.sources.length} source${c.sources.length === 1 ? '' : 's'}`,
          ),
          div('rail-bar', [el('span', { style: `width:${done}%` })]),
        ])
      : div('rail-foot', [text('div', 'rail-foot-label', 'Setup in progress'), text('div', 'rail-foot-meta', 'Your workspace is ready when you are.')]),
    themeRow,
  ]);
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

const resetToWelcome = (push = false): void => {
  try {
    localStorage.removeItem('rs-apply-setup-skipped');
  } catch {
    // Ignore storage restrictions.
  }
  current = 'welcome';
  if (push) history.pushState({ route: 'welcome' }, '', '#welcome');
  else history.replaceState({ route: 'welcome' }, '', '#welcome');
  window.scrollTo({ top: 0 });
};

const signature = (): string => JSON.stringify([current, error, state, shop]);

function actionProgress(action: string): string {
  const labels: Record<string, string> = {
    save: 'Saving your campaign preferences…',
    create: 'Creating your campaign…',
    update: 'Updating your campaign…',
    rules: 'Saving your automation rules…',
    preferences: 'Saving your preferences…',
    testAi: 'Checking your ChatGPT connection…',
    testApi: 'Testing the optional API connection…',
    processProfileWithChatGPT: 'Asking ChatGPT to reconcile your CV and LinkedIn evidence… Nothing is being added to your profile yet.',
    approveAiProfileDraft: 'Adding the approved ChatGPT suggestions to your candidate profile…',
    start: 'Starting the application queue…',
    findJobs: 'Starting LinkedIn Jobs search and preparing related role titles…',
    finishJobSearch: 'Finishing the current search and preparing the jobs for review…',
    pause: 'Pausing the workflow…',
    clear: 'Deleting all local data from this device…',
  };
  return labels[action] ?? 'Working… Your changes are being saved.';
}

/**
 * Draws the page.
 *
 * `force` is for anything the person just did: their own click must always be reflected, even when the data
 * behind it happens to be identical. A background refresh passes nothing and is skipped unless something
 * actually changed, because rebuilding the DOM under someone's hands is how typing gets eaten.
 */
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
      render();
    },
    run: async request => {
      if (busyAction) return;
      busyAction = `${request.kind}:${request.action}`;
      busyMessage = actionProgress(request.action);
      note = '';
      error = '';
      render(true);
      try {
        if (request.kind === 'workspace') {
          shop = await sendWorkspace(request);
          note = api.lastMessage;
        } else state = await send(request);
        // An action on one side can change the other — queueing a job, or a profile edit that re-qualifies the
        // shortlist — so both are re-read rather than guessing which moved.
        const [a, b] = await Promise.all([view(), workspace().catch(() => shop)]);
        state = a;
        shop = b;
        if (request.kind === 'workspace' && request.action === 'clear') resetToWelcome(true);
        error = '';
      } catch (e) {
        error = e instanceof Error ? e.message : 'Something went wrong.';
      } finally {
        busyAction = '';
        busyMessage = '';
      }
      render(true);
    },
    runNetwork: async request => {
      if (busyAction) return;
      busyAction = `network:${request.action}`;
      busyMessage = request.action === 'import'
        ? 'Reading your LinkedIn profile… Keep this dashboard open. Referral Scout is saving it as source evidence; ChatGPT will reconcile it with your CV before anything enters your candidate profile.'
        : actionProgress(request.action);
      note = '';
      error = '';
      render(true);
      try {
        const result = await sendNetwork(request);
        if (request.action === 'import') {
          if (!result.profile || !result.profileCapturedAt) {
            throw new Error('LinkedIn did not return a verified profile. Check that you are signed in to the correct account, then try again.');
          }
        } else {
          note = request.action === 'consent'
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
            ? `${result.profile!.name || 'Your LinkedIn'} profile was verified and saved as source evidence, but the dashboard could not refresh. Reopen Candidate profile to process it with ChatGPT.`
            : `${result.profile!.name || 'Your LinkedIn'} profile was verified and saved as source evidence. Add your CV, then ask ChatGPT to reconcile both before creating candidate-profile records.`;
        }
        error = '';
      } catch (e) {
        error = e instanceof Error ? e.message : 'Something went wrong.';
      } finally {
        busyAction = '';
        busyMessage = '';
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
      render(true);
    },
    openPanel: () => void chrome.runtime.sendMessage({ kind: 'surface', action: 'open-panel' }).catch(() => undefined),
    go: route => {
      if (route === current) return;
      current = route;
      error = '';
      note = '';
      // pushState, not replaceState: moving between screens should be undoable with the browser's Back button.
      history.pushState({ route }, '', `#${route}`);
      render(true);
      // Moving between screens should land the person at the top of the new one, not halfway down the last.
      window.scrollTo({ top: 0 });
    },
    redraw: () => render(true),
    refresh: async () => {
      try {
        const [a, b] = await Promise.all([view(), workspace().catch(() => shop)]);
        if (state?.campaign && !a.campaign && !['welcome', 'profile', 'setup', 'settings'].includes(current)) resetToWelcome();
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
      render(true);
    },
    busyAction,
  };

  const { header, body } = screenFor(ctx);
  document.title = `${header.title} · Referral Scout`;

  const head = div('page-head', [
    div('', [text('h1', 'page-title', header.title), text('p', 'page-sub', header.sub)]),
    div('page-actions', [header.status, ...(header.actions ?? [])].filter(Boolean) as HTMLElement[]),
  ]);

  const page = el('main', { class: 'page' }, [
    text('div', 'crumb', state.campaign ? `Campaigns / ${state.campaign.name}` : 'Campaigns'),
    head,
    busyMessage ? el('div', { class: 'banner banner-progress', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, [icon('clock', 18), text('span', 'progress-copy', busyMessage)]) : null,
    error ? div('banner banner-error', [icon('alert', 18), error]) : null,
    note ? div('banner banner-note', [icon('check', 18), note]) : null,
    body,
  ]);

  root.replaceChildren(div('app', [rail(ctx), page]));
  restoreForm(root, snap);
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

/** Applies state that arrived mid-edit, once the person has moved on. */
function flushDeferred(): void {
  if (!deferred || isEditing(root)) return;
  state = deferred.view;
  shop = deferred.workspace;
  deferred = null;
  render();
}

/** Entry point. Exported rather than run on import so the design preview can install its stub first. */
export async function mount(): Promise<void> {
  applyTheme(currentTheme());
  const hash = routeFor(location.hash);
  if (hash) current = hash;
  root.replaceChildren(div('empty', [text('div', 'empty-title', 'Loading your campaign…')]));
  try {
    const [a, b] = await Promise.all([
      view(),
      workspace().catch((e: unknown) => {
        error = `Your profile and jobs could not be loaded: ${e instanceof Error ? e.message : 'unknown error'}`;
        return null;
      }),
    ]);
    state = a;
    shop = b;
  } catch (e) {
    root.replaceChildren(
      div('page', [div('banner banner-error', [icon('alert', 18), e instanceof Error ? e.message : 'Referral Scout is not running.'])]),
    );
    return;
  }
  if (!state.campaign && !location.hash) current = 'welcome';
  render(true);
  // A worker filling a form in another tab changes the queue without this page doing anything, so the view is
  // re-read on a slow tick. It never interrupts: while the person is in a field the new state is held back, and
  // a tick that changes nothing does not touch the DOM at all.
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

  // Held-back state lands as soon as the person leaves the field they were in.
  root.addEventListener('focusout', () => setTimeout(flushDeferred, 150));

  // Async button handlers that perform a multi-step workflow outside ctx.run also receive visible feedback.
  const replaceTransientBanner = (kind: 'progress' | 'error', message: string): void => {
    const page = root.querySelector<HTMLElement>('.page');
    const head = page?.querySelector('.page-head');
    if (!page || !head) return;
    page.querySelectorAll('.banner-progress, .banner-error, .banner-note').forEach(node => node.remove());
    const banner = kind === 'progress'
      ? el('div', { class: 'banner banner-progress', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, [icon('clock', 18), text('span', 'progress-copy', message)])
      : div('banner banner-error', [icon('alert', 18), message]);
    head.after(banner);
  };

  addEventListener('referral-scout-action-start', event => {
    if (busyAction) return; // ctx.run already owns a more specific progress message
    busyAction = 'generic';
    busyMessage = (event as CustomEvent<string>).detail || 'Working… Your changes are being saved.';
    note = '';
    error = '';
    replaceTransientBanner('progress', busyMessage);
  });
  addEventListener('referral-scout-action-end', () => {
    if (busyAction === 'generic') {
      busyAction = '';
      busyMessage = '';
    }
    // The DOM may have been rebuilt while the action ran. Recreate controls now that the shared action lock is clear.
    render(true);
  });

  // Async click handlers outside ctx.run (exports, connection checks, file operations) still report failures
  // in the same visible banner rather than leaving a rejected promise in the console.
  addEventListener('referral-scout-action-error', event => {
    if (busyAction && busyAction !== 'generic') return;
    const message = (event as CustomEvent<string>).detail;
    error = typeof message === 'string' && message ? message : 'That action could not be completed. Please try again.';
    busyAction = '';
    busyMessage = '';
    replaceTransientBanner('error', error);
  });

  // The service worker reports real milestones during longer LinkedIn imports. Keep the update in the existing
  // banner instead of re-rendering the page while the person may be reading or scrolling.
  chrome.runtime?.onMessage?.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
    const payload = message as { kind?: unknown; scope?: unknown; message?: unknown; tone?: unknown; title?: unknown };
    if (payload.kind === 'ui.cleared') {
      deferred = null;
      error = '';
      busyAction = '';
      busyMessage = '';
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
    if (payload.kind === 'ui.toast' && typeof payload.message === 'string') {
      floatingToasts.show(payload.tone === 'error' ? 'error' : payload.tone === 'info' ? 'info' : 'success', `${typeof payload.title === 'string' ? `${payload.title}: ` : ''}${payload.message}`);
      sendResponse({ shown: document.visibilityState === 'visible' });
      return false;
    }
    if (payload.kind !== 'ui.progress' || !['network-import', 'profile-ai'].includes(String(payload.scope)) || typeof payload.message !== 'string') return false;
    if (payload.scope === 'network-import' && busyAction !== 'network:import') return false;
    if (payload.scope === 'profile-ai' && busyAction !== 'workspace:processProfileWithChatGPT') return false;
    busyMessage = payload.message;
    const copy = root.querySelector<HTMLElement>('.banner-progress .progress-copy');
    if (copy) copy.textContent = busyMessage;
    sendResponse({ shown: document.visibilityState === 'visible' });
    return false;
  });

  // Back, Forward and a hand-edited address all change the hash; without this the page would keep showing the
  // screen it started on while the address bar said otherwise.
  addEventListener('popstate', routeFromHash);
  addEventListener('hashchange', routeFromHash);
}
