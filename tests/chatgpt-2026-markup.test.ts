import { beforeEach, expect, it, vi } from 'vitest';

// The November 2026 ChatGPT build: no data-message-author-role, the marker split across spans, the answer in
// [data-response-body] [data-dil-response].
const ID = 'defbdb4459fdc7898012d8f013c9b3b2e15930beea9ddb78034caae868b1bad3';
beforeEach(() => {
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
  document.body.innerHTML = `
    <main>
      <div data-virtualized-turn>
        <h4 class="sr-only" data-conversation-role="user">You said:</h4>
        <div data-user-message-bubble="true"><div class="whitespace-pre-wrap"><p><span>[REFERRAL_SCOUT_JOB</span>:${ID}<span>]</span><br><span>You are filling in a job application form</span></p></div></div>
      </div>
      <div data-virtualized-turn>
        <div data-talvt-turn-state="complete"><div data-response-body="m1">
          <div class="thinking">Thought for 12 seconds</div>
          <div data-dil-response><p>{"fill":[],"files":[],"ask":[],"summary":"General Management Intern at NearBond"}</p></div>
        </div></div>
      </div>
    </main>
    <form data-chatgpt-composer><div contenteditable="true"></div></form>`;
});
it('finds our message and reads only the answer', async () => {
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: () => undefined }, sendMessage: async () => undefined, id: 'x' } });
  vi.resetModules();
  const { __test } = await import('../src/content/network-ai');
  const user = __test.turnFor(ID);
  expect(user?.hasAttribute('data-user-message-bubble')).toBe(true);
  expect(__test.userTurns().length).toBe(1);
  const reply = __test.relevantAssistant(user!);
  expect(reply?.hasAttribute('data-response-body')).toBe(true);
  expect(JSON.parse(__test.replyValue(reply!)).summary).toBe('General Management Intern at NearBond');
});

it('does not throw in the page when the extension was reloaded under an open tab', async () => {
  vi.stubGlobal('chrome', {});
  const { send } = await import('../src/content/dom');
  await expect(send({ kind: 'x' })).rejects.toThrow(/Extension context invalidated/);
});
