import { visible } from './dom';
import { relationship } from './network';
import { pageItem, type PageItem } from './page-item';

/*
 * "Remember" button on LinkedIn profile and job pages.
 * Click it, optionally write why ("hiring APM interns, message once they accept"), press Save.
 * Nothing on LinkedIn is clicked or changed. The button lives in its own closed shadow root, built
 * with DOM calls only, and fixed to the bottom-left corner of the page.
 *
 * Ad blockers hide "suspicious" page overlays with generic rules such as `head ~ div[style*="z-index"]`
 * (a div directly under <html> with an inline z-index). So the host is not a div, carries no inline
 * style or id, sits in <body>, and gets its position from a stylesheet inside its own shadow root.
 * If something still hides it, it is moved once and the console says why.
 */
interface Saved extends PageItem {
  note: string;
  savedAt: number;
}
type Reply = { ok: true; saved: Saved | null } | { ok: false };

const ask = async (action: 'get' | 'save' | 'remove', item: PageItem & { note?: string }): Promise<Reply> => {
  try {
    const reply = (await chrome.runtime.sendMessage({ kind: 'network.remember', action, item: { note: '', ...item } })) as
      { saved?: Saved | null } | undefined;
    return reply ? { ok: true, saved: reply.saved ?? null } : { ok: false };
  } catch {
    return { ok: false };
  } // most often: the extension was reloaded and this tab still runs the old script
};

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
};
const FONT = "font:500 13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;box-sizing:border-box";

const host = document.createElement('referral-scout-remember');
const root = host.attachShadow({ mode: 'closed' });
const placement = new CSSStyleSheet(); // CSSOM only: page security policies that block inline styles do not apply
placement.replaceSync(':host{all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483000;display:block}');
root.adoptedStyleSheets = [placement];
const ui = make('div', 'display:none');
const box = make(
  'div',
  `${FONT};display:none;margin-bottom:8px;width:290px;background:#fff;color:#1d2226;border:1px solid #d0d7de;border-radius:12px;padding:12px;box-shadow:0 8px 28px rgba(0,0,0,.28)`,
);
const who = make('div', `${FONT};font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`);
const sub = make('div', `${FONT};color:#5e6b78;font-size:12px;margin:2px 0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`);
const field = make(
  'textarea',
  `${FONT};display:block;width:100%;height:74px;resize:none;border:1px solid #b9c2cc;border-radius:8px;padding:8px;background:#fff;color:#1d2226`,
);
field.maxLength = 300;
const status = make('div', `${FONT};min-height:16px;margin-top:6px;font-size:12px;color:#b3261e`);
const row = make('div', 'display:flex;justify-content:space-between;align-items:center;margin-top:6px');
const forget = make('button', `${FONT};border:0;background:transparent;color:#b3261e;cursor:pointer;padding:6px 4px`, 'Forget');
forget.type = 'button';
const save = make(
  'button',
  `${FONT};border:0;border-radius:999px;background:#0a66c2;color:#fff;cursor:pointer;padding:7px 16px;font-weight:600`,
  'Save',
);
save.type = 'button';
const pill = make(
  'button',
  `${FONT};display:inline-flex;align-items:center;gap:6px;border:0;border-radius:999px;background:#0a66c2;color:#fff;cursor:pointer;padding:10px 16px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.3)`,
);
pill.type = 'button';
// Job pages only: two more buttons. The search runs in the extension's own window; these only ask for it.
const PILL2 = `${FONT};display:block;border:1px solid #0a66c2;border-radius:999px;background:#fff;color:#0a66c2;cursor:pointer;padding:8px 14px;font-weight:600;margin-bottom:6px;box-shadow:0 4px 14px rgba(0,0,0,.2)`;
const jobRow = make('div', 'display:none');
const referralButton = (mode: 'referral' | 'connections', label: string): HTMLButtonElement => {
  const b = make('button', PILL2, label);
  b.type = 'button';
  b.addEventListener('click', () => {
    const job = current;
    if (!job || job.type !== 'job') return;
    if (!job.subtitle) {
      b.textContent = 'Could not read the company here. Open the job on its own page and try again.';
      setTimeout(() => {
        b.textContent = label;
      }, 6000);
      return;
    }
    b.textContent = 'Starting…';
    void chrome.runtime
      .sendMessage({
        kind: 'network.referral',
        mode,
        job: {
          url: job.url,
          title: job.title,
          company: job.subtitle,
          location: job.location ?? '',
          ...(job.companyUrl ? { companyUrl: job.companyUrl } : {}),
          ...(job.suggested ? { suggested: job.suggested } : {}),
        },
      })
      .then((reply: { message?: string } | undefined) => {
        b.textContent = reply?.message ?? 'Open Referral Scout to see progress.';
      })
      .catch(() => {
        b.textContent = 'Refresh this LinkedIn tab and try again.';
      })
      .finally(() =>
        setTimeout(() => {
          b.textContent = label;
        }, 6000),
      );
  });
  return b;
};
jobRow.append(referralButton('referral', 'Ask for referrals'), referralButton('connections', 'My connections here'));
row.append(forget, save);
box.append(who, sub, field, status, row);
ui.append(box, jobRow, pill);
root.append(ui);
// LinkedIn listens for keys on the whole page (for example "/" jumps to search). Typing a note must stay inside the box.
for (const type of ['keydown', 'keyup', 'keypress']) box.addEventListener(type, e => e.stopPropagation());

let current: PageItem | null = null,
  saved: Saved | null = null,
  shownKey = '',
  shownUrl = '';

function paint(): void {
  ui.style.display = current ? 'block' : 'none';
  if (!current) {
    box.style.display = 'none';
    return;
  }
  const noun = current.type === 'job' ? 'job' : 'person';
  jobRow.style.display = current.type === 'job' ? 'block' : 'none'; // always offered on a job; a missing company is explained on click
  pill.textContent = saved ? '✓ Remembered · edit note' : `＋ Remember this ${noun}`;
  pill.style.background = saved ? '#1a7f4b' : '#0a66c2';
  who.textContent = current.title;
  sub.textContent = current.subtitle;
  field.placeholder =
    current.type === 'job'
      ? 'Note, e.g. applied on the website, ask for a referral at this company'
      : 'Note, e.g. hiring APM interns at their company, message once they accept';
  forget.style.display = saved ? 'inline' : 'none';
}
const openBox = (open: boolean): void => {
  box.style.display = open ? 'block' : 'none';
  if (open) {
    status.textContent = '';
    field.focus();
  }
};

pill.addEventListener('click', () => {
  if (current) openBox(box.style.display === 'none');
});
save.addEventListener('click', async () => {
  if (!current) return;
  const item = current;
  save.disabled = true;
  status.textContent = '';
  const reply = await ask('save', { ...item, note: field.value.trim() });
  save.disabled = false;
  if (!reply.ok || !reply.saved) {
    status.textContent = 'Could not save. Refresh this LinkedIn tab and try again.';
    return;
  }
  saved = reply.saved;
  paint();
  openBox(false);
});
forget.addEventListener('click', async () => {
  if (!current) return;
  const reply = await ask('remove', current);
  if (!reply.ok) {
    status.textContent = 'Could not remove. Refresh this LinkedIn tab and try again.';
    return;
  }
  saved = null;
  field.value = '';
  paint();
  openBox(false);
});

const parents = (): Element[] => [document.body, document.documentElement].filter((e): e is HTMLElement => !!e);
let triedOther = false,
  warned = false;
/** Keeps the host attached, and if the page or another extension hides it, tries the other place once and then says so in the console. */
function keepVisible(): void {
  if (!host.isConnected) parents()[0]?.append(host);
  if (!current || ui.style.display === 'none') return;
  const r = host.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) return;
  const other = parents().find(p => p !== host.parentElement);
  if (!triedOther && other) {
    triedOther = true;
    other.append(host);
    return;
  }
  if (!warned) {
    warned = true;
    console.warn(
      '[Referral Scout] The Remember button is being hidden by the page or by another extension (an ad blocker?). Allow this extension, or turn the blocker off for linkedin.com.',
    );
  }
}
// LinkedIn changes pages without reloading, so look again every second and only act when something changed.
async function look(): Promise<void> {
  keepVisible();
  const item = pageItem(document, location.href, { visible, relation: relationship });
  const key = item ? `${item.url}|${item.title}|${item.relation ?? ''}` : '';
  if (key === shownKey) return;
  const newPage = !item || item.url !== shownUrl;
  shownKey = key;
  current = item;
  if (newPage) {
    shownUrl = item?.url ?? '';
    saved = null;
    field.value = '';
    openBox(false);
  }
  if (item && newPage) {
    // "get" also lets the extension notice that a remembered person has since accepted
    const reply = await ask('get', item);
    if (shownKey !== key) return;
    saved = reply.ok ? reply.saved : null;
    field.value = saved?.note ?? '';
  }
  paint();
}
const installed = globalThis as typeof globalThis & { __referralScoutRemember?: boolean };
if (!installed.__referralScoutRemember && location.hostname.endsWith('linkedin.com') && window.top === window) {
  installed.__referralScoutRemember = true;
  parents()[0]?.append(host);
  console.info('[Referral Scout] Remember button is active on this tab.');
  setInterval(() => {
    void look();
  }, 1000);
  void look();
}
