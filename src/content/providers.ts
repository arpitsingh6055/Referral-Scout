import { selectors } from "../shared/selectors.config";
import { find, wait, insert, readEditor, sleep, guard } from "./dom";
import type { Command } from "../shared/commands";
export interface LlmStatus { state: "running" | "done" | "failed"; text: string; sources: string[]; error: string; notes: string[] }
export async function runProvider(cmd: Extract<Command, { kind: "llm.run" }>, signal: AbortSignal): Promise<LlmStatus> {
  const provider = location.hostname === "gemini.google.com" ? "gemini" : "chatgpt", s = selectors[provider];
  const notes: string[] = [];
  if (find(s.login)) throw new Error("Provider login wall");
  if (!cmd.repair && find(s.reply)) throw new Error("Fresh empty chat required");
  if (cmd.attachment && !cmd.repair) {
    if (provider !== "chatgpt") throw new Error("CV upload is supported through ChatGPT only");
    const input = document.querySelector<HTMLInputElement>(selectors.chatgpt.fileInput.join(","));
    if (!input) throw new Error("CV upload control unavailable. Paste your CV text in setup instead.");
    const bytes = Uint8Array.from(atob(cmd.attachment.base64), ch => ch.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], cmd.attachment.name, { type: cmd.attachment.mime }));
    input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    const name = cmd.attachment.name;
    await wait(() => [...document.querySelectorAll<HTMLElement>(selectors.chatgpt.attachment.join(","))].some(e => (e.innerText + " " + e.getAttribute("aria-label") + " " + e.getAttribute("title")).includes(name)), signal, 30000);
    await wait(() => !find(selectors.chatgpt.uploading), signal, 60000);
  }
  if (!cmd.repair && provider === "gemini") {
    const temp = find(s.temporary);
    if (temp) { temp.click(); await sleep(700, signal); } else notes.push("Temporary chat control unavailable; normal new chat used");
  }
  if (provider === "chatgpt" && cmd.search) {
    if (!find(selectors.chatgpt.searchOn)) {
      let search = find(selectors.chatgpt.search);
      if (!search) { find(selectors.chatgpt.tools)?.click(); await sleep(500, signal); search = find(selectors.chatgpt.search); }
      if (!search) throw new Error("HALT: Critical Search toggle missing"); search.click();
      await wait(() => find(selectors.chatgpt.searchOn), signal, 5000);
    }
  }
  const editor = await wait(() => find(s.composer), signal);
  if (readEditor(editor).trim()) throw new Error("Composer is not empty");
  const previous = [...document.querySelectorAll(s.reply[0])].length;
  insert(editor, cmd.prompt); await sleep(500, signal); guard(signal);
  const send = find(s.send);
  if (send && !send.hasAttribute("disabled") && send.getAttribute("aria-disabled") !== "true") send.click();
  else editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  const started = Date.now(); let last = "", changed = started, first = false;
  while (Date.now() - started < cmd.total) {
    await sleep(500, signal);
    const body = document.body.innerText;
    if (/you.ve reached.*limit|usage limit|try again later/i.test(body)) throw new Error("Provider usage cap");
    let nodes: HTMLElement[] = [];
    for (const selector of s.reply) { nodes = [...document.querySelectorAll<HTMLElement>(selector)]; if (nodes.length) break; }
    const node = nodes.at(-1), value = nodes.length > previous ? node?.innerText.trim() ?? "" : "";
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
