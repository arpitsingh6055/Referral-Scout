import { beforeEach, expect, it } from "vitest";
import { replyNodes, replyText } from "../src/content/providers";

beforeEach(() => { document.body.innerHTML = ""; });

it("captures the newest ChatGPT completed turn when older and fallback selectors coexist", () => {
  document.body.innerHTML = `
    <div data-talvt-turn-state="complete"><div data-message-author-role="assistant">Older answer</div></div>
    <div data-message-author-role="assistant"><div class="markdown">New search answer</div></div>
  `;
  const nodes = replyNodes([
    '[data-talvt-turn-state="complete"]',
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"]',
  ]);
  expect(replyText(nodes.at(-1)!, "chatgpt")).toBe("New search answer");
});

it("extracts the assistant portion from a ChatGPT turn wrapper", () => {
  document.body.innerHTML = `
    <div data-talvt-turn-state="complete">
      <div>You said: search request</div>
      <div>ChatGPT said:</div>
      <div data-message-author-role="assistant">{"name":"Example"}</div>
    </div>
  `;
  expect(replyText(document.querySelector("[data-talvt-turn-state]")!, "chatgpt"))
    .toBe('{"name":"Example"}');
});
