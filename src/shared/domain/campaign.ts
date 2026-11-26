/**
 * The campaign: the one thing the person sets up, and the thing both engines read their rules from.
 *
 * A campaign does not run anything itself. It holds the target, the rules and the pause state; the application queue
 * and the referral allocator each read it and run their own work. Keeping them apart is deliberate — an application
 * waiting on a PIN code has nothing to do with whether an invitation can be sent, and merging their control into one
 * switch is how one stuck step stops a whole job search.
 */

import { defaultAdmission, type AdmissionRules } from '../state-machines/application-task';
import type { StrategyOrder } from '../apply-status';

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'stopping' | 'completed';

/** High-level mission mode controlling discovery, guided review, and opt-in autopilot. */
export type MissionMode = 'discover' | 'guided' | 'autopilot';

/** What the runner does when every step of a form is complete and valid. */
export type SubmitPolicy = 'review' | 'auto';

export interface ReferralRules {
  /** The campaign's whole invitation allowance for the week, spent across companies rather than per company. */
  weeklyBudget: number;
  /** How many people may be approached at one employer before the budget moves elsewhere. */
  maxPerCompany: number;
  /** Hold the second contact at a company until the first has had this long to answer. */
  diminishingHours: number;
  /** Draft only, or send after review. Email never sends to an unverified address regardless. */
  emailMode: 'off' | 'draft' | 'send-verified';
  /** Days after sending to follow up, then stop. */
  followUpDays: number[];
  /** Canonical company keys the person has pinned/boosted so outreach & budget prioritize them first. */
  pinnedCompanies?: string[];
}

export interface ApplicationRules extends AdmissionRules {
  /** Primary mission mode: discover only, guided (default), or autopilot (opt-in). */
  mode: MissionMode;
  submitPolicy: SubmitPolicy;
  /** Page workers at once. One until the pilot proves two is safe; see the concurrency note below. */
  concurrency: 1 | 2;
  /** Start looking for referral contacts when the application reaches this point. */
  referralTrigger: 'on-qualify' | 'on-queue' | 'on-submit' | 'never';
  /** How applications and referral outreach are ordered. */
  strategyOrder: StrategyOrder;
  /** For referral-first / pinned companies: hours to wait for a referral before applying. */
  referralWaitHours?: number;
  /** Active hours window (24h local time), or null for anytime. */
  activeHours?: { start: number; end: number } | null;
  /** Timestamp when user explicitly opted into Autopilot and acknowledged LinkedIn risk. */
  autopilotOptInAt?: number;
  /** Timestamp when user approved the one-time Pre-flight Preview. */
  preflightApprovedAt?: number;
  /** Explicit informed opt-in for ticking required terms/privacy checkboxes in Autopilot. Default false. */
  allowConsentAutoTick?: boolean;
  /** Consecutive application failures; pauses automatically at 3. */
  failureStreak?: number;
  /** Earliest timestamp for claiming the next application (randomized pacing). */
  nextClaimAfter?: number;
}

export interface Campaign {
  id: string;
  name: string;
  targetRoles: string[];
  location: string;
  employmentType: string;
  sources: string[];
  status: CampaignStatus;
  application: ApplicationRules;
  referral: ReferralRules;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  /** Why it stopped, in the person's words or the system's. */
  statusNote?: string;
  /** Set while "Stop after current" is in effect: no new claims, current work reaches a safe point. */
  drainAt?: number;
}

export const defaultApplicationRules = (): ApplicationRules => ({
  ...defaultAdmission(),
  mode: 'guided',
  submitPolicy: 'review',
  // One worker. Two page tabs are not two AI sessions: with one ChatGPT conversation the model calls serialise
  // anyway, so a second tab buys contention rather than speed until that is measured.
  concurrency: 1,
  referralTrigger: 'on-queue',
  strategyOrder: 'parallel',
  referralWaitHours: 48,
  activeHours: null,
  allowConsentAutoTick: false,
  failureStreak: 0,
});

export const defaultReferralRules = (): ReferralRules => ({
  weeklyBudget: 80,
  maxPerCompany: 3,
  diminishingHours: 48,
  emailMode: 'off',
  followUpDays: [3, 7],
});

export function newCampaign(input: {
  name: string;
  targetRoles: string[];
  location: string;
  employmentType?: string;
  now?: number;
}): Campaign {
  const now = input.now ?? Date.now();
  return {
    id: `camp:${now}:${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    targetRoles: input.targetRoles,
    location: input.location,
    employmentType: input.employmentType ?? 'any',
    sources: ['linkedin'],
    status: 'draft',
    application: defaultApplicationRules(),
    referral: defaultReferralRules(),
    createdAt: now,
    updatedAt: now,
  };
}

/* ---------- control ---------- */
export type Control = 'start' | 'pause' | 'resume' | 'drain' | 'stop';

export const CONTROL_EFFECT: Record<Control, string> = {
  start: 'Claims eligible jobs and begins filling them.',
  pause: 'Stops claiming new jobs. Work already on a form stops at its next safe point.',
  resume: 'Carries on from where each application stopped.',
  drain: 'No new jobs are claimed; applications already open finish their current step.',
  stop: 'Everything stops. Nothing already submitted is affected.',
};

export function applyControl(c: Campaign, control: Control, now = Date.now()): Campaign {
  const next: Campaign = { ...c, updatedAt: now };
  // Clearing the drain mark means removing the field, not setting it to undefined: the record is written to
  // IndexedDB as-is, and a stored `drainAt: undefined` reads back as a key that exists with no value.
  const clearDrain = (): void => {
    delete next.drainAt;
  };
  switch (control) {
    case 'start':
      clearDrain();
      return { ...next, status: 'running', startedAt: c.startedAt ?? now, statusNote: '' };
    case 'resume':
      clearDrain();
      return { ...next, status: 'running', statusNote: '' };
    case 'pause':
      return { ...next, status: 'paused', statusNote: 'Paused by you.' };
    case 'drain':
      return { ...next, status: 'stopping', statusNote: 'Finishing the applications already open.', drainAt: now };
    case 'stop':
      clearDrain();
      return { ...next, status: 'paused', statusNote: 'Stopped by you.' };
  }
}

/** True when the runner may claim another job. Draining and pausing both stop claims; only pausing stops work. */
export const mayClaim = (c: Campaign): boolean => c.status === 'running';
export const mayContinue = (c: Campaign): boolean => c.status === 'running' || c.status === 'stopping';

/* ---------- progress across both engines ---------- */
export interface StageProgress {
  key: 'discover' | 'qualify' | 'apply' | 'referral' | 'outcomes';
  label: string;
  value: number;
  of?: number;
  detail: string;
  done: boolean;
}

/**
 * The five stages the overview draws. They are reported as counts, not as a single percentage, because the two
 * pipelines run independently: a referral figure says nothing about how far the applications have got, and one bar
 * covering both would imply the queue is waiting for outreach when it is not.
 */
/** "1 replies" reads as a bug to the person looking at it. One of anything takes the singular. */
const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function stages(input: {
  found: number;
  qualified: number;
  applied: number;
  queued: number;
  contacts: number;
  replies: number;
}): StageProgress[] {
  return [
    { key: 'discover', label: 'Discover', value: input.found, detail: `${input.found} found`, done: input.found > 0 },
    { key: 'qualify', label: 'Qualify', value: input.qualified, detail: `${input.qualified} relevant`, done: input.qualified > 0 },
    {
      key: 'apply',
      label: 'Apply queue',
      value: input.applied,
      of: input.queued,
      // "0 / 0" reads as something broken rather than as nothing queued yet.
      detail: input.queued === 0 ? 'nothing queued' : `${input.applied} / ${input.queued}`,
      done: input.queued > 0 && input.applied >= input.queued,
    },
    {
      key: 'referral',
      label: 'Referral outreach',
      value: input.contacts,
      detail: input.contacts === 0 ? 'nobody yet' : `${input.contacts} identified`,
      done: input.contacts > 0,
    },
    {
      key: 'outcomes',
      label: 'Track outcomes',
      value: input.replies,
      detail: input.replies === 0 ? 'no replies yet' : count(input.replies, 'reply', 'replies'),
      done: input.replies > 0,
    },
  ];
}
