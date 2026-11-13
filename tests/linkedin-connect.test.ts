// @vitest-environment-options { "url": "https://www.linkedin.com/in/alex/" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const URL_ = 'https://www.linkedin.com/in/alex/';
let listener!: (input: unknown, sender: unknown, respond: (r: unknown) => void) => boolean | void;
let sent: { note: string | null }[] = [];

/*
 * The real LinkedIn invitation flow (screenshots, November 2026):
 *   step 1  "Add a note to your invitation?"   [Add a note] [Send without a note]
 *   step 2  a NEW dialog with a 200-character box, [Cancel] and a [Send] that is disabled until text is typed
 *   when the monthly free notes are used up, step 2 is an upgrade offer with no box.
 */
function page(options: { notesLeft?: boolean; limitNotice?: boolean; connectUnderMore?: boolean } = {}): void {
  const { notesLeft = true, limitNotice = false, connectUnderMore = false } = options;
  // Some profiles show Follow first and keep Connect inside the More menu, which LinkedIn draws outside the top card.
  const actions = connectUnderMore
    ? '<button aria-label="Follow Alex Example">Follow</button><a href="/messaging/compose/">Message</a><button id="more">More</button>'
    : `<a id="connect" href="${URL_}" aria-label="Invite Alex Example to connect">Connect</a><button>More</button>`;
  sent = [];
  document.body.innerHTML = `<main><section><div componentkey="com.linkedin.sdui.profile.card.refXYZTopcard" class="i87k8o"><h2>Alex Example</h2><p hidden>· 1st</p><p>· ${connectUnderMore ? '3rd' : '2nd'}</p><p>Recruiter at Acme</p><p>Pune, India</p><p>·</p><p><a href="/in/alex/overlay/contact-info/">Contact info</a></p><div id="actions">${actions}</div></div><h2>People you may know</h2><a href="/in/other/" aria-label="Invite Other Person to connect">Connect</a></section></main>`;
  if (connectUnderMore) {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="menu" hidden><a role="menuitem">Send profile in a message</a><div role="menuitem" id="connect">Connect</div><a role="menuitem">Report Alex</a></div>',
    );
    const menu = document.querySelector('[role="menu"]')!;
    document.getElementById('more')!.addEventListener('click', () => menu.toggleAttribute('hidden'));
  }
  const dialog = (html: string): HTMLElement => {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.innerHTML = html;
    document.body.append(d);
    return d;
  };
  const finish = (d: HTMLElement, note: string | null): void => {
    sent.push({ note });
    d.remove();
    document.getElementById('actions')!.innerHTML =
      '<button aria-label="Pending, click to withdraw invitation sent to Alex Example">Pending</button>';
  };
  document.getElementById('connect')!.addEventListener('click', event => {
    event.preventDefault();
    document.querySelector('[role="menu"]')?.setAttribute('hidden', '');
    const first = dialog(
      `<h2>Add a note to your invitation?</h2><p>${limitNotice ? 'You’ve reached the weekly invitation limit' : 'Personalize your invitation to Alex Example by adding a note.'}</p><button id="add">Add a note</button><button id="plain">Send without a note</button>`,
    );
    first.querySelector('#plain')!.addEventListener('click', () => finish(first, null));
    first.querySelector('#add')!.addEventListener('click', () => {
      first.remove(); // LinkedIn swaps in a different dialog element
      if (!notesLeft) {
        const offer = dialog(
          '<h2>No free personalized invitations left</h2><p>Send unlimited invitations with Premium.</p><button aria-label="Dismiss">x</button>',
        );
        offer.querySelector('button')!.addEventListener('click', () => offer.remove());
        return;
      }
      const second = dialog(
        '<h2>Add a note to your invitation</h2><p>1 personalized invitations remaining for this month</p><textarea maxlength="200"></textarea><button id="cancel">Cancel</button><button id="send" disabled>Send</button>',
      );
      const box = second.querySelector('textarea')!,
        send = second.querySelector<HTMLButtonElement>('#send')!;
      box.addEventListener('input', () => {
        send.disabled = !box.value.trim();
      });
      send.addEventListener('click', () => finish(second, box.value));
      second.querySelector('#cancel')!.addEventListener('click', () => second.remove());
    });
  });
}
async function run(noteMode: 'require' | 'preferred' | 'none', body = 'Hi Alex, would love to connect.') {
  const cmd = {
    kind: 'network.page',
    requestId: crypto.randomUUID(),
    deadline: Date.now() + 60000,
    action: 'connect',
    url: URL_,
    intentId: crypto.randomUUID(),
    body,
    noteMode,
  };
  return new Promise<{ ok: boolean; data?: { state: string; noteSent?: boolean }; error?: string }>(resolve =>
    listener(cmd, { id: 'abc', url: 'chrome-extension://abc/service-worker.js', origin: 'chrome-extension://abc' }, resolve as never),
  );
}

beforeEach(async () => {
  vi.resetModules();
  delete (globalThis as { __referralScoutNetworkV1?: boolean }).__referralScoutNetworkV1;
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? '';
    },
  });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'abc',
      getURL: (p: string) => `chrome-extension://abc/${p}`,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue({ allowed: true }),
    },
  });
  await import('../src/content/network');
  listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]![0] as typeof listener;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('follows LinkedIn’s two-step dialog: Add a note, type into the new dialog, then Send with the note', async () => {
  page();
  const reply = await run('preferred', 'Hi Alex, I’m Arpit. Would love to connect in case there are relevant openings at Acme.');
  expect(reply).toMatchObject({ ok: true, data: { state: 'pending', noteSent: true } });
  expect(sent).toEqual([{ note: 'Hi Alex, I’m Arpit. Would love to connect in case there are relevant openings at Acme.' }]);
});

it('sends without a note when this month’s free notes are used up, instead of getting stuck on the upgrade offer', async () => {
  page({ notesLeft: false });
  const reply = await run('preferred');
  expect(reply).toMatchObject({ ok: true, data: { state: 'pending', noteSent: false } });
  expect(sent).toEqual([{ note: null }]);
}, 20000);

it('"Always require a note" sends nothing when no note can be written, and says why', async () => {
  page({ notesLeft: false });
  const reply = await run('require');
  expect(reply.ok).toBe(false);
  expect(reply.error).toMatch(/not offering a note field.*No invitation was sent/);
  expect(sent).toEqual([]);
}, 20000);

it('"No note" presses Send without a note straight away', async () => {
  page();
  expect(await run('none')).toMatchObject({ ok: true, data: { state: 'pending', noteSent: false } });
  expect(sent).toEqual([{ note: null }]);
});

it('stops with a clear reason when LinkedIn shows its weekly invitation limit', async () => {
  page({ limitNotice: true });
  const reply = await run('preferred');
  expect(reply.ok).toBe(false);
  expect(reply.error).toMatch(/weekly invitation limit/i);
  expect(sent).toEqual([]);
});

it('does not read the hidden "1st" label as already connected (the bug that skipped everyone)', async () => {
  page();
  const reply = await new Promise<{
    ok: boolean;
    data?: { page: string; problems: string[]; sample: { relationship: string; name: string }[] };
  }>(resolve =>
    listener(
      { kind: 'network.page', requestId: crypto.randomUUID(), deadline: Date.now() + 60000, action: 'selftest' },
      { id: 'abc', url: 'chrome-extension://abc/service-worker.js', origin: 'chrome-extension://abc' },
      resolve as never,
    ),
  );
  expect(reply.data).toMatchObject({ page: 'Profile', problems: [], sample: [{ relationship: 'not-connected', name: 'Alex Example' }] });
});

it('finds Connect under More when the profile shows Follow first, and sends from there', async () => {
  page({ connectUnderMore: true });
  const reply = await run('preferred', 'Hi Alex, would love to connect.');
  expect(reply).toMatchObject({ ok: true, data: { state: 'pending', noteSent: true } });
  expect(sent).toEqual([{ note: 'Hi Alex, would love to connect.' }]);
});

// A profile whose action bar (Connect/Follow) is injected after the page is already "complete", like the live SPA.
function bareProfile(actionsHtml: string): void {
  document.body.innerHTML = `<main><section><div componentkey="com.linkedin.sdui.profile.card.refXYZTopcard" class="i87k8o"><h2>Alex Example</h2><p hidden>· 1st</p><p>· 3rd</p><p>Recruiter at Acme</p><p><a href="/in/alex/overlay/contact-info/">Contact info</a></p><div id="actions">${actionsHtml}</div></div></section></main>`;
}
async function askRelationship() {
  const cmd = { kind: 'network.page', requestId: crypto.randomUUID(), deadline: Date.now() + 60000, action: 'relationship', url: URL_, intentId: crypto.randomUUID(), body: '', noteMode: 'preferred' };
  return new Promise<{ ok: boolean; data?: { state: string } }>(resolve =>
    listener(cmd, { id: 'abc', url: 'chrome-extension://abc/service-worker.js', origin: 'chrome-extension://abc' }, resolve as never),
  );
}

it('waits for the Connect button to render before judging, instead of calling it unknown', async () => {
  bareProfile(''); // no action bar yet, only the "· 3rd" degree
  setTimeout(() => {
    document.getElementById('actions')!.innerHTML = `<a href="${URL_}" aria-label="Invite Alex Example to connect">Connect</a><button>More</button>`;
  }, 800);
  const reply = await askRelationship();
  expect(reply).toMatchObject({ ok: true, data: { state: 'not-connected' } }); // found once it rendered
}, 12000);

it('reports follow-only only when LinkedIn truly offers no Connect, just Follow', async () => {
  bareProfile('<button aria-label="Follow Alex Example">Follow</button><button id="more">More</button>');
  document.body.insertAdjacentHTML('beforeend', '<div role="menu" hidden><a role="menuitem">Send profile in a message</a><a role="menuitem">Save to PDF</a></div>');
  const menu = document.querySelector('[role="menu"]')!;
  document.getElementById('more')!.addEventListener('click', () => menu.toggleAttribute('hidden'));
  const reply = await askRelationship();
  expect(reply).toMatchObject({ ok: true, data: { state: 'follow-only' } });
}, 12000);
