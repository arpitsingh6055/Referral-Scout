import { first, many, textOf } from "./linkedin";
import { selectors as s } from "../shared/selectors.config";
export interface MailRow { sender: string; subject: string; text: string; url: string }
export function gmailThread(url: string): string | null {
  try { const u = new URL(url, "https://mail.google.com"); return u.origin === "https://mail.google.com" && /^#(?:inbox|sent|all|drafts|search\/[^/]+)\/[A-Za-z0-9_-]{8,}$/.test(u.hash) ? u.href : null; } catch { return null; }
}
export function mailRows(doc: ParentNode): MailRow[] {
  return many(doc, s.gmail.rows).map(row => {
    const sender = first(row, s.gmail.rowSender);
    return { sender: (sender?.getAttribute("email") ?? sender?.getAttribute("data-hovercard-id") ?? "").toLowerCase(), subject: textOf(first(row, s.gmail.rowSubject)), text: textOf(row), url: first(row, s.gmail.messageLink)?.getAttribute("href") ?? "" };
  }).filter(v => v.sender && v.subject);
}
export function failedRecipients(body: string): string[] {
  const addresses: string[] = [];
  const patterns = [/(?:Final-Recipient|Original-Recipient):\s*(?:rfc822;\s*)?([^\s<>]+)/gi, /(?:delivery (?:to|has failed to)|address not found|couldn.t be delivered to|message wasn.t delivered to)\s*[:\s]*<?([\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,})/gi];
  for (const pattern of patterns) for (const match of body.matchAll(pattern)) if (match[1]) addresses.push(match[1].replace(/[>.,;]+$/, "").toLowerCase());
  return [...new Set(addresses)];
}
export function isAutomatic(subject: string): boolean { return /automatic reply|out of office|auto[- ]reply/i.test(subject); }
export function isOptOut(body: string): boolean { return /\b(?:unsubscribe|no thanks|not interested|please stop|remove me)\b/i.test(body); }
export function messageData(doc: ParentNode) {
  const messages = many(doc, s.gmail.message);
  const last = messages.at(-1) ?? doc;
  const sender = many(last, s.gmail.sender).at(-1);
  const bodyNode = many(last, s.gmail.messageBody).at(-1)?.cloneNode(true) as HTMLElement | undefined;
  for (const quote of bodyNode?.querySelectorAll(s.gmail.quote.join(",")) ?? []) quote.remove();
  const body = textOf(bodyNode ?? null);
  return { sender: (sender?.getAttribute("email") ?? "").toLowerCase(), subject: textOf(first(doc, s.gmail.messageSubject)), body, failed: failedRecipients(body) };
}
