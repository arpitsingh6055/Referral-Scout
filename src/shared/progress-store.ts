/**
 * Cross-context live progress store backed by `chrome.storage.session` (MV3 service worker,
 * Workbench dashboard, Side Panel) with an in-memory fallback for JSDOM tests and restricted windows.
 *
 * Closing and reopening the Side Panel or Workbench tab mid-operation rehydrates exact percentages,
 * stage copy, and error/retry actions immediately without resetting back to 0%.
 */

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
const LOCAL_EVENT = 'rs-progress-store-update';

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

function sessionArea(): chrome.storage.StorageArea | undefined {
  try {
    return (globalThis as { chrome?: typeof chrome }).chrome?.storage?.session;
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
  const area = sessionArea();
  if (area) {
    try {
      const got = await area.get(PROGRESS_STORAGE_KEY);
      const parsed = (got?.[PROGRESS_STORAGE_KEY] ?? {}) as Partial<Record<ProcessId, ProgressTask>>;
      memoryTasks = pruneMap(parsed, now);
      return memoryTasks;
    } catch {
      // Fall back to in-memory cache when session storage rejects in mocks/tests.
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
  writeChain = writeChain
    .then(async () => {
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
      const area = sessionArea();
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
      const area = sessionArea();
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
      const area = sessionArea();
      if (area) {
        await area.remove(PROGRESS_STORAGE_KEY).catch(() => undefined);
      }
      notifySameContext({});
    })
    .catch(() => undefined);
  return writeChain;
}

/** Subscribes to live changes from both `chrome.storage.onChanged` and same-page CustomEvents. */
export function subscribeProgressTasks(listener: (tasks: Partial<Record<ProcessId, ProgressTask>>) => void): () => void {
  const onLocal = (e: Event): void => {
    const detail = (e as CustomEvent<Partial<Record<ProcessId, ProgressTask>>>).detail;
    listener(pruneMap(detail ?? memoryTasks));
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== 'session' || !changes[PROGRESS_STORAGE_KEY]) return;
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
    top.etaSeconds !== undefined ? Math.max(1, Math.round(top.etaSeconds - Math.min(top.etaSeconds - 1, elapsedSinceUpdate))) : undefined;
  return {
    ...top,
    percent,
    ...(etaSeconds !== undefined ? { etaSeconds } : {}),
  };
}
