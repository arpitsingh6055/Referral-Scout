/**
 * The Gmail channel, driven through the person's own signed-in tab.
 *
 * Three jobs: talk to the page, hold the gate on sending, and turn what comes back into outcome events.
 *
 * The gate is the important part. A send is only ever performed against an intent this file issued, naming one
 * recipient, valid for two minutes, consumed once. The page re-reads the address off the compose window and asks
 * for approval of *that* value immediately before clicking, so the address approved here and the address mailed
 * are the same string. Nothing else in the product can cause an email to leave.
 */

import { z } from 'zod';
import {
  gmailAuthorize,
  searchQuery,
  SCOUT_LABEL,
  type GmailCommand,
  type GmailScanResult,
  type GmailSendResult,
  type GmailThreadResult,
} from '../shared/gmail';
import { classify, isBounce, matchMessage, returnDate, type MatchTarget } from '../parsers/gmail';
import { outcomeFor, type MailClass } from '../shared/domain/system';
import { advance, stopFor, type OutreachTask } from '../shared/domain/outreach';
import { EMAIL_RULES, mayEmail, type EmailConfidence } from '../shared/domain/outreach';
import {
  allContacts,
  allOutreach,
  allThreads,
  changeOutreach,
  recordEvent,
  saveThreads,
  suppressContact,
  tasksFor,
  activeCampaign,
} from '../shared/persistence/campaign-store';
import { read, write } from '../storage/state';
import { trustedSite } from '../validators/security';

const GMAIL_URL = 'https://mail.google.com/mail/u/0/';
const INTENT_KEY = 'gmail-intent';
const IDENTITY_KEY = 'gmail-identity';
const COMMAND_TIMEOUT = 90_000;

interface SendIntent {
  id: string;
  to: string;
  outreachId: string;
  at: number;
  claimed?: boolean;
}

/* ---------- talking to the tab ---------- */
async function gmailTab(): Promise<number> {
  const open = await chrome.tabs.query({ url: 'https://mail.google.com/*' }).catch(() => []);
  const existing = open.find(t => t.id !== undefined && !t.discarded);
  if (existing?.id !== undefined) return existing.id;
  const created = await chrome.tabs.create({ url: GMAIL_URL, active: false });
  if (created.id === undefined) throw new Error('Gmail could not be opened.');
  // Give the page time to load before the first command; Gmail's shell takes a moment.
  await new Promise(r => setTimeout(r, 4000));
  return created.id;
}

async function ensureScript(tabId: number): Promise<void> {
  try {
    const pong = (await chrome.tabs.sendMessage(tabId, { kind: 'gmail.ping' })) as { ok?: boolean } | undefined;
    if (pong?.ok) return;
  } catch {
    // Nothing listening in this tab yet.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['health.js'] }).catch(() => undefined);
  await new Promise(r => setTimeout(r, 600));
}

/** The command's defaults live in the schema; callers pass only the fields their action uses. */
type CommandInput = Pick<GmailCommand, 'action'> & Partial<Omit<GmailCommand, 'action'>>;

async function command<T>(input: CommandInput): Promise<T> {
  const tabId = await gmailTab();
  await ensureScript(tabId);
  const message: GmailCommand = {
    kind: 'gmail.page',
    requestId: crypto.randomUUID(),
    deadline: Date.now() + COMMAND_TIMEOUT,
    action: input.action,
    query: input.query ?? '',
    threadId: input.threadId ?? '',
    to: input.to ?? '',
    subject: input.subject ?? '',
    body: input.body ?? '',
    intentId: input.intentId ?? '',
  };
  const reply = (await chrome.tabs.sendMessage(tabId, message).catch((e: unknown) => {
    throw new Error(
      e instanceof Error && /Receiving end does not exist/.test(e.message)
        ? 'The Gmail tab is not responding. Open Gmail, let it finish loading, and try again.'
        : 'Gmail could not be reached.',
    );
  })) as { ok?: boolean; data?: T; error?: string } | undefined;
  if (!reply?.ok) throw new Error(reply?.error ?? 'Gmail did not answer.');
  return reply.data as T;
}

export async function gmailIdentity(force = false): Promise<string> {
  if (!force) {
    const saved = await read<string>(IDENTITY_KEY);
    if (saved) return saved;
  }
  const { address } = await command<{ address: string }>({ action: 'identity' });
  await write(IDENTITY_KEY, address);
  return address;
}

export const gmailConnected = async (): Promise<boolean> => !!(await read<string>(IDENTITY_KEY));

/* ---------- the send gate ---------- */
async function issueIntent(to: string, outreachId: string): Promise<string> {
  const intent: SendIntent = { id: crypto.randomUUID(), to: to.trim().toLowerCase(), outreachId, at: Date.now() };
  await write(INTENT_KEY, intent);
  return intent.id;
}

/**
 * Called by the page just before it clicks Send. Approves only when the intent is the current one, is young, has
 * not already been used, and names exactly the address sitting in the compose window.
 */
export async function authorizeSend(id: string, to: string, claim: boolean): Promise<boolean> {
  const intent = await read<SendIntent>(INTENT_KEY);
  if (!intent) return false;
  const ok =
    intent.id === id &&
    intent.to === to.trim().toLowerCase() &&
    Date.now() - intent.at < 120_000 &&
    (claim ? !intent.claimed : !!intent.claimed);
  if (ok && claim) await write(INTENT_KEY, { ...intent, claimed: true });
  return ok;
}

/* ---------- drafting and sending ---------- */
export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
  confidence: EmailConfidence;
}

/** Puts a message in Drafts. Always allowed for an address with any provenance at all; never sends. */
export async function draftMail(mail: OutgoingMail): Promise<GmailSendResult> {
  if (!EMAIL_RULES[mail.confidence].canDraft) throw new Error(EMAIL_RULES[mail.confidence].note);
  return command<GmailSendResult>({ action: 'draft', to: mail.to, subject: mail.subject, body: mail.body });
}

/**
 * Sends one message. Refuses outright unless the campaign has sending switched on and the address is sourced —
 * a pattern guess is a lead to verify, never a recipient.
 */
export async function sendMail(mail: OutgoingMail, outreachId: string, mode: 'off' | 'draft' | 'send-verified'): Promise<GmailSendResult> {
  if (!mayEmail(mail.confidence, mode)) throw new Error(EMAIL_RULES[mail.confidence].note);
  const intentId = await issueIntent(mail.to, outreachId);
  const result = await command<GmailSendResult>({ action: 'send', to: mail.to, subject: mail.subject, body: mail.body, intentId });
  // Spend the intent whatever happened: if the click landed and the confirmation did not, a retry must not mail twice.
  await write(INTENT_KEY, null);

  await changeOutreach(outreachId, task => {
    if (!task) return task;
    if (!result.sent) return advance(task, 'sent', 'Send was pressed; Gmail showed no confirmation. Check your Sent folder.', Date.now());
    return { ...advance(task, 'sent', 'Sent through Gmail.', Date.now()), sentAt: Date.now() };
  });
  return result;
}

/* ---------- outcome sync ---------- */
export interface SyncReport {
  scanned: number;
  matched: number;
  events: number;
  stopped: number;
  needsConfirmation: number;
}

async function targets(campaignId: string): Promise<MatchTarget[]> {
  const [tasks, contacts, outreach] = await Promise.all([tasksFor(campaignId), allContacts(), allOutreach()]);
  const byContact = new Map(contacts.map(c => [c.id, c]));
  const out: MatchTarget[] = tasks.map(t => ({
    id: t.id,
    kind: 'application' as const,
    company: t.company,
    title: t.title,
    ...(hostOf(t.url) ? { domain: hostOf(t.url)! } : {}),
  }));
  for (const task of outreach) {
    const contact = byContact.get(task.contactId);
    if (!contact) continue;
    out.push({
      id: task.id,
      kind: 'contact',
      company: contact.companyName ?? '',
      ...(contact.email ? { contactEmail: contact.email } : {}),
      ...(task.threadId ? { threadId: task.threadId } : {}),
    });
  }
  return out;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

const EVENT_FOR: Partial<Record<MailClass, 'interview' | 'assessment' | 'rejected' | 'referral-offered' | 'reply'>> = {
  interview: 'interview',
  assessment: 'assessment',
  rejection: 'rejected',
  'referral-update': 'referral-offered',
  'info-request': 'reply',
};

/**
 * Reads the recent mail this product should look at, classifies it and records what it finds.
 *
 * Only a narrow slice is read: the person's own "Referral Scout" label where they made one, otherwise recent mail
 * from the addresses already in the campaign. The whole mailbox is never scanned.
 */
export async function syncOutcomes(options: { sinceDays?: number; label?: string } = {}): Promise<SyncReport> {
  const campaign = await activeCampaign();
  if (!campaign) throw new Error('Create a campaign first.');
  const me = await gmailIdentity();
  const known = await targets(campaign.id);
  const addresses = [...new Set(known.map(t => t.contactEmail).filter((e): e is string => !!e))];

  const query = searchQuery({
    ...((options.label ?? SCOUT_LABEL) ? { label: (options.label ?? SCOUT_LABEL).replace(/\s+/g, '-') } : {}),
    sinceDays: options.sinceDays ?? 14,
    ...(addresses.length ? { from: addresses.slice(0, 20) } : {}),
  });

  let scan = await command<GmailScanResult>({ action: 'scan', query });
  // A labelled search that finds nothing usually means the person never made the label, not that nothing arrived.
  if (!scan.threads.length && addresses.length)
    scan = await command<GmailScanResult>({
      action: 'scan',
      query: searchQuery({ sinceDays: options.sinceDays ?? 14, from: addresses.slice(0, 20) }),
    });

  const report: SyncReport = { scanned: scan.threads.length, matched: 0, events: 0, stopped: 0, needsConfirmation: 0 };
  const seen = new Map((await allThreads()).map(t => [t.gmailThreadId, t]));
  const now = Date.now();

  for (const row of scan.threads) {
    const existing = seen.get(row.threadId);
    // A conversation already confirmed by the person is not re-read; their judgement stands.
    if (existing?.classificationState === 'confirmed' && existing.lastMessageAt >= (row.at ?? 0)) continue;

    const thread = await command<GmailThreadResult>({ action: 'thread', threadId: row.threadId }).catch(() => undefined);
    const latest = thread?.messages.filter(m => !m.mine).at(-1);
    if (!latest) continue;

    const match = matchMessage(
      { threadId: row.threadId, from: latest.email ?? row.email ?? '', subject: row.subject, body: latest.text },
      known,
    );
    const verdict = classify({ subject: row.subject, body: latest.text, from: latest.email ?? row.email ?? '' });
    const bounced = isBounce({ subject: row.subject, body: latest.text, from: latest.email ?? row.email ?? '' });

    await saveThreads([
      {
        id: `thread:${row.threadId}`,
        gmailThreadId: row.threadId,
        participants: [me, latest.email ?? ''].filter(Boolean),
        subject: row.subject,
        lastMessageAt: latest.at ?? row.at ?? now,
        labels: [],
        classification: verdict.classification,
        confidence: verdict.confidence,
        classificationState: verdict.confidence >= 0.85 ? 'suggested' : 'unclassified',
        ...(match ? { linkedEntityId: match.target.id, linkedEntityKind: match.target.kind, matchBasis: match.basis } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
    ]);

    if (!match) continue;
    report.matched++;

    // Stop rules first: they are about whether to keep writing, not about what the message means.
    if (match.target.kind === 'contact') {
      const stop = bounced
        ? stopFor('bounce')
        : verdict.classification === 'auto-reply'
          ? stopFor('out-of-office', { ...(returnDate(latest.text, now) ? { returnAt: returnDate(latest.text, now)! } : {}) })
          : stopFor('reply');
      await changeOutreach(match.target.id, (task): OutreachTask | undefined => {
        if (!task) return task;
        const next = advance(task, stop.state, stop.reason, now);
        return stop.postponeUntil ? { ...next, nextFollowUpAt: stop.postponeUntil } : next;
      });
      report.stopped++;
      if (stop.suppressEverywhere) {
        const contact = (await allContacts()).find(c => c.id === match.target.id);
        if (contact) await suppressContact(contact.personKey, stop.reason, now);
      }
    }

    const eventType = bounced ? 'bounce' : EVENT_FOR[verdict.classification];
    if (!eventType) continue;
    const outcome = outcomeFor(verdict.classification, verdict.confidence);
    if (outcome.needsConfirmation) report.needsConfirmation++;
    await recordEvent({
      campaignId: campaign.id,
      entityId: match.target.id,
      entityKind: match.target.kind,
      type: eventType,
      company: match.target.company,
      ...(match.target.title ? { title: match.target.title } : {}),
      source: 'gmail',
      occurredAt: latest.at ?? now,
      // An email is a reading, not a fact. Only an unambiguous, non-consequential class is recorded as verified.
      confidence: outcome.autoApply ? 'verified' : outcome.needsConfirmation ? 'needs-confirmation' : 'suggested',
      note: `${match.basis} ${outcome.note}`.trim(),
    });
    report.events++;
  }
  return report;
}

/* ---------- messages ---------- */
export const gmailRequest = z.discriminatedUnion('action', [
  z.object({ kind: z.literal('gmail'), action: z.literal('connect') }),
  z.object({ kind: z.literal('gmail'), action: z.literal('status') }),
  z.object({ kind: z.literal('gmail'), action: z.literal('sync'), sinceDays: z.number().int().min(1).max(90).optional() }),
  z.object({
    kind: z.literal('gmail'),
    action: z.literal('draft'),
    to: z.email().max(320),
    subject: z.string().max(400),
    body: z.string().max(20000),
    confidence: z.enum(['verified', 'likely', 'unknown']),
  }),
  z.object({
    kind: z.literal('gmail'),
    action: z.literal('send'),
    outreachId: z.string().max(80),
    to: z.email().max(320),
    subject: z.string().max(400),
    body: z.string().max(20000),
    confidence: z.enum(['verified', 'likely', 'unknown']),
  }),
]);

export type GmailRequest = z.infer<typeof gmailRequest>;

async function handle(req: GmailRequest): Promise<unknown> {
  switch (req.action) {
    case 'connect':
      return { address: await gmailIdentity(true) };
    case 'status':
      return { connected: await gmailConnected(), address: await read<string>(IDENTITY_KEY) };
    case 'sync':
      return syncOutcomes(req.sinceDays !== undefined ? { sinceDays: req.sinceDays } : {});
    case 'draft':
      return draftMail({ to: req.to, subject: req.subject, body: req.body, confidence: req.confidence });
    case 'send': {
      const campaign = await activeCampaign();
      if (!campaign) throw new Error('Create a campaign first.');
      return sendMail(
        { to: req.to, subject: req.subject, body: req.body, confidence: req.confidence },
        req.outreachId,
        campaign.referral.emailMode,
      );
    }
  }
}

export function registerGmailMessages(): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    // The page asking permission to send. Only a real Gmail tab may ask, and only about the current intent.
    const auth = gmailAuthorize.safeParse(input);
    if (auth.success) {
      if (!trustedSite(sender, chrome.runtime.id) || !/^https:\/\/mail\.google\.com\//.test(sender.url ?? '')) {
        respond({ allowed: false });
        return false;
      }
      void authorizeSend(auth.data.id, auth.data.to, auth.data.claim)
        .then(allowed => respond({ allowed }))
        .catch(() => respond({ allowed: false }));
      return true;
    }
    if (!input || typeof input !== 'object' || (input as { kind?: unknown }).kind !== 'gmail') return false;
    const parsed = gmailRequest.safeParse(input);
    if (!parsed.success) {
      respond({ ok: false, error: 'That request was not understood.' });
      return false;
    }
    void handle(parsed.data)
      .then(data => respond({ ok: true, data }))
      .catch((e: unknown) => respond({ ok: false, error: e instanceof Error ? e.message : 'Gmail could not be reached.' }));
    return true;
  });
}
