/**
 * How much ChatGPT this person can afford to spend, and what to do when they run out.
 *
 * ChatGPT's own caps differ by plan and are not published as numbers an extension can read, so Referral Scout
 * cannot measure them. What it can do is spend deliberately: count what it has asked, keep a conservative budget
 * per plan, and when ChatGPT does say it has had enough, stop asking for a while rather than hammering a page
 * that will keep refusing. Every limit here is a self-imposed floor well under the real one; the point is that a
 * search should not use up the person's whole afternoon of ChatGPT on its own.
 *
 * Nothing in this file touches storage or the browser, so the rules can be tested on their own.
 */

export type AiTier = 'free' | 'go' | 'plus' | 'api';

export interface TierLimits {
  label: string;
  /** What choosing this means, in the person's words rather than ours. */
  blurb: string;
  /** Questions Referral Scout will ask in one rolling window before it waits. */
  perWindow: number;
  windowMs: number;
  /** Whether anything other than the one-off profile dossier may use ChatGPT's slower thinking mode. */
  thinkingBeyondDossier: boolean;
  /** How many batches of ten jobs one search may spend on ranking. */
  rankBatches: number;
  /** Whether a note may be rewritten for one named recipient, which costs one message per person. */
  perContactAi: boolean;
}

const HOURS = 3600000;

export const TIERS: Record<AiTier, TierLimits> = {
  free: {
    label: 'Free',
    blurb: 'Referral Scout writes from your own wording and asks ChatGPT only for what it cannot do itself.',
    perWindow: 8,
    windowMs: 3 * HOURS,
    thinkingBeyondDossier: false,
    rankBatches: 1,
    perContactAi: false,
  },
  go: {
    label: 'ChatGPT Go',
    blurb: 'Enough for a full search and a few applications in one sitting. Long written answers still get thinking time.',
    perWindow: 25,
    windowMs: 3 * HOURS,
    thinkingBeyondDossier: true,
    rankBatches: 2,
    perContactAi: false,
  },
  plus: {
    label: 'ChatGPT Plus or Pro',
    blurb: 'Everything on, including a note rewritten for each person you reach out to.',
    perWindow: 60,
    windowMs: 3 * HOURS,
    thinkingBeyondDossier: true,
    rankBatches: 3,
    perContactAi: true,
  },
  api: {
    label: 'My OpenAI API key',
    blurb: 'Goes straight to the API, so no ChatGPT tab opens and nothing waits on a page. You pay per use.',
    perWindow: 240,
    windowMs: 1 * HOURS,
    thinkingBeyondDossier: true,
    rankBatches: 3,
    perContactAi: true,
  },
};

export interface AiBudget {
  tier: AiTier;
  /** When each question was asked, oldest first. Trimmed to the current window on every write. */
  calls: number[];
  /** Set when ChatGPT itself said it had had enough. Nothing is asked before this time. */
  cooldownUntil?: number;
  /** Consecutive refusals; the second one in a row waits much longer than the first. */
  strikes: number;
}

export const emptyBudget = (tier: AiTier = 'free'): AiBudget => ({ tier, calls: [], strikes: 0 });

/** The first refusal waits half an hour; a second in a row waits three. */
export const COOLDOWNS = [30 * 60000, 3 * HOURS];

const live = (b: AiBudget, now: number): number[] => b.calls.filter(t => now - t < TIERS[b.tier].windowMs);

export interface Usage {
  used: number;
  allowed: number;
  remaining: number;
  /** When the oldest question drops out of the window and one more becomes available. */
  resetsAt: number | null;
}

export function usage(b: AiBudget, now = Date.now()): Usage {
  const calls = live(b, now);
  const allowed = TIERS[b.tier].perWindow;
  return {
    used: calls.length,
    allowed,
    remaining: Math.max(0, allowed - calls.length),
    resetsAt: calls.length ? calls[0]! + TIERS[b.tier].windowMs : null,
  };
}

export type Refusal = { ok: false; reason: 'cooldown' | 'budget'; retryAt: number };
export type Permission = { ok: true } | Refusal;

/**
 * Whether to ask ChatGPT now. `force` is for the one-off profile dossier and for anything the person just clicked:
 * work they are waiting on is never silently skipped to save a message they did not know they were spending.
 */
export function mayAsk(b: AiBudget, now = Date.now(), force = false): Permission {
  if (force) return { ok: true };
  if (b.cooldownUntil && now < b.cooldownUntil) return { ok: false, reason: 'cooldown', retryAt: b.cooldownUntil };
  const u = usage(b, now);
  if (u.remaining <= 0) return { ok: false, reason: 'budget', retryAt: u.resetsAt ?? now + TIERS[b.tier].windowMs };
  return { ok: true };
}

export function recordCall(b: AiBudget, now = Date.now()): AiBudget {
  return { ...b, calls: [...live(b, now), now].slice(-500) };
}

/** ChatGPT answered, so whatever it was refusing before has passed. */
export function recordSuccess(b: AiBudget): AiBudget {
  const { cooldownUntil, ...rest } = b;
  void cooldownUntil;
  return { ...rest, strikes: 0 };
}

/** ChatGPT said it had reached a limit. Back off, and back off harder if this is not the first time. */
export function recordLimitHit(b: AiBudget, now = Date.now()): AiBudget {
  const strikes = Math.min(b.strikes + 1, COOLDOWNS.length);
  return { ...b, strikes, cooldownUntil: now + COOLDOWNS[strikes - 1]! };
}

/** Whether this task may use thinking mode. The dossier always may: it is asked once and it is worth the wait. */
export function thinkingAllowed(tier: AiTier, kind: string, wanted: boolean): boolean {
  if (!wanted) return false;
  if (kind === 'BUILD_DOSSIER') return true;
  return TIERS[tier].thinkingBeyondDossier;
}

export const rankBatchesFor = (tier: AiTier): number => TIERS[tier].rankBatches;
export const perContactAllowed = (tier: AiTier): boolean => TIERS[tier].perContactAi;

/** One line for the panel: what is left, or how long until it is worth asking again. */
export function budgetLine(b: AiBudget, now = Date.now()): string {
  if (b.cooldownUntil && now < b.cooldownUntil) {
    const mins = Math.max(1, Math.round((b.cooldownUntil - now) / 60000));
    return `ChatGPT asked for a break. Waiting about ${mins} minute${mins === 1 ? '' : 's'}; your saved wording is used meanwhile.`;
  }
  const u = usage(b, now);
  if (u.remaining <= 0 && u.resetsAt) {
    const mins = Math.max(1, Math.round((u.resetsAt - now) / 60000));
    return `Today's ChatGPT budget is used. More in about ${mins} minute${mins === 1 ? '' : 's'}; your saved wording is used meanwhile.`;
  }
  return `${u.remaining} of ${u.allowed} ChatGPT questions left in this stretch.`;
}

/** What the panel says about one call before it is made. */
export const askLine = (thinking: boolean): string => (thinking ? 'Asking ChatGPT · thinking · up to 2 min' : 'Asking ChatGPT · instant');
export const cachedLine = 'From your saved wording · no AI used';
