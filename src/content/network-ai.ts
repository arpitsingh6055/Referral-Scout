/** Visible, main-frame ChatGPT DOM bridge. No API calls or page-context injection. */
import { z } from 'zod';
import { describeMismatch, find, guard, insert, readEditor, sameText, sleep, visible, wait } from './dom';
import { selectors } from '../shared/selectors.config';

const documentId = crypto.randomUUID();
const start = Date.now();
const requests = new Map<string, { chunks: string[]; total: number; state: string; text?: string; error?: string; running?: boolean; parentId?: string }>();
let lastComposer: Element | null = null;
let composerSince = 0;

const composer = () => find(selectors.chatgpt.composer);
export function chatGptReady(): boolean {
  const input = composer();
  if (input !== lastComposer || document.readyState !== 'complete') {
    lastComposer = input; composerSince = Date.now(); return false;
  }
  return !!input && input.isConnected && visible(input) && !input.hasAttribute('disabled') &&
    input.getAttribute('aria-disabled') !== 'true' && Date.now() - start >= 1800 && Date.now() - composerSince >= 1200;
}
const marker = (id: string) => `[REFERRAL_SCOUT_JOB:${id}]`;
const text = (e: HTMLElement): string => e.innerText || e.textContent || '';
const nodes = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)].filter(visible);
const userTurns = () => nodes('[data-message-author-role="user"], [data-turn="user"]');
const assistantTurns = () => nodes('[data-message-author-role="assistant"], [data-turn="assistant"]');
const outsideConversation = (e: Element) => !!e.closest('form, nav, aside, header, [contenteditable="true"]');
/** This ChatGPT build exposes almost no stable attributes, so also find our message by its job marker text. */
function markerElement(id: string): HTMLElement | null {
  const needle = marker(id), walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue?.includes(needle)) continue;
    const el = n.parentElement;
    if (el && !outsideConversation(el) && visible(el)) return el;
  }
  return null;
}
const turnFor = (id: string): HTMLElement | null => {
  const byAttribute = userTurns().find(e => text(e).includes(marker(id)));
  if (byAttribute) return byAttribute;
  const el = markerElement(id);
  return el ? el.closest<HTMLElement>('[data-message-author-role], [data-turn], article') ?? el : null;
};
const diagnose = (id: string): string =>
  `marker on page: ${text(document.body).includes(marker(id)) ? 'yes' : 'no'}; user turns found by attribute: ${userTurns().length}; assistant turns found by attribute: ${assistantTurns().length}`;
const errorPage = (): string | null => {
  if (/\/auth\/|\/login|\/challenge/.test(location.pathname) || find(selectors.chatgpt.challenge) || find(selectors.chatgpt.login)) return 'Sign in to ChatGPT or resolve its challenge in the visible tab.';
  if (/you.ve reached.*limit|usage cap|usage limit|try again later/i.test(text(document.body).slice(-3000))) return 'ChatGPT reports a usage limit. No retry was sent.';
  return null;
};
async function progress(id: string, stage: string, extra: { text?: string; error?: string } = {}): Promise<void> {
  const job = requests.get(id);
  if (job) { job.state = stage; if (extra.text !== undefined) job.text = extra.text; if (extra.error) job.error = extra.error; }
  await chrome.runtime.sendMessage({ kind: 'network.ai.event', id, documentId, stage, ...extra }).catch(() => undefined);
}
function relevantAssistant(user: HTMLElement): HTMLElement | null {
  // Only take the first assistant turn following OUR verified user turn, never an older response.
  const byAttribute = assistantTurns().find(a => !!(user.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) && !a.contains(user));
  if (byAttribute) return byAttribute;
  // Fallback without attributes: the reply is the next block after our message that carries JSON.
  for (let el: HTMLElement | null = user, depth = 0; el && el !== document.body && depth < 8; el = el.parentElement, depth++) {
    for (let sib = el.nextElementSibling as HTMLElement | null; sib; sib = sib.nextElementSibling as HTMLElement | null) {
      if (sib.matches('form') || sib.querySelector('form, [contenteditable="true"]')) return null;
      if (visible(sib) && text(sib).includes('{') && !text(sib).includes(marker(idOf(user)))) return sib;
    }
  }
  return null;
}
const idOf = (user: HTMLElement): string => /\[REFERRAL_SCOUT_JOB:([a-f0-9]{64})\]/.exec(text(user))?.[1] ?? '';
function replyValue(node: HTMLElement): string {
  const markdown = node.querySelector<HTMLElement>('.markdown, [data-message-content]');
  return text(markdown ?? node).replace(/^ChatGPT said:\s*/i, '').trim();
}
const OURS = '[REFERRAL_SCOUT_JOB:';
/** Empties the message box. Only ever used on text this extension typed itself. */
function clearComposer(editor: HTMLElement): void {
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) { insert(editor, ''); return; }
  const range = document.createRange(); range.selectNodeContents(editor);
  const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  document.execCommand('delete');
  if (readEditor(editor).trim()) { editor.replaceChildren(); editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })); }
}
const notSend = /dictate|voice|attach|add files|model|mode|stop|microphone|photo|search|think/i;
/** Send button inside the composer form. This ChatGPT build exposes almost no data-testid hooks, so fall back to aria-labels and the submit button. */
function sendButton(): HTMLElement | null {
  const direct = find(selectors.chatgpt.send);
  if (direct) return direct;
  const form = composer()?.closest('form') ?? document.querySelector('form[data-chatgpt-composer]');
  if (!form) return null;
  const buttons = [...form.querySelectorAll<HTMLElement>('button')].filter(visible);
  return buttons.find(b => /^\s*send\b/i.test(b.getAttribute('aria-label') ?? '')) ??
    buttons.find(b => b.getAttribute('type') === 'submit' && !notSend.test(b.getAttribute('aria-label') ?? '')) ?? null;
}
async function perform(id: string, prompt: string, parentId?: string): Promise<void> {
  const signal = new AbortController().signal;
  let clicked = false; // once Send was pressed, a failure may hide a real submission
  const full = `${marker(id)}\n${prompt}`;
  try {
    await progress(id, 'current_document_ready');
    await wait(() => chatGptReady() || turnFor(id), signal, 60000);
    if (errorPage()) throw new Error(errorPage()!);
    let user = turnFor(id);
    if (!user) {
      if(parentId){
        if(!turnFor(parentId))throw new Error('The original task conversation is not visible. Repair cannot be submitted in a different chat.');
      }else if(userTurns().length || assistantTurns().length)throw new Error('This ChatGPT conversation is not empty and does not contain this job. Open a fresh chat; nothing was submitted.');
      await wait(() => chatGptReady(), signal, 30000);
      await progress(id, 'composer_stable');
      const editor = composer();
      if (!editor) throw new Error('ChatGPT composer disappeared.');
      const leftover = readEditor(editor).trim();
      if (leftover) {
        // A prompt this extension typed earlier but never sent (ChatGPT restores unsent text) is safe to remove. Anything else belongs to the person.
        if (!leftover.includes(OURS)) throw new Error('ChatGPT has unsent text in its message box that this extension did not write. Send or delete it in ChatGPT, then try again.');
        clearComposer(editor); await sleep(400, signal);
        if (readEditor(composer() ?? editor).trim()) throw new Error('An earlier unsent prompt could not be cleared from ChatGPT. Delete the text in ChatGPT’s message box, then try again.');
      }
      insert(editor, full);
      await progress(id, 'prompt_inserted');
      // Rich editors re-render a long paste asynchronously. Poll for the complete text rather than
      // judging a single 250 ms snapshot, and compare whitespace-insensitively (paragraph breaks are
      // re-rendered as blank lines). Nothing is sent unless the complete prompt is really there.
      const verify = () => {
        const active = composer();
        return active && active.isConnected && sameText(readEditor(active), full) ? active : null;
      };
      await wait(verify, signal, 8000).catch(() => {
        const active = composer();
        const detail = active ? describeMismatch(readEditor(active), full) : 'composer not found';
        throw new Error(`The complete prompt did not survive ChatGPT hydration. It was NOT sent. (${detail})`);
      });
      await sleep(600, signal); // the editor must still hold the full text after it settles
      if (!verify()) throw new Error('The complete prompt did not survive ChatGPT hydration. It was NOT sent. (text changed after insertion)');
      await progress(id, 'insertion_verified');
      const send = await wait(() => {
        if (turnFor(id)) return { previousSend: true };
        if (!verify()) return null;
        const b = sendButton();
        return b && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true' ? b : null;
      }, signal, 15000).catch(() => {
        const labels = [...document.querySelectorAll<HTMLElement>('form[data-chatgpt-composer] button')].filter(visible).map(b => b.getAttribute('aria-label') || text(b).trim()).filter(Boolean).slice(0, 8).join(' | ');
        throw new Error(`ChatGPT Send button was not found or stayed disabled. Visible composer buttons: ${labels || 'none'}. The prompt was NOT sent.`);
      });
      if (send instanceof HTMLElement) {
        if (!verify()) throw new Error('Composer changed immediately before Send.');
        clicked = true;
        send.click();
        await progress(id, 'send_clicked');
        // Some ChatGPT layouts ignore a scripted click on the arrow. If the prompt is still sitting there after a few seconds, press Enter instead.
        await wait(() => turnFor(id) || !verify(), signal, 4000).catch(() => undefined);
        if (!turnFor(id) && verify()) {
          const active = composer()!; active.focus();
          for (const type of ['keydown', 'keypress', 'keyup'] as const) active.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          const form = active.closest('form'); await sleep(1500, signal);
          if (!turnFor(id) && verify() && form) form.requestSubmit?.();
        }
      }
      // The click alone is not proof of a submission.
      user = await wait(() => turnFor(id), signal, 30000).catch(() => { throw new Error(`Send result cannot be verified (${diagnose(id)}). Inspect the ChatGPT tab; do not retry blindly.`); });
    }
    await progress(id, 'user_turn_verified');
    let last = '', changed = Date.now(), began = Date.now(), streamingReported=false;
    while (Date.now() - began < 300000) {
      guard(signal);
      if (errorPage()) throw new Error(errorPage()!);
      const currentUser = turnFor(id);
      if (!currentUser) throw new Error('The verified user turn disappeared; conversation may have changed.');
      const reply = relevantAssistant(currentUser);
      const nowText = reply ? replyValue(reply) : '';
      if (nowText !== last) { last = nowText; changed = Date.now(); if (last && !streamingReported) {streamingReported=true;await progress(id, 'assistant_streaming');} }
      if (last && Date.now() - changed >= 2500 && !find(selectors.chatgpt.stop) && reply?.isConnected) {
        await progress(id, 'completion_verified');
        await progress(id, 'response_extracted', { text: last });
        return;
      }
      await sleep(500, signal);
    }
    throw new Error('ChatGPT response did not finish in the visible tab. The task remains resumable; no second prompt was sent.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Never leave our own unsent prompt behind: ChatGPT restores it in every new chat and it would block the next task.
    try { const box = composer(); if (box && readEditor(box).includes(OURS) && !turnFor(id)) clearComposer(box); } catch { /* best effort */ }
    await progress(id, clicked && /cannot be verified|disappeared|changed/i.test(message) ? 'uncertain' : 'failed', { error: message.slice(0, 1000) });
  }
}

const begin = z.object({ kind: z.literal('network.ai'), action: z.enum(['begin', 'part', 'execute', 'status']), id: z.string().regex(/^[a-f0-9]{64}$/), index: z.number().int().min(0).optional(), total: z.number().int().positive().max(500).optional(), parentId:z.string().regex(/^[a-f0-9]{64}$/).optional(), chunk: z.string().max(30000).optional() });
const secureSender = (sender: chrome.runtime.MessageSender) => sender.id === chrome.runtime.id && !sender.tab && (sender.frameId ?? 0) === 0 &&
  (!sender.url || sender.url === chrome.runtime.getURL('service-worker.js'));
if (window.top === window) chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  if (!secureSender(sender)) return false;
  if (input && typeof input === 'object' && 'kind' in input && input.kind === 'network.ai.ping') {
    respond({ ok: true, ready: chatGptReady(), documentId, url: location.href }); return false;
  }
  const parsed = begin.safeParse(input); if (!parsed.success) return false;
  const { id, action } = parsed.data;
  if (action === 'status') {
    const record = requests.get(id);
    const turn = turnFor(id), reply = turn ? relevantAssistant(turn) : null;
    const finished = !!reply && !find(selectors.chatgpt.stop) && !!replyValue(reply);
    respond({ state: record?.state ?? (turn ? 'submitted' : 'unknown'), text: record?.text, error: record?.error, documentId, foundUserTurn: !!turn,
      ...(finished && reply ? { replyText: replyValue(reply) } : {}) });
    return false;
  }
  if (action === 'begin') {
    if (!parsed.data.total) { respond({ ok: false }); return false; }
    const record = requests.get(id);
    if (!record || !record.running) requests.set(id, { chunks: Array(parsed.data.total).fill(''), total: parsed.data.total, state: 'receiving', ...(parsed.data.parentId?{parentId:parsed.data.parentId}:{}) });
    respond({ ok: true, documentId }); return false;
  }
  if (action === 'part') {
    const record = requests.get(id), i = parsed.data.index;
    if (!record || i === undefined || i >= record.total || parsed.data.chunk === undefined || record.running) { respond({ ok: false }); return false; }
    record.chunks[i] = parsed.data.chunk;
    respond({ ok: true, index: i, documentId }); return false;
  }
  const record = requests.get(id);
  if (!record || record.chunks.some(c => !c) || record.running) { respond({ ok: false, reason: 'Missing ordered chunks or job is already running' }); return false; }
  record.running = true;
  void perform(id, record.chunks.join(''),record.parentId);
  respond({ ok: true, state: 'running', documentId }); return false;
});

if (window.top === window) void chrome.runtime.sendMessage({ kind: 'network.ai.hello', documentId, url: location.href }).catch(() => undefined);
