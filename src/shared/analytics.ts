/**
 * Privacy-safe, local-first product & outcome analytics (Stage 5 & Part 7).
 * Never inspects or exports CV text, contact names, or message contents.
 */

import type { Job } from './domain/job';
import type { OutreachTask } from './domain/outreach';
import type { OutcomeEvent } from './persistence/campaign-store';
import type { ApplicationTask } from './state-machines/application-task';

export const MIN_SAMPLE_FOR_RATES = 10;

export interface AnalyticsSummary {
  /** North-Star Metric: distinct opportunities progressed to a verified milestone in the last 7 days. */
  weeklyProgressedOpportunities: number;
  /** Activation Event: profile ready + at least 1 opportunity progressed beyond discovery. */
  activated: boolean;
  totalOpportunities: number;
  shortlisted: number;
  submitted: number;
  outreachSent: number;
  replies: number;
  interviews: number;
  offers: number;
  uncertainSubmissions: number;
  sampleReliable: boolean;
}

const WEEK_MS = 7 * 86_400_000;
const PROGRESSED_EVENTS = new Set([
  'queued',
  'submitted',
  'invitation-sent',
  'invitation-accepted',
  'reply',
  'referral-offered',
  'referral-submitted',
  'interview',
  'offer',
]);

export function computeAnalyticsSummary(input: {
  profileReady: boolean;
  jobs: readonly Job[];
  tasks: readonly ApplicationTask[];
  outreach: readonly OutreachTask[];
  events: readonly OutcomeEvent[];
  now?: number;
}): AnalyticsSummary {
  const now = input.now ?? Date.now();
  const weekCutoff = now - WEEK_MS;

  const weeklyEntities = new Set<string>();
  for (const e of input.events) {
    if (e.occurredAt >= weekCutoff && PROGRESSED_EVENTS.has(e.type) && e.confidence !== 'needs-confirmation') {
      weeklyEntities.add(e.entityId);
    }
  }
  for (const j of input.jobs) {
    if (j.userJudgement === 'shortlisted' && j.updatedAt >= weekCutoff) {
      weeklyEntities.add(j.id);
    }
  }

  const shortlisted = input.jobs.filter(j => j.userJudgement === 'shortlisted' || j.userJudgement === 'applied').length;
  const submitted = input.tasks.filter(t => t.state === 'submitted').length;
  const uncertainSubmissions = input.tasks.filter(t => t.state === 'uncertain').length;
  const outreachSent = input.outreach.filter(o => !!o.sentAt).length;
  const replies = input.events.filter(e => e.type === 'reply').length;
  const interviews = input.events.filter(e => e.type === 'interview' && e.confidence === 'verified').length;
  const offers = input.events.filter(e => e.type === 'offer' && e.confidence === 'verified').length;

  const activated = input.profileReady && (shortlisted > 0 || submitted > 0 || outreachSent > 0);

  return {
    weeklyProgressedOpportunities: weeklyEntities.size,
    activated,
    totalOpportunities: input.jobs.length,
    shortlisted,
    submitted,
    outreachSent,
    replies,
    interviews,
    offers,
    uncertainSubmissions,
    sampleReliable: input.jobs.length >= MIN_SAMPLE_FOR_RATES,
  };
}
