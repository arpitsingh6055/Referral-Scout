import { selectors as s } from "../shared/selectors.config";
import { gmailThread, messageData } from "../parsers/gmail";
import { textOf, first } from "../parsers/linkedin";
import { wait, sleep, guard, find, visible } from "./dom";
const rows = () => [...document.querySelectorAll<HTMLElement>(s.gmail.rows.join(","))].filter(e => visible(e) && first(e, s.gmail.rowSubject));
async function ready(signal: AbortSignal): Promise<void> {
  await wait(() => rows().length > 0 || /No conversations found|No results found/i.test(document.body.innerText), signal, 20000);
}
export async function findMessage(subject: string, email: string, folder: "sent" | "drafts", signal: AbortSignal): Promise<unknown> {
  const search = `in:${folder} to:${email} subject:("${subject.replace(/["\\]/g, " ")}")`;
  location.hash = `#search/${encodeURIComponent(search)}`; await sleep(1500, signal); await ready(signal);
  const matches = rows().filter(r => textOf(first(r, s.gmail.rowSubject)).replace(/^Re:\s*/i, "") === subject.replace(/^Re:\s*/i, ""));
  if (matches.length !== 1) throw new Error("Cannot uniquely identify the Gmail message; inspect the search results");
  matches[0]?.click(); await sleep(800, signal);
  if (folder === "drafts") { await wait(() => find(s.gmail.subject), signal); return { opened: true, url: location.href }; }
  const url = await wait(() => gmailThread(location.href), signal); return { opened: true, url };
}
export async function scanMessages(signal: AbortSignal, offset = 0): Promise<unknown> {
  await sleep(1500, signal); await ready(signal); let skip = offset;
  while (rows().length && skip >= rows().length) {
    skip -= rows().length; const older = find(s.gmail.older);
    if (!older || older.getAttribute("aria-disabled") === "true" || older.hasAttribute("disabled")) return { messages: [], complete: true, nextOffset: 0 };
    older.click(); await sleep(1000, signal); await ready(signal);
  }
  const searchHash = location.hash, count = rows().length, end = Math.min(count, skip + 10);
  const result: Array<ReturnType<typeof messageData> & { url: string }> = [];
  for (let i = skip; i < end; i++) {
    guard(signal); const row = rows()[i]; if (!row) throw new Error("HALT: Gmail search rows changed during monitoring");
    row.click(); await wait(() => find(s.gmail.messageBody), signal, 10000);
    const message = messageData(document); if (!message.sender || !message.body) throw new Error("HALT: Cannot read message sender/body reliably");
    result.push({ ...message, url: gmailThread(location.href) ?? location.href });
    location.hash = searchHash; await sleep(500, signal); await ready(signal);
  }
  const older = find(s.gmail.older), more = older && older.getAttribute("aria-disabled") !== "true" && !older.hasAttribute("disabled");
  return { messages: result, complete: end === count && !more, nextOffset: offset + result.length };
}
