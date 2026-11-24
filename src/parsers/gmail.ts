/**
 * Reading Gmail's pages.
 *
 * Pure functions over a DOM, so every rule here is tested against fixtures rather than against a live mailbox.
 * Nothing in this file clicks anything; `content/gmail.ts` does that.
 *
 * On classification: the rules below are deliberately literal, and they are allowed to return low confidence.
 * Getting this wrong is not a cosmetic error — silently marking an application "rejected" on a stray phrase hides
 * an opportunity the person was still in, and silently marking "interview" makes them think they have something
 * they do not. Anything under the threshold becomes a question instead of a status change (see domain/system.ts).
 */

import type { MailClass } from '../shared/domain/system';

const clean = (s: string | null | undefined): string => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export const textOf = (e: Element | null | undefined): string => clean((e as HTMLElement | null)?.innerText ?? e?.textContent ?? '');

/* ---------- the thread list ---------- */
export interface ThreadRow {
  /** Gmail's own thread id, which is what makes a conversation trackable across visits. */
  threadId: string;
  from: string;
  email?: string;
  subject: string;
  snippet: string;
  unread: boolean;
  /** The row's own timestamp title, e.g. "Mon, 24 Nov 2026, 14:02". Parsed where possible, kept raw regardless. */
  dateText: string;
  at?: number;
}

/** Gmail puts the thread id on the row or on a child; both spellings have been in use. */
export function threadIdOf(row: Element): string {
  const own = row.getAttribute('data-legacy-thread-id') ?? row.getAttribute('data-thread-id') ?? '';
  if (own) return own.replace(/^thread-[fa]:/, '');
  const child = row.querySelector('[data-legacy-thread-id], [data-thread-id]');
  const value = child?.getAttribute('data-legacy-thread-id') ?? child?.getAttribute('data-thread-id') ?? '';
  return value.replace(/^thread-[fa]:/, '');
}

export function threadRows(root: ParentNode): ThreadRow[] {
  const out: ThreadRow[] = [];
  for (const row of root.querySelectorAll('tr.zA')) {
    const threadId = threadIdOf(row);
    if (!threadId) continue;
    const senderCell = row.querySelector('.yW span[email], .yX span[email], span[email]');
    const dateCell = row.querySelector('.xW span[title], td.xW span, span[title]');
    const dateText = dateCell?.getAttribute('title') ?? textOf(dateCell);
    const parsed = Date.parse(dateText);
    out.push({
      threadId,
      from: clean(senderCell?.getAttribute('name') ?? textOf(senderCell)),
      ...(senderCell?.getAttribute('email') ? { email: senderCell.getAttribute('email')!.toLowerCase() } : {}),
      subject: textOf(row.querySelector('.bog, .y6 span')),
      snippet: textOf(row.querySelector('.y2')).replace(/^[\s-–—]+/, ''),
      // Gmail marks an unread row with the zE class; the bold styling that follows is generated.
      unread: row.classList.contains('zE'),
      dateText,
      ...(Number.isFinite(parsed) ? { at: parsed } : {}),
    });
  }
  return out;
}

/* ---------- an open conversation ---------- */
export interface MailMessage {
  from: string;
  email?: string;
  /** True when the signed-in person wrote it, which is how a reply is told from an echo of the original. */
  mine: boolean;
  text: string;
  dateText: string;
  at?: number;
}

/**
 * Reads the messages of the open conversation. `me` is the signed-in address, supplied by the caller rather than
 * guessed: deciding "mine" wrongly would turn the person's own sent mail into a reply and stop a sequence that
 * nobody ever answered.
 */
export function threadMessages(root: ParentNode, me: string): MailMessage[] {
  const out: MailMessage[] = [];
  const mine = me.toLowerCase();
  for (const block of root.querySelectorAll('.adn.ads, div[data-message-id]')) {
    const senderCell = block.querySelector('.gD[email], span[email]');
    const email = senderCell?.getAttribute('email')?.toLowerCase();
    const dateCell = block.querySelector('.g3[title], span[title][alt]');
    const dateText = dateCell?.getAttribute('title') ?? textOf(dateCell);
    const parsed = Date.parse(dateText);
    const body = block.querySelector('.a3s, .ii.gt');
    if (!senderCell && !body) continue;
    out.push({
      from: clean(senderCell?.getAttribute('name') ?? textOf(senderCell)),
      ...(email ? { email } : {}),
      mine: !!email && email === mine,
      text: quotedStripped(textOf(body)),
      dateText,
      ...(Number.isFinite(parsed) ? { at: parsed } : {}),
    });
  }
  return out;
}

/**
 * Drops the quoted original beneath a reply. Without this every reply "contains" the words of the message that
 * was sent, so a cheerful outreach line about an interview would classify the answer as an interview invitation.
 */
export function quotedStripped(text: string): string {
  const cut = text.search(/\bOn .{4,60}\b(wrote:|a écrit\s*:)|^\s*-{2,}\s*Original Message|^\s*>{1,}/im);
  return clean(cut > 0 ? text.slice(0, cut) : text);
}

/* ---------- who is signed in ---------- */
export function signedInAddress(root: ParentNode): string | undefined {
  const account = root.querySelector('a[aria-label*="Google Account" i], [aria-label*="Google Account" i]');
  const label = account?.getAttribute('aria-label') ?? '';
  const match = /\(([^)\s]+@[^)\s]+)\)/.exec(label) ?? /([^\s(]+@[^\s)]+)/.exec(label);
  return match?.[1]?.toLowerCase();
}

/* ---------- classification ---------- */
export interface Classification {
  classification: MailClass;
  confidence: number;
  /** The phrases that decided it, so the person can see why rather than being told a label. */
  signals: string[];
}

interface Rule {
  kind: MailClass;
  patterns: RegExp[];
  /** Weight per match. Terms that are near-conclusive on their own score higher. */
  weight: number;
}

/**
 * Checked in order, and the first group that fires decisively wins. Bounces and auto-replies come first because
 * they are the two that must never be read as a human answer: one would stop a sequence that was never delivered,
 * the other would stop one nobody has read.
 */
const RULES: Rule[] = [
  {
    kind: 'auto-reply',
    weight: 0.6,
    patterns: [
      /\bautomatic reply\b/i,
      /\bout of (the )?office\b/i,
      /\bauto[- ]?reply\b/i,
      /\bI am currently (away|out|on leave|on holiday)\b/i,
      /\bon (annual |parental |maternity |paternity )?leave until\b/i,
      /\bwill (be )?(back|return)(ing)? on\b/i,
    ],
  },
  {
    kind: 'rejection',
    weight: 0.45,
    patterns: [
      /\bnot (be )?(moving|taking|progressing) forward\b/i,
      /\bdecided to (proceed|move forward|continue) with other\b/i,
      /\bwe (have )?(decided|chosen) (not to|to go)\b/i,
      /\bunfortunately\b.{0,80}\b(application|candidacy|role|position)\b/i,
      /\byour application (was|has been) (unsuccessful|rejected)\b/i,
      /\bwe will not be (proceeding|progressing)\b/i,
      /\bkeep your (CV|resume|profile) on file\b/i,
    ],
  },
  {
    kind: 'interview',
    weight: 0.45,
    patterns: [
      /\b(schedule|book|arrange) (an?|the|your) (interview|call|chat|conversation)\b/i,
      /\binterview (invitation|invite)\b/i,
      /\binvite you (to|for) (an?|the) (interview|discussion|conversation)\b/i,
      /\bshare your availability\b/i,
      /\bwhat times? (work|suit)\b/i,
      /\b(calendly\.com|cal\.com\/|savvycal)/i,
      /\bnext round\b/i,
    ],
  },
  {
    kind: 'assessment',
    weight: 0.45,
    patterns: [
      /\b(online |coding |technical )?(assessment|aptitude test)\b/i,
      /\b(take[- ]home|case study|assignment)\b/i,
      /\b(hackerrank|codility|hackerearth|doselect|mettl|testgorilla)\b/i,
      /\bcomplete the (test|challenge|exercise)\b/i,
    ],
  },
  {
    kind: 'referral-update',
    weight: 0.45,
    patterns: [
      /\b(I|we) (have )?referred you\b/i,
      /\byour referral (has been|was) submitted\b/i,
      /\bemployee referral\b/i,
      /\breferral id\b/i,
      /\bput in a (good word|referral)\b/i,
    ],
  },
  {
    kind: 'info-request',
    weight: 0.4,
    patterns: [
      /\b(could|can) you (please )?(share|send|provide|confirm)\b/i,
      /\bplease (share|send|provide|attach|confirm)\b/i,
      /\bwe (need|require)\b.{0,40}\b(details|documents|CV|resume)\b/i,
      /\b(notice period|current ctc|expected ctc|salary expectation)\b.{0,30}\?/i,
    ],
  },
];

const BOUNCE_SENDER = /\b(mailer-daemon|postmaster|no-?reply@.*(google|mail))\b/i;
const BOUNCE_BODY =
  /\b(address not found|delivery (status notification|has failed|incomplete)|undeliverable|could ?n[o']t be delivered|recipient .{0,20}(does not exist|rejected)|550[ -]5\.1\.1)\b/i;

/**
 * Reads one message. Returns `unknown` with low confidence rather than reaching for the nearest label — the
 * caller turns that into a question for the person, which is the right outcome for an ambiguous email.
 */
export function classify(input: { subject: string; body: string; from?: string }): Classification {
  const subject = clean(input.subject);
  const body = quotedStripped(clean(input.body));
  const haystack = `${subject}\n${body}`;
  const signals: string[] = [];

  // A bounce is a fact about delivery, not an opinion about the candidate, so it is decided on its own evidence.
  if (BOUNCE_SENDER.test(input.from ?? '') || BOUNCE_BODY.test(haystack)) {
    const hit = BOUNCE_BODY.exec(haystack)?.[0] ?? input.from ?? 'mailer-daemon';
    return { classification: 'unknown', confidence: 1, signals: [`bounce: ${hit}`] };
  }

  let best: { kind: MailClass; score: number; signals: string[] } | undefined;
  for (const rule of RULES) {
    const hits = rule.patterns.map(p => p.exec(haystack)?.[0]).filter((h): h is string => !!h);
    if (!hits.length) continue;
    // Two independent phrases are much stronger evidence than one, but no single rule reaches certainty alone.
    const score = Math.min(0.95, rule.weight + (hits.length - 1) * 0.25);
    if (!best || score > best.score) best = { kind: rule.kind, score, signals: hits.slice(0, 3) };
    // An auto-reply outranks everything: a holiday message quoting the original must not read as a real answer.
    if (rule.kind === 'auto-reply') {
      best = { kind: 'auto-reply', score: Math.max(0.9, score), signals: hits.slice(0, 3) };
      break;
    }
  }
  if (!best) return { classification: 'unknown', confidence: 0, signals: [] };
  signals.push(...best.signals);
  return { classification: best.kind, confidence: Number(best.score.toFixed(2)), signals };
}

export const isBounce = (input: { subject: string; body: string; from?: string }): boolean =>
  classify(input).signals.some(s => s.startsWith('bounce:'));

/** The date an out-of-office says they are back, so a follow-up waits rather than being thrown away. */
export function returnDate(body: string, now = Date.now()): number | undefined {
  const m =
    /\b(?:back|return(?:ing)?|available again)\s+(?:on|from)?\s*(\d{1,2}(?:st|nd|rd|th)?\s+\w+(?:\s+\d{4})?|\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2})/i.exec(
      body,
    ) ??
    /\buntil\s+(\d{1,2}(?:st|nd|rd|th)?\s+\w+(?:\s+\d{4})?|\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2})/i.exec(body);
  if (!m?.[1]) return undefined;
  const cleaned = m[1].replace(/(\d+)(st|nd|rd|th)/i, '$1');
  const year = new Date(now).getFullYear();
  const parsed = Date.parse(/\d{4}/.test(cleaned) ? cleaned : `${cleaned} ${year}`);
  if (!Number.isFinite(parsed)) return undefined;
  // A date that has already passed was meant for next year, not last.
  return parsed < now - 86_400_000 ? Date.parse(`${cleaned} ${year + 1}`) || undefined : parsed;
}

/* ---------- matching a message to what we are tracking ---------- */
export interface MatchTarget {
  id: string;
  kind: 'application' | 'contact';
  company: string;
  title?: string;
  /** The employer's domain, which is the strongest signal a message is about them. */
  domain?: string;
  contactEmail?: string;
  threadId?: string;
}

export interface MatchResult {
  target: MatchTarget;
  confidence: number;
  basis: string;
}

/**
 * Ties an incoming message to an application or a contact. Ordered strongest first: a thread id we recorded, then
 * the exact address we wrote to, then the employer's domain, then the company name in the subject. A name alone is
 * weak evidence and is scored that way, because "Microsoft" appears in a great deal of mail that is not from them.
 */
export function matchMessage(
  message: { threadId?: string; from?: string; subject: string; body: string },
  targets: readonly MatchTarget[],
): MatchResult | undefined {
  const from = (message.from ?? '').toLowerCase();
  const domain = from.split('@')[1] ?? '';
  const subject = message.subject.toLowerCase();
  let best: MatchResult | undefined;

  const consider = (target: MatchTarget, confidence: number, basis: string): void => {
    if (!best || confidence > best.confidence) best = { target, confidence, basis };
  };

  for (const t of targets) {
    if (message.threadId && t.threadId && message.threadId === t.threadId) consider(t, 1, 'Same conversation we started.');
    if (t.contactEmail && from && t.contactEmail.toLowerCase() === from) consider(t, 0.95, `From ${t.contactEmail}.`);
    if (t.domain && domain && (domain === t.domain.toLowerCase() || domain.endsWith(`.${t.domain.toLowerCase()}`)))
      consider(t, 0.85, `Sent from ${domain}.`);
    const company = t.company.toLowerCase();
    if (company.length > 3 && subject.includes(company)) {
      const alsoTitle = t.title && subject.includes(t.title.toLowerCase());
      consider(t, alsoTitle ? 0.8 : 0.5, alsoTitle ? 'Company and role both named in the subject.' : 'Company named in the subject.');
    }
  }
  return best;
}
