/**
 * Autopilot trust gates, pacing, route reliability, and submission receipts.
 *
 * Pure domain rules (no browser APIs) so every gate is unit-tested and enforced in the engine.
 */

import type { Campaign } from './domain/campaign';
import type { ApplyRoute, ApplicationTask } from './state-machines/application-task';

export const HARD_DAILY_CAP = 25;
export const DEFAULT_DAILY_CAP = 15;
export const FAILURE_STREAK_LIMIT = 3;
export const MIN_GAP_MS = 45_000;
export const MAX_GAP_MS = 120_000;

/**
 * Reliable routes for unattended Autopilot submission based on measured ATS form structure:
 * - LinkedIn Easy Apply (standardized multi-step modal)
 * - Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Breezy, Teamtailor, Recruitee
 * Complex portals (Workday, iCIMS, Taleo, Oracle, unknown employer sites) require human review at submit.
 */
export const RELIABLE_AUTOPILOT_ATS = new Set([
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'workable.com',
  'smartrecruiters.com',
  'breezy.hr',
  'teamtailor.com',
  'recruitee.com',
]);

export function isReliableAutopilotRoute(route: ApplyRoute, atsHost?: string, url?: string): boolean {
  if (route === 'easy-apply') return true;
  if (route !== 'external') return false;
  const host = (atsHost || extractHost(url) || '').toLowerCase().replace(/^www\./, '');
  if (!host) return false;
  for (const reliable of RELIABLE_AUTOPILOT_ATS) {
    if (host === reliable || host.endsWith(`.${reliable}`)) return true;
  }
  return false;
}

function extractHost(raw?: string): string {
  if (!raw) return '';
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}

export interface ReceiptAnswer {
  label: string;
  value: string;
  source: 'profile' | 'bank' | 'cv' | 'ai' | 'user';
}

export interface ApplicationReceipt {
  id: string;
  applicationId: string;
  jobId: string;
  title: string;
  company: string;
  url: string;
  submittedAt: number;
  route: ApplyRoute;
  ats: string;
  mode: 'guided' | 'autopilot';
  resumeName: string;
  answersUsed: ReceiptAnswer[];
  confirmationNote?: string;
}

export interface AutopilotGateInput {
  campaign: Campaign;
  task: Pick<ApplicationTask, 'fit' | 'route' | 'ats' | 'url'>;
  doneToday: number;
  now?: number;
  eligible?: boolean;
  hasMissingRequired?: boolean;
  hasCaptcha?: boolean;
  hasLoginWall?: boolean;
  hasUploadError?: boolean;
  hasValidationError?: boolean;
  hasSensitiveOrLegalUnanswered?: boolean;
}

export type AutopilotGateVerdict = { ok: true } | { ok: false; reason: string; code: string };

/**
 * Enforces every Autopilot gate before an application may be auto-submitted.
 * If any gate fails, the application stops as `needs-you` (Ready to submit / Review) with the exact reason.
 */
export function evaluateAutopilotGates(input: AutopilotGateInput): AutopilotGateVerdict {
  const { campaign, task, doneToday } = input;
  const now = input.now ?? Date.now();
  const rules = campaign.application;

  if (rules.mode !== 'autopilot') {
    return { ok: false, code: 'mode-not-autopilot', reason: 'Guided mode is active: you review and press Submit.' };
  }
  if (!rules.autopilotOptInAt) {
    return {
      ok: false,
      code: 'opt-in-required',
      reason: 'Autopilot requires your explicit opt-in and risk acknowledgment first.',
    };
  }
  if (!rules.preflightApprovedAt) {
    return {
      ok: false,
      code: 'preflight-required',
      reason: 'Approve the one-time Pre-flight Preview in Mission settings before Autopilot submits.',
    };
  }
  const effectiveCap = Math.min(rules.dailyTarget > 0 ? rules.dailyTarget : DEFAULT_DAILY_CAP, HARD_DAILY_CAP);
  if (doneToday >= effectiveCap) {
    return {
      ok: false,
      code: 'daily-cap',
      reason: `Daily cap of ${effectiveCap} applications reached for today.`,
    };
  }
  if (!withinActiveHoursWindow(rules.activeHours ?? null, now)) {
    return {
      ok: false,
      code: 'outside-active-hours',
      reason: 'Outside your configured active hours window.',
    };
  }
  if ((rules.failureStreak ?? 0) >= FAILURE_STREAK_LIMIT) {
    return {
      ok: false,
      code: 'failure-streak',
      reason: `Paused automatically after ${FAILURE_STREAK_LIMIT} consecutive application failures.`,
    };
  }
  if (input.eligible === false) {
    return { ok: false, code: 'ineligible', reason: 'Job failed your eligibility requirements.' };
  }
  if (task.fit < rules.minFit) {
    return { ok: false, code: 'below-min-fit', reason: `Fit ${task.fit} is below your minimum of ${rules.minFit}.` };
  }
  if (!isReliableAutopilotRoute(task.route, task.ats, task.url)) {
    return {
      ok: false,
      code: 'unreliable-route',
      reason: `Route (${task.ats || task.route}) requires manual review at Submit.`,
    };
  }
  if (input.hasCaptcha) {
    return { ok: false, code: 'captcha', reason: 'A verification challenge (CAPTCHA) appeared.' };
  }
  if (input.hasLoginWall) {
    return { ok: false, code: 'login-wall', reason: 'The site requires you to sign in.' };
  }
  if (input.hasUploadError) {
    return { ok: false, code: 'upload-error', reason: 'CV or file upload did not succeed.' };
  }
  if (input.hasValidationError) {
    return { ok: false, code: 'validation-error', reason: 'The form reported a validation error.' };
  }
  if (input.hasMissingRequired) {
    return { ok: false, code: 'missing-required', reason: 'One or more required fields still need your answer.' };
  }
  if (input.hasSensitiveOrLegalUnanswered) {
    return {
      ok: false,
      code: 'sensitive-or-legal',
      reason: 'Terms, legal consent, signature, or EEO fields require your own confirmation.',
    };
  }

  return { ok: true };
}

export function withinActiveHoursWindow(window: { start: number; end: number } | null | undefined, now = Date.now()): boolean {
  if (!window) return true;
  const hour = new Date(now).getHours();
  if (window.start <= window.end) return hour >= window.start && hour < window.end;
  return hour >= window.start || hour < window.end;
}

export function nextRandomGapMs(rand = Math.random()): number {
  const clamped = Math.max(0, Math.min(1, rand));
  return Math.round(MIN_GAP_MS + clamped * (MAX_GAP_MS - MIN_GAP_MS));
}

export const AUTOPILOT_RISK_DISCLOSURE =
  'Automating job applications on LinkedIn or employer portals can violate site terms and lead to account restrictions. You are in control: Autopilot pauses on any uncertainty, enforces a strict daily cap, and you own the decision to enable it.';
