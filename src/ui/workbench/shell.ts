/**
 * The workbench shell: the navigation rail, the routing and the one redraw that every screen shares.
 *
 * The page holds no state of its own beyond which screen is open. Every action sends a message and redraws from
 * the view that comes back, so what this page shows is always what the background believes — there is no local
 * copy to drift out of date while a worker is filling a form in another tab.
 */

import './tokens.css';
import './app.css';
import * as api from './api';
import { send, sendWorkspace, view, workspace, type CampaignView, type Request, type WorkspaceView } from './api';
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
  go: (route: Route) => void;
  openPanel: () => void;
  redraw: () => void;
  refresh: () => Promise<void>;
  fail: (message: string) => void;
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
/** What the last render drew, so a refresh that changes nothing does not rebuild the page. */
let drawn = '';
/** State that arrived while the person was typing, applied once they stop. */
let deferred: { view: CampaignView; workspace: WorkspaceView | null } | null = null;

const root = document.getElementById('app')!;

function rail(ctx: Ctx): HTMLElement {
  const nav = el('nav', { class: 'nav', 'aria-label': 'Sections' });
  for (const item of NAV) {
    const b = button(item.label, 'nav-item', () => ctx.go(item.route));
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
    const b = button(label, 'rail-theme-btn', () => ctx.setTheme(value));
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
      : div('rail-foot', [text('div', 'rail-foot-label', 'No campaign yet'), text('div', 'rail-foot-meta', 'Create one to begin.')]),
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

const signature = (): string => JSON.stringify([current, error, state, shop]);

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
      try {
        note = '';
        if (request.kind === 'workspace') {
          shop = await sendWorkspace(request);
          note = api.lastMessage;
        } else state = await send(request);
        // An action on one side can change the other — queueing a job, or a profile edit that re-qualifies the
        // shortlist — so both are re-read rather than guessing which moved.
        const [a, b] = await Promise.all([view(), workspace().catch(() => shop)]);
        state = a;
        shop = b;
        error = '';
      } catch (e) {
        error = e instanceof Error ? e.message : 'Something went wrong.';
      }
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
  // re-read on a slow tick rather than left to go stale behind the person's back.
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
        state = a;
        shop = b;
        render();
      })
      .catch(() => undefined);
  }, 5000);

  // Held-back state lands as soon as the person leaves the field they were in.
  root.addEventListener('focusout', () => setTimeout(flushDeferred, 150));

  // Back, Forward and a hand-edited address all change the hash; without this the page would keep showing the
  // screen it started on while the address bar said otherwise.
  addEventListener('popstate', routeFromHash);
  addEventListener('hashchange', routeFromHash);
}
