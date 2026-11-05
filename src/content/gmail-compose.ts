import { selectors as s } from "../shared/selectors.config";
import { find, wait, insert, normalize, readEditor, guard, sleep } from "./dom";
import type { Command } from "../shared/commands";
type Compose = Extract<Command, { kind: "gmail.fill" | "gmail.send" }>;
async function compose(cmd: Compose, signal: AbortSignal, fill: boolean): Promise<HTMLElement> {
  if (cmd.reply && !find(s.gmail.body)) { const reply = await wait(() => find(s.gmail.reply), signal); reply.click(); }
  const editor = await wait(() => find(s.gmail.body), signal);
  const root = editor.closest<HTMLElement>('[role="dialog"]') ?? editor.closest<HTMLElement>("form") ?? editor.closest<HTMLElement>(".M9") ?? editor.parentElement;
  if (!root) throw new Error("HALT: Critical compose container missing");
  const from = find(s.gmail.from, root);
  const fromText = from instanceof HTMLInputElement || from instanceof HTMLSelectElement ? from.value : from?.getAttribute("email") || from?.innerText || "";
  const matches = fromText.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  if (matches.length !== 1 || matches[0]?.toLowerCase() !== cmd.from.toLowerCase()) throw new Error("HALT: From address missing or mismatched; expose Gmail's From field");
  const recipients = [...root.querySelectorAll<HTMLElement>('[email], input[name="to"], input[name="cc"], input[name="bcc"]')]
    .filter(e => !e.closest('[name="from"], .az2') && !editor.contains(e))
    .map(e => e.getAttribute("email") || (e instanceof HTMLInputElement ? e.value : "")).filter(v => v.includes("@"));
  if (!recipients.length || recipients.some(v => v.trim().toLowerCase() !== cmd.to.toLowerCase())) throw new Error("HALT: Recipient mismatch or unreadable recipient chips");
  const subject = find(s.gmail.subject, root);
  if (!cmd.reply && (!subject || readEditor(subject) !== cmd.subject)) throw new Error("HALT: Subject mismatch");
  if (fill && normalize(readEditor(editor)) !== normalize(cmd.body)) insert(editor, cmd.body);
  if (normalize(readEditor(editor)) !== normalize(cmd.body)) throw new Error("HALT: Body verification failed");
  return root;
}
export async function fillCompose(cmd: Compose, signal: AbortSignal): Promise<unknown> {
  await compose(cmd, signal, true); await sleep(1000, signal); return { filled: true };
}
export async function sendCompose(cmd: Compose, signal: AbortSignal): Promise<unknown> {
  const root = await compose(cmd, signal, false); guard(signal);
  if (cmd.kind !== "gmail.send") throw new Error("Missing send authorization");
  const permission: unknown = await chrome.runtime.sendMessage({ kind: "send.authorize", requestId: crypto.randomUUID(), sendId: cmd.sendId });
  if (!permission || typeof permission !== "object" || !("allowed" in permission) || permission.allowed !== true) throw new Error("HALT: Sending is no longer authorized");
  guard(signal);
  const send = find(s.gmail.send, root); if (!send || send.getAttribute("aria-disabled") === "true") throw new Error("HALT: Critical Send control unavailable");
  send.click();
  await wait(() => [...document.querySelectorAll(s.gmail.toast.join(","))].some(e => /message sent/i.test((e as HTMLElement).innerText)), signal, 15000);
  return { sent: true };
}
export async function draftSaved(signal: AbortSignal): Promise<unknown> {
  await wait(() => [...document.querySelectorAll(s.gmail.saved.join(","))].some(e => /draft saved|saved to drafts|all changes saved/i.test((e as HTMLElement).innerText)), signal, 30000);
  return { saved: true };
}
