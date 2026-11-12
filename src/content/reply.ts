/**
 * LinkedIn messaging. When the open conversation is with someone this extension invited or messaged, a small card
 * says so: which job they were asked about and what has happened since, with one button to draft the next reply
 * with ChatGPT. The draft is only placed in the message box; the person edits it, attaches what they want, and
 * presses Send themselves. For anyone else nothing is shown and nothing is kept.
 *
 * Checked on the live page, 12 November 2026 (the full /messaging/ page): the header link
 * `a.msg-thread__link-to-profile` holds LinkedIn's encoded member id, not the profile address; the name is in
 * `.msg-entity-lockup__entity-title`; each message is a `.msg-s-event-listitem`, with `--other` on the other
 * person's; the box is `.msg-form__contenteditable`. Chat windows on other pages use the same message markup inside
 * LinkedIn's messaging shadow root; their header has not been checked live.
 */
import { insert, queryAll, readEditor, visible } from './dom';

export interface ThreadMessage {
  mine: boolean;
  text: string;
}
export interface OpenThread {
  id: string;
  url?: string;
  name: string;
  messages: ThreadMessage[];
}
const textOf = (e: Element | null | undefined): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
const inPath = (href: string): string => /\/in\/([^/?#]+)/.exec(href)?.[1] ?? '';

/** Who a conversation is with and what has been said, oldest first, read from the page or from one chat window. */
export function readThread(scope: ParentNode, path: string, chatWindow = false): OpenThread | null {
  if (!chatWindow && !path.startsWith('/messaging/thread/')) return null;
  // On the full page only the conversation's own header link counts: the site's top bar links to your own profile.
  const links = [
    ...scope.querySelectorAll<HTMLAnchorElement>(
      chatWindow
        ? 'a.msg-thread__link-to-profile, header a[href*="/in/"], .msg-overlay-bubble-header a[href*="/in/"]'
        : 'a.msg-thread__link-to-profile',
    ),
  ];
  const slugs = links.map(a => inPath(a.getAttribute('href') ?? '')).filter(Boolean);
  // An encoded member id starts with "ACoA"; anything else is the person's own profile name.
  const id = slugs.find(s => /^ACoA/.test(s)) ?? '',
    own = slugs.find(s => !/^ACoA/.test(s));
  const name = textOf(scope.querySelector('.msg-entity-lockup__entity-title, .msg-overlay-bubble-header__title')) || textOf(links[0]);
  if (!name || (!id && !own)) return null;
  const messages: ThreadMessage[] = [];
  for (const item of scope.querySelectorAll('.msg-s-event-listitem')) {
    const text = textOf(item.querySelector('.msg-s-event-listitem__body'));
    if (text) messages.push({ mine: !item.classList.contains('msg-s-event-listitem--other'), text: text.slice(0, 800) });
  }
  return { id, ...(own ? { url: `https://www.linkedin.com/in/${own}/` } : {}), name: name.slice(0, 200), messages: messages.slice(-20) };
}
/** The conversation in front of the person: the open thread on the messaging page, otherwise the chat window in use. */
function current(): { thread: OpenThread; scope: ParentNode } | null {
  const page = readThread(document, location.pathname);
  if (page) return { thread: page, scope: document };
  const windows = queryAll('.msg-overlay-conversation-bubble').filter(
    b => visible(b) && !b.classList.contains('msg-overlay-conversation-bubble--is-minimized'),
  );
  const chosen =
    windows.find(b =>
      b.contains(b.getRootNode() instanceof ShadowRoot ? (b.getRootNode() as ShadowRoot).activeElement : document.activeElement),
    ) ?? windows.at(-1);
  const thread = chosen ? readThread(chosen, location.pathname, true) : null;
  return chosen && thread ? { thread, scope: chosen } : null;
}

interface Info {
  first: string;
  job: { title: string; company: string; url: string } | null;
  history: string;
}
const FONT = "font:500 13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;box-sizing:border-box";
const host = document.createElement('referral-scout-reply');
const root = host.attachShadow({ mode: 'closed' });
const placement = new CSSStyleSheet(); // CSSOM only, so page rules against inline styles do not apply
placement.replaceSync(':host{position:fixed;left:20px;bottom:20px;z-index:2147483000;display:block}');
root.adoptedStyleSheets = [placement];
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.style.cssText = css;
  el.textContent = text;
  return el;
};
const card = make(
  'div',
  `${FONT};display:none;width:290px;background:#fff;color:#1a1f29;border:1px solid #d5dbe5;border-radius:14px;padding:12px 14px;box-shadow:0 6px 22px rgba(0,0,0,.22)`,
);
const head = make('div', 'display:flex;align-items:center;gap:8px;margin-bottom:6px');
const badge = make('span', `${FONT};font-weight:800;font-size:11px;color:#fff;background:#0b57d0;border-radius:6px;padding:2px 6px`, 'RS');
const title = make('span', `${FONT};font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`);
const fold = make(
  'button',
  `${FONT};border:0;background:transparent;color:#586273;cursor:pointer;font-size:16px;line-height:1;padding:0 2px`,
  '–',
);
const why = make('div', `${FONT};margin-bottom:2px`);
const jobLink = make('a', `${FONT};color:#0b57d0;font-weight:600;text-decoration:none;display:none`);
const history = make('div', `${FONT};color:#586273;font-size:12px;margin:4px 0 10px`);
const pill = make(
  'button',
  `${FONT};font-weight:700;display:block;width:100%;border:0;border-radius:999px;background:#0b57d0;color:#fff;cursor:pointer;padding:9px 14px`,
);
const note = make('div', `${FONT};font-size:12px;color:#586273;margin-top:8px;display:none`);
const mini = make(
  'button',
  `${FONT};font-weight:800;display:none;border:0;border-radius:999px;background:#0b57d0;color:#fff;cursor:pointer;padding:9px 13px;box-shadow:0 4px 14px rgba(0,0,0,.25)`,
  'RS',
);
jobLink.target = '_blank';
jobLink.rel = 'noopener noreferrer';
fold.title = 'Make this smaller';
mini.title = 'Referral Scout: this is someone you asked for a referral';
head.append(badge, title, fold);
card.append(head, why, jobLink, history, pill, note);
root.append(card, mini);

const LABEL = 'Draft a reply with ChatGPT';
let shownFor = '',
  signature = '',
  ours = false,
  folded = false,
  busy = false,
  confirmReplace = false;
const say = (text: string): void => {
  note.textContent = text;
  note.style.display = text ? 'block' : 'none';
};
const paint = (): void => {
  card.style.display = ours && !folded ? 'block' : 'none';
  mini.style.display = ours && folded ? 'block' : 'none';
};
fold.addEventListener('click', () => {
  folded = true;
  paint();
});
mini.addEventListener('click', () => {
  folded = false;
  paint();
});

async function look(): Promise<void> {
  // LinkedIn rebuilds parts of the page as you move around; put the card back if it was dropped.
  if (!host.isConnected) (document.body ?? document.documentElement).append(host);
  const open = current();
  if (!open) {
    ours = false;
    shownFor = signature = '';
    return paint();
  }
  const { thread } = open,
    key = thread.id || thread.url || thread.name,
    now = `${key}|${thread.messages.length}|${thread.messages.at(-1)?.text ?? ''}`;
  if (now === signature) return;
  signature = now;
  let reply: { ours?: boolean; info?: Info } | undefined;
  try {
    reply = (await chrome.runtime.sendMessage({ kind: 'network.thread', action: 'sync', ...thread })) as typeof reply;
  } catch {
    reply = undefined; // the extension was reloaded: the card comes back after the tab is refreshed
  }
  if (key !== shownFor) {
    say('');
    confirmReplace = false;
    pill.textContent = LABEL;
  }
  shownFor = key;
  if (!!reply?.ours && !ours) console.info('[Referral Scout] This conversation is with someone on your list.');
  ours = !!reply?.ours;
  if (reply?.info) {
    const { first, job, history: line } = reply.info;
    title.textContent = `${first} is on your Referral Scout list`;
    why.textContent = job ? 'You reached out about:' : 'You reached out for general networking.';
    jobLink.style.display = job ? 'block' : 'none';
    if (job) {
      jobLink.textContent = `${job.title} · ${job.company} ↗`;
      jobLink.href = job.url;
    }
    history.textContent = line.charAt(0).toUpperCase() + line.slice(1);
  }
  paint();
}

pill.addEventListener('click', () => {
  if (busy) return;
  const open = current(),
    editor = open ? ((open.scope as ParentNode).querySelector<HTMLElement>('.msg-form__contenteditable') ?? null) : null;
  if (!open || !editor) return say('Open the conversation and try again.');
  const { thread } = open,
    key = thread.id || thread.url || thread.name;
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
      const again = current(),
        target = again ? ((again.scope as ParentNode).querySelector<HTMLElement>('.msg-form__contenteditable') ?? null) : null;
      if (!reply?.ok || !reply.text) return say(reply?.error || 'No draft came back. Try again.');
      if (!again || !target || (again.thread.id || again.thread.url || again.thread.name) !== key)
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
  console.info('[Referral Scout] Watching LinkedIn conversations on this tab.');
  setInterval(() => {
    void look();
  }, 1500);
}
