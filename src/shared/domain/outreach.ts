/**
 * Contacts and the outreach tasks that reach them (specification 12.3, 13, 14.2).
 *
 * The state machine here is per person and per channel, and it stops rather than continues. Every rule below is a
 * stop rule: a reply, a bounce, an opt-out, the wrong person. That bias is deliberate — the cost of one message
 * too few is a missed conversation, while the cost of one too many is the person's professional reputation, and
 * the second does not get a second chance.
 */

export type Channel = 'linkedin-invite' | 'linkedin-message' | 'email' | 'manual';

export type Relationship = 'existing-connection' | 'alumni' | 'second-degree' | 'shared-group' | 'none';
export type ContactCategory = 'existing-connection' | 'alumni' | 'hiring-manager' | 'recruiter' | 'peer' | 'founder' | 'unknown';

export type EmailConfidence = 'verified' | 'likely' | 'unknown';

export interface ContactEvidence {
  /** What was observed, and where. A classification with no evidence behind it is not used for ranking. */
  claim: string;
  source: string;
  observedAt: number;
  confidence: number;
}

export interface Contact {
  id: string;
  /** Stable across companies and channels, so one person is never approached twice as two records. */
  personKey: string;
  name: string;
  currentRole?: string;
  companyId?: string;
  companyName?: string;
  profileUrl?: string;
  relationship: Relationship;
  category: ContactCategory;
  evidence: ContactEvidence[];
  /** 0-1 that this is the right person, at that employer, in that role. */
  confidence: number;
  email?: string;
  emailConfidence: EmailConfidence;
  emailProvenance?: string;
  /** Set when the person asked not to be contacted: suppressed across every campaign and channel, for good. */
  suppressed?: { at: number; reason: string };
  createdAt: number;
  updatedAt: number;
}

/** One person, however many jobs or companies they turn up against. */
export const personKeyOf = (input: { profileUrl?: string; name: string; companyName?: string }): string => {
  const slug = /\/in\/([^/?#]+)/.exec(input.profileUrl ?? '')?.[1];
  if (slug) return `li:${slug.toLowerCase()}`;
  const name = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `n:${name}|${(input.companyName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
};

/* ---------- outreach ---------- */
export type OutreachState =
  | 'identified'
  | 'ranked'
  | 'reserved'
  | 'draft-ready'
  | 'approved'
  | 'sent'
  | 'accepted'
  | 'replied'
  | 'referral-offered'
  | 'referral-submitted'
  | 'declined'
  | 'no-response'
  | 'bounced'
  | 'wrong-person'
  | 'opted-out'
  | 'stopped';

export const OUTREACH_ALLOWED: Record<OutreachState, readonly OutreachState[]> = {
  identified: ['ranked', 'stopped'],
  ranked: ['reserved', 'stopped', 'wrong-person'],
  reserved: ['draft-ready', 'ranked', 'stopped'],
  'draft-ready': ['approved', 'reserved', 'stopped'],
  approved: ['sent', 'stopped'],
  sent: ['accepted', 'replied', 'bounced', 'no-response', 'opted-out', 'wrong-person', 'declined', 'stopped'],
  accepted: ['replied', 'no-response', 'opted-out', 'stopped'],
  replied: ['referral-offered', 'declined', 'wrong-person', 'opted-out', 'stopped'],
  'referral-offered': ['referral-submitted', 'declined', 'stopped'],
  'referral-submitted': ['stopped'],
  declined: [],
  'no-response': ['stopped'],
  bounced: ['stopped'],
  'wrong-person': ['stopped'],
  'opted-out': [],
  stopped: [],
};

export const TERMINAL_OUTREACH: readonly OutreachState[] = [
  'declined',
  'opted-out',
  'referral-submitted',
  'bounced',
  'wrong-person',
  'stopped',
];

export const canSend = (s: OutreachState): boolean => s === 'approved';

export interface FollowUp {
  /** Days after the first message. The default is one around day 3 and a final one around day 7. */
  dueAt: number;
  sequence: number;
  sent?: boolean;
}

export interface OutreachTask {
  id: string;
  campaignId: string;
  contactId: string;
  jobId?: string;
  channel: Channel;
  state: OutreachState;
  /** The exact text that will be sent, and its version, so what was approved is what goes out. */
  message?: string;
  messageVersion: number;
  approvedAt?: number;
  sentAt?: number;
  threadId?: string;
  followUps: FollowUp[];
  nextFollowUpAt?: number;
  stopReason?: string;
  priorityScore?: number;
  createdAt: number;
  updatedAt: number;
  history: { at: number; from: OutreachState; to: OutreachState; reason: string }[];
}

export class OutreachTransitionError extends Error {
  constructor(from: OutreachState, to: OutreachState) {
    super(`An outreach task cannot go from ${from} to ${to}.`);
    this.name = 'OutreachTransitionError';
  }
}

export function advance(task: OutreachTask, to: OutreachState, reason: string, now = Date.now()): OutreachTask {
  if (task.state !== to && !OUTREACH_ALLOWED[task.state].includes(to)) throw new OutreachTransitionError(task.state, to);
  const next: OutreachTask = {
    ...task,
    state: to,
    updatedAt: now,
    history: [...task.history, { at: now, from: task.state, to, reason }].slice(-40),
  };
  // Anything that ends the conversation cancels what was scheduled. Clearing the date is the mechanism that makes
  // "stop on reply" real rather than a label.
  if (TERMINAL_OUTREACH.includes(to) || to === 'replied') {
    delete next.nextFollowUpAt;
    next.followUps = task.followUps.map(f => (f.sent ? f : { ...f, sent: false }));
    next.stopReason = reason;
  }
  return next;
}

export type StopSignal = 'reply' | 'bounce' | 'opt-out' | 'out-of-office' | 'wrong-person' | 'declined';

export interface StopOutcome {
  state: OutreachState;
  reason: string;
  /** An out-of-office is not a refusal: the sequence waits until they are back. */
  postponeUntil?: number;
  /** Whether this person should be suppressed everywhere, not just on this campaign. */
  suppressEverywhere?: boolean;
  needsYou?: boolean;
}

/**
 * What a signal from the outside world does to the sequence. An auto-reply is explicitly not a meaningful reply:
 * counting it as one both stops a conversation that never started and inflates the reply rate the product reports.
 */
export function stopFor(signal: StopSignal, context: { returnAt?: number } = {}): StopOutcome {
  switch (signal) {
    case 'reply':
      return { state: 'replied', reason: 'They replied; planned follow-ups are cancelled.', needsYou: true };
    case 'bounce':
      return { state: 'bounced', reason: 'The address bounced. It is marked invalid until corrected.' };
    case 'opt-out':
      return { state: 'opted-out', reason: 'They asked not to be contacted.', suppressEverywhere: true, needsYou: true };
    case 'out-of-office':
      return {
        state: 'sent',
        reason: context.returnAt ? 'Out of office; the follow-up waits until they are back.' : 'Out of office; the follow-up is on hold.',
        ...(context.returnAt ? { postponeUntil: context.returnAt } : {}),
      };
    case 'wrong-person':
      return { state: 'wrong-person', reason: 'Not the right person. Nothing further is sent to them.', needsYou: true };
    case 'declined':
      return { state: 'declined', reason: 'They declined.' };
  }
}

const DAY = 86_400_000;

/** The default cadence: one contextual follow-up around day 3, one final around day 7, then stop. */
export function planFollowUps(sentAt: number, days: readonly number[] = [3, 7]): FollowUp[] {
  return days.map((d, i) => ({ dueAt: sentAt + d * DAY, sequence: i + 1 }));
}

export const dueFollowUp = (task: OutreachTask, now = Date.now()): FollowUp | undefined =>
  TERMINAL_OUTREACH.includes(task.state) || task.state === 'replied'
    ? undefined
    : task.followUps.find(f => !f.sent && f.dueAt <= now && (!task.nextFollowUpAt || task.nextFollowUpAt <= now));

/* ---------- message quality ---------- */
export interface MessageCheck {
  ok: boolean;
  warnings: string[];
  /** Claims the message makes that are not backed by a profile record, so the person can see them before sending. */
  unsupportedClaims: string[];
  length: number;
  limit?: number;
}

const GENERIC = [
  /\bi hope this (message|email) finds you well\b/i,
  /\bi came across your profile\b/i,
  /\bi would like to connect\b/i,
  /\bdear sir\s*\/?\s*madam\b/i,
  /\bto whom it may concern\b/i,
];

/**
 * Checks a draft before a person is asked to approve it. The point is not to score the prose but to catch the two
 * things that actually damage an outreach: a message that could have been sent to anyone, and a claim about the
 * candidate that nothing in their profile supports.
 */
export function checkMessage(
  message: string,
  context: { limit?: number; recipientName?: string; evidence?: readonly string[] },
): MessageCheck {
  const warnings: string[] = [];
  const text = message.trim();
  if (context.limit && text.length > context.limit) warnings.push(`This is ${text.length} characters; the limit is ${context.limit}.`);
  if (context.recipientName && !text.toLowerCase().includes(context.recipientName.split(' ')[0]!.toLowerCase()))
    warnings.push('The message does not use their name.');
  for (const p of GENERIC) if (p.test(text)) warnings.push('This opening reads as a template; say why you are writing to this person.');

  const unsupportedClaims: string[] = [];
  const evidence = (context.evidence ?? []).map(e => e.toLowerCase());
  // Numbers are the claims that get a candidate caught out, so any figure with no matching evidence is flagged.
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\s*(?:%|percent|years?|months?|x|crore|lakh|k\b)/gi)) {
    const claim = m[0];
    if (!evidence.some(e => e.includes(claim.toLowerCase()))) unsupportedClaims.push(claim);
  }
  return {
    ok: !warnings.length && !unsupportedClaims.length,
    warnings,
    unsupportedClaims,
    length: text.length,
    ...(context.limit ? { limit: context.limit } : {}),
  };
}

/* ---------- email provenance ---------- */
export const EMAIL_RULES: Record<EmailConfidence, { canDraft: boolean; canSend: boolean; note: string }> = {
  verified: { canDraft: true, canSend: true, note: 'Published, given by them, or from earlier correspondence.' },
  // A pattern guess is a lead to verify. Sending to it risks the wrong person and a bounce, and both cost more
  // than the message was worth.
  likely: { canDraft: true, canSend: false, note: 'Guessed from the company’s address pattern. Confirm before sending.' },
  unknown: { canDraft: false, canSend: false, note: 'No defensible address. Use LinkedIn or keep researching.' },
};

export const mayEmail = (confidence: EmailConfidence, mode: 'off' | 'draft' | 'send-verified'): boolean =>
  mode === 'send-verified' && EMAIL_RULES[confidence].canSend;
