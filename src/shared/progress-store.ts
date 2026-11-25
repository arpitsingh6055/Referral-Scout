/**
 * Cross-context live progress store backed by `chrome.storage.local` (MV3 service worker,
 * Workbench dashboard, Side Panel) with an in-memory fallback for JSDOM tests and restricted windows.
 *
 * Closing and reopening the Side Panel or Workbench tab (or restarting the browser) rehydrates exact
 * percentages, stage copy, and error/retry actions immediately without resetting back to 0%.
 */

import { currentResetGeneration, shouldAbortStaleWrite } from '../storage/database';
import { isProfilePendingReview, type ProfileReviewStatus } from './domain/profile';

export type ProcessId =
  | 'cv_parse'
  | 'cv_ai_review'
  | 'linkedin_import'
  | 'job_search'
  | 'apply_autofill'
  | 'application_queue'
  | 'outreach_scan'
  | 'gmail_sync'
  | 'export_reset';

export type TaskStatus = 'running' | 'waiting' | 'error' | 'done';

export interface ProgressTask {
  id: ProcessId;
  status: TaskStatus;
  percent: number;
  label: string;
  detail?: string;
  ctaLabel?: string;
  targetRoute?: string;
  targetSelector?: string;
  tabId?: number;
  tabUrl?: string;
  backgroundTab?: boolean;
  needsIntervention?: boolean;
  startedAt: number;
  updatedAt: number;
  etaSeconds?: number;
  error?: string;
}

export type ProgressTaskInput = Omit<ProgressTask, 'updatedAt' | 'startedAt'> & {
  startedAt?: number;
  updatedAt?: number;
};

export const PROGRESS_STORAGE_KEY = 'rs_live_progress_v1';
export const ACTIVE_MISSION_KEY = 'rs_active_mission_v1';
const LOCAL_EVENT = 'rs-progress-store-update';
const MISSION_LOCAL_EVENT = 'rs-active-mission-update';

export type MissionSurface = 'workbench' | 'linkedin_tab' | 'ats_tab';

export interface ActiveMissionState {
  currentStage: string;
  activeRoute: string;
  stageLabel: string;
  liveSummary: string;
  percent: number;
  active: boolean;
  pendingBlockerCount: number;
  recommendedSurface: MissionSurface;
  activeTabId?: number;
  activeTabUrl?: string;
  isSidePanelOpen: boolean;
  updatedAt: number;
}

const DEFAULT_MISSION: ActiveMissionState = {
  currentStage: 'overview',
  activeRoute: 'overview',
  stageLabel: 'Campaign Ready',
  liveSummary: 'Open Dashboard or Side Panel to continue',
  percent: 0,
  active: false,
  pendingBlockerCount: 0,
  recommendedSurface: 'workbench',
  isSidePanelOpen: false,
  updatedAt: 0,
};

let memoryMission: ActiveMissionState = { ...DEFAULT_MISSION };
let missionWriteChain: Promise<void> = Promise.resolve();

const PROCESS_PRIORITY: Record<ProcessId, number> = {
  cv_parse: 100,
  cv_ai_review: 95,
  apply_autofill: 90,
  linkedin_import: 85,
  job_search: 75,
  application_queue: 70,
  outreach_scan: 65,
  gmail_sync: 55,
  export_reset: 50,
};

const RUNNING_TTL_MS = 10 * 60_000;
const ERROR_TTL_MS = 5 * 60_000;
const DONE_TTL_MS = 8_000;

let memoryTasks: Partial<Record<ProcessId, ProgressTask>> = {};
let writeChain: Promise<void> = Promise.resolve();

function storageArea(): chrome.storage.StorageArea | undefined {
  try {
    const storage = (globalThis as { chrome?: typeof chrome }).chrome?.storage;
    return storage?.local ?? storage?.session;
  } catch {
    return undefined;
  }
}

function pruneMap(raw: Partial<Record<ProcessId, ProgressTask>>, now = Date.now()): Partial<Record<ProcessId, ProgressTask>> {
  const next: Partial<Record<ProcessId, ProgressTask>> = {};
  for (const [k, v] of Object.entries(raw) as [ProcessId, ProgressTask | undefined][]) {
    if (!v) continue;
    const age = now - v.updatedAt;
    if (v.status === 'running' && age > RUNNING_TTL_MS) continue;
    if (v.status === 'error' && age > ERROR_TTL_MS) continue;
    if (v.status === 'done' && age > DONE_TTL_MS) continue;
    next[k] = v;
  }
  return next;
}

function notifySameContext(map: Partial<Record<ProcessId, ProgressTask>>): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: map }));
    }
  } catch {
    // Service worker context has no DOM window.
  }
}

/** Reads all non-expired live progress tasks across MV3 storage and memory fallback. */
export async function readProgressTasks(now = Date.now()): Promise<Partial<Record<ProcessId, ProgressTask>>> {
  const area = storageArea();
  if (area) {
    try {
      const got = await area.get(PROGRESS_STORAGE_KEY);
      const parsed = (got?.[PROGRESS_STORAGE_KEY] ?? {}) as Partial<Record<ProcessId, ProgressTask>>;
      memoryTasks = pruneMap(parsed, now);
      return memoryTasks;
    } catch {
      // Fall back to in-memory cache when storage rejects in mocks/tests.
    }
  }
  memoryTasks = pruneMap(memoryTasks, now);
  return memoryTasks;
}

/** Synchronous snapshot of latest known tasks in this runtime. */
export function getCachedProgressTasks(now = Date.now()): Partial<Record<ProcessId, ProgressTask>> {
  memoryTasks = pruneMap(memoryTasks, now);
  return memoryTasks;
}

/** Atomically writes or updates a named background/interactive progress task. */
export function publishProgressTask(input: ProgressTaskInput): Promise<void> {
  const capturedGen = currentResetGeneration();
  writeChain = writeChain
    .then(async () => {
      if (shouldAbortStaleWrite(capturedGen)) return;
      const now = input.updatedAt ?? Date.now();
      const current = await readProgressTasks(now);
      const prev = current[input.id];
      const sameRun =
        prev && input.status === 'running' && prev.status === 'running' && (!input.startedAt || input.startedAt === prev.startedAt);
      const percent = Math.max(0, Math.min(100, Math.round(sameRun ? Math.max(prev.percent, input.percent) : input.percent)));
      const nextTask: ProgressTask = {
        ...input,
        percent,
        startedAt: input.startedAt ?? (sameRun ? prev.startedAt : now),
        updatedAt: now,
      };
      const nextMap: Partial<Record<ProcessId, ProgressTask>> = { ...current, [input.id]: nextTask };
      memoryTasks = nextMap;
      const area = storageArea();
      if (area) {
        await area.set({ [PROGRESS_STORAGE_KEY]: nextMap }).catch(() => undefined);
      }
      notifySameContext(nextMap);
    })
    .catch(() => undefined);
  return writeChain;
}

/** Removes a single finished/dismissed task from live progress storage. */
export function clearProgressTask(id: ProcessId): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      const current = await readProgressTasks();
      if (!current[id]) return;
      const nextMap = { ...current };
      delete nextMap[id];
      memoryTasks = nextMap;
      const area = storageArea();
      if (area) {
        await area.set({ [PROGRESS_STORAGE_KEY]: nextMap }).catch(() => undefined);
      }
      notifySameContext(nextMap);
    })
    .catch(() => undefined);
  return writeChain;
}

/** Clears every persisted progress entry (called on workspace reset). */
export function clearAllProgressTasks(): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      memoryTasks = {};
      const area = storageArea();
      if (area?.remove) {
        await Promise.resolve(area.remove(PROGRESS_STORAGE_KEY)).catch(() => undefined);
      }
      notifySameContext({});
    })
    .catch(() => undefined);
  void clearActiveMission();
  return writeChain;
}

/** Reads the unified cross-surface ActiveMissionState from extension storage (or in-memory test fallback). */
export async function readActiveMission(): Promise<ActiveMissionState> {
  const area = storageArea();
  if (area) {
    try {
      const got = await area.get(ACTIVE_MISSION_KEY);
      const raw = got?.[ACTIVE_MISSION_KEY] as ActiveMissionState | undefined;
      if (raw && typeof raw === 'object') {
        memoryMission = { ...DEFAULT_MISSION, ...raw };
        return memoryMission;
      }
    } catch {
      // Fall back safely in test mocks without chrome.storage.
    }
  }
  return memoryMission;
}

export function getCachedActiveMission(): ActiveMissionState {
  return memoryMission;
}

function notifyMissionSameContext(next: ActiveMissionState): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(MISSION_LOCAL_EVENT, { detail: next }));
    }
  } catch {
    // Service worker context has no DOM window.
  }
}

/** Atomically merges partial mission state updates into `rs_active_mission_v1`. */
export function publishActiveMission(patch: Partial<ActiveMissionState>): Promise<ActiveMissionState> {
  const capturedGen = currentResetGeneration();
  let result = memoryMission;
  missionWriteChain = missionWriteChain
    .then(async () => {
      if (shouldAbortStaleWrite(capturedGen)) return;
      const cur = await readActiveMission();
      if (shouldAbortStaleWrite(capturedGen)) return;
      const next: ActiveMissionState = {
        ...cur,
        ...patch,
        updatedAt: patch.updatedAt ?? Date.now(),
      };
      memoryMission = next;
      result = next;
      const area = storageArea();
      if (area) {
        await area.set({ [ACTIVE_MISSION_KEY]: next }).catch(() => undefined);
      }
      notifyMissionSameContext(next);
    })
    .catch(() => undefined);
  return missionWriteChain.then(() => result);
}

export function clearActiveMission(): Promise<void> {
  missionWriteChain = missionWriteChain
    .then(async () => {
      memoryMission = { ...DEFAULT_MISSION, isSidePanelOpen: memoryMission.isSidePanelOpen };
      const area = storageArea();
      if (area) {
        await area.remove(ACTIVE_MISSION_KEY).catch(() => undefined);
      }
      notifyMissionSameContext(memoryMission);
    })
    .catch(() => undefined);
  return missionWriteChain;
}

/** Subscribes to cross-context ActiveMissionState updates across Workbench, Side Panel, and Content Scripts. */
export function subscribeActiveMission(listener: (mission: ActiveMissionState) => void): () => void {
  const onLocal = (e: Event): void => {
    const detail = (e as CustomEvent<ActiveMissionState>).detail;
    listener(detail ?? memoryMission);
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if ((areaName !== 'local' && areaName !== 'session') || !changes[ACTIVE_MISSION_KEY]) return;
    const raw = (changes[ACTIVE_MISSION_KEY].newValue ?? DEFAULT_MISSION) as ActiveMissionState;
    memoryMission = { ...DEFAULT_MISSION, ...raw };
    listener(memoryMission);
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(MISSION_LOCAL_EVENT, onLocal);
  }
  try {
    (globalThis as { chrome?: typeof chrome }).chrome?.storage?.onChanged?.addListener(onStorage);
  } catch {
    // Storage listener unavailable outside extension pages.
  }

  return () => {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener(MISSION_LOCAL_EVENT, onLocal);
    }
    try {
      (globalThis as { chrome?: typeof chrome }).chrome?.storage?.onChanged?.removeListener(onStorage);
    } catch {
      // Ignore cleanup errors.
    }
  };
}

export interface HomingAction {
  action: 'navigate-route' | 'summon-linkedin' | 'none';
  label: string;
  route?: string;
  tabId?: number;
  url?: string;
}

/** Computes the 1-click "Return to Where You Belong" homing target from any Workbench screen. */
export function returnToWhereYouBelong(mission: ActiveMissionState, currentRoute: string): HomingAction {
  if (!mission.active && mission.pendingBlockerCount <= 0) {
    return { action: 'none', label: '' };
  }
  if (mission.activeRoute && mission.activeRoute !== currentRoute) {
    return {
      action: 'navigate-route',
      label: 'Return to Active Step →',
      route: mission.activeRoute,
    };
  }
  if (mission.recommendedSurface !== 'workbench' || !mission.isSidePanelOpen) {
    return {
      action: 'summon-linkedin',
      label: mission.isSidePanelOpen ? 'Focus Active LinkedIn Tab →' : 'Open Side Panel on LinkedIn →',
      ...(mission.activeTabId !== undefined ? { tabId: mission.activeTabId } : {}),
      ...(mission.activeTabUrl ? { url: mission.activeTabUrl } : {}),
    };
  }
  return { action: 'none', label: '' };
}

/** Subscribes to live changes from both `chrome.storage.onChanged` and same-page CustomEvents. */
export function subscribeProgressTasks(listener: (tasks: Partial<Record<ProcessId, ProgressTask>>) => void): () => void {
  const onLocal = (e: Event): void => {
    const detail = (e as CustomEvent<Partial<Record<ProcessId, ProgressTask>>>).detail;
    listener(pruneMap(detail ?? memoryTasks));
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if ((areaName !== 'local' && areaName !== 'session') || !changes[PROGRESS_STORAGE_KEY]) return;
    const next = (changes[PROGRESS_STORAGE_KEY].newValue ?? {}) as Partial<Record<ProcessId, ProgressTask>>;
    memoryTasks = pruneMap(next);
    listener(memoryTasks);
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(LOCAL_EVENT, onLocal);
  }
  try {
    (globalThis as { chrome?: typeof chrome }).chrome?.storage?.onChanged?.addListener(onStorage);
  } catch {
    // Storage listener unavailable in non-extension tests.
  }

  return () => {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener(LOCAL_EVENT, onLocal);
    }
    try {
      (globalThis as { chrome?: typeof chrome }).chrome?.storage?.onChanged?.removeListener(onStorage);
    } catch {
      // Ignore cleanup errors.
    }
  };
}

const STATUS_WEIGHT: Record<TaskStatus, number> = {
  running: 400,
  error: 300,
  waiting: 200,
  done: 100,
};

/** Selects the highest-priority task for display, smoothing long-running steps incrementally. */
export function selectPrimaryProgressTask(tasks: Partial<Record<ProcessId, ProgressTask>>, now = Date.now()): ProgressTask | null {
  const live = Object.values(pruneMap(tasks, now)).filter((t): t is ProgressTask => !!t);
  if (!live.length) return null;
  live.sort((a, b) => {
    const scoreA = STATUS_WEIGHT[a.status] + (PROCESS_PRIORITY[a.id] ?? 0);
    const scoreB = STATUS_WEIGHT[b.status] + (PROCESS_PRIORITY[b.id] ?? 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.updatedAt - a.updatedAt;
  });
  const top = live[0]!;
  if (top.status !== 'running') return top;
  const elapsedSinceUpdate = Math.max(0, (now - top.updatedAt) / 1000);
  const creep = Math.min(6, Math.floor(elapsedSinceUpdate / 4));
  const percent = Math.min(97, top.percent + creep);
  const etaSeconds =
    top.etaSeconds !== undefined && top.etaSeconds > 0
      ? Math.max(0, Math.round(top.etaSeconds - Math.min(top.etaSeconds, elapsedSinceUpdate)))
      : undefined;
  return {
    ...top,
    percent,
    ...(etaSeconds !== undefined && etaSeconds > 0 ? { etaSeconds } : {}),
  };
}

/* ---------- End-to-End 6-Stage Macro Journey State Machine ---------- */
export type JourneyRoute = 'welcome' | 'profile' | 'setup' | 'overview' | 'jobs' | 'needs-you' | 'applications' | 'referrals';

export interface JourneySnapshotInput {
  route: string;
  linkedinConnected: boolean;
  cvHasText: boolean;
  cvImported: boolean;
  hasAiDraft: boolean;
  profileReviewStatus?: ProfileReviewStatus | undefined;
  pendingConflictsCount: number;
  missingRequiredIdentity: 'fullName' | 'email' | null;
  hasCampaign: boolean;
  jobSearchStatus?: 'finding' | 'choosing' | 'working' | undefined;
  jobsCount: number;
  shortlistedCount: number;
  queuedCount: number;
  submittedCount: number;
  inboxOpen: number;
  inboxUrgent: number;
  inboxPrompt?: string | undefined;
  peopleCount: number;
}

export interface JourneyStepState {
  stage: 1 | 2 | 3 | 4 | 5 | 6;
  totalStages: 6;
  mode: 'completion' | 'ready' | 'error';
  percent: number;
  title: string;
  detail: string;
  ctaLabel: string;
  targetRoute: JourneyRoute;
  targetSelector?: string;
  command?: 'findJobs' | 'openPanel';
}

/**
 * Resolves the user's true end-to-end macro stage and next highest-leverage CTA without trapping
 * them on non-blocking micro-fields (like optional Answer Bank answers).
 */
export function resolveMacroJourney(input: JourneySnapshotInput): JourneyStepState {
  // Priority Blocker A: Needs-You / Uncertain Submissions
  if (input.inboxOpen > 0) {
    return {
      stage: 5,
      totalStages: 6,
      mode: input.inboxUrgent > 0 ? 'error' : 'completion',
      percent: 82,
      title: input.inboxUrgent
        ? `Action needed · ${input.inboxUrgent} confirmation${input.inboxUrgent === 1 ? '' : 's'}`
        : `Stage 5 of 6 · ${input.inboxOpen} waiting for you`,
      detail: input.inboxPrompt ?? 'Answer once in Needs you to keep applications moving',
      ctaLabel: input.route === 'needs-you' ? 'Resolve card above ↑' : 'Resolve now →',
      targetRoute: 'needs-you',
      targetSelector: '.inbox-item',
    };
  }

  // Priority Blocker B: Pending AI Profile Draft awaiting 1-click confirmation
  if (input.hasAiDraft) {
    const conflicts = input.pendingConflictsCount;
    return {
      stage: 2,
      totalStages: 6,
      mode: 'completion',
      percent: conflicts > 0 ? 35 : 42,
      title: `Stage 2 of 6 · 42% Complete`,
      detail:
        conflicts > 0
          ? `Next: Review ${conflicts} source difference${conflicts === 1 ? '' : 's'} & save profile`
          : 'Next: Confirm AI profile summary in 1 click',
      ctaLabel: input.route === 'profile' ? 'Confirm Profile Below ↓' : 'Review & Confirm CV →',
      targetRoute: 'profile',
      targetSelector: '[data-hud-target="cv-review"]',
    };
  }

  // Stage 1: Connect LinkedIn OR Upload CV
  if (!input.linkedinConnected) {
    return {
      stage: 1,
      totalStages: 6,
      mode: 'completion',
      percent: input.cvHasText ? 20 : 10,
      title: `Stage 1 of 6 · ${input.cvHasText ? 20 : 10}% Complete`,
      detail: 'Next: Connect LinkedIn so jobs and contacts match you',
      ctaLabel: 'Connect LinkedIn →',
      targetRoute: input.hasCampaign ? 'profile' : 'welcome',
      targetSelector: '[data-hud-target="linkedin"]',
    };
  }

  if (!input.cvHasText && !input.cvImported) {
    return {
      stage: 2,
      totalStages: 6,
      mode: 'completion',
      percent: 25,
      title: 'Stage 2 of 6 · 25% Complete',
      detail: 'Next: Upload your PDF or DOCX CV for AI profile setup',
      ctaLabel: 'Upload CV →',
      targetRoute: input.hasCampaign ? 'profile' : 'welcome',
      targetSelector: '[data-hud-target="cv-upload"]',
    };
  }

  // Stage 2b: CV uploaded, needs AI organization
  if (input.cvHasText && !input.cvImported) {
    return {
      stage: 2,
      totalStages: 6,
      mode: 'completion',
      percent: 38,
      title: 'Stage 2 of 6 · 38% Complete',
      detail: 'Next: Let AI organize your CV into a ready-to-apply profile',
      ctaLabel: 'Start AI Review →',
      targetRoute: 'profile',
      targetSelector: '[data-hud-target="cv-review"]',
    };
  }

  // Priority Blocker C: Missing required Name or Email after import
  if (input.missingRequiredIdentity) {
    const label = input.missingRequiredIdentity === 'fullName' ? 'Full Name' : 'Email';
    return {
      stage: 2,
      totalStages: 6,
      mode: 'completion',
      percent: 48,
      title: 'Stage 2 of 6 · Required Detail Missing',
      detail: `1 required detail before applying: Add your ${label}`,
      ctaLabel: `Add ${label} →`,
      targetRoute: 'profile',
      targetSelector: '[data-hud-target="identity"]',
    };
  }

  // Resumable Smart Profile Review awaiting explicit user approval
  if (isProfilePendingReview(input.profileReviewStatus)) {
    return {
      stage: 2,
      totalStages: 6,
      mode: 'completion',
      percent: 54,
      title: 'Profile Extracted • Quick 10s Review Needed',
      detail: 'Verify identity, roles & skills, then click Approve Profile & Continue →',
      ctaLabel: input.route === 'profile' ? 'Review & Approve ↓' : 'Review & Approve →',
      targetRoute: 'profile',
      targetSelector: '[data-hud-target="cv-review"]',
    };
  }

  // Stage 3: Set Target Role & Campaign
  if (!input.hasCampaign) {
    return {
      stage: 3,
      totalStages: 6,
      mode: 'completion',
      percent: 58,
      title: 'Stage 3 of 6 · Profile Ready (58% Complete)',
      detail: 'Next: Pick your target roles and preferred location',
      ctaLabel: 'Set Target Role →',
      targetRoute: 'welcome',
      targetSelector: '[data-hud-target="campaign-goal"]',
    };
  }

  // Stage 4: Choose discovered jobs
  if (input.jobSearchStatus === 'choosing' && input.jobsCount > 0) {
    return {
      stage: 5,
      totalStages: 6,
      mode: 'completion',
      percent: 78,
      title: 'Stage 5 of 6 · 78% Complete',
      detail: `Next: Shortlist from ${input.jobsCount} matched roles`,
      ctaLabel: 'Review Matched Jobs →',
      targetRoute: 'jobs',
    };
  }

  // Stage 4: Campaign exists, ready to search LinkedIn Jobs
  if (input.jobsCount === 0 && input.queuedCount === 0) {
    return {
      stage: 4,
      totalStages: 6,
      mode: 'ready',
      percent: 100,
      title: 'Setup 100% Ready · Find Jobs',
      detail: 'Profile & campaign ready — search LinkedIn roles now',
      ctaLabel: 'Find Jobs on LinkedIn →',
      targetRoute: 'jobs',
      command: 'findJobs',
    };
  }

  // Stage 5: Jobs exist, shortlist or enqueue
  if (input.queuedCount === 0 && input.submittedCount === 0) {
    return {
      stage: 5,
      totalStages: 6,
      mode: 'ready',
      percent: 100,
      title: input.shortlistedCount ? `${input.shortlistedCount} Shortlisted · Ready to Queue` : `${input.jobsCount} Jobs Matched`,
      detail: input.shortlistedCount
        ? 'Next: Add shortlisted roles to your application queue'
        : 'Next: Shortlist top roles & queue applications',
      ctaLabel: input.shortlistedCount ? 'View Shortlist & Queue →' : 'Review Top Jobs →',
      targetRoute: 'jobs',
    };
  }

  // Stage 6: Queue & Referral Outreach Active / Complete
  return {
    stage: 6,
    totalStages: 6,
    mode: 'ready',
    percent: 100,
    title: 'Pipeline Active · 100% Ready',
    detail:
      input.peopleCount > 0
        ? `${input.submittedCount} applied · ${input.peopleCount} referral contacts ranked`
        : `${input.queuedCount} in queue · ${input.submittedCount} submitted`,
    ctaLabel: input.route === 'applications' ? 'Open Referrals →' : 'View Queue & Progress →',
    targetRoute: input.route === 'applications' ? 'referrals' : 'applications',
  };
}
