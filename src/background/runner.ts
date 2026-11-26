/**
 * The application queue runner.
 *
 * This is the piece the product was missing. The fill engine in `apply.ts` already works through one application
 * well; what it could not do was pick the next job by itself, keep going when one application needed the person, or
 * survive the browser closing mid-form. The runner adds exactly those three things and nothing else — it drives the
 * existing engine rather than reimplementing it, so every ATS quirk already solved stays solved.
 *
 * Three rules shape the code below:
 *   1. The tab is a lease, never the identity. After a restart, work resumes from the durable record by reopening
 *      the URL and reading the page again, never from a remembered DOM.
 *   2. An exception parks one application and nothing else. The loop steps over it and claims the next job.
 *   3. If a submit was pressed and the result could not be read, the application is "uncertain" and is never
 *      retried automatically. A duplicate application is worse than a missing one.
 */

import { loadApplySession, startApplyOnTab, applyRunning, checkSubmitted, cvFile, type ApplySession } from './apply';
import { openManagedTab } from './network-browser';
import {
  activeCampaign,
  allTasks,
  changeCampaign,
  changeException,
  changeTask,
  getCampaign,
  getTask,
  openExceptionsFor,
  recordEvent,
  saveExceptions,
  saveTask,
  tasksFor,
} from '../shared/persistence/campaign-store';
import { read, write } from '../storage/state';
import { mayClaim, mayContinue, type Campaign } from '../shared/domain/campaign';
import {
  evaluateAutopilotGates,
  FAILURE_STREAK_LIMIT,
  HARD_DAILY_CAP,
  nextRandomGapMs,
  withinActiveHoursWindow,
  type ApplicationReceipt,
} from '../shared/autopilot';
import { queueReferral } from './network';
import { raise, resolve as resolveExc, type ApplicationException, type ExceptionKind } from '../shared/domain/exceptions';
import {
  heartbeat,
  isActive,
  nextEligible,
  orphaned,
  safeToRetry,
  staleNeedsYou,
  transition,
  withLease,
  type ApplicationTask,
  type TaskState,
} from '../shared/state-machines/application-task';

export const RUNNER_ALARM = 'campaign-runner';
const WORK_WINDOW_KEY = 'work-window';
const POLL_MS = 1500;
/** A single application gets this long before the runner calls it stalled and hands it back. */
const APPLICATION_TIMEOUT_MS = 12 * 60_000;
/** After a submit with no confirmation, wait this long for late evidence before calling it uncertain. */
const CONFIRM_GRACE_MS = 20_000;

/** This service-worker generation. A record left leased by an earlier generation is not ours to trust. */
const OWNER = `sw:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

const workers = new Map<string, AbortController>();
const workerPromises = new Set<Promise<void>>();
let ticking = false;

export const activeWorkerCount = (): number => workers.size;

/* ---------- the work window ---------- */
/**
 * Applications open in their own window rather than in front of whatever the person is doing. It is created
 * unfocused so a queue running in the background does not steal the screen every time it claims a job.
 */
async function workWindowId(): Promise<number | undefined> {
  const saved = await read<number>(WORK_WINDOW_KEY);
  if (saved !== undefined) {
    const existing = await chrome.windows.get(saved).catch(() => undefined);
    if (existing?.id !== undefined) return existing.id;
  }
  const created = await chrome.windows.create({ focused: false, state: 'normal' }).catch(() => undefined);
  if (created?.id === undefined) return undefined;
  await write(WORK_WINDOW_KEY, created.id);
  // A new window arrives with a blank tab; the application replaces it rather than opening beside it.
  const blank = created.tabs?.[0]?.id;
  if (blank !== undefined) await chrome.tabs.remove(blank).catch(() => undefined);
  return created.id;
}

async function openApplicationTab(url: string): Promise<number> {
  const windowId = await workWindowId();
  const handle = await openManagedTab({
    url,
    mode: 'background',
    purpose: 'ats_check',
    ...(windowId !== undefined ? { windowId } : {}),
  });
  return handle.tabId;
}

/* ---------- reading the engine's state ---------- */
interface Reading {
  state: TaskState;
  note: string;
  exception?: { kind: ExceptionKind; prompt: string; fieldId?: string; options?: string[]; help?: string };
  /** Several questions on one step each become their own inbox item. */
  questions?: { prompt: string; fieldId: string; options?: string[] }[];
  submitPressed?: boolean;
  confirmed?: boolean;
}

/**
 * Turns one engine session into a queue state. The order of the checks is the product's priority order: anything
 * that may already have happened in the outside world is read before anything that has not.
 */
export function readSession(s: ApplySession | undefined, now = Date.now()): Reading {
  if (!s) return { state: 'opening', note: 'Opening the application…' };
  if (s.sent) return { state: 'submitted', note: 'The site confirmed the application was sent.', confirmed: true };
  // Submit was pressed and nothing confirmed it. Not an error, and not a success: a question for the person.
  if (s.autoSent && !s.sent && now - s.updatedAt > CONFIRM_GRACE_MS)
    return {
      state: 'uncertain',
      note: 'Submit was pressed but the site showed no confirmation.',
      submitPressed: true,
      exception: { kind: 'submission-uncertain', prompt: 'Did this application go through? Check the page or your email, then confirm.' },
    };
  if (s.captcha)
    return {
      state: 'needs-you',
      note: 'The site showed a verification challenge.',
      exception: { kind: 'security', prompt: 'A verification challenge appeared. Complete it on the open tab, then resume.' },
    };
  if (s.waitSignIn || s.stage === 'permission')
    return {
      state: 'needs-you',
      note: 'The site asked you to sign in.',
      exception: { kind: 'auth', prompt: 'Sign in to the employer portal on the open tab, then resume this application.' },
    };
  if (s.ask?.length)
    return {
      state: 'needs-you',
      note: `${s.ask.length} question${s.ask.length === 1 ? '' : 's'} need you.`,
      questions: s.ask.map(a => ({
        prompt: a.question || a.label,
        fieldId: a.id,
        ...(a.options?.length ? { options: a.options } : {}),
      })),
    };
  if (s.closed)
    return {
      state: 'closed',
      note: s.message || 'This job is no longer accepting applications.',
    };
  if (s.stage === 'error')
    return {
      state: 'failed',
      note: s.message || 'The page could not be read.',
      exception: { kind: 'page-failure', prompt: s.message || 'This application could not be filled. Retry, open the page, or skip it.' },
    };
  if (s.stage === 'done' || (s.stage === 'review' && s.hasSubmit && !s.hasNext))
    return { state: 'ready', note: s.message || 'The form is complete and ready to submit.' };
  if (s.stage === 'review') return { state: 'filling', note: s.message || 'Waiting at this step.' };
  if (s.stage === 'submitted') return { state: 'submitted', note: 'Submitted.', confirmed: true };
  if (s.stage === 'reading' || s.stage === 'opening') return { state: 'opening', note: s.message || 'Reading the application form…' };
  return { state: 'filling', note: s.message || 'Filling the form…' };
}

/* ---------- raising exceptions ---------- */
async function park(task: ApplicationTask, reading: Reading, campaign: Campaign): Promise<void> {
  const open = await openExceptionsFor(campaign.id);
  let list: ApplicationException[] = open;
  const ids: string[] = [];
  const country = campaign.location;
  const common = { campaignId: campaign.id, applicationId: task.id, company: task.company, title: task.title, country };

  for (const q of reading.questions ?? []) {
    // A question the Answer Bank recognises is a reusable fact and joins the group for that fact; anything else is
    // scoped to this job, because an unrecognised question could mean anything.
    const result = raise(list, {
      ...common,
      kind: 'reusable-fact',
      prompt: q.prompt,
      fieldId: q.fieldId,
      ...(q.options?.length ? { options: q.options } : {}),
    });
    list = result.list;
    ids.push(result.item.id);
  }
  if (reading.exception) {
    const result = raise(list, {
      ...common,
      kind: reading.exception.kind,
      prompt: reading.exception.prompt,
      ...(reading.exception.fieldId ? { fieldId: reading.exception.fieldId } : {}),
      ...(reading.exception.options?.length ? { options: reading.exception.options } : {}),
    });
    list = result.list;
    ids.push(result.item.id);
  }
  await saveExceptions(list);
  await changeTask(task.id, old => (old ? { ...old, blockedBy: [...new Set([...(old.blockedBy ?? []), ...ids])] } : old));
}

/* ---------- one application ---------- */
async function workOne(task: ApplicationTask, campaign: Campaign, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  let tabId: number;
  try {
    tabId = await openApplicationTab(task.url);
  } catch (e) {
    await changeTask(task.id, old =>
      old
        ? transition(old, {
            to: 'failed',
            reason: e instanceof Error ? e.message : 'The application page could not be opened.',
            patch: { attempts: old.attempts + 1 },
          })
        : old,
    );
    return;
  }

  await changeTask(task.id, old =>
    old ? withLease(transition(old, { to: 'opening', reason: 'Opening the application…' }), OWNER, tabId) : old,
  );
  await recordEvent({
    campaignId: campaign.id,
    entityId: task.id,
    entityKind: 'application',
    type: 'filling',
    company: task.company,
    title: task.title,
    source: 'system',
    occurredAt: Date.now(),
    confidence: 'verified',
  });

  try {
    await startApplyOnTab(tabId);
  } catch (e) {
    await finish(task.id, 'failed', e instanceof Error ? e.message : 'The fill engine could not start.', tabId);
    return;
  }

  let lastState: TaskState = 'opening';
  while (!signal.aborted) {
    await new Promise(r => setTimeout(r, POLL_MS));
    if (signal.aborted) break;

    const fresh = await getTask(task.id);
    // The person skipped it, or resolved it from the inbox, while the worker was on the page.
    if (!fresh || fresh.state === 'skipped' || fresh.state === 'closed') break;

    const session = await loadApplySession(tabId);
    const reading = readSession(session);

    if (reading.state !== lastState) {
      lastState = reading.state;
      await changeTask(task.id, old => {
        if (!old) return old;
        const patch: Partial<ApplicationTask> = {
          ...(session?.step ? { lastStep: session.step } : {}),
          ...(session?.url ? { lastUrl: session.url } : {}),
          ...(reading.submitPressed || reading.confirmed
            ? {
                submission: {
                  ...(old.submission ?? {}),
                  ...(reading.submitPressed ? { attemptedAt: old.submission?.attemptedAt ?? Date.now() } : {}),
                  ...(reading.confirmed ? { confirmedAt: Date.now(), how: 'site-confirmation' as const } : {}),
                },
              }
            : {}),
        };
        return transition(old, { to: reading.state, reason: reading.note, patch });
      });

      if (reading.state === 'needs-you' || reading.state === 'uncertain' || reading.state === 'failed') {
        await park(task, reading, campaign);
        if (reading.state === 'failed') {
          await recordFailureAndCheckStreak(campaign.id);
        }
        // The tab stays open: a sign-in or a security check is completed on that page by the person.
        const keepOpen = reading.exception?.kind === 'auth' || reading.exception?.kind === 'security' || reading.state === 'uncertain';
        if (!keepOpen) await closeTab(tabId);
        await note(reading, task, campaign);
        notifyRunnerEvent(
          reading.state === 'uncertain'
            ? `Check ${task.company}: Submit was pressed`
            : reading.state === 'needs-you'
              ? `${task.company} needs you`
              : `${task.company} failed`,
          reading.note,
        );
        return;
      }
      if (reading.state === 'submitted') {
        const cv = await cvFile().catch(() => undefined);
        const receipt: ApplicationReceipt = {
          id: `rcpt:${task.id}:${Date.now()}`,
          applicationId: task.id,
          jobId: task.jobId,
          title: task.title,
          company: task.company,
          url: task.url,
          submittedAt: Date.now(),
          route: task.route,
          ats: task.ats || task.source,
          mode: campaign.application.mode === 'autopilot' ? 'autopilot' : 'guided',
          resumeName: cv?.name ?? 'Profile / CV',
          answersUsed: (session?.filled ?? []).map(f => ({
            label: f.label,
            value: f.value,
            source: f.why?.includes('earlier') ? 'bank' : f.why?.includes('profile') ? 'profile' : 'ai',
          })),
          ...(reading.note ? { confirmationNote: reading.note } : {}),
        };
        await changeTask(task.id, old => (old ? { ...old, receipt } : old));
        await resetFailureStreakAndPace(campaign.id);
        await recordEvent({
          campaignId: campaign.id,
          entityId: task.id,
          entityKind: 'application',
          type: 'submitted',
          company: task.company,
          title: task.title,
          source: 'site',
          occurredAt: Date.now(),
          confidence: 'verified',
        });
        if (campaign.application.referralTrigger === 'on-submit' || campaign.application.referralTrigger === 'on-queue') {
          void queueReferral(
            {
              url: task.url,
              title: task.title,
              company: task.company,
              location: task.location,
            },
            'referral',
          ).catch(() => undefined);
        }
        await closeTab(tabId);
        return;
      }
      if (reading.state === 'ready') {
        const since = startOfToday();
        const doneToday = (await tasksFor(campaign.id)).filter(t => t.state === 'submitted' && t.updatedAt >= since).length;
        const gate = evaluateAutopilotGates({
          campaign,
          task,
          doneToday,
          hasMissingRequired: !!session?.ask?.length,
          hasCaptcha: !!session?.captcha,
          hasLoginWall: !!session?.waitSignIn,
          hasSensitiveOrLegalUnanswered: !!session?.leftForYou?.length,
        });
        if (!gate.ok) {
          // Guided mode or an Autopilot gate failed: park for human review with the exact reason.
          await park(
            task,
            {
              state: 'needs-you',
              note: gate.reason,
              exception: { kind: 'written-review', prompt: `${gate.reason} Check the form and press Submit on the page.` },
            },
            campaign,
          );
          await changeTask(task.id, old => (old ? transition(old, { to: 'needs-you', reason: gate.reason }) : old));
          notifyRunnerEvent(`${task.company} is ready for your review`, gate.reason);
          return;
        }
      }
    } else {
      await changeTask(task.id, old => (old ? heartbeat(old, OWNER) : old));
    }

    // The engine stopped without writing a stage the runner understands.
    if (
      !applyRunning(tabId) &&
      (reading.state === 'opening' || reading.state === 'filling') &&
      Date.now() - (session?.updatedAt ?? started) > 60_000
    ) {
      await finish(task.id, 'failed', 'The fill stopped without finishing. It can be retried.', tabId);
      return;
    }
    if (Date.now() - started > APPLICATION_TIMEOUT_MS) {
      await finish(task.id, 'failed', 'This application took too long and was handed back to the queue.', tabId);
      return;
    }
  }
}

async function note(reading: Reading, task: ApplicationTask, campaign: Campaign): Promise<void> {
  if (reading.state !== 'uncertain') return;
  await recordEvent({
    campaignId: campaign.id,
    entityId: task.id,
    entityKind: 'application',
    type: 'submission-uncertain',
    company: task.company,
    title: task.title,
    source: 'system',
    occurredAt: Date.now(),
    confidence: 'needs-confirmation',
    note: 'Submit was pressed; no confirmation was read.',
  });
}

async function closeTab(tabId: number): Promise<void> {
  await chrome.tabs.remove(tabId).catch(() => undefined);
}

async function finish(id: string, state: TaskState, reason: string, tabId?: number): Promise<void> {
  const updated = await changeTask(id, old => (old ? transition(old, { to: state, reason, patch: { attempts: old.attempts + 1 } }) : old));
  if (state === 'failed' && updated) {
    await recordFailureAndCheckStreak(updated.campaignId);
  }
  if (tabId !== undefined) await closeTab(tabId);
}

async function recordFailureAndCheckStreak(campaignId: string): Promise<void> {
  const updated = await changeCampaign(campaignId, c => {
    if (!c) return c;
    const streak = (c.application.failureStreak ?? 0) + 1;
    const shouldPause = streak >= FAILURE_STREAK_LIMIT && c.status === 'running';
    return {
      ...c,
      updatedAt: Date.now(),
      ...(shouldPause
        ? {
            status: 'paused' as const,
            statusNote: `Paused automatically after ${FAILURE_STREAK_LIMIT} consecutive failures.`,
          }
        : {}),
      application: {
        ...c.application,
        failureStreak: streak,
      },
    };
  });
  if (updated && (updated.application.failureStreak ?? 0) >= FAILURE_STREAK_LIMIT) {
    notifyRunnerEvent(
      'Application queue paused',
      `Paused after ${FAILURE_STREAK_LIMIT} consecutive failures. Review Needs you before resuming.`,
    );
  }
}

async function resetFailureStreakAndPace(campaignId: string): Promise<void> {
  const gap = nextRandomGapMs();
  await changeCampaign(campaignId, c =>
    c
      ? {
          ...c,
          updatedAt: Date.now(),
          application: {
            ...c.application,
            failureStreak: 0,
            nextClaimAfter: Date.now() + gap,
          },
        }
      : c,
  );
}

function notifyRunnerEvent(title: string, message: string): void {
  try {
    chrome.notifications?.create?.(`rs-runner-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
    });
  } catch {
    // Ignore outside extension runtime.
  }
}

/* ---------- the loop ---------- */
function startWorker(task: ApplicationTask, campaign: Campaign): void {
  const controller = new AbortController();
  workers.set(task.id, controller);
  // The service worker must stay awake for the length of an application; a periodic call keeps it so.
  const keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  const done = workOne(task, campaign, controller.signal)
    .catch(async e => {
      await finish(task.id, 'failed', e instanceof Error ? e.message : 'This application stopped unexpectedly.');
    })
    .finally(() => {
      clearInterval(keepAlive);
      if (workers.get(task.id) === controller) workers.delete(task.id);
      // One finishing is the moment to claim the next.
      void tick();
    });
  workerPromises.add(done);
  void done.finally(() => workerPromises.delete(done));
}

const startOfToday = (now = Date.now()): number => new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();

/** The main loop. Safe to call often: it claims at most up to the concurrency setting and does nothing otherwise. */
export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const campaign = await activeCampaign();
    if (!campaign) return;
    const tasks = await tasksFor(campaign.id);

    // Anything left running by a service worker that went away is handed back before new work is claimed.
    for (const dead of orphaned(tasks)) {
      if (workers.has(dead.id)) continue;
      const reason = safeToRetry(dead)
        ? 'The browser stopped before this finished; it will be read again from the page.'
        : 'This stopped after Submit was pressed. It is not retried until you confirm what happened.';
      await changeTask(dead.id, old => (old ? transition(old, { to: safeToRetry(old) ? 'queued' : 'uncertain', reason }) : old));
    }

    // Heal any parked task whose blocking exceptions have all already been resolved or closed.
    const open = await openExceptionsFor(campaign.id);
    const openIds = new Set(open.map(e => e.id));
    for (const healed of staleNeedsYou(tasks, openIds)) {
      if (workers.has(healed.id)) continue;
      await changeTask(healed.id, old =>
        old && old.state === 'needs-you'
          ? transition(old, {
              to: 'queued',
              reason: 'All blocking questions were resolved; returned to queue automatically.',
              patch: { blockedBy: [] },
            })
          : old,
      );
    }

    if (!mayClaim(campaign)) return;
    if (campaign.application.mode === 'discover') return;
    if (!withinActiveHoursWindow(campaign.application.activeHours ?? null)) return;
    if (campaign.application.nextClaimAfter && Date.now() < campaign.application.nextClaimAfter) return;
    if ((campaign.application.failureStreak ?? 0) >= FAILURE_STREAK_LIMIT) return;
    const since = startOfToday();
    const doneToday = tasks.filter(t => t.state === 'submitted' && t.updatedAt >= since).length;
    const effectiveDailyTarget = Math.min(campaign.application.dailyTarget || 15, HARD_DAILY_CAP);
    if (effectiveDailyTarget > 0 && doneToday >= effectiveDailyTarget) {
      notifyRunnerEvent('Daily application cap reached', `Reached today's cap of ${effectiveDailyTarget} applications.`);
      return;
    }
    const fresh = await tasksFor(campaign.id);
    const next = nextEligible(fresh, {
      owner: OWNER,
      concurrency: campaign.application.concurrency,
      doneToday,
      dailyTarget: effectiveDailyTarget,
    });
    if (!next || workers.has(next.id)) return;
    startWorker(next, campaign);
  } finally {
    ticking = false;
  }
}

/* ---------- resuming one application ---------- */
/**
 * Puts a parked application back in the queue once the thing that blocked it is dealt with. The page is never
 * assumed to be where it was: the item goes back to `queued` and is reopened and read again.
 */
export async function resumeApplication(id: string, reason = 'Resumed after you answered.'): Promise<void> {
  const task = await getTask(id);
  if (!task) return;
  if (!safeToRetry(task)) throw new Error('This one may already have been submitted. Confirm what happened before retrying it.');
  await changeTask(id, old => (old && old.state !== 'queued' ? transition(old, { to: 'queued', reason, patch: { blockedBy: [] } }) : old));
  void tick();
}

/** Stops the worker on one application without changing what the record says happened. */
export function abortApplication(id: string): void {
  workers.get(id)?.abort();
  workers.delete(id);
}

export function abortAll(): void {
  for (const c of workers.values()) c.abort();
  workers.clear();
}

export async function stopRunnerAndWait(): Promise<void> {
  abortAll();
  if (workerPromises.size) await Promise.allSettled([...workerPromises]);
}

/* ---------- reconciliation ---------- */
/**
 * Asks the page itself whether an uncertain application went through. This runs only when the tab is still open and
 * only reads; it never presses anything, because the whole point of the uncertain state is that pressing again
 * could submit twice.
 */
export async function reconcile(id: string): Promise<'submitted' | 'unknown'> {
  const task = await getTask(id);
  if (!task?.tabId) return 'unknown';
  const sent = await checkSubmitted(task.tabId).catch(() => false);
  if (!sent) return 'unknown';
  await changeTask(id, old =>
    old
      ? transition(old, {
          to: 'submitted',
          reason: 'The page confirmed the application after all.',
          patch: {
            blockedBy: [],
            submission: { ...(old.submission ?? {}), confirmedAt: Date.now(), how: 'site-confirmation' },
          },
        })
      : old,
  );
  const uncertainOpen = (await openExceptionsFor(task.campaignId)).filter(
    e => e.kind === 'submission-uncertain' && e.affected.some(a => a.applicationId === id),
  );
  for (const exc of uncertainOpen) {
    await changeException(exc.id, e => (e ? resolveExc(e, { applyTo: exc.affected.map(a => a.applicationId), savedToBank: false }) : e));
  }
  await recordEvent({
    campaignId: task.campaignId,
    entityId: id,
    entityKind: 'application',
    type: 'submitted',
    company: task.company,
    title: task.title,
    source: 'site',
    occurredAt: Date.now(),
    confidence: 'verified',
  });
  return 'submitted';
}

/* ---------- startup ---------- */
export async function recoverQueue(): Promise<void> {
  const tasks = await allTasks();
  const now = Date.now();
  for (const t of tasks) {
    if (!isActive(t.state)) continue;
    // Tab ids are reused after a restart, so a remembered one points at an unrelated page. Drop it.
    await changeTask(t.id, old =>
      old
        ? transition(old, {
            to: safeToRetry(old) ? 'queued' : 'uncertain',
            reason: safeToRetry(old)
              ? 'Picked up again after the browser restarted.'
              : 'The browser closed after Submit was pressed. Confirm whether it went through.',
            at: now,
          })
        : old,
    );
  }
}

export function registerRunner(): void {
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === RUNNER_ALARM) void tick();
  });
  // A tab closing mid-application is the person's decision, not a failure: the item goes back to the queue.
  chrome.tabs.onRemoved.addListener(tabId => {
    void (async () => {
      const tasks = await allTasks();
      const owned = tasks.find(t => t.tabId === tabId && isActive(t.state));
      if (!owned) return;
      abortApplication(owned.id);
      await changeTask(owned.id, old =>
        old
          ? transition(old, {
              to: safeToRetry(old) ? 'queued' : 'uncertain',
              reason: safeToRetry(old)
                ? 'The tab was closed; this goes back in the queue.'
                : 'The tab was closed after Submit. Confirm whether it went through.',
            })
          : old,
      );
      void tick();
    })().catch(() => undefined);
  });
}

export async function ensureRunnerAlarm(): Promise<void> {
  if (!(await chrome.alarms.get(RUNNER_ALARM))) await chrome.alarms.create(RUNNER_ALARM, { periodInMinutes: 1 });
}

/** Exposed for the campaign message handlers, which need the same campaign the runner is using. */
export const currentCampaign = (): Promise<Campaign | undefined> => activeCampaign();
export const campaignById = (id: string): Promise<Campaign | undefined> => getCampaign(id);
export const canContinue = (c: Campaign): boolean => mayContinue(c);
export const saveTaskRecord = (t: ApplicationTask): Promise<void> => saveTask(t);
