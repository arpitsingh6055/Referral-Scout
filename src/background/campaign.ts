/**
 * Campaign services: admitting jobs into the queue, resolving exceptions, keeping the Answer Bank, and the one
 * read the UI uses to draw every screen.
 *
 * The side panel and the dashboard never touch IndexedDB. They send a request and get back one view, so there is a
 * single place where "what is true right now" is decided, and two surfaces cannot disagree about it.
 */

import { z } from 'zod';
import { focusManagedTab } from './network-browser';
import {
  activeCampaign,
  allActionItems,
  allCampaigns,
  allContacts,
  allConversations,
  allExceptions,
  allFacts,
  allJobs,
  allOpportunityNotes,
  allOutreach,
  changeActionItem,
  changeCampaign,
  changeConversation,
  changeException,
  changeOutreach,
  changeTask,
  eventsFor,
  getProfile,
  getTask,
  openExceptionsFor,
  recordEvent,
  saveActionItems,
  saveCampaign,
  saveFacts,
  saveOpportunityNote,
  saveOutreach,
  saveTasks,
  tasksFor,
  type OutcomeEvent,
} from '../shared/persistence/campaign-store';
import {
  checkOutreachCollision,
  evaluateReadiness,
  reconcileActions,
  type ActionItem,
  type ApplicationReadiness,
  type Conversation,
  type OpportunityNote,
} from '../shared/domain/opportunity';
import { advance, type OutreachTask } from '../shared/domain/outreach';
import { computeAnalyticsSummary, type AnalyticsSummary } from '../shared/analytics';
import { syncOutcomes } from './gmail';
import { migrateV3ToV4 } from './migration-v4';
import { read, write } from '../storage/state';
import { applyControl, newCampaign, stages, type Campaign, type Control, type MissionMode } from '../shared/domain/campaign';
import type { StrategyOrder } from '../shared/apply-status';
import type { ApplicationReceipt } from '../shared/autopilot';
import { canonicalCompany } from '../shared/domain/job';
import {
  admit,
  counts,
  dedupeKey,
  progressOf,
  safeToRetry,
  transition,
  type AdmissionCandidate,
  type ApplicationTask,
  type ApplyRoute,
  type QueueCounts,
} from '../shared/state-machines/application-task';
import { inboxCounts, resolve, sortInbox, type ApplicationException } from '../shared/domain/exceptions';
import {
  completeness,
  makeFact,
  matchLabel,
  migrateProfile,
  sections,
  type CandidateFact,
  type SectionProgress,
} from '../shared/domain/facts';
import { applyProfile, PROFILE_KEY } from './apply';
import { ensureRunnerAlarm, reconcile, resumeApplication, tick, abortApplication, activeWorkerCount } from './runner';
import { getNetwork, queueReferral, updateNetwork } from './network';
import { trustedExtension } from '../validators/security';

const MIGRATED_KEY = 'answer-bank-migrated';

/* ---------- admitting jobs ---------- */
export interface JobCandidate extends AdmissionCandidate {
  jobId: string;
  url: string;
  ats?: string;
  postedAt?: number;
  priority?: number;
}

export interface AdmissionReport {
  added: number;
  skipped: { title: string; company: string; reason: string }[];
}

/**
 * Turns shortlisted jobs into durable application tasks. Every refusal keeps its reason: a job that quietly fails
 * to appear in the queue is indistinguishable from a bug, and the person cannot fix what they cannot see.
 */
export async function enqueueJobs(campaignId: string, candidates: readonly JobCandidate[]): Promise<AdmissionReport> {
  const campaign = await campaignOrThrow(campaignId);
  const existing = await tasksFor(campaignId);
  const seen = existing.map(t => ({ dedupeKey: t.dedupeKey, id: t.id }));
  const now = Date.now();
  const made: ApplicationTask[] = [];
  const skipped: AdmissionReport['skipped'] = [];

  for (const c of candidates) {
    const verdict = admit(c, campaign.application, seen);
    const key = dedupeKey(c);
    if (!verdict.ok) {
      skipped.push({ title: c.title, company: c.company, reason: verdict.reason });
      continue;
    }
    const task: ApplicationTask = {
      id: `app:${now}:${made.length}:${Math.random().toString(36).slice(2, 6)}`,
      campaignId,
      jobId: c.jobId,
      company: c.company,
      title: c.title,
      location: c.location,
      url: c.url,
      source: c.source ?? 'linkedin',
      ats: c.ats ?? '',
      route: c.route,
      fit: c.fit,
      ...(c.priority !== undefined ? { priority: c.priority } : {}),
      ...(c.postedAt ? { postedAt: c.postedAt } : {}),
      state: 'queued',
      note: 'Waiting for a worker.',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      history: [{ at: now, from: 'queued', to: 'queued', reason: 'Added to the queue.' }],
      dedupeKey: key,
    };
    made.push(task);
    seen.push({ dedupeKey: key, id: task.id });
  }
  await saveTasks(made);
  for (const t of made)
    await recordEvent({
      campaignId,
      entityId: t.id,
      entityKind: 'application',
      type: 'queued',
      company: t.company,
      title: t.title,
      source: 'system',
      occurredAt: now,
      confidence: 'verified',
    });
  if (made.length) {
    // Wire `referralTrigger: 'on-queue'` (default) unless strategy is explicitly `apply-first`.
    const shouldTriggerReferrals =
      campaign.application.referralTrigger === 'on-queue' && campaign.application.strategyOrder !== 'apply-first';
    if (shouldTriggerReferrals) {
      for (const t of made) {
        if (!t.url || !t.company || !t.title) continue;
        void queueReferral(
          {
            url: t.url,
            title: t.title,
            company: t.company,
            location: t.location,
          },
          'referral',
        ).catch(() => undefined);
      }
    }
    void tick();
  }
  return { added: made.length, skipped };
}

async function campaignOrThrow(id: string): Promise<Campaign> {
  const c = (await allCampaigns()).find(x => x.id === id);
  if (!c) throw new Error('That campaign no longer exists.');
  return c;
}

/* ---------- the Answer Bank ---------- */
/**
 * Brings the old saved details and remembered answers into the Answer Bank, once. The old profile is left exactly
 * as it is: the per-tab engine still reads it, so nothing breaks if this layer is rolled back.
 */
export async function migrateAnswerBank(force = false): Promise<number> {
  if (!force && (await read<boolean>(MIGRATED_KEY))) return 0;
  const [profile, network, existing] = await Promise.all([applyProfile(), getNetwork().catch(() => null), allFacts()]);
  const country = network?.location?.split(',').pop()?.trim() || 'India';
  const { facts } = migrateProfile(profile, country);
  const have = new Set(existing.map(f => f.id));
  // A fact the person has already edited here wins; the old profile is the starting point, not the authority.
  const fresh = facts.filter(f => !have.has(f.id));
  // The LinkedIn profile fills in the obvious identity facts the application details never asked for.
  if (network?.profile?.name && !have.has('fact:full_name:global'))
    fresh.push(
      makeFact({ canonicalKey: 'full_name', value: network.profile.name, source: 'profile', provenance: 'Your LinkedIn profile' }),
    );
  if (network?.profile?.url && !have.has('fact:linkedin_url:global'))
    fresh.push(
      makeFact({ canonicalKey: 'linkedin_url', value: network.profile.url, source: 'profile', provenance: 'Your LinkedIn profile' }),
    );
  await saveFacts(fresh);
  await write(MIGRATED_KEY, true);
  return fresh.length;
}

export async function saveAnswer(input: { canonicalKey: string; value: string; scopeValue?: string }): Promise<CandidateFact> {
  const fact = makeFact({
    canonicalKey: input.canonicalKey,
    value: input.value,
    source: 'user',
    ...(input.scopeValue ? { scopeValue: input.scopeValue } : {}),
  });
  await saveFacts([fact]);
  // The per-tab engine reads the old profile, so a fact saved here is mirrored back into it and fills forms today.
  await mirrorToLegacyProfile(fact);
  return fact;
}

const LEGACY_BY_KEY: Record<string, string> = {
  phone: 'phone',
  email: 'email',
  city: 'city',
  address: 'address',
  state: 'state',
  pincode: 'pincode',
  current_ctc: 'currentCtc',
  expected_ctc: 'expectedCtc',
  notice_period: 'noticePeriod',
  start_date: 'startDate',
  work_authorization: 'workAuthorization',
  relocate: 'relocate',
  portfolio_url: 'links',
};

async function mirrorToLegacyProfile(fact: CandidateFact): Promise<void> {
  const legacy = LEGACY_BY_KEY[fact.canonicalKey];
  if (!legacy) return;
  const profile = await applyProfile();
  await write(PROFILE_KEY, { ...profile, details: { ...profile.details, [legacy]: fact.value } });
}

/* ---------- resolving an exception ---------- */
export interface ResolveInput {
  exceptionId: string;
  value?: string;
  /** Which of the waiting applications get the value. Defaults to all of them. */
  applyTo?: string[];
  saveToBank: boolean;
  /** 'skip' leaves the applications parked; 'resume' puts them back in the queue. */
  then: 'resume' | 'skip';
}

/**
 * The step the whole "ask once" promise rests on. The value reaches only the applications that asked for this
 * question, and only the ones the person ticked; it is never pushed at an application that happens to have a
 * similar field.
 */
export async function resolveException(input: ResolveInput): Promise<{ resumed: string[] }> {
  const all = await allExceptions();
  const item = all.find(e => e.id === input.exceptionId);
  if (!item) throw new Error('That item is no longer in the inbox.');
  if (item.status !== 'open') return { resumed: [] };

  const resolved = resolve(item, {
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(input.applyTo ? { applyTo: input.applyTo } : {}),
    savedToBank: input.saveToBank,
  });
  await changeException(item.id, () => resolved);

  if (input.saveToBank && input.value && item.canonicalKey)
    await saveAnswer({
      canonicalKey: item.canonicalKey,
      value: input.value,
      ...(item.scope === 'country' && item.country ? { scopeValue: item.country } : {}),
    });

  const resumed: string[] = [];
  for (const id of resolved.resolution?.appliedTo ?? []) {
    const task = await getTask(id);
    if (!task) continue;
    // Clear this item from whatever is blocking the application; others may still hold it.
    const stillBlocked = (task.blockedBy ?? []).filter(b => b !== item.id);
    await changeTask(id, old => (old ? { ...old, blockedBy: stillBlocked } : old));
    if (stillBlocked.length || input.then !== 'resume') continue;
    if (!safeToRetry(task)) continue;
    await resumeApplication(id, 'Resumed after you answered.');
    resumed.push(id);
  }
  return { resumed };
}

/** The person says what happened to an application whose submission could not be read. */
export async function confirmSubmission(id: string, outcome: 'submitted' | 'not-submitted'): Promise<void> {
  const task = await getTask(id);
  if (!task) throw new Error('That application is no longer in the queue.');
  if (outcome === 'submitted') {
    await changeTask(id, old =>
      old
        ? transition(old, {
            to: 'submitted',
            reason: 'You confirmed this was submitted.',
            patch: {
              blockedBy: [],
              submission: { ...(old.submission ?? {}), confirmedAt: Date.now(), how: 'user-confirmed' },
            },
          })
        : old,
    );
    const uncertainOpen = (await openExceptionsFor(task.campaignId)).filter(
      e => e.kind === 'submission-uncertain' && e.affected.some(a => a.applicationId === id),
    );
    for (const exc of uncertainOpen) {
      await changeException(exc.id, e => (e ? resolve(e, { applyTo: exc.affected.map(a => a.applicationId), savedToBank: false }) : e));
    }
    await recordEvent({
      campaignId: task.campaignId,
      entityId: id,
      entityKind: 'application',
      type: 'submitted',
      company: task.company,
      title: task.title,
      source: 'user',
      occurredAt: Date.now(),
      confidence: 'verified',
    });
    return;
  }
  // Not submitted after all: the attempt record is cleared so the item can safely be filled again.
  const uncertainOpen = (await openExceptionsFor(task.campaignId)).filter(
    e => e.kind === 'submission-uncertain' && e.affected.some(a => a.applicationId === id),
  );
  for (const exc of uncertainOpen) {
    await changeException(exc.id, e => (e ? resolve(e, { applyTo: exc.affected.map(a => a.applicationId), savedToBank: false }) : e));
  }
  await changeTask(id, old => {
    if (!old) return old;
    const next = transition(old, {
      to: 'queued',
      reason: 'You confirmed it was not submitted; it goes back in the queue.',
      patch: { blockedBy: [] },
    });
    delete next.submission;
    return next;
  });
  void tick();
}

/* ---------- the view the UI draws ---------- */
export interface QueueRow {
  id: string;
  jobId?: string;
  url?: string;
  company: string;
  title: string;
  ats: string;
  source: string;
  route: ApplyRoute;
  fit: number;
  state: ApplicationTask['state'];
  stateLabel: string;
  note: string;
  percent: number | null;
  progressLabel: string;
  updatedAt: number;
  canRetry: boolean;
  blocked: number;
  receipt?: ApplicationReceipt;
}

export interface InboxRow {
  id: string;
  kind: ApplicationException['kind'];
  kindLabel: string;
  prompt: string;
  matchedAs?: string;
  suggestedValue?: string;
  options?: string[];
  resolution: string;
  affected: { applicationId: string; company: string; title: string }[];
  createdAt: number;
}

export interface CampaignView {
  campaign: Campaign | null;
  counts: QueueCounts;
  inbox: InboxRow[];
  inboxCounts: ReturnType<typeof inboxCounts>;
  queue: QueueRow[];
  facts: CandidateFact[];
  factSections: SectionProgress[];
  completeness: ReturnType<typeof completeness>;
  stages: ReturnType<typeof stages>;
  events: OutcomeEvent[];
  workers: { active: number; limit: number };
  peopleIdentified: number;
  replies: number;
  actions?: ActionItem[];
  conversations?: Conversation[];
  outreach?: OutreachTask[];
  opportunityNotes?: Record<string, OpportunityNote>;
  readiness?: ApplicationReadiness;
  analytics?: AnalyticsSummary;
  receipts?: ApplicationReceipt[];
}

import { KIND_LABELS, RESOLUTION } from '../shared/domain/exceptions';
import { STATE_LABELS } from '../shared/state-machines/application-task';

export async function campaignView(): Promise<CampaignView> {
  await migrateV3ToV4().catch(() => undefined);
  const campaign = (await activeCampaign()) ?? null;
  const [facts, network] = await Promise.all([allFacts(), getNetwork().catch(() => null)]);
  const readiness = evaluateReadiness(facts, !!network?.cv);
  const empty: CampaignView = {
    campaign,
    counts: counts([]),
    inbox: [],
    inboxCounts: inboxCounts([]),
    queue: [],
    facts,
    factSections: sections(facts),
    completeness: completeness(facts),
    stages: stages({ found: 0, qualified: 0, applied: 0, queued: 0, contacts: 0, replies: 0 }),
    events: [],
    workers: { active: activeWorkerCount(), limit: campaign?.application.concurrency ?? 1 },
    peopleIdentified: network?.contacts?.length ?? 0,
    // A reply is an outcome the person marked, not a contact state: a connection can be accepted without a word back.
    replies: (network?.contacts ?? []).filter(c => c.outcome === 'replied' || c.outcome === 'referred').length,
    actions: [],
    conversations: [],
    outreach: [],
    opportunityNotes: {},
    readiness,
  };
  if (!campaign) return empty;

  const [tasks, open, events, jobs, contacts, outreach, conversations, existingActions, notes, profile] = await Promise.all([
    tasksFor(campaign.id),
    openExceptionsFor(campaign.id),
    eventsFor(campaign.id, 60),
    allJobs(),
    allContacts(),
    allOutreach(),
    allConversations(),
    allActionItems(),
    allOpportunityNotes(),
    getProfile(),
  ]);
  const actions = reconcileActions({
    campaignId: campaign.id,
    jobs,
    tasks,
    exceptions: open,
    outreach,
    contacts,
    conversations,
    existing: existingActions,
  });
  await saveActionItems(actions).catch(() => undefined);
  const opportunityNotes: Record<string, OpportunityNote> = {};
  for (const n of notes) opportunityNotes[n.jobId] = n;
  const analytics = computeAnalyticsSummary({
    profileReady: !!profile.identity.fullName,
    jobs,
    tasks,
    outreach,
    events,
  });
  const found = Math.max(jobs.length, network?.jobSearch?.found?.length ?? 0);
  const qualified =
    jobs.filter(j => j.userJudgement === 'shortlisted' || j.qualification?.tier === 'strong').length ||
    (network?.jobSearch?.found ?? []).filter(j => j.picked).length ||
    tasks.length;
  const syncedReplies = Math.max(empty.replies, conversations.filter(c => c.status === 'replied' || c.status === 'needs-reply').length);

  return {
    ...empty,
    replies: syncedReplies,
    actions,
    conversations: [...conversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    outreach,
    opportunityNotes,
    analytics,
    counts: counts(tasks),
    queue: tasks
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(t => {
        const p = progressOf(t);
        return {
          id: t.id,
          jobId: t.jobId,
          url: t.url,
          company: t.company,
          title: t.title,
          ats: t.ats,
          source: t.source,
          route: t.route,
          fit: t.fit,
          state: t.state,
          stateLabel: STATE_LABELS[t.state],
          note: t.note,
          percent: p.percent,
          progressLabel: p.label,
          updatedAt: t.updatedAt,
          canRetry: safeToRetry(t),
          blocked: (t.blockedBy ?? []).length,
          ...(t.receipt ? { receipt: t.receipt } : {}),
        };
      }),
    inbox: sortInbox(open).map(e => ({
      id: e.id,
      kind: e.kind,
      kindLabel: KIND_LABELS[e.kind],
      prompt: e.prompt,
      ...(e.matchedAs ? { matchedAs: e.matchedAs } : {}),
      ...(e.suggestedValue ? { suggestedValue: e.suggestedValue } : {}),
      ...(e.options?.length ? { options: e.options } : {}),
      resolution: RESOLUTION[e.kind],
      affected: e.affected.map(a => ({ applicationId: a.applicationId, company: a.company, title: a.title })),
      createdAt: e.createdAt,
    })),
    inboxCounts: inboxCounts(open),
    stages: stages({
      found,
      qualified,
      applied: tasks.filter(t => t.state === 'submitted').length,
      queued: tasks.length,
      contacts: Math.max(contacts.length, network?.contacts?.length ?? 0),
      replies: syncedReplies,
    }),
    events,
    receipts: tasks
      .map(t => t.receipt)
      .filter((r): r is ApplicationReceipt => !!r)
      .sort((a, b) => b.submittedAt - a.submittedAt),
  };
}

/* ---------- messages ---------- */
const routes = z.enum(['easy-apply', 'external', 'email', 'unknown']);

export const campaignRequest = z.discriminatedUnion('action', [
  z.object({ kind: z.literal('campaign'), action: z.literal('view') }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('create'),
    name: z.string().trim().min(1).max(120),
    targetRoles: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
    location: z.string().trim().min(1).max(120),
    employmentType: z.string().trim().max(40).optional(),
  }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('update'),
    name: z.string().trim().min(1).max(120),
    targetRoles: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
    location: z.string().trim().min(1).max(120),
    employmentType: z.string().trim().max(40),
  }),
  z.object({ kind: z.literal('campaign'), action: z.literal('control'), control: z.enum(['start', 'pause', 'resume', 'drain', 'stop']) }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('rules'),
    mode: z.enum(['discover', 'guided', 'autopilot']).optional(),
    minFit: z.number().int().min(0).max(100).optional(),
    autoAdmit: z.boolean().optional(),
    dailyTarget: z.number().int().min(0).max(25).optional(),
    concurrency: z.union([z.literal(1), z.literal(2)]).optional(),
    submitPolicy: z.enum(['review', 'auto']).optional(),
    routes: z.array(routes).max(4).optional(),
    referralTrigger: z.enum(['on-qualify', 'on-queue', 'on-submit', 'never']).optional(),
    strategyOrder: z.enum(['referral-first', 'apply-first', 'parallel']).optional(),
    referralWaitHours: z.number().int().min(1).max(168).optional(),
    activeHours: z
      .object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) })
      .nullable()
      .optional(),
    autopilotOptIn: z.boolean().optional(),
    preflightApprove: z.boolean().optional(),
    allowConsentAutoTick: z.boolean().optional(),
    weeklyBudget: z.number().int().min(0).max(500).optional(),
    maxPerCompany: z.number().int().min(1).max(5).optional(),
  }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('enqueue'),
    jobs: z
      .array(
        z.object({
          jobId: z.string().max(200),
          url: z.string().url().max(600),
          company: z.string().trim().min(1).max(200),
          title: z.string().trim().min(1).max(250),
          location: z.string().trim().max(200).default(''),
          fit: z.number().min(0).max(100).default(70),
          route: routes.default('unknown'),
          source: z.string().max(40).optional(),
          ats: z.string().max(60).optional(),
          postedAt: z.number().optional(),
          priority: z.number().int().min(0).max(10).optional(),
        }),
      )
      .min(1)
      .max(200),
  }),
  z.object({ kind: z.literal('campaign'), action: z.literal('retry'), id: z.string().max(80) }),
  z.object({ kind: z.literal('campaign'), action: z.literal('skip'), id: z.string().max(80), reason: z.string().max(200).optional() }),
  z.object({ kind: z.literal('campaign'), action: z.literal('open'), id: z.string().max(80) }),
  z.object({ kind: z.literal('campaign'), action: z.literal('reconcile'), id: z.string().max(80) }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('confirm'),
    id: z.string().max(80),
    outcome: z.enum(['submitted', 'not-submitted']),
  }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('resolve'),
    exceptionId: z.string().max(80),
    value: z.string().max(4000).optional(),
    applyTo: z.array(z.string().max(80)).max(200).optional(),
    saveToBank: z.boolean().default(true),
    then: z.enum(['resume', 'skip']).default('resume'),
  }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('saveFact'),
    canonicalKey: z.string().max(60),
    value: z.string().max(4000),
    scopeValue: z.string().max(120).optional(),
  }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('pinCompany'),
    company: z.string().trim().min(1).max(200),
    pinned: z.boolean(),
  }),
  z.object({ kind: z.literal('campaign'), action: z.literal('migrate') }),
  z.object({ kind: z.literal('campaign'), action: z.literal('gmailSync'), sinceDays: z.number().int().min(1).max(90).optional() }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('confirmConversation'),
    conversationId: z.string().max(200),
    opportunityId: z.string().max(200),
  }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('saveOpportunityNote'),
    jobId: z.string().max(200),
    company: z.string().max(200),
    title: z.string().max(250),
    outcome: z.enum(['interviewing', 'offer', 'rejected', 'withdrawn']).optional(),
    notes: z.string().max(4000).default(''),
    interviewDate: z.string().max(80).optional(),
  }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('createOutreachDraft'),
    contactId: z.string().max(200),
    opportunityId: z.string().max(200).optional(),
    channel: z.enum(['linkedin-invite', 'linkedin-message', 'email', 'manual']).default('linkedin-invite'),
    message: z.string().trim().min(1).max(4000),
    allowMultiRole: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('campaign'), action: z.literal('approveOutreach'), outreachId: z.string().max(200) }),
  z.object({
    kind: z.literal('campaign'),
    action: z.literal('dismissAction'),
    actionId: z.string().max(200),
    snoozeHours: z.number().min(1).max(168).optional(),
  }),
]);

export type CampaignRequest = z.infer<typeof campaignRequest>;

async function handle(req: CampaignRequest): Promise<CampaignView> {
  switch (req.action) {
    case 'view':
      break;
    case 'create': {
      const c = newCampaign({
        name: req.name,
        targetRoles: req.targetRoles,
        location: req.location,
        ...(req.employmentType ? { employmentType: req.employmentType } : {}),
      });
      await saveCampaign(c);
      await migrateAnswerBank();
      break;
    }
    case 'update': {
      const current = await activeCampaign();
      if (!current) throw new Error('Create a campaign first.');
      await changeCampaign(current.id, c =>
        c
          ? {
              ...c,
              name: req.name,
              targetRoles: req.targetRoles,
              location: req.location,
              employmentType: req.employmentType,
              updatedAt: Date.now(),
            }
          : c,
      );
      break;
    }
    case 'control': {
      const current = await activeCampaign();
      if (!current) throw new Error('Create a campaign first.');
      await changeCampaign(current.id, c =>
        c
          ? {
              ...applyControl(c, req.control as Control),
              ...(req.control === 'start' || req.control === 'resume' ? { application: { ...c.application, failureStreak: 0 } } : {}),
            }
          : c,
      );
      if (req.control === 'start' || req.control === 'resume') {
        await ensureRunnerAlarm();
        void tick();
      }
      break;
    }
    case 'rules': {
      const current = await activeCampaign();
      if (!current) throw new Error('Create a campaign first.');
      const now = Date.now();
      const nextMode: MissionMode | undefined =
        req.mode ?? (req.submitPolicy === 'auto' ? 'autopilot' : req.submitPolicy === 'review' ? 'guided' : undefined);
      const nextSubmitPolicy = nextMode !== undefined ? (nextMode === 'autopilot' ? 'auto' : 'review') : req.submitPolicy;
      await changeCampaign(current.id, c =>
        c
          ? {
              ...c,
              updatedAt: now,
              application: {
                ...c.application,
                ...(nextMode !== undefined ? { mode: nextMode } : {}),
                ...(req.minFit !== undefined ? { minFit: req.minFit } : {}),
                ...(req.autoAdmit !== undefined ? { autoAdmit: req.autoAdmit } : {}),
                ...(req.dailyTarget !== undefined ? { dailyTarget: Math.min(25, Math.max(0, req.dailyTarget)) } : {}),
                ...(req.concurrency !== undefined ? { concurrency: req.concurrency } : {}),
                ...(nextSubmitPolicy !== undefined ? { submitPolicy: nextSubmitPolicy } : {}),
                ...(req.routes !== undefined ? { routes: req.routes } : {}),
                ...(req.referralTrigger !== undefined ? { referralTrigger: req.referralTrigger } : {}),
                ...(req.strategyOrder !== undefined ? { strategyOrder: req.strategyOrder as StrategyOrder } : {}),
                ...(req.referralWaitHours !== undefined ? { referralWaitHours: req.referralWaitHours } : {}),
                ...(req.activeHours !== undefined ? { activeHours: req.activeHours } : {}),
                ...(req.autopilotOptIn === true ? { autopilotOptInAt: c.application.autopilotOptInAt ?? now } : {}),
                ...(req.preflightApprove === true ? { preflightApprovedAt: c.application.preflightApprovedAt ?? now } : {}),
                ...(req.allowConsentAutoTick !== undefined ? { allowConsentAutoTick: req.allowConsentAutoTick } : {}),
              },
              referral: {
                ...c.referral,
                ...(req.weeklyBudget !== undefined ? { weeklyBudget: req.weeklyBudget } : {}),
                ...(req.maxPerCompany !== undefined ? { maxPerCompany: req.maxPerCompany } : {}),
              },
            }
          : c,
      );
      if (req.strategyOrder !== undefined) {
        await updateNetwork(s => ({ ...s, strategyOrder: req.strategyOrder as StrategyOrder })).catch(() => undefined);
      }
      break;
    }
    case 'enqueue': {
      const current = await activeCampaign();
      if (!current) throw new Error('Create a campaign first.');
      await enqueueJobs(current.id, req.jobs as JobCandidate[]);
      break;
    }
    case 'retry': {
      const task = await getTask(req.id);
      if (!task) throw new Error('That application is no longer in the queue.');
      if (!safeToRetry(task)) throw new Error('Submit was pressed on this one. Confirm what happened before retrying it.');
      await resumeApplication(req.id, 'Retried by you.');
      break;
    }
    case 'skip': {
      abortApplication(req.id);
      await changeTask(req.id, t => (t ? transition(t, { to: 'skipped', reason: req.reason ?? 'Skipped by you.' }) : t));
      void tick();
      break;
    }
    case 'open': {
      const task = await getTask(req.id);
      if (!task) break;
      await focusManagedTab(task.tabId, task.url);
      break;
    }
    case 'reconcile':
      await reconcile(req.id);
      break;
    case 'confirm':
      await confirmSubmission(req.id, req.outcome);
      break;
    case 'resolve':
      await resolveException({
        exceptionId: req.exceptionId,
        ...(req.value !== undefined ? { value: req.value } : {}),
        ...(req.applyTo ? { applyTo: req.applyTo } : {}),
        saveToBank: req.saveToBank,
        then: req.then,
      });
      break;
    case 'saveFact':
      await saveAnswer({ canonicalKey: req.canonicalKey, value: req.value, ...(req.scopeValue ? { scopeValue: req.scopeValue } : {}) });
      break;
    case 'pinCompany': {
      const current = await activeCampaign();
      if (!current) throw new Error('Create a campaign first.');
      const key = canonicalCompany(req.company);
      if (!key) break;
      await changeCampaign(current.id, c => {
        if (!c) return c;
        const next = new Set(c.referral.pinnedCompanies ?? []);
        if (req.pinned) next.add(key);
        else next.delete(key);
        return {
          ...c,
          updatedAt: Date.now(),
          referral: { ...c.referral, pinnedCompanies: [...next] },
        };
      });
      break;
    }
    case 'migrate':
      await migrateAnswerBank(true);
      break;
    case 'gmailSync':
      await syncOutcomes(req.sinceDays !== undefined ? { sinceDays: req.sinceDays } : {});
      break;
    case 'confirmConversation':
      await changeConversation(req.conversationId, c =>
        c
          ? {
              ...c,
              attributedOpportunityIds: [req.opportunityId],
              attributionState: 'confirmed',
              attributionEvidence: 'Confirmed by you',
              updatedAt: Date.now(),
            }
          : c,
      );
      break;
    case 'saveOpportunityNote': {
      const current = await activeCampaign();
      const now = Date.now();
      await saveOpportunityNote({
        id: req.jobId,
        jobId: req.jobId,
        ...(req.outcome ? { outcome: req.outcome } : {}),
        notes: req.notes,
        ...(req.interviewDate ? { interviewDate: req.interviewDate } : {}),
        updatedAt: now,
      });
      if (current && req.outcome) {
        const typeMap = {
          interviewing: 'interview',
          offer: 'offer',
          rejected: 'rejected',
          withdrawn: 'withdrawn',
        } as const;
        await recordEvent({
          campaignId: current.id,
          entityId: req.jobId,
          entityKind: 'application',
          type: typeMap[req.outcome],
          company: req.company,
          title: req.title,
          source: 'user',
          occurredAt: now,
          confidence: 'verified',
        });
      }
      break;
    }
    case 'createOutreachDraft': {
      const current = await activeCampaign();
      if (!current) throw new Error('Create a campaign first.');
      const [contacts, existingOutreach] = await Promise.all([allContacts(), allOutreach()]);
      const contact = contacts.find(c => c.id === req.contactId);
      if (!contact) throw new Error('Contact not found.');
      const collision = checkOutreachCollision({
        contact,
        ...(req.opportunityId ? { opportunityId: req.opportunityId } : {}),
        existingTasks: existingOutreach,
      });
      if (collision.blocked) throw new Error(collision.warning ?? 'Outreach blocked by collision guard.');
      if (collision.warning && !req.allowMultiRole) throw new Error(collision.warning);
      const now = Date.now();
      const task: OutreachTask = {
        id: `out:${now}:${Math.random().toString(36).slice(2, 7)}`,
        campaignId: current.id,
        contactId: contact.id,
        ...(req.opportunityId ? { jobId: req.opportunityId } : {}),
        channel: req.channel,
        state: 'draft-ready',
        message: req.message,
        messageVersion: 1,
        followUps: [],
        createdAt: now,
        updatedAt: now,
        history: [{ at: now, from: 'identified', to: 'draft-ready', reason: 'Draft created from Opportunity Workspace.' }],
      };
      await saveOutreach([task]);
      break;
    }
    case 'approveOutreach':
      await changeOutreach(req.outreachId, t =>
        t ? { ...advance(t, 'approved', 'Approved by you.', Date.now()), approvedAt: Date.now() } : t,
      );
      break;
    case 'dismissAction':
      await changeActionItem(req.actionId, a =>
        a
          ? {
              ...a,
              ...(req.snoozeHours ? { snoozedUntil: Date.now() + req.snoozeHours * 3_600_000 } : { status: 'dismissed' as const }),
              updatedAt: Date.now(),
            }
          : a,
      );
      break;
  }
  return campaignView();
}

export function registerCampaignMessages(): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (!input || typeof input !== 'object' || (input as { kind?: unknown }).kind !== 'campaign') return false;
    if (!trustedExtension(sender, chrome.runtime.id)) return false;
    const parsed = campaignRequest.safeParse(input);
    if (!parsed.success) {
      respond({ ok: false, error: 'That request was not understood. Reload the panel.' });
      return false;
    }
    void handle(parsed.data)
      .then(view => respond({ ok: true, view }))
      .catch((e: unknown) => respond({ ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' }));
    return true;
  });
}

/** A question the Answer Bank already knows the shape of, used by the inbox to label an incoming prompt. */
export const labelFor = (prompt: string): string | undefined => matchLabel(prompt)?.matchedAs;
