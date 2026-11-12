/**
 * LinkedIn messaging, one conversation open. When the other person is someone this extension asked for a referral,
 * their conversation is kept in step quietly, and one button offers to draft the next reply with ChatGPT.
 * The draft is only placed in the message box: the person edits it, adds any attachment, and presses Send themselves.
 *
 * Checked on the live page, 12 November 2026: the header link `a.msg-thread__link-to-profile` (an encoded member id,
 * not the profile's own address), the name in `.msg-entity-lockup__entity-title`, one `.msg-s-event-listitem` per
 * message with `--other` on those from the other person, and the box `.msg-form__contenteditable`.
 */
import { insert, readEditor } from './dom';

export interface ThreadMessage {
  mine: boolean;
  text: string;
}
const textOf = (e: Element | null | undefined): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Who the open conversation is with, and what has been said, oldest first. Null when no single conversation is open. */
export function readThread(doc: ParentNode, path: string): { id: string; name: string; messages: ThreadMessage[] } | null {
  if (!path.startsWith('/messaging/thread/')) return null;
  const name = textOf(doc.querySelector('.msg-entity-lockup__entity-title'));
  const id =
    /\/in\/([^/?#]+)/.exec(doc.querySelector<HTMLAnchorElement>('a.msg-thread__link-to-profile')?.getAttribute('href') ?? '')?.[1] ?? '';
  if (!name || !id) return null;
  const messages: ThreadMessage[] = [];
  for (const item of doc.querySelectorAll('.msg-s-event-listitem')) {
    const text = textOf(item.querySelector('.msg-s-event-listitem__body'));
    if (text) messages.push({ mine: !item.classList.contains('msg-s-event-listitem--other'), text: text.slice(0, 800) });
  }
  return { id, name: name.slice(0, 200), messages: messages.slice(-20) };
}

const FONT = "font:600 13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;box-sizing:border-box";
const host = document.createElement('referral-scout-reply');
const root = host.attachShadow({ mode: 'closed' });
const placement = new CSSStyleSheet(); // CSSOM only, so page rules against inline styles do not apply
placement.replaceSync(':host{position:fixed;left:24px;bottom:24px;z-index:2147483000;display:block}');
root.adoptedStyleSheets = [placement];
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.style.cssText = css;
  el.textContent = text;
  return el;
};
const wrap = make('div', 'display:none;max-width:280px');
const pill = make(
  'button',
  `${FONT};display:block;border:0;border-radius:999px;background:#0b57d0;color:#fff;cursor:pointer;padding:10px 16px;box-shadow:0 4px 14px rgba(0,0,0,.25)`,
);
const note = make(
  'div',
  `${FONT};font-weight:500;font-size:12px;color:#1a1f29;background:#fff;border-radius:10px;padding:8px 10px;margin-top:6px;display:none;box-shadow:0 2px 8px rgba(0,0,0,.18)`,
);
wrap.append(pill, note);
root.append(wrap);

const LABEL = 'Draft a reply with ChatGPT';
let shownFor = '',
  signature = '',
  busy = false,
  confirmReplace = false;
const say = (text: string): void => {
  note.textContent = text;
  note.style.display = text ? 'block' : 'none';
};
const box = (): HTMLElement | null => document.querySelector<HTMLElement>('.msg-form__contenteditable');

async function look(): Promise<void> {
  const thread = readThread(document, location.pathname);
  if (!thread) {
    wrap.style.display = 'none';
    shownFor = signature = '';
    return;
  }
  const now = `${thread.id}|${thread.messages.length}|${thread.messages.at(-1)?.text ?? ''}`;
  if (now === signature) return;
  signature = now;
  let ours = false;
  try {
    ours = !!((await chrome.runtime.sendMessage({ kind: 'network.thread', action: 'sync', ...thread })) as { ours?: boolean } | undefined)
      ?.ours;
  } catch {
    ours = false; // the extension was reloaded: the button comes back after the tab is refreshed
  }
  if (thread.id !== shownFor) {
    say('');
    confirmReplace = false;
    pill.textContent = LABEL;
  }
  shownFor = thread.id;
  wrap.style.display = ours ? 'block' : 'none';
}

pill.addEventListener('click', () => {
  if (busy) return;
  const thread = readThread(document, location.pathname),
    editor = box();
  if (!thread || !editor) return say('Open the conversation and try again.');
  if (readEditor(editor).trim() && !confirmReplace) {
    confirmReplace = true;
    return say('The message box already has text. Press again to replace it with a draft.');
  }
  confirmReplace = false;
  busy = true;
  pill.textContent = 'Drafting…';
  pill.style.opacity = '.7';
  say('Asking ChatGPT. This can take up to two minutes; you can keep reading.');
  void chrome.runtime
    .sendMessage({ kind: 'network.thread', action: 'draft', ...thread })
    .then((reply: { ok?: boolean; text?: string; error?: string } | undefined) => {
      const target = box();
      if (!reply?.ok || !reply.text) return say(reply?.error || 'No draft came back. Try again.');
      if (!target || readThread(document, location.pathname)?.id !== thread.id)
        return say('You moved to another conversation, so the draft was not placed.');
      insert(target, reply.text);
      say('Draft placed in the message box. Edit it, attach your CV if needed, and press Send yourself.');
    })
    .catch(() => say('The extension was reloaded. Refresh this tab and try again.'))
    .finally(() => {
      busy = false;
      pill.textContent = LABEL;
      pill.style.opacity = '1';
    });
});

const installed = globalThis as typeof globalThis & { __referralScoutReply?: boolean };
if (!installed.__referralScoutReply && location.hostname.endsWith('linkedin.com') && window.top === window) {
  installed.__referralScoutReply = true;
  pill.textContent = LABEL;
  (document.body ?? document.documentElement).append(host);
  setInterval(() => {
    void look();
  }, 1500);
}
