import { selectors } from "../shared/selectors.config";
import { find, wait, insert, readEditor, sleep, guard, normalize } from "./dom";
import type { Command } from "../shared/commands";
export interface LlmStatus { state: "running" | "done" | "failed"; text: string; sources: string[]; error: string; notes: string[] }
const elementText = (element: HTMLElement): string => element.innerText || element.textContent || "";
// Contenteditable editors normalize line breaks and may replace their DOM node.
// Match the current text, not the original node or its exact whitespace layout.
export const promptText = (text: string): string => normalize(text).replace(/\s+/g, ' ');
export function currentPromptEditor(composers: readonly string[], prompt: string): HTMLElement | null {
  const editor = find(composers);
  return editor?.isConnected && promptText(readEditor(editor)) === promptText(prompt) ? editor : null;
}
function visibleText(pattern: RegExp): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>("button, [role='button'], [role='menuitem'], [role='option']")]
    .find(element => element.getClientRects().length > 0 && pattern.test(element.innerText.trim())) ?? null;
}
async function configureThinking(
  provider: "gemini" | "chatgpt",
  signal: AbortSignal,
  notes: string[],
): Promise<void> {
  const config = selectors[provider];
  try {
    let control = find(config.thinking) ?? visibleText(/^(thinking|reasoning|thinking mode|reasoning mode)$/i);
    if (!control) {
      notes.push(`${provider} Thinking control unavailable; continuing with the provider default`);
      return;
    }
    const enabled = control.getAttribute("aria-pressed") === "true"
      || control.getAttribute("aria-checked") === "true"
      || control.getAttribute("data-state") === "on";
    if (!enabled) {
      control.click();
      await sleep(350, signal);
    }
    if (provider === "chatgpt") {
      const medium = find(config.thinkingMedium) ?? visibleText(/^medium$/i);
      if (medium) { medium.click(); notes.push("chatgpt Thinking set to Medium"); }
      else notes.push("chatgpt Thinking enabled; Medium level is unavailable for this account");
    } else notes.push("gemini Thinking enabled");
  } catch (error) {
    if (signal.aborted) throw error;
    notes.push(`${provider} Thinking could not be configured; continuing with the provider default`);
  }
}
export function replyText(node: HTMLElement, provider: "gemini" | "chatgpt"): string {
  const assistant = provider === "chatgpt"
    ? [...node.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"], .markdown, [data-message-content]')]
      .sort((a, b) => elementText(b).length - elementText(a).length)[0]
    : null;
  const text = (assistant ? elementText(assistant) : elementText(node)).trim();
  const marker = text.lastIndexOf("ChatGPT said:");
  return marker >= 0 ? text.slice(marker + "ChatGPT said:".length).trim() : text;
}
export function replyNodes(selectorsToUse: readonly string[]): HTMLElement[] {
  const unique = new Set<HTMLElement>();
  for (const selector of selectorsToUse) {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) unique.add(node);
  }
  return [...unique].sort((a, b) => {
    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}
export async function runProvider(cmd: Extract<Command, { kind: "llm.run" }>, signal: AbortSignal): Promise<LlmStatus> {
  const provider = location.hostname === "gemini.google.com" ? "gemini" : "chatgpt", s = selectors[provider];
  const notes: string[] = [];
  if (find(s.login)) throw new Error("Provider login wall");
  if (!cmd.repair && find(s.reply)) throw new Error("Fresh empty chat required");
  if (cmd.search) await configureThinking(provider, signal, notes);
  if (!cmd.repair && provider === "gemini") {
    const temp = find(s.temporary);
    if (temp) { temp.click(); await sleep(700, signal); } else notes.push("Temporary chat control unavailable; normal new chat used");
  }
  let editor: HTMLElement;
  try {
  editor = await wait(() => find(s.composer), signal);
  } catch (error) {
  throw new Error(`ChatGPT composer did not become ready: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (readEditor(editor).trim()) throw new Error("ChatGPT has an unsent draft. Open a fresh chat before continuing.");
  const previous = new Set(replyNodes(s.reply));
  insert(editor, cmd.prompt); await sleep(500, signal); guard(signal);
  const submitted = () => !!find(s.stop) || replyNodes(s.reply).some(node => !previous.has(node)) ||
    [...document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')].some(node => promptText(elementText(node)) === promptText(cmd.prompt));
  // If the user pressed Enter during insertion, consume that response without sending again.
  if (!submitted()) {
  const send = await wait(() => {
    if (submitted()) return { alreadySent: true as const };
    if (!currentPromptEditor(s.composer, cmd.prompt)) return null;
    const button = find(s.send);
    return button && !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true" ? button : null;
  }, signal, 15000).catch(() => { throw new Error('Could not verify the prompt and enabled Send button in ChatGPT. Your draft has been left in its input.'); });
  if (send instanceof HTMLElement) {
    guard(signal);
    if (!submitted()) {
      if (!currentPromptEditor(s.composer, cmd.prompt)) throw new Error('The ChatGPT draft changed before sending. It has been left untouched.');
      send.click();
    }
  }
  }
  await wait(submitted, signal, 20000).catch(() => { throw new Error('ChatGPT did not confirm submission. Check the visible chat before retrying; the extension did not send a second prompt.'); });
  await sleep(500, signal);
  const started = Date.now(); let last = "", changed = started, first = false;
  while (Date.now() - started < cmd.total) {
    await sleep(500, signal);
    const body = document.body.innerText;
    if (/you.ve reached.*limit|usage limit|try again later/i.test(body)) throw new Error("Provider usage cap");
    const nodes = replyNodes(s.reply);
    const node = [...nodes].reverse().find((candidate: HTMLElement) => !previous.has(candidate)) ?? (nodes.length ? nodes[nodes.length - 1] : null);
    const value = node && !previous.has(node) ? replyText(node, provider) : "";
    if (value) first = true;
    if (value !== last) { last = value; changed = Date.now(); }
    if (!first && Date.now() - started > cmd.first) throw new Error("First-token timeout");
    if (last && !find(s.stop) && Date.now() - changed >= 3000) {
      const sources = [...(node?.querySelectorAll<HTMLAnchorElement>('a[href^="http"]') ?? [])].map(a => a.href);
      return { state: "done", text: last.slice(0, 100000), sources, error: "", notes };
    }
  }
  throw new Error("Total reply timeout");
}
