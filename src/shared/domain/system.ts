/**
 * The supporting records: AI context, Gmail threads, notifications and the audit trail
 * (specification 18, 20.2, 14.1).
 *
 * These exist for the same reason: so that after the fact, the product can say what it did and why. An AI answer
 * that arrived in the wrong application, a status changed by an email that was misread, a message sent while the
 * person thought the campaign was paused — each of those is a trust failure that is impossible to investigate
 * without a record tying the action to its cause.
 */

/* ---------- AI context ---------- */
export type AiProvider = 'chatgpt-web' | 'openai-api' | 'none';

export interface AIContext {
  id: string;
  applicationId: string;
  provider: AiProvider;
  /** The provider's own handle for the conversation, where it has one. Meaningless to anything else. */
  conversationHandle?: string;
  /** Which dossier version the context was built from, so a profile edit can invalidate it. */
  dossierVersion: number;
  /** Step plus form fingerprint plus profile version: the cache key for a prepared answer. */
  cacheKey?: string;
  lastStep?: string;
  contextSize: number;
  status: 'active' | 'stale' | 'expired' | 'failed';
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

/**
 * A prepared answer may be reused only for the same application, the same form and the same profile version. Any
 * of those changing means the answer was written against something that no longer exists.
 */
export const cacheKeyFor = (input: {
  applicationId: string;
  formFingerprint: string;
  profileVersion: number;
  questionKey: string;
}): string => `${input.applicationId}|${input.formFingerprint}|v${input.profileVersion}|${input.questionKey}`;

export const contextUsable = (c: AIContext, dossierVersion: number, now = Date.now()): boolean =>
  c.status === 'active' && c.dossierVersion === dossierVersion && (!c.expiresAt || c.expiresAt > now);

/**
 * The guard against the worst failure in a two-worker setup: one application receiving another's answer. The
 * reply is accepted only when the context it came back on is the one that was sent.
 */
export const correlates = (context: AIContext, applicationId: string): boolean => context.applicationId === applicationId;

/* ---------- Gmail ---------- */
export type MailClass = 'interview' | 'assessment' | 'rejection' | 'info-request' | 'referral-update' | 'auto-reply' | 'unknown';

/** Below this, a classification is never allowed to move a pipeline stage on its own. */
export const CLASSIFY_THRESHOLD = 0.85;

export interface GmailThread {
  id: string;
  gmailThreadId: string;
  participants: string[];
  subject: string;
  lastMessageAt: number;
  labels: string[];
  /** What the classifier thinks, and how sure it is. Both are shown; neither is treated as fact on its own. */
  classification?: MailClass;
  confidence?: number;
  classificationState: 'unclassified' | 'suggested' | 'confirmed' | 'corrected';
  /** The application or contact this thread was matched to, and on what basis. */
  linkedEntityId?: string;
  linkedEntityKind?: 'application' | 'contact';
  matchBasis?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClassificationOutcome {
  /** Whether the pipeline may move without asking. */
  autoApply: boolean;
  needsConfirmation: boolean;
  note: string;
}

/**
 * What a classified email is allowed to do. An out-of-office never counts as a reply, and an interview invite is
 * never applied silently — a wrongly auto-marked interview is a far worse error than an extra question, because
 * the person acts on what the pipeline says.
 */
export function outcomeFor(classification: MailClass, confidence: number): ClassificationOutcome {
  if (classification === 'auto-reply')
    return { autoApply: false, needsConfirmation: false, note: 'An automatic reply. Follow-up is paused; it does not count as an answer.' };
  if (classification === 'unknown' || confidence < CLASSIFY_THRESHOLD)
    return { autoApply: false, needsConfirmation: true, note: 'Not clear enough to act on. Confirm what this message is.' };
  if (classification === 'interview' || classification === 'referral-update')
    return { autoApply: false, needsConfirmation: true, note: 'Looks important. Confirm before the pipeline is updated.' };
  return { autoApply: true, needsConfirmation: false, note: 'Recorded with the message as evidence; you can correct it.' };
}

/* ---------- notifications ---------- */
export type NotificationType =
  'exception-created' | 'submission-uncertain' | 'queue-completed' | 'reply-detected' | 'interview-invite' | 'deadline-near';

/** Only changes worth interrupting someone for. Progress is visible in the panel and never notified. */
export const NOTIFY: Record<NotificationType, { priority: 0 | 1 | 2; title: string }> = {
  'submission-uncertain': { priority: 0, title: 'Check whether an application went through' },
  'interview-invite': { priority: 0, title: 'Possible interview invitation' },
  'reply-detected': { priority: 1, title: 'Someone replied' },
  'exception-created': { priority: 1, title: 'An application needs you' },
  'deadline-near': { priority: 1, title: 'A deadline is close' },
  'queue-completed': { priority: 2, title: 'The queue has finished' },
};

export interface Notification {
  id: string;
  type: NotificationType;
  priority: 0 | 1 | 2;
  title: string;
  body: string;
  entityRef?: string;
  deepLink?: string;
  createdAt: number;
  readAt?: number;
  dismissedAt?: number;
}

export interface QuietHours {
  from: number;
  to: number;
}

/** Quiet hours hold everything but a P0: an uncertain submission or an interview invite still gets through. */
export function mayNotify(type: NotificationType, hours: QuietHours | null, now = Date.now()): boolean {
  if (NOTIFY[type].priority === 0) return true;
  if (!hours) return true;
  const hour = new Date(now).getHours();
  const quiet = hours.from <= hours.to ? hour >= hours.from && hour < hours.to : hour >= hours.from || hour < hours.to;
  return !quiet;
}

/* ---------- audit ---------- */
export interface AuditEvent {
  id: string;
  /** Who did it: the person, the runner, or a connector acting on their behalf. */
  actor: 'user' | 'runner' | 'connector' | 'migration';
  action: string;
  entityRef: string;
  summary: string;
  before?: string;
  after?: string;
  at: number;
}

export const audit = (input: Omit<AuditEvent, 'id' | 'at'> & { at?: number }): AuditEvent => {
  const at = input.at ?? Date.now();
  return { ...input, at, id: `audit:${at}:${Math.random().toString(36).slice(2, 8)}` };
};
