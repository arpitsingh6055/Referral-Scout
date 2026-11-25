/**
 * Opportunity-Centred Coordination Engine:
 * - Derived Opportunity lifecycle (never hides parallel Application & Networking sub-processes)
 * - Pre-flight Application Readiness checklist from Answer Bank facts
 * - Contact × Opportunity Outreach Collision Protection
 * - Unified Conversation attribution & Today / Next Actions reconciliation
 */

import type { ApplicationException } from './exceptions';
import type { CandidateFact } from './facts';
import { canonicalCompany, type Job } from './job';
import type { Contact, OutreachTask } from './outreach';
import type { ApplicationTask } from '../state-machines/application-task';

/* ---------- 1. Derived Opportunity Lifecycle ---------- */
export type OpportunityStage =
  | 'discovered'
  | 'evaluating'
  | 'saved'
  | 'pursuing'
  | 'application-in-progress'
  | 'application-submitted'
  | 'networking-in-progress'
  | 'referral-offered'
  | 'interviewing'
  | 'offer'
  | 'rejected'
  | 'withdrawn'
  | 'closed';

export interface OpportunityNote {
  id: string; // jobId
  jobId: string;
  outcome?: 'interviewing' | 'offer' | 'rejected' | 'withdrawn';
  notes: string;
  interviewDate?: string;
  updatedAt: number;
}

export interface OpportunityLifecycle {
  stage: OpportunityStage;
  label: string;
  tone: 'grey' | 'violet' | 'blue' | 'amber' | 'green' | 'red';
  isApplying: boolean;
  isSubmitted: boolean;
  isNetworking: boolean;
  isReferred: boolean;
}

const STAGE_META: Record<OpportunityStage, { label: string; tone: OpportunityLifecycle['tone'] }> = {
  discovered: { label: 'Discovered', tone: 'grey' },
  evaluating: { label: 'Evaluating', tone: 'grey' },
  saved: { label: 'Saved', tone: 'grey' },
  pursuing: { label: 'Shortlisted', tone: 'violet' },
  'application-in-progress': { label: 'Applying', tone: 'blue' },
  'application-submitted': { label: 'Applied', tone: 'green' },
  'networking-in-progress': { label: 'Networking', tone: 'violet' },
  'referral-offered': { label: 'Referral offered', tone: 'green' },
  interviewing: { label: 'Interviewing', tone: 'green' },
  offer: { label: 'Offer received', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  withdrawn: { label: 'Withdrawn', tone: 'grey' },
  closed: { label: 'Closed', tone: 'grey' },
};

const ACTIVE_APP_STATES = new Set(['queued', 'opening', 'filling', 'needs-you', 'ready', 'uncertain']);
const ACTIVE_OUTREACH_STATES = new Set(['draft-ready', 'approved', 'sent', 'accepted', 'replied']);

/**
 * Derives the overall Opportunity stage from independent Application, Outreach, and Outcome evidence
 * while preserving parallel sub-process flags so neither pipeline hides the other.
 */
export function deriveOpportunityStage(input: {
  job: Pick<Job, 'availability' | 'qualification' | 'userJudgement'>;
  application?: Pick<ApplicationTask, 'state'> | undefined;
  outreach?: readonly Pick<OutreachTask, 'state'>[];
  note?: OpportunityNote | undefined;
  confirmedEventTypes?: readonly string[];
}): OpportunityLifecycle {
  const outreach = input.outreach ?? [];
  const events = new Set(input.confirmedEventTypes ?? []);

  const isApplying = !!input.application && ACTIVE_APP_STATES.has(input.application.state);
  const isSubmitted = input.application?.state === 'submitted' || input.job.userJudgement === 'applied';
  const isNetworking = outreach.some(o => ACTIVE_OUTREACH_STATES.has(o.state));
  const isReferred =
    outreach.some(o => o.state === 'referral-offered' || o.state === 'referral-submitted') ||
    events.has('referral-offered') ||
    events.has('referral-submitted');

  let stage: OpportunityStage;
  if (input.job.availability === 'closed') stage = 'closed';
  else if (input.note?.outcome === 'offer' || events.has('offer')) stage = 'offer';
  else if (input.note?.outcome === 'rejected' || events.has('rejected')) stage = 'rejected';
  else if (input.note?.outcome === 'withdrawn' || events.has('withdrawn')) stage = 'withdrawn';
  else if (input.note?.outcome === 'interviewing' || events.has('interview')) stage = 'interviewing';
  else if (isReferred) stage = 'referral-offered';
  else if (isSubmitted) stage = 'application-submitted';
  else if (isApplying) stage = 'application-in-progress';
  else if (isNetworking) stage = 'networking-in-progress';
  else if (input.job.userJudgement === 'shortlisted') stage = 'pursuing';
  else if (input.job.qualification) stage = 'evaluating';
  else stage = 'discovered';

  return {
    stage,
    ...STAGE_META[stage],
    isApplying,
    isSubmitted,
    isNetworking,
    isReferred,
  };
}

/* ---------- 2. Pre-Flight Application Readiness ---------- */
export interface ReadinessCheck {
  key: string;
  label: string;
  ready: boolean;
  source?: string;
}

export interface ApplicationReadiness {
  ready: boolean;
  score: number;
  missing: ReadinessCheck[];
  checks: ReadinessCheck[];
}

const REQUIRED_APPLICATION_FACTS: { key: string; label: string }[] = [
  { key: 'full_name', label: 'Full name' },
  { key: 'email', label: 'Email address' },
  { key: 'phone', label: 'Phone number' },
  { key: 'city', label: 'Current city' },
  { key: 'work_authorization', label: 'Work authorization' },
  { key: 'notice_period', label: 'Notice period / availability' },
];

export function evaluateReadiness(facts: readonly CandidateFact[] = [], cvHasText = false): ApplicationReadiness {
  const byKey = new Map<string, CandidateFact>();
  for (const f of facts ?? []) {
    if (f.value.trim()) byKey.set(f.canonicalKey, f);
  }
  const checks: ReadinessCheck[] = [
    { key: 'cv', label: 'Resume / CV uploaded', ready: cvHasText, ...(cvHasText ? { source: 'Uploaded CV' } : {}) },
    ...REQUIRED_APPLICATION_FACTS.map(req => {
      const hit = byKey.get(req.key);
      return {
        key: req.key,
        label: req.label,
        ready: !!hit,
        ...(hit ? { source: hit.provenance || hit.source } : {}),
      };
    }),
  ];
  const missing = checks.filter(c => !c.ready);
  const score = Math.round(((checks.length - missing.length) / checks.length) * 100);
  return { ready: missing.length === 0, score, missing, checks };
}

/* ---------- 3. Contact × Opportunity Collision Prevention ---------- */
export interface CollisionCheck {
  blocked: boolean;
  warning?: string;
  existingForSameRole?: OutreachTask;
  existingAtSameCompany: OutreachTask[];
}

export function checkOutreachCollision(input: {
  contact: Pick<Contact, 'id' | 'name' | 'suppressed'>;
  opportunityId?: string;
  existingTasks: readonly OutreachTask[];
  companyJobIds?: ReadonlySet<string>;
}): CollisionCheck {
  if (input.contact.suppressed) {
    return {
      blocked: true,
      warning: `${input.contact.name} asked not to be contacted and is permanently suppressed.`,
      existingAtSameCompany: [],
    };
  }
  const forContact = input.existingTasks.filter(t => t.contactId === input.contact.id && t.state !== 'stopped');
  const existingForSameRole = input.opportunityId ? forContact.find(t => t.jobId === input.opportunityId) : undefined;
  const existingAtSameCompany = forContact.filter(
    t => t.jobId !== input.opportunityId && (!input.companyJobIds || !t.jobId || input.companyJobIds.has(t.jobId)),
  );

  if (existingForSameRole) {
    return {
      blocked: true,
      warning: `Already in ${existingForSameRole.state} with ${input.contact.name} for this exact role.`,
      existingForSameRole,
      existingAtSameCompany,
    };
  }
  if (existingAtSameCompany.length > 0) {
    return {
      blocked: false,
      warning: `${input.contact.name} already has an active outreach thread at this company (${existingAtSameCompany[0]!.state}). Confirm before messaging about a second role.`,
      existingAtSameCompany,
    };
  }
  return { blocked: false, existingAtSameCompany: [] };
}

/* ---------- 4. Unified Cross-Channel Conversations ---------- */
export interface ConversationSnippet {
  at: number;
  sender: 'me' | 'them' | 'system';
  text: string;
}

export interface Conversation {
  id: string;
  contactId: string;
  contactName: string;
  companyName?: string;
  channel: 'linkedin' | 'gmail';
  threadId: string;
  subject?: string;
  attributedOpportunityIds: string[];
  attributionState: 'confirmed' | 'suggested' | 'ambiguous';
  attributionEvidence?: string;
  status: 'awaiting-them' | 'needs-reply' | 'replied' | 'closed' | 'auto-reply';
  lastMessageAt: number;
  lastSender: 'me' | 'them' | 'system';
  summary?: string;
  snippets: ConversationSnippet[];
  createdAt: number;
  updatedAt: number;
}

export function matchConversationOpportunity(
  companyName: string,
  text: string,
  jobs: readonly Pick<Job, 'id' | 'companyName' | 'title'>[],
): { opportunityIds: string[]; state: Conversation['attributionState']; evidence: string } {
  const coKey = canonicalCompany(companyName);
  const coJobs = jobs.filter(j => canonicalCompany(j.companyName) === coKey);
  if (!coJobs.length) return { opportunityIds: [], state: 'suggested', evidence: 'No tracked role at this company yet.' };
  if (coJobs.length === 1) {
    return { opportunityIds: [coJobs[0]!.id], state: 'confirmed', evidence: `Only active role at ${coJobs[0]!.companyName}` };
  }
  const lower = text.toLowerCase();
  const titleHits = coJobs.filter(j => lower.includes(j.title.toLowerCase()));
  if (titleHits.length === 1) {
    return { opportunityIds: [titleHits[0]!.id], state: 'confirmed', evidence: `Matched role title "${titleHits[0]!.title}"` };
  }
  return {
    opportunityIds: coJobs.map(j => j.id),
    state: 'ambiguous',
    evidence: `${coJobs.length} open roles at ${coJobs[0]!.companyName} — confirm which role this thread belongs to.`,
  };
}

/* ---------- 5. Unified Today / Next Actions ---------- */
export type ActionKind =
  | 'submission-uncertain'
  | 'application-exception'
  | 'reply-needs-response'
  | 'ambiguous-thread'
  | 'outreach-approval'
  | 'follow-up-due'
  | 'review-high-fit-jobs';

export interface ActionItem {
  id: string;
  campaignId: string;
  kind: ActionKind;
  opportunityId?: string;
  companyName?: string;
  roleTitle?: string;
  contactId?: string;
  contactName?: string;
  exceptionId?: string;
  conversationId?: string;
  outreachId?: string;
  title: string;
  reason: string;
  ctaLabel: string;
  priorityScore: number;
  dueAt?: number;
  snoozedUntil?: number;
  status: 'open' | 'completed' | 'dismissed';
  createdAt: number;
  updatedAt: number;
}

export function reconcileActions(input: {
  campaignId: string;
  jobs: readonly Job[];
  tasks: readonly ApplicationTask[];
  exceptions: readonly ApplicationException[];
  outreach: readonly OutreachTask[];
  contacts: readonly Contact[];
  conversations: readonly Conversation[];
  existing?: readonly ActionItem[];
  now?: number;
}): ActionItem[] {
  const now = input.now ?? Date.now();
  const prevById = new Map((input.existing ?? []).map(a => [a.id, a]));
  const jobById = new Map(input.jobs.map(j => [j.id, j]));
  const contactById = new Map(input.contacts.map(c => [c.id, c]));
  const items: ActionItem[] = [];

  const upsert = (draft: Omit<ActionItem, 'createdAt' | 'updatedAt' | 'status'>): void => {
    const prev = prevById.get(draft.id);
    if (prev?.status === 'dismissed') return;
    if (prev?.snoozedUntil && prev.snoozedUntil > now) return;
    items.push({
      ...draft,
      status: 'open',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    });
  };

  // 1. Open Application Exceptions (uncertain submissions = P0 100, auth/security = 88, facts/reviews = 76)
  for (const exc of input.exceptions) {
    if (exc.status !== 'open') continue;
    const first = exc.affected[0];
    const score = exc.kind === 'submission-uncertain' ? 100 : exc.kind === 'auth' || exc.kind === 'security' ? 88 : 76;
    upsert({
      id: `act:exc:${exc.id}`,
      campaignId: input.campaignId,
      kind: exc.kind === 'submission-uncertain' ? 'submission-uncertain' : 'application-exception',
      ...(first?.company ? { companyName: first.company } : {}),
      ...(first?.title ? { roleTitle: first.title } : {}),
      exceptionId: exc.id,
      title: exc.kind === 'submission-uncertain' ? `Confirm submission: ${first?.company ?? 'Application'}` : exc.prompt,
      reason:
        exc.affected.length > 1
          ? `Blocking ${exc.affected.length} applications — answer once to resume all.`
          : `Waiting in ${first?.company ?? 'application'} (${first?.title ?? 'role'}).`,
      ctaLabel: exc.kind === 'submission-uncertain' ? 'Confirm' : 'Resolve',
      priorityScore: score,
    });
  }

  // 2. Conversations needing reply or ambiguous opportunity attribution
  for (const conv of input.conversations) {
    if (conv.attributionState === 'ambiguous') {
      upsert({
        id: `act:ambig:${conv.id}`,
        campaignId: input.campaignId,
        kind: 'ambiguous-thread',
        conversationId: conv.id,
        contactId: conv.contactId,
        contactName: conv.contactName,
        ...(conv.companyName ? { companyName: conv.companyName } : {}),
        title: `Confirm role for ${conv.contactName}'s ${conv.channel} thread`,
        reason: conv.attributionEvidence ?? 'Multiple open roles at this company.',
        ctaLabel: 'Assign role',
        priorityScore: 84,
      });
    } else if (conv.status === 'needs-reply') {
      const opp = conv.attributedOpportunityIds[0] ? jobById.get(conv.attributedOpportunityIds[0]) : undefined;
      upsert({
        id: `act:reply:${conv.id}`,
        campaignId: input.campaignId,
        kind: 'reply-needs-response',
        conversationId: conv.id,
        contactId: conv.contactId,
        contactName: conv.contactName,
        ...(opp
          ? { opportunityId: opp.id, companyName: opp.companyName, roleTitle: opp.title }
          : conv.companyName
            ? { companyName: conv.companyName }
            : {}),
        title: `Reply to ${conv.contactName}${opp ? ` (${opp.companyName})` : ''}`,
        reason: conv.summary ?? `New ${conv.channel} message waiting for your response.`,
        ctaLabel: 'Open thread',
        priorityScore: 86,
      });
    }
  }

  // 3. Outreach drafts waiting for approval + context-aware follow-ups due
  for (const task of input.outreach) {
    const contact = contactById.get(task.contactId);
    const opp = task.jobId ? jobById.get(task.jobId) : undefined;
    if (opp?.availability === 'closed') continue; // never nudge follow-up on closed role

    if (task.state === 'draft-ready') {
      upsert({
        id: `act:approve:${task.id}`,
        campaignId: input.campaignId,
        kind: 'outreach-approval',
        outreachId: task.id,
        contactId: task.contactId,
        ...(contact?.name ? { contactName: contact.name } : {}),
        ...(opp
          ? { opportunityId: opp.id, companyName: opp.companyName, roleTitle: opp.title }
          : contact?.companyName
            ? { companyName: contact.companyName }
            : {}),
        title: `Approve outreach to ${contact?.name ?? 'contact'}`,
        reason: opp ? `Tailored ${task.channel} draft for ${opp.title} at ${opp.companyName}.` : `Tailored ${task.channel} draft ready.`,
        ctaLabel: 'Review & approve',
        priorityScore: 72,
      });
    } else if ((task.state === 'sent' || task.state === 'accepted') && task.nextFollowUpAt && task.nextFollowUpAt <= now) {
      upsert({
        id: `act:followup:${task.id}`,
        campaignId: input.campaignId,
        kind: 'follow-up-due',
        outreachId: task.id,
        contactId: task.contactId,
        ...(contact?.name ? { contactName: contact.name } : {}),
        ...(opp
          ? { opportunityId: opp.id, companyName: opp.companyName, roleTitle: opp.title }
          : contact?.companyName
            ? { companyName: contact.companyName }
            : {}),
        title: `Follow up with ${contact?.name ?? 'contact'}`,
        reason: opp ? `No reply yet on ${opp.title} (${opp.companyName}).` : 'Follow-up window reached with no reply yet.',
        ctaLabel: 'Open Workspace',
        priorityScore: 60,
        dueAt: task.nextFollowUpAt,
      });
    }
  }

  // 4. Batched high-fit unreviewed jobs
  const strongUnreviewed = input.jobs.filter(
    j => j.qualification?.tier === 'strong' && (!j.userJudgement || j.userJudgement === 'none') && j.availability !== 'closed',
  );
  if (strongUnreviewed.length > 0) {
    upsert({
      id: `act:review-jobs:${input.campaignId}`,
      campaignId: input.campaignId,
      kind: 'review-high-fit-jobs',
      title: `Review ${strongUnreviewed.length} strong-match role${strongUnreviewed.length === 1 ? '' : 's'}`,
      reason: `Top match: ${strongUnreviewed[0]!.title} at ${strongUnreviewed[0]!.companyName}.`,
      ctaLabel: 'Review roles',
      priorityScore: 45,
    });
  }

  return items.sort((a, b) => b.priorityScore - a.priorityScore || a.createdAt - b.createdAt);
}
