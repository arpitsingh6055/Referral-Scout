import { describe, expect, it } from 'vitest';
import {
  admit,
  canTransition,
  claimable,
  counts,
  dedupeKey,
  defaultAdmission,
  heartbeat,
  nextEligible,
  orphaned,
  pacedOut,
  priorityOf,
  progressOf,
  safeToRetry,
  staleNeedsYou,
  transition,
  TransitionError,
  withLease,
  type ApplicationTask,
  type TaskState,
} from '../src/shared/state-machines/application-task';

const NOW = 1_700_000_000_000;

function task(over: Partial<ApplicationTask> = {}): ApplicationTask {
  return {
    id: over.id ?? 'app:1',
    campaignId: 'camp:1',
    jobId: 'job:1',
    company: 'Razorpay',
    title: 'Product Operations Intern',
    location: 'Bengaluru',
    url: 'https://example.com/job/1',
    source: 'linkedin',
    ats: 'greenhouse',
    route: 'external',
    fit: 80,
    state: 'queued',
    note: '',
    attempts: 0,
    createdAt: NOW,
    updatedAt: NOW,
    history: [],
    dedupeKey: 'k:razorpay|product operations|bengaluru',
    ...over,
  };
}

describe('state machine', () => {
  it('allows the lifecycle the product describes', () => {
    const path: TaskState[] = ['queued', 'opening', 'filling', 'ready', 'submitted'];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('refuses a jump that would skip the work', () => {
    expect(canTransition('queued', 'submitted')).toBe(false);
    expect(() => transition(task(), { to: 'submitted', reason: 'no' })).toThrow(TransitionError);
  });

  it('never lets an uncertain submission go back to filling', () => {
    expect(canTransition('uncertain', 'filling')).toBe(false);
    expect(canTransition('uncertain', 'ready')).toBe(false);
  });

  it('records every transition with its reason', () => {
    const t = transition(task(), { to: 'opening', reason: 'Opening the form', at: NOW + 1 });
    expect(t.history).toEqual([{ at: NOW + 1, from: 'queued', to: 'opening', reason: 'Opening the form' }]);
    expect(t.note).toBe('Opening the form');
  });

  it('ignores a repeated transition carrying the same idempotency key', () => {
    const once = transition(task(), { to: 'opening', reason: 'Opening', idempotencyKey: 'k1' });
    const twice = transition(once, { to: 'opening', reason: 'Opening', idempotencyKey: 'k1' });
    expect(twice).toBe(once);
    expect(twice.history).toHaveLength(1);
  });

  it('drops the lease when the item stops being worked on', () => {
    const held = withLease(task({ state: 'filling' }), 'worker-a', 42, NOW);
    expect(held.tabId).toBe(42);
    const parked = transition(held, { to: 'needs-you', reason: 'Needs a PIN code' });
    expect(parked.lease).toBeUndefined();
    expect(parked.tabId).toBeUndefined();
  });
});

describe('leases', () => {
  it('lets the holder keep working and keeps others out', () => {
    const held = withLease(task({ state: 'filling' }), 'worker-a', 7, NOW);
    expect(claimable(held, 'worker-a', NOW + 1000)).toBe(true);
    expect(claimable(held, 'worker-b', NOW + 1000)).toBe(false);
  });

  it('frees the item once the lease lapses, so a dead worker does not hold it for ever', () => {
    const held = withLease(task({ state: 'filling' }), 'worker-a', 7, NOW);
    expect(claimable(held, 'worker-b', NOW + 120_000)).toBe(true);
  });

  it('extends only the holder’s lease', () => {
    const held = withLease(task({ state: 'filling' }), 'worker-a', 7, NOW);
    expect(heartbeat(held, 'worker-a', NOW + 1000).lease!.expiresAt).toBeGreaterThan(held.lease!.expiresAt);
    expect(heartbeat(held, 'worker-b', NOW + 1000)).toBe(held);
  });

  it('takes back items whose worker vanished mid-form', () => {
    const live = withLease(task({ id: 'a', state: 'filling' }), 'w', 1, NOW);
    const dead = withLease(task({ id: 'b', state: 'filling' }), 'w', 2, NOW - 200_000);
    expect(orphaned([live, dead], NOW).map(t => t.id)).toEqual(['b']);
  });
});

describe('admission', () => {
  const rules = defaultAdmission();

  it('keeps out jobs below the fit threshold, with a reason', () => {
    const v = admit({ company: 'X', title: 'Y', location: 'Z', fit: 40, route: 'external' }, rules, []);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('below your minimum');
  });

  it('skips a job already applied for rather than queueing it again', () => {
    const v = admit({ company: 'X', title: 'Y', location: 'Z', fit: 90, route: 'external', alreadyApplied: true }, rules, []);
    expect(v).toMatchObject({ ok: false, state: 'skipped' });
  });

  it('marks the same vacancy from a second board as a duplicate', () => {
    const first = {
      company: 'Razorpay Pvt Ltd',
      title: 'Product Operations Intern',
      location: 'Bengaluru, India',
      fit: 80,
      route: 'external' as const,
    };
    const second = {
      company: 'Razorpay',
      title: 'Product Operations Intern (Remote)',
      location: 'Bengaluru',
      fit: 80,
      route: 'external' as const,
    };
    expect(dedupeKey(first)).toBe(dedupeKey(second));
    const v = admit(second, rules, [{ dedupeKey: dedupeKey(first), id: 'app:1' }]);
    expect(v).toMatchObject({ ok: false, state: 'duplicate' });
  });

  it('keeps genuinely different roles at one company apart', () => {
    const a = { company: 'Swiggy', title: 'Business Analyst Intern', location: 'Bengaluru' };
    const b = { company: 'Swiggy', title: 'Product Design Intern', location: 'Bengaluru' };
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });

  it('prefers the source job id when both postings came from one source', () => {
    expect(dedupeKey({ company: 'A', title: 'B', location: 'C', source: 'linkedin', sourceJobId: '99' })).toBe('linkedin:99');
  });
});

describe('ordering', () => {
  it('puts a better-fitting external role ahead of an easy but weaker one', () => {
    const strong = priorityOf({ fit: 90, route: 'external', attempts: 0, postedAt: NOW }, NOW);
    const easy = priorityOf({ fit: 70, route: 'easy-apply', attempts: 0, postedAt: NOW }, NOW);
    expect(strong).toBeGreaterThan(easy);
  });

  it('uses easy apply as a tie-breaker between comparable jobs', () => {
    const easy = priorityOf({ fit: 80, route: 'easy-apply', attempts: 0, postedAt: NOW }, NOW);
    const hard = priorityOf({ fit: 80, route: 'external', attempts: 0, postedAt: NOW }, NOW);
    expect(easy).toBeGreaterThan(hard);
  });

  it('sends a repeatedly failing item to the back', () => {
    const fresh = priorityOf({ fit: 80, route: 'external', attempts: 0 }, NOW);
    const burnt = priorityOf({ fit: 80, route: 'external', attempts: 3 }, NOW);
    expect(burnt).toBeLessThan(fresh);
  });
});

describe('scheduling', () => {
  const opts = { owner: 'w1', now: NOW, concurrency: 1, doneToday: 0, dailyTarget: 15 };

  it('claims the strongest queued job', () => {
    const list = [task({ id: 'a', fit: 70 }), task({ id: 'b', fit: 95 }), task({ id: 'c', fit: 60 })];
    expect(nextEligible(list, opts)?.id).toBe('b');
  });

  it('steps over an application that is waiting for the person', () => {
    const blocked = task({ id: 'blocked', state: 'needs-you', fit: 99 });
    const ready = task({ id: 'ready', fit: 70 });
    expect(nextEligible([blocked, ready], opts)?.id).toBe('ready');
  });

  it('claims nothing once the concurrency limit is in use', () => {
    const running = withLease(task({ id: 'running', state: 'filling' }), 'w1', 1, NOW);
    expect(nextEligible([running, task({ id: 'next' })], opts)).toBeUndefined();
  });

  it('allows a second worker when concurrency is two', () => {
    const running = withLease(task({ id: 'running', state: 'filling' }), 'w1', 1, NOW);
    expect(nextEligible([running, task({ id: 'next' })], { ...opts, concurrency: 2 })?.id).toBe('next');
  });

  it('stops claiming once the day’s pacing target is met', () => {
    expect(pacedOut({ doneToday: 15, dailyTarget: 15 })).toBe(true);
    expect(nextEligible([task()], { ...opts, doneToday: 15 })).toBeUndefined();
  });
});

describe('submission safety', () => {
  it('will not reopen an application whose submit may already have landed', () => {
    const attempted = task({ state: 'uncertain', submission: { attemptedAt: NOW } });
    expect(safeToRetry(attempted)).toBe(false);
  });

  it('allows a retry when no submit was ever pressed', () => {
    expect(safeToRetry(task({ state: 'failed' }))).toBe(true);
  });

  it('allows a retry once the submission is confirmed', () => {
    expect(safeToRetry(task({ submission: { attemptedAt: NOW, confirmedAt: NOW + 1 } }))).toBe(true);
  });

  it('allows explicit not-submitted confirmation to return an uncertain item to queued', () => {
    expect(canTransition('uncertain', 'queued')).toBe(true);
    const t = transition(task({ state: 'uncertain' }), { to: 'queued', reason: 'Confirmed not submitted' });
    expect(t.state).toBe('queued');
  });

  it('identifies orphaned needs-you tasks whose blocking exceptions are already closed', () => {
    const orphanedTask = task({ id: 'o1', state: 'needs-you', blockedBy: ['exc-closed'] });
    const genuinelyBlocked = task({ id: 'b1', state: 'needs-you', blockedBy: ['exc-open'] });
    const attemptedTask = task({ id: 'a1', state: 'needs-you', blockedBy: ['exc-closed'], submission: { attemptedAt: NOW } });
    expect(staleNeedsYou([orphanedTask, genuinelyBlocked, attemptedTask], new Set(['exc-open'])).map(t => t.id)).toEqual(['o1']);
  });
});

describe('what the person sees', () => {
  it('shows a real percentage only when the site gives a step count', () => {
    expect(progressOf(task({ state: 'filling', lastStep: 'Step 3 of 4' }))).toEqual({ percent: 75, label: 'Step 3 of 4' });
  });

  it('shows a named state rather than a made-up percentage', () => {
    expect(progressOf(task({ state: 'filling', lastStep: 'Application form' }))).toEqual({ percent: null, label: 'Filling' });
  });

  it('counts the queue by what each state means for the person', () => {
    const c = counts([
      task({ id: '1', state: 'queued' }),
      task({ id: '2', state: 'filling' }),
      task({ id: '3', state: 'needs-you' }),
      task({ id: '4', state: 'submitted' }),
      task({ id: '5', state: 'uncertain' }),
      task({ id: '6', state: 'duplicate' }),
    ]);
    expect(c).toMatchObject({ queued: 1, running: 1, needsYou: 1, submitted: 1, uncertain: 1, skipped: 1, total: 6 });
  });
});
