/**
 * Single source of truth for per-job application status across:
 * - manual `ReferralJob.applied` flags
 * - `apply-history` records from the autofill engine
 * - active `ApplySession` state
 * - optional Gmail confirmation signals (always user-confirmed before mutating state)
 */

import type { ReferralJob } from './referral';
import { canonicalJobUrl } from './domain/job';

export type StrategyOrder = 'referral-first' | 'apply-first' | 'parallel';

export const STRATEGY_ORDER_LABELS: Record<StrategyOrder, { label: string; hint: string }> = {
  'referral-first': {
    label: 'Ask a referrer first (recommended)',
    hint: "Ask a referrer first, then apply, and we'll remind you to tell them.",
  },
  'apply-first': {
    label: 'Apply first, then ask',
    hint: 'Submit your application now, then let referrers know your application is in.',
  },
  parallel: {
    label: 'Do both in parallel',
    hint: 'Fill the application while referral searches run in the background.',
  },
};

export type JobApplyStage = 'not-started' | 'ready-to-fill' | 'filling' | 'needs-review' | 'submitted' | 'applied' | 'failed';

export interface UnifiedApplyStatus {
  stage: JobApplyStage;
  label: string;
  appliedAt?: number;
  source?: 'autofill' | 'manual' | 'gmail';
  gmailSuggested?: boolean;
}

export interface ApplyHistoryEntry {
  title: string;
  company: string;
  url: string;
  at: number;
}

export interface ActiveApplySessionSummary {
  url: string;
  jobUrl?: string;
  stage: string;
  hasSubmit?: boolean;
  hasNext?: boolean;
  askCount?: number;
  message?: string;
}

const sameUrl = (a: string | undefined, b: string | undefined): boolean => {
  if (!a || !b) return false;
  const ca = canonicalJobUrl(a) ?? a.replace(/\/+$/, '');
  const cb = canonicalJobUrl(b) ?? b.replace(/\/+$/, '');
  return ca === cb;
};

const BUSY_STAGES = new Set(['reading', 'opening', 'thinking', 'filling', 'moving']);

/**
 * Merges active session, apply-history, manual `ReferralJob.applied`, and Gmail evidence
 * into one deterministic application status per job.
 */
export function resolveJobApplyStatus(
  job: Pick<ReferralJob, 'url' | 'applied' | 'company'>,
  ctx: {
    history?: readonly ApplyHistoryEntry[];
    session?: ActiveApplySessionSummary | null;
    gmailConfirmedCompanyKeys?: ReadonlySet<string>;
  } = {},
): UnifiedApplyStatus {
  const session = ctx.session;
  if (session && (sameUrl(session.jobUrl, job.url) || sameUrl(session.url, job.url))) {
    if (session.stage === 'submitted') {
      return { stage: 'submitted', label: 'Submitted', source: 'autofill' };
    }
    if (session.stage === 'error') {
      return { stage: 'failed', label: 'Needs retry', source: 'autofill' };
    }
    if (BUSY_STAGES.has(session.stage)) {
      return { stage: 'filling', label: 'Filling…', source: 'autofill' };
    }
    if (session.stage === 'review' || session.stage === 'permission' || (session.askCount ?? 0) > 0) {
      return { stage: 'needs-review', label: 'Needs your review', source: 'autofill' };
    }
  }

  const hist = (ctx.history ?? []).find(h => sameUrl(h.url, job.url));
  if (job.applied && hist) {
    return {
      stage: 'applied',
      label: 'Applied',
      appliedAt: Math.max(job.applied, hist.at),
      source: 'autofill',
    };
  }
  if (hist) {
    return {
      stage: 'applied',
      label: 'Applied',
      appliedAt: hist.at,
      source: 'autofill',
    };
  }
  if (job.applied) {
    return {
      stage: 'applied',
      label: 'Applied',
      appliedAt: job.applied,
      source: 'manual',
    };
  }

  const companyKey = job.company.trim().toLowerCase();
  if (companyKey && ctx.gmailConfirmedCompanyKeys?.has(companyKey)) {
    return {
      stage: 'not-started',
      label: 'Not started',
      gmailSuggested: true,
    };
  }

  return { stage: 'not-started', label: 'Not started' };
}
