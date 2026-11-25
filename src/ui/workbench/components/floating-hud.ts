/**
 * Persistent bottom FloatingProgressHUD (Problem 2: dual-mode visibility & 1-click jump-to-next).
 *
 * Dual-Mode Intelligence:
 * 1. Active Processing Mode: renders an animated progress ring + bar, exact tabular percentage,
 *    current micro-step copy, and estimated seconds remaining during CV parsing, ChatGPT reconciliation,
 *    LinkedIn capture, or job search ranking.
 * 2. Interactive Completion Mode: tracks real-time setup / review / profile completeness as items are
 *    completed (`tabular-nums`), transforms into a "100% Ready" CTA pill when finished, and scrolls to or
 *    routes directly to the next incomplete item on click.
 */

import { button, div, el, icon, text } from '../dom';
import type { CampaignView, WorkspaceView } from '../api';
import type { Route } from '../shell';
import { selectPrimaryProgressTask, type ProcessId, type ProgressTask } from '../../../shared/progress-store';

export interface ReviewProgressSnapshot {
  /** Current 1-based step inside GuidedReviewWorkspace (1..3). */
  step: number;
  totalSteps: number;
  /** Number of conflicts + additions left for the user to confirm in the active review flow. */
  remainingItems: number;
  /** True right after the user clicks Apply to celebrate completion. */
  justApproved: boolean;
}

export interface HudInput {
  route: Route;
  view: CampaignView;
  workspace: WorkspaceView | null;
  busyAction: string;
  busyMessage: string;
  cvProgress?: { active: boolean; percent: number; label: string; startedAt: number };
  reviewProgress?: ReviewProgressSnapshot | null;
  persistedTasks?: Partial<Record<ProcessId, ProgressTask>>;
  busyStartedAt?: number;
  now?: number;
}

export interface HudState {
  mode: 'processing' | 'completion' | 'ready' | 'error';
  percent: number;
  title: string;
  detail: string;
  etaText?: string;
  ctaLabel: string;
  targetRoute: Route;
  targetSelector?: string;
  retryTaskId?: ProcessId;
}

const AI_STAGE_PERCENT: [RegExp, number, number][] = [
  [/waiting for chatgpt/i, 12, 55],
  [/opening your chatgpt/i, 20, 48],
  [/preparing your profile analysis|sending your cv/i, 28, 42],
  [/thinking through|processing your source/i, 42, 34],
  [/preparing the reconciliation/i, 52, 28],
  [/sending the structured/i, 60, 24],
  [/waiting for chatgpt/i, 66, 20],
  [/received the request/i, 70, 18],
  [/analysing your documents/i, 78, 14],
  [/drafting your structured/i, 86, 9],
  [/validating every field/i, 92, 5],
  [/checking/i, 96, 3],
];

function estimateProcessProgress(busyAction: string, busyMessage: string, elapsedMs: number): { percent: number; etaSeconds: number } {
  if (busyAction === 'workspace:processProfileWithChatGPT') {
    for (const [pattern, pct, eta] of AI_STAGE_PERCENT) {
      if (pattern.test(busyMessage)) {
        const bonus = Math.min(4, Math.floor(elapsedMs / 8000));
        return { percent: Math.min(97, pct + bonus), etaSeconds: Math.max(2, eta - (Math.floor(elapsedMs / 1000) % 4)) };
      }
    }
    const pct = Math.min(90, 18 + Math.round(elapsedMs / 900));
    return { percent: pct, etaSeconds: Math.max(4, Math.round((100 - pct) * 0.45)) };
  }
  if (busyAction === 'network:import') {
    const pct = Math.min(92, 24 + Math.round(elapsedMs / 350));
    return { percent: pct, etaSeconds: Math.max(2, Math.round((100 - pct) * 0.2)) };
  }
  if (busyAction === 'workspace:approveAiProfileDraft') {
    return { percent: 84, etaSeconds: 3 };
  }
  const pct = Math.min(90, 32 + Math.round(elapsedMs / 400));
  return { percent: pct, etaSeconds: Math.max(2, Math.round((100 - pct) * 0.15)) };
}

/** Pure, deterministic HUD state calculator suitable for unit tests and live UI rendering. */
export function computeHudState(input: HudInput): HudState | null {
  const { route, view, workspace: w, busyAction, busyMessage, cvProgress, reviewProgress, persistedTasks } = input;
  const now = input.now ?? Date.now();

  /* 0. Rehydrated Cross-Context Background Task from chrome.storage.session */
  const persisted = persistedTasks ? selectPrimaryProgressTask(persistedTasks, now) : null;
  if (persisted && persisted.status === 'running' && !busyAction && !cvProgress?.active) {
    return {
      mode: 'processing',
      percent: persisted.percent,
      title: persisted.label,
      detail: persisted.detail ?? 'Running in background · stays synced across tabs',
      ...(persisted.etaSeconds ? { etaText: `~${persisted.etaSeconds}s left` } : {}),
      ctaLabel: persisted.ctaLabel ?? 'View step →',
      targetRoute: (persisted.targetRoute as Route) || route,
      ...(persisted.targetSelector ? { targetSelector: persisted.targetSelector } : {}),
    };
  }
  if (persisted && persisted.status === 'error' && !busyAction) {
    return {
      mode: 'error',
      percent: persisted.percent,
      title: persisted.label,
      detail: persisted.detail ?? 'Paused before finishing. Retry with 1 click.',
      ctaLabel: persisted.ctaLabel ?? 'Retry →',
      targetRoute: (persisted.targetRoute as Route) || 'profile',
      ...(persisted.targetSelector ? { targetSelector: persisted.targetSelector } : {}),
      retryTaskId: persisted.id,
    };
  }

  /* 1. Active Processing Mode */
  if (cvProgress?.active) {
    const elapsed = Math.max(0, (now - cvProgress.startedAt) / 1000);
    const pct = Math.max(8, Math.min(99, Math.round(cvProgress.percent)));
    const eta = pct >= 90 ? 1 : Math.max(2, Math.round(((100 - pct) / Math.max(10, pct)) * Math.max(1.5, elapsed)));
    return {
      mode: 'processing',
      percent: pct,
      title: cvProgress.label || 'Reading CV file…',
      detail: 'Preparing structured review next',
      etaText: `~${eta}s left`,
      ctaLabel: 'Viewing progress',
      targetRoute: route,
      targetSelector: '[data-hud-target="cv-review"]',
    };
  }

  if (busyAction) {
    const elapsedMs = input.busyStartedAt ? Math.max(0, now - input.busyStartedAt) : 1500;
    const { percent, etaSeconds } = estimateProcessProgress(busyAction, busyMessage, elapsedMs);
    return {
      mode: 'processing',
      percent,
      title: busyMessage || 'Working…',
      detail:
        busyAction === 'workspace:processProfileWithChatGPT'
          ? 'Guided diff review opens automatically when ready'
          : 'Stay on this tab — saves automatically',
      etaText: `~${etaSeconds}s left`,
      ctaLabel: 'Jump to step',
      targetRoute: route,
      ...(busyAction === 'workspace:processProfileWithChatGPT' ? { targetSelector: '[data-hud-target="cv-review"]' } : {}),
    };
  }

  if (w?.jobSearch?.status === 'finding') {
    const ranking = w.jobSearch.ranking;
    const pct = ranking?.total
      ? Math.max(8, Math.min(98, Math.round((ranking.done / ranking.total) * 100)))
      : w.jobSearch.totalTerms
        ? Math.max(8, Math.min(95, Math.round((w.jobSearch.cursor / w.jobSearch.totalTerms) * 100)))
        : 22;
    const remaining = ranking ? Math.max(0, ranking.total - ranking.done) : 0;
    return {
      mode: 'processing',
      percent: pct,
      title: ranking ? `Scoring job ${ranking.done} of ${ranking.total}…` : `Found ${w.jobSearch.found} matching roles…`,
      detail: 'Matching listings against your CV & profile',
      ...(remaining ? { etaText: `~${Math.max(3, remaining * 2)}s left` } : {}),
      ctaLabel: 'View jobs',
      targetRoute: 'jobs',
    };
  }

  if (!w) return null;

  /* 2. Active Guided AI Review Mode */
  if (w.aiProfileDraft && (route === 'profile' || route === 'welcome')) {
    const step = reviewProgress?.step ?? 1;
    const total = reviewProgress?.totalSteps ?? 3;
    const pct = step === 1 ? 35 : step === 2 ? 78 : 100;
    const conflictsLeft = w.aiProfileDraft.conflicts.length;
    return {
      mode: 'completion',
      percent: pct,
      title: `CV Review · Step ${step} of ${total}`,
      detail:
        step === 1
          ? conflictsLeft
            ? `${conflictsLeft} ${conflictsLeft === 1 ? 'difference' : 'differences'} to confirm`
            : 'Ready to inspect extracted changes'
          : '1 click to save improvements to profile',
      ctaLabel: step === 1 ? 'Review diff →' : 'Apply changes →',
      targetRoute: 'profile',
      targetSelector: '[data-hud-target="cv-review"]',
    };
  }

  /* 3. Overall Setup & Profile Completion Mode */
  const hasProfileRecords = w.cv.imported || w.profile.employment.length > 0 || w.profile.education.length > 0;
  const answerFraction = w.completeness.total > 0 ? Math.min(1, w.completeness.complete / w.completeness.total) : 1;
  const milestones: { done: boolean; weight: number; label: string; route: Route; selector: string }[] = [
    {
      done: w.connections.linkedin,
      weight: 20,
      label: 'Connect LinkedIn profile',
      route: view.campaign ? 'profile' : 'welcome',
      selector: '[data-hud-target="linkedin"]',
    },
    {
      done: w.cv.hasText,
      weight: 20,
      label: 'Upload your CV',
      route: view.campaign ? 'profile' : 'welcome',
      selector: '[data-hud-target="cv-upload"]',
    },
    {
      done: !w.aiProfileDraft && hasProfileRecords,
      weight: 25,
      label: w.aiProfileDraft ? 'Approve AI CV review' : w.cv.hasText ? 'Organize CV with AI' : 'Add role or degree',
      route: 'profile',
      selector: '[data-hud-target="cv-review"]',
    },
    {
      done: answerFraction >= 1,
      weight: 15,
      label: `${w.completeness.missing.length || 1} core answer${w.completeness.missing.length === 1 ? '' : 's'} left`,
      route: 'answers',
      selector: '[data-hud-target="answers"]',
    },
    {
      done: !!view.campaign,
      weight: 20,
      label: 'Set target roles & campaign',
      route: view.campaign ? 'setup' : 'welcome',
      selector: '[data-hud-target="campaign-goal"]',
    },
  ];

  let score = 0;
  for (const m of milestones) {
    if (m.label.includes('core answer')) score += m.done ? m.weight : Math.round(m.weight * answerFraction);
    else if (m.done) score += m.weight;
  }
  const percent = Math.max(0, Math.min(100, Math.round(score)));
  const incomplete = milestones.filter(m => !m.done);
  const next = incomplete[0];

  if (percent >= 100 && view.inboxCounts.open === 0) {
    return {
      mode: 'ready',
      percent: 100,
      title: '100% Ready',
      detail: w.jobs.length ? 'Profile verified & campaign ready' : 'Profile & CV ready for job search',
      ctaLabel: w.jobs.length ? 'Review top jobs →' : 'Open side panel →',
      targetRoute: w.jobs.length ? 'jobs' : 'overview',
    };
  }

  if (percent >= 100 && view.inboxCounts.open > 0) {
    return {
      mode: 'completion',
      percent: 92,
      title: `92% Complete · ${view.inboxCounts.open} waiting`,
      detail: 'A paused application needs your quick answer',
      ctaLabel: 'Answer now →',
      targetRoute: 'needs-you',
    };
  }

  return {
    mode: 'completion',
    percent,
    title: `${percent}% Complete · ${incomplete.length} step${incomplete.length === 1 ? '' : 's'} left`,
    detail: `Next: ${next?.label ?? 'Finish profile'}`,
    ctaLabel: route === next?.route ? 'Jump to next ↓' : 'Fix next →',
    targetRoute: next?.route ?? 'profile',
    ...(next?.selector ? { targetSelector: next.selector } : {}),
  };
}

export interface FloatingHudController {
  element: HTMLElement;
  update: (state: HudState | null, onNavigate: (state: HudState) => void) => void;
}

const RING_RADIUS = 13;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function progressRing(percent: number, mode: HudState['mode']): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', `hud-ring${mode === 'processing' ? ' is-spinning' : ''}`);
  svg.setAttribute('aria-hidden', 'true');

  const track = document.createElementNS(NS, 'circle');
  track.setAttribute('cx', '16');
  track.setAttribute('cy', '16');
  track.setAttribute('r', String(RING_RADIUS));
  track.setAttribute('class', 'hud-ring-track');

  const fill = document.createElementNS(NS, 'circle');
  fill.setAttribute('cx', '16');
  fill.setAttribute('cy', '16');
  fill.setAttribute('r', String(RING_RADIUS));
  fill.setAttribute('class', 'hud-ring-fill');
  fill.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE));
  const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, percent)) / 100);
  fill.setAttribute('stroke-dashoffset', offset.toFixed(2));

  svg.append(track, fill);
  return svg;
}

/** Mounts a persistent bottom FloatingProgressHUD container inside the shell. */
export function createFloatingHud(host: HTMLElement): FloatingHudController {
  let collapsed = false;
  let lastState: HudState | null = null;
  let lastHandler: ((state: HudState) => void) | null = null;

  const element = el('aside', {
    class: 'floating-hud',
    role: 'region',
    'aria-label': 'Overall progress and next step',
  });
  element.hidden = true;
  host.append(element);

  const paint = (): void => {
    if (!lastState) {
      element.hidden = true;
      element.replaceChildren();
      return;
    }
    const state = lastState;
    const onNavigate = lastHandler ?? (() => undefined);
    element.hidden = false;
    element.className = `floating-hud is-${state.mode}${collapsed ? ' is-collapsed' : ''}`;

    if (collapsed) {
      const expandBtn = button(`${state.percent}% · Next`, 'hud-chip-expand', () => {
        collapsed = false;
        paint();
      });
      expandBtn.prepend(progressRing(state.percent, state.mode));
      expandBtn.setAttribute('aria-expanded', 'false');
      expandBtn.setAttribute('aria-label', `${state.title}. Expand progress tracker.`);
      element.replaceChildren(expandBtn);
      return;
    }

    const collapseBtn = button(
      '',
      'hud-minimize',
      () => {
        collapsed = true;
        paint();
      },
      { 'aria-label': 'Minimize progress pill', 'aria-expanded': 'true', 'data-allow-during-action': true },
    );
    collapseBtn.replaceChildren(icon('chevronDown', 14));

    const ctaBtn = button(
      state.ctaLabel,
      `btn btn-sm ${state.mode === 'ready' || state.mode === 'error' ? 'btn-primary' : 'hud-cta'}`,
      () => onNavigate(state),
      { 'data-allow-during-action': true },
    );
    if (state.mode === 'processing') {
      ctaBtn.disabled = !state.targetSelector;
    }

    const copy = div('hud-copy', [
      div('hud-title-row', [text('span', 'hud-title', state.title), state.etaText ? text('span', 'hud-eta', state.etaText) : null]),
      text('div', 'hud-detail', state.detail),
    ]);

    const body = div('hud-inner', [
      div('hud-ring-wrap', [progressRing(state.percent, state.mode), text('span', 'hud-pct', `${state.percent}%`)]),
      copy,
      div('hud-actions', [state.mode !== 'processing' || state.targetSelector ? ctaBtn : null, collapseBtn]),
    ]);

    const bar = div('hud-progress-track', [el('span', { class: 'hud-progress-fill', style: `width:${state.percent}%` })]);
    element.replaceChildren(body, bar);
  };

  return {
    element,
    update: (state, onNavigate) => {
      lastState = state;
      lastHandler = onNavigate;
      paint();
    },
  };
}
