// @vitest-environment-options { "url": "https://www.linkedin.com/in/alex/" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const URL_ = 'https://www.linkedin.com/in/alex/', OWNER = 'https://www.linkedin.com/in/arpit45/';
let listener!: (input: unknown, sender: unknown, respond: (r: unknown) => void) => boolean | void;
let sendClicks = 0;

/** A minimal LinkedIn profile: Connect opens a dialog; Send flips the page to Pending. */
function page(dialogBody: string): void {
  sendClicks = 0;
  document.body.innerHTML = `<header><nav><a aria-label="View profile" href="${OWNER}"></a></nav></header><main><section id="top"><h1>Alex Example</h1><p class="text-body-medium break-words">Recruiter at Acme</p><div id="actions"><button id="connect">Connect</button></div></section></main>`;
  document.getElementById('connect')!.addEventListener('click', () => {
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = `<p>Invitation to connect with Alex</p>${dialogBody}`;
    document.body.append(dialog);
    dialog.querySelectorAll('button').forEach(b => {
      if (/^send/i.test(b.textContent ?? '')) b.addEventListener('click', () => {
        sendClicks++; dialog.remove();
        document.getElementById('actions')!.innerHTML = '<button>Pending</button>';
      });
    });
  });
}
async function run(noteMode: 'require' | 'preferred' | 'none', body = 'Hi Alex, would love to connect.') {
  const cmd = { kind: 'network.page', requestId: crypto.randomUUID(), deadline: Date.now() + 60000, action: 'connect', url: URL_, owner: OWNER, intentId: 'intent-1', body, noteMode };
  return new Promise<{ ok: boolean; data?: { state: string; noteSent?: boolean }; error?: string }>(resolve => listener(cmd, { id: 'abc', url: 'chrome-extension://abc/service-worker.js', origin: 'chrome-extension://abc' }, resolve as never));
}

beforeEach(async () => {
  vi.resetModules(); delete (globalThis as { __coldContactNetworkV1?: boolean }).__coldContactNetworkV1;
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get(this: HTMLElement) { return this.textContent ?? ''; } });
  vi.stubGlobal('chrome', { runtime: { id: 'abc', getURL: (p: string) => `chrome-extension://abc/${p}`, onMessage: { addListener: vi.fn() }, sendMessage: vi.fn().mockResolvedValue({ allowed: true }) } });
  await import('../src/content/network');
  listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]![0] as typeof listener;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it('"Use a note when available" sends without a note when LinkedIn offers no note field (free accounts run out of notes)', async () => {
  page('<button>Send without a note</button>');
  const reply = await run('preferred');
  expect(reply).toMatchObject({ ok: true, data: { state: 'pending', noteSent: false } });
  expect(sendClicks).toBe(1);
});

it('"Always require a note" refuses to send when no note can be written', async () => {
  page('<button>Send without a note</button>');
  const reply = await run('require');
  expect(reply.ok).toBe(false);
  expect(reply.error).toMatch(/No editable invitation note field/);
  expect(sendClicks).toBe(0);
});

it('writes the note into the field when LinkedIn offers one, and says the note was sent', async () => {
  page('<textarea maxlength="300"></textarea><button>Send</button>');
  const reply = await run('preferred');
  expect(reply).toMatchObject({ ok: true, data: { state: 'pending', noteSent: true } });
  expect(sendClicks).toBe(1);
});

it('stops with a clear reason when LinkedIn shows its weekly invitation limit', async () => {
  page('<p>You’ve reached the weekly invitation limit</p><button>Send</button>');
  const reply = await run('preferred');
  expect(reply.ok).toBe(false);
  expect(reply.error).toMatch(/weekly invitation limit/i);
  expect(sendClicks).toBe(0);
});
