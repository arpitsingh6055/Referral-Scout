/**
 * "Needs you": every question, sign-in and uncertain result from every application, in one place.
 *
 * The old engine could ask a question and carry on with that application once answered. What it could not do is let
 * the other twenty applications keep going meanwhile. Isolation is the whole point of this file: an exception
 * belongs to one application, and the queue steps over it. A reusable fact is the exception to that — it is grouped
 * across applications so the person types a PIN code once, sees exactly which applications will receive it, and
 * resumes all of them.
 */

import { matchLabel, type FactScope } from './facts';

export type ExceptionKind =
  'reusable-fact' | 'job-choice' | 'written-review' | 'auth' | 'security' | 'page-failure' | 'submission-uncertain' | 'profile-gap';

/** 0 is most urgent. Anything that may have already happened in the outside world outranks anything that has not. */
export const PRIORITY: Record<ExceptionKind, 0 | 1 | 2 | 3> = {
  'submission-uncertain': 0,
  auth: 1,
  security: 1,
  'reusable-fact': 1,
  'job-choice': 1,
  'page-failure': 1,
  'written-review': 2,
  'profile-gap': 3,
};

export const KIND_LABELS: Record<ExceptionKind, string> = {
  'reusable-fact': 'Reusable fact',
  'job-choice': 'Personal decision',
  'written-review': 'Written answer',
  auth: 'Account step',
  security: 'Security check',
  'page-failure': 'Page problem',
  'submission-uncertain': 'Check this submission',
  'profile-gap': 'Profile',
};

/** What the person does about it, which decides the button the inbox draws. */
export type Resolution = 'answer' | 'choose' | 'review' | 'open-tab' | 'confirm' | 'retry-or-skip';

export const RESOLUTION: Record<ExceptionKind, Resolution> = {
  'reusable-fact': 'answer',
  'job-choice': 'choose',
  'written-review': 'review',
  auth: 'open-tab',
  security: 'open-tab',
  'page-failure': 'retry-or-skip',
  'submission-uncertain': 'confirm',
  'profile-gap': 'answer',
};

export interface AffectedApplication {
  applicationId: string;
  company: string;
  title: string;
  /** The field on that application's form waiting for the value. */
  fieldId?: string;
}

export interface ApplicationException {
  id: string;
  campaignId: string;
  kind: ExceptionKind;
  /** The application that raised it. A grouped fact keeps its first raiser here and the rest in `affected`. */
  applicationId: string;
  /** Set for a reusable fact: the Answer Bank key the question resolved to. Grouping happens on this, never on text. */
  canonicalKey?: string;
  /** The question as the form worded it, so the person recognises it. */
  prompt: string;
  /** What the form called the field, for the "Matched to:" line. */
  matchedAs?: string;
  help?: string;
  options?: string[];
  /** Offered only when there is evidence behind it; an empty box is better than a confident guess. */
  suggestedValue?: string;
  suggestionSource?: string;
  affected: AffectedApplication[];
  scope: FactScope;
  /** The country of the raising job, so a country-scoped answer is saved against the right place. */
  country?: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  resolution?: { value?: string; appliedTo: string[]; savedToBank: boolean };
}

/**
 * The grouping key. Two questions share an inbox item only when they resolve to the same canonical fact and the same
 * scope value — so "PIN code" and "postal code" merge, while a work authorisation question from an Indian role and
 * one from a US role stay apart and get asked separately.
 */
export function groupKey(
  e: Pick<ApplicationException, 'kind' | 'canonicalKey' | 'prompt' | 'applicationId' | 'scope' | 'country'>,
): string {
  if (e.kind !== 'reusable-fact' || !e.canonicalKey) return `${e.kind}:${e.applicationId}:${e.prompt.slice(0, 80)}`;
  const place = e.scope === 'country' ? (e.country ?? 'unknown').toLowerCase() : '';
  return `fact:${e.canonicalKey}${place ? `:${place}` : ''}`;
}

export interface RaiseInput {
  campaignId: string;
  applicationId: string;
  company: string;
  title: string;
  kind: ExceptionKind;
  prompt: string;
  fieldId?: string;
  help?: string;
  options?: string[];
  suggestedValue?: string;
  suggestionSource?: string;
  country?: string;
  now?: number;
}

/**
 * Adds an exception to the inbox, merging it into an existing group when it is safely the same question. Returns the
 * whole list so the caller writes it in one transaction.
 */
export function raise(
  open: readonly ApplicationException[],
  input: RaiseInput,
): { list: ApplicationException[]; item: ApplicationException } {
  const now = input.now ?? Date.now();
  const match = input.kind === 'reusable-fact' ? matchLabel(input.prompt) : undefined;
  const draft: ApplicationException = {
    id: `exc:${now}:${Math.random().toString(36).slice(2, 8)}`,
    campaignId: input.campaignId,
    kind: input.kind,
    applicationId: input.applicationId,
    ...(match ? { canonicalKey: match.key, matchedAs: match.matchedAs } : {}),
    prompt: input.prompt,
    ...(input.help ? { help: input.help } : {}),
    ...(input.options?.length ? { options: input.options } : {}),
    ...(input.suggestedValue ? { suggestedValue: input.suggestedValue } : {}),
    ...(input.suggestionSource ? { suggestionSource: input.suggestionSource } : {}),
    affected: [
      {
        applicationId: input.applicationId,
        company: input.company,
        title: input.title,
        ...(input.fieldId ? { fieldId: input.fieldId } : {}),
      },
    ],
    scope: match?.definition.scope ?? 'job',
    ...(input.country ? { country: input.country } : {}),
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  // A question with no canonical match is never merged: an unknown question could be about anything.
  const key = groupKey(draft);
  const existing = draft.canonicalKey ? open.find(e => e.status === 'open' && groupKey(e) === key) : undefined;
  if (existing) {
    if (existing.affected.some(a => a.applicationId === input.applicationId)) return { list: [...open], item: existing };
    const merged: ApplicationException = {
      ...existing,
      affected: [
        ...existing.affected,
        {
          applicationId: input.applicationId,
          company: input.company,
          title: input.title,
          ...(input.fieldId ? { fieldId: input.fieldId } : {}),
        },
      ],
      updatedAt: now,
    };
    return { list: open.map(e => (e.id === existing.id ? merged : e)), item: merged };
  }
  return { list: [...open, draft], item: draft };
}

/**
 * Which applications a saved answer is allowed to reach. Only the ones already waiting on this exact question: an
 * answer never leaks into an application that did not ask for it, however well it would fit.
 */
export const willApplyTo = (e: ApplicationException): AffectedApplication[] => (e.status === 'open' ? e.affected : []);

export function resolve(
  e: ApplicationException,
  input: { value?: string; applyTo?: string[]; savedToBank: boolean; now?: number },
): ApplicationException {
  const now = input.now ?? Date.now();
  const allowed = new Set(e.affected.map(a => a.applicationId));
  const appliedTo = (input.applyTo ?? e.affected.map(a => a.applicationId)).filter(id => allowed.has(id));
  return {
    ...e,
    status: 'resolved',
    updatedAt: now,
    resolvedAt: now,
    resolution: { ...(input.value !== undefined ? { value: input.value } : {}), appliedTo, savedToBank: input.savedToBank },
  };
}

/** Most urgent first, then oldest, so nothing sits forgotten behind a stream of new arrivals. */
export const sortInbox = (list: readonly ApplicationException[]): ApplicationException[] =>
  [...list].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.createdAt - b.createdAt);

export const openOnly = (list: readonly ApplicationException[]): ApplicationException[] => list.filter(e => e.status === 'open');

/** How many applications are waiting on the person right now, counting each application once. */
export function waitingApplications(list: readonly ApplicationException[]): number {
  const ids = new Set<string>();
  for (const e of openOnly(list)) for (const a of e.affected) ids.add(a.applicationId);
  return ids.size;
}

export interface InboxCounts {
  open: number;
  urgent: number;
  facts: number;
  reviews: number;
  blocked: number;
}

export function inboxCounts(list: readonly ApplicationException[]): InboxCounts {
  const open = openOnly(list);
  return {
    open: open.length,
    urgent: open.filter(e => PRIORITY[e.kind] === 0).length,
    facts: open.filter(e => e.kind === 'reusable-fact').length,
    reviews: open.filter(e => e.kind === 'written-review').length,
    blocked: waitingApplications(open),
  };
}

/**
 * How the runner should behave when this kind of exception appears. The security case is the one that must never
 * change: a verification challenge is left alone, not solved, not worked around.
 */
export const RUNNER_BEHAVIOUR: Record<ExceptionKind, { parkApplication: boolean; continueOthers: boolean; note: string }> = {
  'reusable-fact': { parkApplication: true, continueOthers: true, note: 'Only this application waits; the queue carries on.' },
  'job-choice': { parkApplication: true, continueOthers: true, note: 'Scoped to this job, so it is asked once for this role.' },
  'written-review': { parkApplication: true, continueOthers: true, note: 'A draft is ready for you to check.' },
  auth: { parkApplication: true, continueOthers: true, note: 'Sign in on the open tab, then resume this one.' },
  security: { parkApplication: true, continueOthers: true, note: 'Complete the check yourself; it is never answered for you.' },
  'page-failure': { parkApplication: true, continueOthers: true, note: 'Retried only after the page is read again.' },
  'submission-uncertain': { parkApplication: true, continueOthers: true, note: 'Never retried on its own: it may already be submitted.' },
  'profile-gap': { parkApplication: false, continueOthers: true, note: 'Nothing is blocked; it would just save time later.' },
};
