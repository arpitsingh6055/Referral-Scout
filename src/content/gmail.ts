/**
 * Actions on Gmail pages.
 *
 * Mirrors `content/network.ts`: controls are found by role, label and Gmail's own accessibility hooks rather than
 * by generated class names; anything that sends asks the background for authorization immediately before the
 * click and verifies the result afterwards; anything unexpected stops rather than guessing.
 *
 * The send path is the one to read carefully. Between filling the fields and pressing Send it re-reads the
 * recipient off the page and sends that value back for approval, so the thing authorised is the thing on screen.
 * An address the person never approved can therefore never be mailed, even if the compose window was changed
 * underneath us.
 */

import { selectors } from '../shared/selectors.config';
import { gmailCommand, type GmailCommand, type GmailScanResult, type GmailSendResult, type GmailThreadResult } from '../shared/gmail';
import { signedInAddress, threadMessages, threadRows, textOf } from '../parsers/gmail';
import { canon, find, guard, insert, readEditor, sameText, send, sleep, visible, wait } from './dom';

let controller = new AbortController();
/** Intents already acted on in this tab, so a resent command can never send a second copy. */
const claimed = new Set<string>();

const g = selectors.gmail;

const one = (variants: readonly string[], root: ParentNode = document): HTMLElement | null => find(variants, root);

function required(variants: readonly string[], what: string, root: ParentNode = document): HTMLElement {
  const found = one(variants, root);
  if (!found) throw new Error(`Gmail's ${what} could not be found. Open Gmail in a normal tab and try again.`);
  return found;
}

/* ---------- identity ---------- */
async function identity(signal: AbortSignal): Promise<{ address: string }> {
  const address = await wait(() => signedInAddress(document) ?? null, signal, 15000).catch(() => undefined);
  if (!address) throw new Error('Could not tell which Google account is signed in. Open Gmail and make sure you are signed in.');
  return { address };
}

/* ---------- reading ---------- */
async function runSearch(query: string, signal: AbortSignal): Promise<void> {
  const box = required(g.search, 'search box') as HTMLInputElement;
  insert(box, query);
  await sleep(200, signal);
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  box.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  // The list repaints in place, so wait for rows rather than for navigation.
  await sleep(1200, signal);
}

async function scan(cmd: GmailCommand, signal: AbortSignal): Promise<GmailScanResult> {
  if (cmd.query) await runSearch(cmd.query, signal);
  // An empty result and a broken selector look identical in a snapshot, so wait for the list container itself and
  // only then accept that it holds no rows.
  await wait(() => document.querySelector('table[role="grid"], div[role="main"]'), signal, 15000);
  await sleep(600, signal);
  const rows = threadRows(document);
  return {
    threads: rows.map(r => ({
      threadId: r.threadId,
      from: r.from,
      ...(r.email ? { email: r.email } : {}),
      subject: r.subject,
      snippet: r.snippet,
      unread: r.unread,
      ...(r.at ? { at: r.at } : {}),
    })),
  };
}

async function openThread(cmd: GmailCommand, signal: AbortSignal): Promise<GmailThreadResult> {
  const { address } = await identity(signal);
  if (cmd.threadId) {
    const row = [...document.querySelectorAll('tr.zA')].find(r => {
      const id = r.getAttribute('data-legacy-thread-id') ?? r.getAttribute('data-thread-id') ?? '';
      return id.replace(/^thread-[fa]:/, '') === cmd.threadId;
    });
    if (!row) throw new Error('That conversation is not in the list on screen. Search for it first.');
    (row.querySelector('.y6, .bog, td') as HTMLElement | null)?.click();
    await sleep(1200, signal);
  }
  await wait(() => document.querySelector('.adn.ads, div[data-message-id]'), signal, 15000);
  // Gmail collapses long conversations; expanding gives the whole exchange rather than the first and last message.
  for (const more of document.querySelectorAll<HTMLElement>('[aria-label*="Show trimmed content" i], .ajR'))
    if (visible(more)) more.click();
  await sleep(400, signal);
  const messages = threadMessages(document, address);
  return {
    threadId: cmd.threadId,
    subject: textOf(document.querySelector('h2[data-thread-perm-id], .hP')),
    messages: messages.map(m => ({
      from: m.from,
      ...(m.email ? { email: m.email } : {}),
      mine: m.mine,
      text: m.text,
      ...(m.at ? { at: m.at } : {}),
    })),
  };
}

/* ---------- composing ---------- */
interface Compose {
  dialog: HTMLElement;
  to: HTMLElement;
  subject: HTMLElement;
  body: HTMLElement;
}

async function openCompose(signal: AbortSignal): Promise<Compose> {
  const existing = one(g.subject);
  if (!existing) {
    required(g.compose, 'Compose button').click();
    await sleep(900, signal);
  }
  const subject = await wait(() => one(g.subject), signal, 15000);
  const dialog = (subject.closest('div[role="dialog"]') ?? subject.closest('.nH') ?? document.body) as HTMLElement;
  return {
    dialog,
    to: required(g.to, 'recipient field', dialog),
    subject,
    body: required(g.body, 'message body', dialog),
  };
}

/**
 * Types the message and checks every field reads back as intended. Gmail's recipient field is a chip editor that
 * can silently drop or re-parse what is typed, which is exactly the failure that would mail the wrong person.
 */
async function fill(compose: Compose, cmd: GmailCommand, signal: AbortSignal): Promise<void> {
  insert(compose.to, cmd.to);
  await sleep(250, signal);
  // Committing the chip is what makes Gmail accept the address; without it the field can clear on blur.
  compose.to.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  await sleep(250, signal);

  insert(compose.subject, cmd.subject);
  await sleep(150, signal);
  insert(compose.body, cmd.body);
  await sleep(300, signal);
  guard(signal);

  if (!sameText(readEditor(compose.subject), cmd.subject))
    throw new Error('The subject did not go into Gmail correctly. Nothing was sent.');
  if (!sameText(readEditor(compose.body), cmd.body)) throw new Error('The message did not go into Gmail correctly. Nothing was sent.');
}

/** Reads the recipient back off the page, from the committed chip where there is one. */
function recipientOnPage(compose: Compose): string {
  const chip = compose.dialog.querySelector('[data-hovercard-id], span[email], div[role="option"][data-name]');
  const chipAddress = chip?.getAttribute('data-hovercard-id') ?? chip?.getAttribute('email') ?? '';
  const typed = readEditor(compose.to);
  const match = /[^\s<>,;]+@[^\s<>,;]+/.exec(chipAddress || typed);
  return (match?.[0] ?? '').toLowerCase();
}

async function authorize(cmd: GmailCommand, to: string, claim: boolean, signal: AbortSignal): Promise<void> {
  guard(signal);
  const reply: unknown = await send({ kind: 'gmail.authorize', id: cmd.intentId, to, claim });
  guard(signal);
  if (!reply || typeof reply !== 'object' || !('allowed' in reply) || reply.allowed !== true)
    throw new Error('This email is not authorized. It may have been paused, already sent, or the recipient changed.');
}

async function draft(cmd: GmailCommand, signal: AbortSignal): Promise<GmailSendResult> {
  const compose = await openCompose(signal);
  await fill(compose, cmd, signal);
  // Closing a filled compose window is what puts it in Drafts; nothing is sent.
  const close = one(g.close, compose.dialog) ?? one(['[aria-label*="Close" i]'], compose.dialog);
  close?.click();
  await sleep(600, signal);
  return { sent: false, evidence: 'Saved in your Gmail drafts.' };
}

async function sendMail(cmd: GmailCommand, signal: AbortSignal): Promise<GmailSendResult> {
  if (!cmd.intentId) throw new Error('This send was not authorized.');
  const compose = await openCompose(signal);
  await fill(compose, cmd, signal);

  // Approve the address that is actually in the window, not the one the command asked for.
  const onPage = recipientOnPage(compose);
  if (!onPage) throw new Error('Gmail has not accepted the recipient address. Nothing was sent.');
  if (onPage !== cmd.to.trim().toLowerCase()) throw new Error(`The recipient in Gmail is ${onPage}, not ${cmd.to}. Nothing was sent.`);
  await authorize(cmd, onPage, true, signal);

  const button = required(g.send, 'Send button', compose.dialog);
  button.click();

  // Gmail confirms with its own status message. No confirmation is not treated as failure: the mail may well have
  // gone, and saying otherwise would invite a second copy.
  const confirmed = await wait(
    () => {
      const alerts = [...document.querySelectorAll('[role="alert"], .bAq, .vh')].map(e => canon(textOf(e))).join(' ');
      return /message sent|sending|undo/i.test(alerts) ? alerts : null;
    },
    signal,
    12000,
  ).catch(() => undefined);

  if (!confirmed)
    return { sent: false, evidence: 'Send was pressed but Gmail showed no confirmation. Check your Sent folder before trying again.' };
  return { sent: true, evidence: confirmed.slice(0, 120) };
}

/* ---------- dispatch ---------- */
async function handle(cmd: GmailCommand, signal: AbortSignal): Promise<unknown> {
  guard(signal);
  if (cmd.action === 'identity') return identity(signal);
  if (cmd.action === 'scan') return scan(cmd, signal);
  if (cmd.action === 'thread') return openThread(cmd, signal);
  if (cmd.action === 'draft') return draft(cmd, signal);
  // One intent, one attempt. A resent command after a timeout must not produce a second email.
  if (claimed.has(cmd.intentId)) throw new Error('This email has already been attempted. Check your Sent folder in Gmail.');
  claimed.add(cmd.intentId);
  return sendMail(cmd, signal);
}

const installed = globalThis as typeof globalThis & { __referralScoutGmailV1?: boolean };
if (!installed.__referralScoutGmailV1 && chrome.runtime?.onMessage)
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || (sender.url && sender.url !== chrome.runtime.getURL('service-worker.js'))) return false;
    if (
      sender.origin &&
      !['chrome-extension://', 'extension://', 'edge-extension://'].some(prefix => sender.origin === prefix + chrome.runtime.id)
    )
      return false;
    if (input && typeof input === 'object' && 'kind' in input && input.kind === 'gmail.ping') {
      respond({ ok: true });
      return false;
    }
    if (input && typeof input === 'object' && 'kind' in input && input.kind === 'gmail.cancel') {
      controller.abort();
      controller = new AbortController();
      respond({ ok: true });
      return false;
    }
    const parsed = gmailCommand.safeParse(input);
    if (!parsed.success || parsed.data.deadline < Date.now() || parsed.data.deadline > Date.now() + 120000) return false;
    const cmd = parsed.data;
    const signal = controller.signal;
    void handle(cmd, signal)
      .then(data => respond({ requestId: cmd.requestId, ok: true, data }))
      .catch((e: unknown) => respond({ requestId: cmd.requestId, ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  });
installed.__referralScoutGmailV1 = true;
