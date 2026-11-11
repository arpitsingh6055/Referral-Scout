import { selectors, siteForHost } from "../shared/selectors.config";
export const visible = (e: Element): boolean => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
export function find(variants: readonly string[], root: ParentNode = document): HTMLElement | null {
  for (const q of variants) { const e = [...root.querySelectorAll<HTMLElement>(q)].find(visible); if (e) return e; } return null;
}
/** LinkedIn draws its messaging window, and some dialogs, inside an open shadow root that document.querySelector cannot see. */
export function roots(): ParentNode[] {
  const found: ParentNode[] = [document];
  for (const host of document.querySelectorAll("#interop-outlet, [data-testid='interop-shadowdom']")) if (host.shadowRoot) found.push(host.shadowRoot);
  return found;
}
export function queryAll<T extends HTMLElement = HTMLElement>(selector: string): T[] { return roots().flatMap(r => [...r.querySelectorAll<T>(selector)]); }
export function guard(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Paused", "AbortError");
  const site = siteForHost(location.hostname); if (!site) throw new Error("HALT: Unrecognized site");
  if (find(selectors[site].challenge) || /checkpoint|challenge/.test(location.pathname)) throw new Error("HALT: CAPTCHA or checkpoint detected");
  if (site === "linkedin" && find(selectors.linkedin.login)) throw new Error("HALT: Signed out");
  const notices = queryAll('[role="alert"], [role="alertdialog"], [role="status"]').filter(visible).map(e => (e as HTMLElement).innerText).join(" ");
  if (/unusual activity|suspicious activity|sending limit|too many requests|rate limit|verify you are human/i.test(notices)) throw new Error("HALT: Site security or rate-limit warning");
  // LinkedIn shows its invitation quota as a dialog, not an alert.
  const dialogs = queryAll('[role="dialog"]').filter(visible).map(e => (e as HTMLElement).innerText).join(" ");
  if (/weekly invitation limit|reached the weekly|invitation limit/i.test(`${notices} ${dialogs}`)) throw new Error("HALT: LinkedIn weekly invitation limit reached");
  if (/unusual activity|verify you are human|too many requests/i.test(document.title)) throw new Error("HALT: Site restriction page");
}
export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  for (let left = ms; left > 0; left -= 250) { guard(signal); await new Promise(r => setTimeout(r, Math.min(left, 250))); }
}
export async function wait<T>(read: () => T | null | undefined | false, signal: AbortSignal, timeout = 20000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { guard(signal); const value = read(); if (value) return value; await sleep(250, signal); }
  throw new Error("Critical selector/state did not become ready");
}
/** Whitespace-insensitive form. Rich editors (ProseMirror, Gmail, LinkedIn) re-render newlines as
 * paragraphs, so innerText legitimately differs from the typed text in blank lines only. */
export const canon = (s: string): string => s.replace(/[\u200b-\u200d\u2060\ufeff]/g, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
/** Letters and digits only. Composer markdown can drop or restyle punctuation (#, *, -, backticks) without losing content. */
const core = (s: string): string => s.replace(/[^\p{L}\p{N}]+/gu, "");
export function sameText(actual: string, expected: string): boolean {
  if (canon(actual) === canon(expected)) return true;
  const a = core(actual), b = core(expected);
  return b.length > 0 && a === b;
}
/** Short, content-free description of how two texts differ, for diagnosable errors. */
export function describeMismatch(actual: string, expected: string): string {
  const a = canon(actual), b = canon(expected);
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `expected ${b.length} chars, editor holds ${a.length}, first difference at character ${i}`;
}
function pasteText(editor: HTMLElement, value: string): boolean {
  if (typeof DataTransfer === "undefined" || typeof ClipboardEvent === "undefined") return false;
  try {
    const data = new DataTransfer(); data.setData("text/plain", value);
    return !editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  } catch { return false; }
}
function selectAll(editor: HTMLElement): void {
  const range = document.createRange(); range.selectNodeContents(editor);
  // Inside a shadow root the selection belongs to that root (Chromium), not to the document.
  const root = editor.getRootNode() as Node & { getSelection?: () => Selection | null };
  const selection = root.getSelection?.() ?? getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
export function insert(editor: HTMLElement, value: string): void {
  editor.focus();
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    const proto = editor instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(editor, value);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  } else {
    const ok = () => sameText(readEditor(editor), value);
    // 1) The browser's own text insertion keeps framework editors (ProseMirror) in sync.
    selectAll(editor);
    if (typeof document.execCommand === "function") document.execCommand("insertText", false, value);
    // 2) A synthetic plain-text paste is what ProseMirror-style editors handle natively.
    if (!ok()) { selectAll(editor); pasteText(editor, value); }
    // 3) Last resort for simple contenteditables only. Frameworks may discard this, so callers still verify.
    if (!ok()) {
      editor.replaceChildren(...value.split("\n").flatMap((line, i) => i ? [document.createElement("br"), document.createTextNode(line)] : [document.createTextNode(line)]));
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
  }
}
export const normalize = (s: string) => s.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
export const readEditor = (e: HTMLElement) => e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement ? e.value : e.innerText;
