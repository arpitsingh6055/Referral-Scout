// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * Reproduces the live failure "The complete prompt did not survive ChatGPT hydration. It was NOT sent."
 * against a fake ChatGPT page that behaves like the real composer in the saved page:
 *  - a ProseMirror contenteditable (no #prompt-textarea, no data-testid hooks)
 *  - typed newlines are re-rendered as <p> paragraphs, which innerText reports as blank lines
 *  - Send only becomes enabled a moment after the text lands
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canon, describeMismatch, sameText } from '../src/content/dom';

const ID = 'a'.repeat(64);
const PROMPT = ['Return ONLY one JSON object.', '', '# Sources', '- LinkedIn: Associate Consultant, 2 years', '- CV: **Oracle OBDX**, WebLogic, `Podman`', '', 'Line with trailing words.'].join('\n');

type Mode = 'faithful' | 'drops-text';
let mode: Mode = 'faithful';
let shape: 'simple' | 'deep' | 'thinking' = 'simple'; // deep: no hooks, turns nested 14 levels; thinking: an empty block before the answer
let plainMarkup = false; // true: a ChatGPT build without data-message-author-role / data-turn hooks
let clicks = 0;
const events: { stage: string; text?: string; error?: string }[] = [];
let listener!: (input: unknown, sender: unknown, respond: (r: unknown) => void) => boolean | void;

function buildPage(): void {
  document.body.innerHTML = `
    <main><div id="thread"></div></main>
    <form data-chatgpt-composer>
      <div class="ProseMirror" contenteditable="true" role="textbox" aria-label="Ask ChatGPT"><p data-empty-paragraph="true"><br class="ProseMirror-trailingBreak"></p></div>
      <button type="button" aria-label="Dictate"></button>
      <button type="button" aria-label="Start Voice"></button>
    </form>`;
}
const editor = () => document.querySelector<HTMLElement>('.ProseMirror')!;

function installFakeBrowser(): void {
  // jsdom has no layout, no innerText and no execCommand. Emulate what Chrome + ProseMirror do.
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      const paragraphs = [...this.children].filter(c => c.tagName === 'P');
      return paragraphs.length ? paragraphs.map(p => p.textContent ?? '').join('\n\n') : this.textContent ?? '';
    },
  });
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: (_cmd: string, _ui: boolean, value: string) => {
      const lines = mode === 'drops-text' ? value.split('\n').slice(0, 2) : value.split('\n');
      const render = (el: HTMLElement) => el.replaceChildren(...lines.map(l => { const p = document.createElement('p'); p.textContent = l; return p; }));
      render(editor());
      // ProseMirror owns its DOM: foreign edits such as replaceChildren() are reverted, not kept.
      if (mode === 'drops-text') editor().replaceChildren = () => undefined;
      // Send is created/enabled only after the editor has re-rendered.
      setTimeout(() => {
        if (document.querySelector('[aria-label="Send prompt"]')) return;
        const send = document.createElement('button');
        send.type = 'button'; send.setAttribute('aria-label', 'Send prompt');
        send.addEventListener('click', () => {
          clicks++;
          const thread = document.querySelector('#thread')!;
          const bubble = document.createElement('div');
          if (!plainMarkup) bubble.setAttribute('data-message-author-role', 'user');
          bubble.textContent = editor().innerText;
          const nest = (el: HTMLElement): HTMLElement => { let out = el; if (shape === 'deep') for (let i = 0; i < 14; i++) { const w = document.createElement('div'); w.append(out); out = w; } return out; };
          const userTurn = document.createElement('div'); userTurn.className = 'turn'; userTurn.append(nest(bubble)); thread.append(userTurn);
          editor().replaceChildren();
          setTimeout(() => {
            const answer = document.createElement('div');
            if (!plainMarkup) answer.setAttribute('data-message-author-role', 'assistant');
            answer.innerHTML = shape === 'thinking' ? '<div class="markdown"></div><div><div class="markdown"><pre><span>json</span><button>Copy code</button><code>{"schemaVersion":2}</code></pre></div></div>'
              : shape === 'deep' ? '<h6 class="sr-only">ChatGPT said:</h6><div><pre><code>{"schemaVersion":2}</code></pre></div><button aria-label="Stop reading aloud">x</button>' : '<div class="markdown">{"schemaVersion":2}</div>';
            const botTurn = document.createElement('div'); botTurn.className = 'turn'; botTurn.append(nest(answer)); thread.append(botTurn);
          }, 300);
        });
        document.querySelector('form')!.append(send);
      }, 400);
      return true;
    },
  });
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
}

async function run(): Promise<void> {
  vi.resetModules();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'abc',
      getURL: (s: string) => `chrome-extension://abc/${s}`,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(async (m: { kind: string; stage?: string; text?: string; error?: string }) => { if (m.kind === 'network.ai.event') events.push({ stage: m.stage!, ...(m.text ? { text: m.text } : {}), ...(m.error ? { error: m.error } : {}) }); }),
    },
  });
  await import('../src/content/network-ai');
  listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0]![0] as typeof listener;
  const send = (msg: object) => { const reply = vi.fn(); listener({ kind: 'network.ai', id: ID, ...msg }, { id: 'abc' }, reply); return reply; };
  expect(send({ action: 'begin', total: 1 })).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  expect(send({ action: 'part', index: 0, chunk: PROMPT })).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  expect(send({ action: 'execute' })).toHaveBeenCalledWith(expect.objectContaining({ ok: true, state: 'running' }));
  await vi.advanceTimersByTimeAsync(40000);
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); events.length = 0; clicks = 0; mode = 'faithful'; plainMarkup = false; shape = 'simple'; buildPage(); installFakeBrowser(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it('sends a multi-paragraph prompt once and extracts the reply when ProseMirror re-renders newlines as paragraphs', async () => {
  await run();
  const stages = events.map(e => e.stage);
  expect(stages).toEqual(expect.arrayContaining(['prompt_inserted', 'insertion_verified', 'send_clicked', 'user_turn_verified', 'response_extracted']));
  expect(stages).not.toContain('failed');
  expect(clicks).toBe(1);
  expect(events.find(e => e.stage === 'response_extracted')?.text).toBe('{"schemaVersion":2}');
});

it('never clicks Send when the editor lost part of the prompt, and reports a retryable failure with a diagnosis', async () => {
  mode = 'drops-text';
  await run();
  const failed = events.find(e => e.stage === 'failed');
  expect(failed?.error).toMatch(/did not survive ChatGPT hydration\. It was NOT sent\./);
  expect(failed?.error).toMatch(/expected \d+ chars, editor holds \d+/);
  expect(events.map(e => e.stage)).not.toContain('uncertain');
  expect(clicks).toBe(0);
});

it('compares text whitespace-insensitively but still catches missing content', () => {
  expect(sameText('a\n\nb\n\n\nc', 'a\nb\nc')).toBe(true);
  expect(sameText('Title Item one', '# Title\n- Item one')).toBe(true);
  expect(sameText('a b', 'a b c')).toBe(false);
  expect(canon('  x \u00a0\n y ')).toBe('x y');
  expect(describeMismatch('abcX', 'abcY')).toContain('first difference at character 3');
});

it('still finds its own message and the reply when the page has no role attributes (the "cannot be verified" case)', async () => {
  plainMarkup = true;
  await run();
  const stages = events.map(e => e.stage);
  expect(stages).toEqual(expect.arrayContaining(['send_clicked', 'user_turn_verified', 'response_extracted']));
  expect(stages).not.toContain('uncertain');
  expect(clicks).toBe(1);
  expect(events.find(e => e.stage === 'response_extracted')?.text).toBe('{"schemaVersion":2}');
});

it('reads the reply by position when ChatGPT gives no hooks and nests its turns deeply, even with a stray Stop control on the page', async () => {
  plainMarkup = true; shape = 'deep';
  await run();
  expect(events.map(e => e.stage)).toEqual(expect.arrayContaining(['user_turn_verified', 'assistant_streaming', 'response_extracted']));
  expect(events.find(e => e.stage === 'response_extracted')?.text).toContain('{"schemaVersion":2}');
  expect(clicks).toBe(1);
});

it('reads the answer when an empty "thinking" block comes before it', async () => {
  shape = 'thinking';
  await run();
  expect(events.find(e => e.stage === 'response_extracted')?.text).toContain('{"schemaVersion":2}');
});
