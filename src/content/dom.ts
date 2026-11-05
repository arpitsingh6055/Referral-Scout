import { selectors, siteForHost } from "../shared/selectors.config";
export const visible = (e: Element): boolean => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
export function find(variants: readonly string[], root: ParentNode = document): HTMLElement | null {
  for (const q of variants) { const e = [...root.querySelectorAll<HTMLElement>(q)].find(visible); if (e) return e; } return null;
}
export function guard(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Paused", "AbortError");
  const site = siteForHost(location.hostname); if (!site) throw new Error("HALT: Unrecognized site");
  if (find(selectors[site].challenge) || /checkpoint|challenge/.test(location.pathname)) throw new Error("HALT: CAPTCHA or checkpoint detected");
  if (find(selectors[site].login) && (site === "linkedin" || site === "gmail")) throw new Error("HALT: Signed out");
  const notices = [...document.querySelectorAll('[role="alert"], [role="alertdialog"], [role="status"]')].filter(visible).map(e => (e as HTMLElement).innerText).join(" ");
  if (/unusual activity|suspicious activity|sending limit|too many requests|rate limit|verify you are human/i.test(notices)) throw new Error("HALT: Site security or rate-limit warning");
}
export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  for (let left = ms; left > 0; left -= 250) { guard(signal); await new Promise(r => setTimeout(r, Math.min(left, 250))); }
}
export async function wait<T>(read: () => T | null | undefined | false, signal: AbortSignal, timeout = 20000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { guard(signal); const value = read(); if (value) return value; await sleep(250, signal); }
  throw new Error("Critical selector/state did not become ready");
}
export function insert(editor: HTMLElement, value: string): void {
  editor.focus();
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    const proto = editor instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(editor, value);
  } else {
    const range = document.createRange(); range.selectNodeContents(editor); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    document.execCommand("insertText", false, value);
  }
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  if (normalize(readEditor(editor)) !== normalize(value)) throw new Error("Text insertion verification failed");
}
export const normalize = (s: string) => s.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
export const readEditor = (e: HTMLElement) => e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement ? e.value : e.innerText;
