/**
 * The contract between the background and the Gmail page.
 *
 * Gmail is driven through the DOM in the person's own signed-in tab, the same way LinkedIn is, rather than through
 * OAuth and the Gmail API. That is a deliberate departure from the written specification: Gmail's read scopes are
 * restricted, so an API build cannot ship publicly without a third-party security assessment and an annual
 * re-review. DOM control needs no such grant, uses the session the person is already in, and keeps the product's
 * promise that nothing leaves the machine.
 *
 * What it costs: Gmail's markup moves, and the product has no message ids or labels except the ones visible on the
 * page. Everything below is therefore written to fail loudly and stop, never to press on and guess — a selector
 * that has gone missing must look like a broken selector, not like an empty inbox.
 */

import { z } from 'zod';

export const gmailCommand = z.object({
  kind: z.literal('gmail.page'),
  requestId: z.uuid(),
  deadline: z.number(),
  action: z.enum([
    /** Which address the person is signed in as. Everything else depends on knowing this. */
    'identity',
    /** Read the thread list for a search query. */
    'scan',
    /** Open one conversation and read its messages. */
    'thread',
    /** Compose and leave it in Drafts, without sending. */
    'draft',
    /** Compose and send, after the background authorises this exact recipient. */
    'send',
  ]),
  query: z.string().max(400).default(''),
  threadId: z.string().max(80).default(''),
  to: z.string().max(320).default(''),
  subject: z.string().max(400).default(''),
  body: z.string().max(20000).default(''),
  /** Names the approval the background issued for this one send. Never reused. */
  intentId: z.string().max(80).default(''),
});

export type GmailCommand = z.infer<typeof gmailCommand>;

export const gmailAuthorize = z.object({
  kind: z.literal('gmail.authorize'),
  id: z.string().max(80),
  to: z.string().max(320),
  claim: z.boolean(),
});
export type GmailAuthorize = z.infer<typeof gmailAuthorize>;

/** A Gmail search that finds only what this product should look at, rather than the whole mailbox. */
export function searchQuery(input: { label?: string; sinceDays?: number; from?: string[] }): string {
  const parts: string[] = [];
  if (input.label) parts.push(`label:${input.label}`);
  if (input.from?.length) parts.push(`(${input.from.map(f => `from:${f}`).join(' OR ')})`);
  if (input.sinceDays) parts.push(`newer_than:${Math.max(1, Math.round(input.sinceDays))}d`);
  parts.push('-in:chats');
  return parts.join(' ');
}

/** The label the person is asked to create, so outcome tracking reads a slice of the mailbox and not all of it. */
export const SCOUT_LABEL = 'Referral Scout';

export interface GmailIdentity {
  address: string;
}

export interface GmailScanResult {
  threads: {
    threadId: string;
    from: string;
    email?: string;
    subject: string;
    snippet: string;
    unread: boolean;
    at?: number;
  }[];
}

export interface GmailThreadResult {
  threadId: string;
  subject: string;
  messages: { from: string; email?: string; mine: boolean; text: string; at?: number }[];
}

export interface GmailSendResult {
  sent: boolean;
  threadId?: string;
  /** What the page showed afterwards, so an unconfirmed send can be described honestly. */
  evidence: string;
}
