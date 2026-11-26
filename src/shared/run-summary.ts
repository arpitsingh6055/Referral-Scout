/**
 * Persistent Run Summary model for Referral Scout.
 *
 * Replaces the in-memory `ui.done` object so that discovery and referrer-search
 * outcomes survive side-panel closes, reloads, and MV3 service-worker restarts.
 */

import type { NetworkState } from './network';

export type RunPhase = 'discover' | 'shortlist' | 'referrers' | 'outreach' | 'apply';
export type RunOutcome = 'success' | 'partial' | 'empty' | 'paused' | 'error';

export interface RunMatchHighlight {
  id: string;
  title: string;
  company: string;
  url: string;
  fit?: number;
  why?: string;
}

export interface RunSummary {
  id: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  phase: RunPhase;
  outcome: RunOutcome;
  jobsRead: number;
  companiesFound: number;
  strongMatches: number;
  referrersFound: number;
  appliedCount: number;
  error?: string;
  dismissedAt?: number;
  topMatches?: RunMatchHighlight[];
  suggestions?: string[];
}

export const EMPTY_SEARCH_SUGGESTIONS: readonly string[] = [
  'Add 1–2 broader or parallel job titles in Edit campaign.',
  'Widen your location (e.g. include Remote or a larger metro area).',
  'Relax strict work-mode or employment-type filters if enabled.',
];

/**
 * Derives a persistent RunSummary snapshot from NetworkState.
 * Safe to call repeatedly on state mutations and service-worker restarts.
 */
export function deriveRunSummary(s: NetworkState, now = Date.now()): RunSummary | undefined {
  const prev = s.lastRun;
  const search = s.jobSearch;
  const jobs = s.referralJobs ?? [];
  const referralContacts = s.contacts.filter(p => !!p.referralJob);
  const readyPeople = referralContacts.filter(
    p =>
      p.state === 'shortlisted' ||
      (p.state === 'review' && p.approved) ||
      (p.state === 'connected' && !p.messagedAt) ||
      p.state === 'review',
  ).length;
  const appliedCount = jobs.filter(j => !!j.applied).length;

  if (!search && !jobs.length && !prev) return undefined;

  let phase: RunPhase = prev?.phase ?? 'discover';
  let outcome: RunOutcome = prev?.outcome ?? 'partial';
  let finishedAt = prev?.finishedAt;
  let error = prev?.error;
  let suggestions = prev?.suggestions;

  if (s.paused) {
    outcome = 'paused';
  } else if (search?.status === 'finding') {
    phase = 'discover';
    outcome = 'partial';
    finishedAt = undefined;
    error = undefined;
    suggestions = undefined;
  } else if (search?.status === 'choosing') {
    phase = 'shortlist';
    if (search.found.length > 0) {
      outcome = 'success';
      finishedAt = finishedAt ?? now;
      suggestions = undefined;
    } else {
      outcome = 'empty';
      finishedAt = finishedAt ?? now;
      suggestions = [...EMPTY_SEARCH_SUGGESTIONS];
    }
    error = undefined;
  } else if (jobs.some(j => j.finishedAt === undefined)) {
    phase = 'referrers';
    outcome = 'partial';
    finishedAt = undefined;
  } else if (jobs.length > 0) {
    phase = readyPeople > 0 || s.active ? 'outreach' : 'apply';
    outcome = referralContacts.length > 0 || appliedCount > 0 ? 'success' : prev?.outcome === 'error' ? 'error' : 'partial';
    finishedAt = finishedAt ?? now;
  }

  const found = search?.found ?? [];
  const jobsRead = search ? found.length + (search.dropped?.length ?? 0) : Math.max(prev?.jobsRead ?? 0, jobs.length);
  const companiesFound = search ? found.length : Math.max(prev?.companiesFound ?? 0, jobs.length);
  const strongMatches = search
    ? found.filter(j => j.prioritized || (j.fit ?? 0) >= 75).length
    : (prev?.strongMatches ?? jobs.filter(j => !!j.fitNote).length);
  const topMatches: RunMatchHighlight[] | undefined = found.length
    ? found.slice(0, 3).map(j => ({
        id: j.id,
        title: j.title,
        company: j.company,
        url: j.url,
        ...(j.fit !== undefined ? { fit: j.fit } : {}),
        ...(j.why ? { why: j.why } : {}),
      }))
    : prev?.topMatches;

  const startedAt = search?.startedAt ?? prev?.startedAt ?? jobs[0]?.addedAt ?? now;
  const id = prev?.id && prev.startedAt === startedAt ? prev.id : `run-${startedAt}`;

  return {
    id,
    startedAt,
    updatedAt: now,
    ...(finishedAt !== undefined ? { finishedAt } : {}),
    phase,
    outcome,
    jobsRead,
    companiesFound,
    strongMatches,
    referrersFound: referralContacts.length,
    appliedCount,
    ...(error ? { error } : {}),
    ...(prev?.dismissedAt !== undefined && prev.phase === phase && prev.outcome === outcome ? { dismissedAt: prev.dismissedAt } : {}),
    ...(topMatches?.length ? { topMatches } : {}),
    ...(suggestions?.length ? { suggestions } : {}),
  };
}
