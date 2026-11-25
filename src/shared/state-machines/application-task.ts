/**
 * The application queue: one durable record per job the person wants to apply for.
 *
 * The old engine kept its working state per browser tab (`apply-session:{tabId}`). A tab id disappears when Edge
 * closes and is handed to an unrelated page after a restart, so it cannot be the identity of an application. Here the
 * identity is `applicationId`, the tab is only a lease, and every change is a checked transition that leaves an audit
 * entry. That is what lets the queue answer the one question that matters after an interruption: did the submit
 * happen or not?
 *
 * Nothing in this file touches the browser. It is the rules only, so it can be tested without a page.
 */

import { dedupeKey as vacancyKey } from '../domain/job';

/* ---------- states ---------- */
export type TaskState =
  'queued' | 'opening' | 'filling' | 'needs-you' | 'ready' | 'submitted' | 'uncertain' | 'failed' | 'skipped' | 'duplicate' | 'closed';

/** Where each state is allowed to go. Anything not listed here is a bug, not a rare case. */
export const ALLOWED: Record<TaskState, readonly TaskState[]> = {
  queued: ['opening', 'skipped', 'duplicate', 'closed'],
  opening: ['filling', 'needs-you', 'failed', 'queued'],
  filling: ['filling', 'needs-you', 'ready', 'failed'],
  'needs-you': ['filling', 'ready', 'skipped', 'failed', 'queued'],
  ready: ['submitted', 'needs-you', 'uncertain', 'failed'],
  // Once submitted, the application leaves the queue: what happens next (assessment, interview, rejection) is an
  // outcome recorded in the event ledger, not a queue state. Mixing the two is how a queue becomes a CRM by accident.
  submitted: ['closed'],
  // An uncertain submission is reconciled by evidence or by the person; only explicit confirmation may return it to queued.
  uncertain: ['submitted', 'queued', 'needs-you', 'failed', 'closed'],
  failed: ['queued', 'closed'],
  skipped: ['closed', 'queued'],
  duplicate: ['closed'],
  closed: [],
};

export const canTransition = (from: TaskState, to: TaskState): boolean => ALLOWED[from].includes(to);

/** States where no worker should be holding the item. */
export const RESTING: readonly TaskState[] = ['queued', 'needs-you', 'submitted', 'uncertain', 'failed', 'skipped', 'duplicate', 'closed'];
/** States that mean a worker is actively on the page. */
export const ACTIVE: readonly TaskState[] = ['opening', 'filling', 'ready'];
/** States that are finished for good; the runner never claims these again. */
export const TERMINAL: readonly TaskState[] = ['submitted', 'skipped', 'duplicate', 'closed'];

export const isActive = (s: TaskState): boolean => ACTIVE.includes(s);
export const isTerminal = (s: TaskState): boolean => TERMINAL.includes(s);

/* ---------- the record ---------- */
export type ApplyRoute = 'easy-apply' | 'external' | 'email' | 'unknown';

export interface SubmissionEvidence {
  /** Set the moment a final Submit is pressed, before the result is known. This is what makes "uncertain" possible. */
  attemptedAt?: number;
  /** A page or site confirmation was read, or the person confirmed it. */
  confirmedAt?: number;
  how?: 'site-confirmation' | 'url-change' | 'user-confirmed' | 'email';
  note?: string;
}

export interface TaskEvent {
  at: number;
  from: TaskState;
  to: TaskState;
  reason: string;
  /** Repeating the same transition with the same key is ignored, so a retried message cannot double-apply. */
  idempotencyKey?: string;
}

export interface WorkerLease {
  owner: string;
  tabId: number;
  /** The lease is dead after this; another worker may take the item. Heartbeats push it out. */
  expiresAt: number;
}

export interface ApplicationTask {
  id: string;
  campaignId: string;
  jobId: string;
  /** Copied from the job so the queue can be drawn without loading every job record. */
  company: string;
  title: string;
  location: string;
  url: string;
  source: string;
  ats: string;
  route: ApplyRoute;
  /** 0-100 fit from the ranking step; the queue orders by this before anything else. */
  fit: number;
  /** When the posting was seen, for the freshness part of the order. */
  postedAt?: number;
  state: TaskState;
  /** Why the item is where it is, in words the person can read. */
  note: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lease?: WorkerLease;
  /** The tab the application is open in right now. Never the identity: see the file comment. */
  tabId?: number;
  lastStep?: string;
  lastUrl?: string;
  /** Step plus field labels, so a resumed worker can tell whether the form is still the one it was filling. */
  formFingerprint?: string;
  /** Which version of the Answer Bank filled this, so a later profile edit does not rewrite history. */
  profileVersion?: number;
  submission?: SubmissionEvidence;
  /** Open exception ids blocking this item. */
  blockedBy?: string[];
  history: TaskEvent[];
  /** Set when the item was admitted as a duplicate of another, so the person can see which one won. */
  duplicateOf?: string;
  dedupeKey: string;
}

/* ---------- transitions ---------- */
export interface TransitionInput {
  to: TaskState;
  reason: string;
  at?: number;
  idempotencyKey?: string;
  patch?: Partial<Omit<ApplicationTask, 'id' | 'state' | 'history'>>;
}

export class TransitionError extends Error {
  constructor(
    readonly from: TaskState,
    readonly to: TaskState,
  ) {
    super(`An application cannot go from ${from} to ${to}.`);
    this.name = 'TransitionError';
  }
}

/**
 * The only way a task's state changes. Returns a new record; the caller writes it in one transaction.
 * A repeated idempotency key returns the record untouched, so a resent message is harmless.
 */
export function transition(task: ApplicationTask, input: TransitionInput): ApplicationTask {
  const at = input.at ?? Date.now();
  if (input.idempotencyKey && task.history.some(h => h.idempotencyKey === input.idempotencyKey)) return task;
  if (task.state !== input.to && !canTransition(task.state, input.to)) throw new TransitionError(task.state, input.to);
  const next: ApplicationTask = {
    ...task,
    ...(input.patch ?? {}),
    state: input.to,
    note: input.reason,
    updatedAt: at,
    history: [
      ...task.history,
      {
        at,
        from: task.state,
        to: input.to,
        reason: input.reason,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      },
    ].slice(-60),
  };
  // Leaving the page means letting go of the tab; keeping a stale lease is how two workers end up on one application.
  if (RESTING.includes(input.to)) {
    delete next.lease;
    delete next.tabId;
  }
  return next;
}

/* ---------- leases ---------- */
export const LEASE_MS = 90_000;

export const leaseLive = (task: ApplicationTask, now = Date.now()): boolean => !!task.lease && task.lease.expiresAt > now;

/** True when this worker may touch the item: nobody holds it, the holder is us, or the holder's lease has lapsed. */
export const claimable = (task: ApplicationTask, owner: string, now = Date.now()): boolean =>
  !leaseLive(task, now) || task.lease?.owner === owner;

export const withLease = (task: ApplicationTask, owner: string, tabId: number, now = Date.now()): ApplicationTask => ({
  ...task,
  lease: { owner, tabId, expiresAt: now + LEASE_MS },
  tabId,
});

export const heartbeat = (task: ApplicationTask, owner: string, now = Date.now()): ApplicationTask =>
  task.lease?.owner === owner ? { ...task, lease: { ...task.lease, expiresAt: now + LEASE_MS }, updatedAt: now } : task;

/* ---------- admission and dedupe ---------- */
// The canonical employer, title and vacancy keys live with the Job domain, since they describe the posting rather
// than the queue. The queue imports them so one vacancy has one dedupe key everywhere in the product.
export { canonicalCompany, normalizeTitle as canonicalTitle, dedupeKey } from '../domain/job';

export interface AdmissionRules {
  /** Below this fit a job is not worth the queue's time. */
  minFit: number;
  /** false = the person ticks jobs themselves; true = everything above minFit goes in. */
  autoAdmit: boolean;
  /** A pacing preference, not a promise that all of them are submitted. */
  dailyTarget: number;
  /** Routes the person is willing to run. */
  routes: ApplyRoute[];
}

export const defaultAdmission = (): AdmissionRules => ({
  minFit: 60,
  autoAdmit: false,
  dailyTarget: 15,
  routes: ['easy-apply', 'external'],
});

export type AdmissionVerdict = { ok: true } | { ok: false; reason: string; state: Extract<TaskState, 'skipped' | 'duplicate'> };

export interface AdmissionCandidate {
  company: string;
  title: string;
  location: string;
  fit: number;
  route: ApplyRoute;
  source?: string;
  sourceJobId?: string;
  closed?: boolean;
  alreadyApplied?: boolean;
  /** Set when a hard filter of the campaign rules is not met (wrong country, wrong employment type). */
  ineligible?: string;
}

/** Decides whether one job may enter the queue. Every refusal carries a reason the person can read. */
export function admit(
  candidate: AdmissionCandidate,
  rules: AdmissionRules,
  existing: Iterable<{ dedupeKey: string; id: string }>,
): AdmissionVerdict {
  if (candidate.closed) return { ok: false, reason: 'This posting is closed.', state: 'skipped' };
  if (candidate.alreadyApplied) return { ok: false, reason: 'You have already applied for this job.', state: 'skipped' };
  if (candidate.ineligible) return { ok: false, reason: candidate.ineligible, state: 'skipped' };
  if (!rules.routes.includes(candidate.route))
    return {
      ok: false,
      reason: `You have turned off ${candidate.route === 'easy-apply' ? 'Easy Apply' : candidate.route} applications.`,
      state: 'skipped',
    };
  if (candidate.fit < rules.minFit)
    return { ok: false, reason: `Fit ${candidate.fit} is below your minimum of ${rules.minFit}.`, state: 'skipped' };
  const key = vacancyKey(candidate);
  for (const e of existing)
    if (e.dedupeKey === key) return { ok: false, reason: 'The same vacancy is already in the queue.', state: 'duplicate' };
  return { ok: true };
}

/* ---------- ordering ---------- */
const DAY = 86_400_000;

/**
 * Fit first, freshness as the tie-breaker, effort last. A fast Easy Apply is a good win between two similar jobs, but
 * it must never push a clearly better external role down the list: that is how a queue fills up with easy, useless
 * applications and the numbers look busy while nothing comes of them.
 */
export function priorityOf(task: Pick<ApplicationTask, 'fit' | 'postedAt' | 'route' | 'attempts'>, now = Date.now()): number {
  const fit = Math.max(0, Math.min(100, task.fit)) * 10;
  const ageDays = task.postedAt ? (now - task.postedAt) / DAY : 14;
  const freshness = Math.max(0, 30 - ageDays * 2);
  const effort = task.route === 'easy-apply' ? 12 : 0;
  // Something that has already failed twice goes behind everything untried.
  const penalty = task.attempts * 25;
  return fit + freshness + effort - penalty;
}

export interface SchedulerOptions {
  owner: string;
  now?: number;
  /** Items already being worked, so the runner does not exceed the concurrency setting. */
  concurrency: number;
  /** Jobs confirmed submitted today, against the campaign's pacing target. */
  doneToday: number;
  dailyTarget: number;
}

/** True when the runner has reached the day's pacing target and should stop claiming new work. */
export const pacedOut = (o: Pick<SchedulerOptions, 'doneToday' | 'dailyTarget'>): boolean =>
  o.dailyTarget > 0 && o.doneToday >= o.dailyTarget;

/**
 * Picks the next item to work on, or nothing. Items blocked on the person are skipped over rather than waited for:
 * that single decision is what keeps one missing PIN code from stalling the whole search.
 */
export function nextEligible(tasks: readonly ApplicationTask[], o: SchedulerOptions): ApplicationTask | undefined {
  const now = o.now ?? Date.now();
  if (pacedOut(o)) return undefined;
  const running = tasks.filter(t => isActive(t.state) && leaseLive(t, now)).length;
  if (running >= o.concurrency) return undefined;
  return tasks
    .filter(t => t.state === 'queued' && claimable(t, o.owner, now))
    .sort((a, b) => priorityOf(b, now) - priorityOf(a, now) || a.createdAt - b.createdAt)[0];
}

/**
 * Items a restart must take back. A worker that vanished mid-form leaves an active state with a dead lease; the item
 * returns to the queue to be re-detected from the page, never resumed from a remembered DOM.
 */
export const orphaned = (tasks: readonly ApplicationTask[], now = Date.now()): ApplicationTask[] =>
  tasks.filter(t => isActive(t.state) && !leaseLive(t, now));

/**
 * Parked items whose blocking exception ids are no longer open (for example resolved or confirmed elsewhere).
 * Only safe-to-retry tasks with stale `blockedBy` references are healed so submitted/uncertain ones stay safe.
 */
export const staleNeedsYou = (tasks: readonly ApplicationTask[], openExceptionIds: ReadonlySet<string>): ApplicationTask[] =>
  tasks.filter(
    t => t.state === 'needs-you' && safeToRetry(t) && (t.blockedBy?.length ?? 0) > 0 && t.blockedBy!.every(id => !openExceptionIds.has(id)),
  );

/**
 * Whether a stopped item is safe to reopen. The question is never "did the worker stop?" but "did it stop before or
 * after pressing Submit?" — if a submit was attempted and never confirmed, reopening risks a second application.
 */
export const safeToRetry = (task: ApplicationTask): boolean => !task.submission?.attemptedAt || !!task.submission.confirmedAt;

export interface QueueCounts {
  queued: number;
  running: number;
  needsYou: number;
  submitted: number;
  uncertain: number;
  failed: number;
  skipped: number;
  total: number;
}

export function counts(tasks: readonly ApplicationTask[]): QueueCounts {
  const c: QueueCounts = { queued: 0, running: 0, needsYou: 0, submitted: 0, uncertain: 0, failed: 0, skipped: 0, total: tasks.length };
  for (const t of tasks) {
    if (t.state === 'queued') c.queued++;
    else if (isActive(t.state)) c.running++;
    else if (t.state === 'needs-you') c.needsYou++;
    else if (t.state === 'submitted') c.submitted++;
    else if (t.state === 'uncertain') c.uncertain++;
    else if (t.state === 'failed') c.failed++;
    else if (t.state === 'skipped' || t.state === 'duplicate') c.skipped++;
  }
  return c;
}

/* ---------- what the person is shown ---------- */
export const STATE_LABELS: Record<TaskState, string> = {
  queued: 'Queued',
  opening: 'Opening',
  filling: 'Filling',
  'needs-you': 'Needs you',
  ready: 'Ready to submit',
  submitted: 'Submitted',
  uncertain: 'Submission uncertain',
  failed: 'Failed',
  skipped: 'Skipped',
  duplicate: 'Duplicate',
  closed: 'Closed',
};

/**
 * Progress is counted steps, never elapsed time. A bar that creeps forward while nothing is happening teaches the
 * person to distrust the whole screen, so when the site gives no step count there is no bar at all — just the state.
 */
export function progressOf(task: ApplicationTask): { percent: number | null; label: string } {
  if (task.state === 'submitted') return { percent: 100, label: 'Submitted' };
  const m = /(\d+)\s*(?:of|\/)\s*(\d+)/i.exec(task.lastStep ?? '');
  if (m) {
    const [done, total] = [Number(m[1]), Number(m[2])];
    if (total > 0 && done > 0 && done <= total) return { percent: Math.round((done / total) * 100), label: `Step ${done} of ${total}` };
  }
  return { percent: null, label: STATE_LABELS[task.state] };
}
