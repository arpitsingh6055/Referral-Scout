/**
 * Side Panel <FloatingProgressHUD /> (360–420px viewport optimized).
 *
 * Docked cleanly above the fixed `.tabs` navigation bar with frosted glass, single/two-line compact
 * micro-copy, tabular percentages, minimize/restore chip, and live cross-context rehydration from
 * `chrome.storage.session`.
 */

import type { CampaignView } from '../../background/campaign';
import type { NetworkState } from '../../shared/network';
import { selectPrimaryProgressTask, type ProcessId, type ProgressTask } from '../../shared/progress-store';

export interface PanelHudAction {
  kind:
    'open-dashboard' | 'focus-tab' | 'tab-home-turn' | 'tab-people-needs' | 'tab-referrals' | 'tab-saved' | 'resume' | 'retry-ai' | 'noop';
  route?: string;
  tabId?: number;
  url?: string;
}

export interface PanelHudState {
  mode: 'processing' | 'completion' | 'ready' | 'error';
  percent: number;
  title: string;
  detail: string;
  ctaLabel: string;
  action: PanelHudAction;
}

/** Computes the highest-value live status / next action for the narrow Side Panel. */
export function computePanelHudState(input: {
  network: NetworkState | null;
  campaign: CampaignView | null;
  persistedTasks: Partial<Record<ProcessId, ProgressTask>>;
  now?: number;
}): PanelHudState | null {
  const { network: s, campaign: cv, persistedTasks } = input;
  const now = input.now ?? Date.now();

  /* 1. Highest priority: active persisted background task (e.g. CV AI, LinkedIn import, Autofill) */
  const persisted = selectPrimaryProgressTask(persistedTasks, now);
  if (persisted && (persisted.status === 'running' || persisted.status === 'error' || persisted.status === 'waiting')) {
    const needsTabFocus =
      (persisted.status === 'waiting' || persisted.needsIntervention) && (persisted.tabId !== undefined || !!persisted.tabUrl);
    return {
      mode: persisted.status === 'error' ? 'error' : persisted.status === 'waiting' ? 'completion' : 'processing',
      percent: persisted.percent,
      title: persisted.needsIntervention
        ? `Action Needed: ${persisted.label}`
        : persisted.backgroundTab && persisted.status === 'running'
          ? `Working in background tab (${persisted.percent}%)…`
          : `${persisted.percent}% · ${persisted.label}`,
      detail: persisted.detail ?? (persisted.etaSeconds ? `~${persisted.etaSeconds}s remaining` : 'Synced across extension'),
      ctaLabel: needsTabFocus
        ? (persisted.ctaLabel ?? 'Inspect Tab →')
        : (persisted.ctaLabel ?? (persisted.status === 'error' ? 'Retry' : 'Open')),
      action: needsTabFocus
        ? {
            kind: 'focus-tab',
            ...(persisted.tabId !== undefined ? { tabId: persisted.tabId } : {}),
            ...(persisted.tabUrl ? { url: persisted.tabUrl } : {}),
          }
        : persisted.status === 'error' && persisted.id === 'cv_ai_review'
          ? { kind: 'open-dashboard', route: 'profile' }
          : persisted.targetRoute
            ? { kind: 'open-dashboard', route: persisted.targetRoute }
            : { kind: 'tab-home-turn' },
    };
  }

  if (!s) return null;

  /* 2. First-run / setup completion tracking before main campaign launches */
  const hasCampaign = !!cv?.campaign;
  if (!s.profile || (!s.targetSet && !hasCampaign)) {
    const done = (s.profile ? 1 : 0) + (s.cv ? 1 : 0) + (hasCampaign ? 1 : 0);
    const pct = Math.round((done / 3) * 100);
    return {
      mode: pct >= 100 ? 'ready' : 'completion',
      percent: pct,
      title: `${pct}% Setup`,
      detail: !s.profile ? 'Step 1: Connect LinkedIn' : !s.cv ? 'Step 2: Upload CV in Dashboard' : 'Step 3: Create search campaign',
      ctaLabel: 'Continue →',
      action: { kind: 'open-dashboard', route: 'welcome' },
    };
  }

  /* 3. Active Job Discovery / Ranking */
  if (s.jobSearch?.status === 'finding') {
    const ranking = s.jobSearch.ranking;
    const pct = ranking?.total ? Math.max(10, Math.min(98, Math.round((ranking.done / ranking.total) * 100))) : 35;
    return {
      mode: 'processing',
      percent: pct,
      title: `${pct}% · Scanning LinkedIn jobs`,
      detail: ranking ? `Scored ${ranking.done} of ${ranking.total} matching roles` : `Found ${s.jobSearch.found.length} roles so far…`,
      ctaLabel: 'Jobs',
      action: { kind: 'tab-referrals' },
    };
  }

  if (s.jobSearch?.status === 'choosing' && s.jobSearch.found.length) {
    return {
      mode: 'completion',
      percent: 72,
      title: 'Action needed',
      detail: `${s.jobSearch.found.length} companies waiting for your pick`,
      ctaLabel: 'Choose →',
      action: { kind: 'tab-home-turn' },
    };
  }

  /* 4. Pending Review / Approval Gates */
  const waitingQuestions = (s.referralJobs ?? []).filter(j => j.waiting && j.finishedAt === undefined).length;
  if (waitingQuestions > 0) {
    return {
      mode: 'completion',
      percent: 76,
      title: `${waitingQuestions} search question${waitingQuestions === 1 ? '' : 's'}`,
      detail: 'Confirm company match so contact scan resumes',
      ctaLabel: 'Answer →',
      action: { kind: 'tab-home-turn' },
    };
  }

  const toApprove = s.contacts.filter(p => p.state === 'review' && !p.approved).length;
  if (toApprove > 0) {
    return {
      mode: 'completion',
      percent: 82,
      title: `${toApprove} draft${toApprove === 1 ? '' : 's'} ready`,
      detail: 'Approve referral note before sending',
      ctaLabel: 'Approve →',
      action: { kind: 'tab-people-needs' },
    };
  }

  if (cv?.inboxCounts.open) {
    return {
      mode: 'completion',
      percent: 75,
      title: `${cv.inboxCounts.open} app${cv.inboxCounts.open === 1 ? '' : 's'} paused`,
      detail: 'Answer a quick form question to resume',
      ctaLabel: 'Answer →',
      action: { kind: 'open-dashboard', route: 'needs-you' },
    };
  }

  /* 5. Campaign Queue Running */
  if (cv?.campaign && (cv.counts.running > 0 || cv.counts.queued > 0)) {
    const done = cv.counts.submitted;
    const total = Math.max(1, cv.counts.total);
    const pct = Math.max(10, Math.min(99, Math.round((done / total) * 100)));
    return {
      mode: 'completion',
      percent: pct,
      title: `${pct}% Queue (${done}/${total})`,
      detail: cv.counts.running ? 'Application queue running smoothly' : `${cv.counts.queued} ready in queue`,
      ctaLabel: 'Dashboard',
      action: { kind: 'open-dashboard', route: 'applications' },
    };
  }

  return null;
}

const R = 11;
const C = 2 * Math.PI * R;

function miniRing(percent: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.setAttribute('class', 'sp-hud-ring');
  svg.setAttribute('aria-hidden', 'true');

  const track = document.createElementNS(NS, 'circle');
  track.setAttribute('cx', '14');
  track.setAttribute('cy', '14');
  track.setAttribute('r', String(R));
  track.setAttribute('class', 'sp-hud-track');

  const fill = document.createElementNS(NS, 'circle');
  fill.setAttribute('cx', '14');
  fill.setAttribute('cy', '14');
  fill.setAttribute('r', String(R));
  fill.setAttribute('class', 'sp-hud-fill');
  fill.setAttribute('stroke-dasharray', String(C));
  fill.setAttribute('stroke-dashoffset', (C * (1 - Math.max(0, Math.min(100, percent)) / 100)).toFixed(2));

  svg.append(track, fill);
  return svg;
}

export interface SidePanelHudController {
  element: HTMLElement;
  update: (state: PanelHudState | null, onAction: (action: PanelHudAction) => void) => void;
}

/** Creates the compact bottom floating pill for the 360px+ Side Panel. */
export function createSidePanelHud(host: HTMLElement): SidePanelHudController {
  let collapsed = false;
  let lastState: PanelHudState | null = null;
  let lastHandler: ((action: PanelHudAction) => void) | null = null;

  const element = document.createElement('aside');
  element.className = 'sp-hud';
  element.setAttribute('role', 'region');
  element.setAttribute('aria-label', 'Live extension progress');
  element.hidden = true;
  host.append(element);

  const paint = (): void => {
    if (!lastState) {
      element.hidden = true;
      element.replaceChildren();
      return;
    }
    const s = lastState;
    const onAction = lastHandler ?? (() => undefined);
    element.hidden = false;
    element.className = `sp-hud is-${s.mode}${collapsed ? ' is-collapsed' : ''}`;

    if (collapsed) {
      const existingChip = element.querySelector<HTMLButtonElement>('.sp-hud-chip');
      if (existingChip) {
        const ringFill = existingChip.querySelector<SVGCircleElement>('.sp-hud-fill');
        if (ringFill) ringFill.setAttribute('stroke-dashoffset', (C * (1 - Math.max(0, Math.min(100, s.percent)) / 100)).toFixed(2));
        const textNode = [...existingChip.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
        if (textNode) textNode.textContent = `${s.percent}% · Progress`;
        return;
      }
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'sp-hud-chip';
      expand.setAttribute('aria-expanded', 'false');
      expand.textContent = `${s.percent}% · Progress`;
      expand.prepend(miniRing(s.percent));
      expand.addEventListener('click', () => {
        collapsed = false;
        paint();
      });
      element.replaceChildren(expand);
      return;
    }

    const existingRow = element.querySelector<HTMLElement>('.sp-hud-row');
    if (existingRow && !element.querySelector('.sp-hud-chip')) {
      const pctEl = existingRow.querySelector<HTMLElement>('.sp-hud-pct');
      if (pctEl) pctEl.textContent = `${s.percent}%`;
      const ringFill = existingRow.querySelector<SVGCircleElement>('.sp-hud-fill');
      if (ringFill) ringFill.setAttribute('stroke-dashoffset', (C * (1 - Math.max(0, Math.min(100, s.percent)) / 100)).toFixed(2));
      const titleEl = existingRow.querySelector<HTMLElement>('.sp-hud-title');
      if (titleEl) titleEl.textContent = s.title;
      const detailEl = existingRow.querySelector<HTMLElement>('.sp-hud-detail');
      if (detailEl) detailEl.textContent = s.detail;
      const bar = element.querySelector<HTMLElement>('.sp-hud-bar');
      if (bar) bar.className = s.mode === 'processing' ? 'sp-hud-bar is-running' : 'sp-hud-bar';
      const fill = element.querySelector<HTMLElement>('.sp-hud-bar > span');
      if (fill) fill.style.width = `${s.percent}%`;
      const ctaEl = existingRow.querySelector<HTMLButtonElement>('.btn');
      if (ctaEl) {
        ctaEl.textContent = s.ctaLabel;
        ctaEl.onclick = () => onAction(s.action);
        return;
      }
    }

    const row = document.createElement('div');
    row.className = 'sp-hud-row';

    const ringWrap = document.createElement('div');
    ringWrap.className = 'sp-hud-ring-wrap';
    const pct = document.createElement('span');
    pct.className = 'sp-hud-pct';
    pct.textContent = `${s.percent}%`;
    ringWrap.append(miniRing(s.percent), pct);

    const copy = document.createElement('div');
    copy.className = 'sp-hud-copy';
    const titleEl = document.createElement('div');
    titleEl.className = 'sp-hud-title';
    titleEl.textContent = s.title;
    const detailEl = document.createElement('div');
    detailEl.className = 'sp-hud-detail';
    detailEl.textContent = s.detail;
    copy.append(titleEl, detailEl);

    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = `btn sm ${s.mode === 'ready' || s.mode === 'error' ? 'primary' : ''}`.trim();
    cta.textContent = s.ctaLabel;
    cta.addEventListener('click', () => onAction(s.action));

    const minBtn = document.createElement('button');
    minBtn.type = 'button';
    minBtn.className = 'sp-hud-min';
    minBtn.setAttribute('aria-label', 'Minimize progress bar');
    minBtn.setAttribute('aria-expanded', 'true');
    minBtn.textContent = '×';
    minBtn.addEventListener('click', () => {
      collapsed = true;
      paint();
    });

    row.append(ringWrap, copy, cta, minBtn);

    const bar = document.createElement('div');
    bar.className = s.mode === 'processing' ? 'sp-hud-bar is-running' : 'sp-hud-bar';
    const fill = document.createElement('span');
    fill.style.width = `${s.percent}%`;
    bar.append(fill);

    element.replaceChildren(row, bar);
  };

  return {
    element,
    update: (state, onAction) => {
      lastState = state;
      lastHandler = onAction;
      paint();
    },
  };
}
