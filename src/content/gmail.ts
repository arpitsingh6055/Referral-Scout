import { selectors as s } from "../shared/selectors.config";
import { gmailThread, messageData } from "../parsers/gmail";
import { textOf, first } from "../parsers/linkedin";
import { wait, sleep, guard } from "./dom";
export async function findMessage(subject: string, email: string, folder: "sent" | "drafts", signal: AbortSignal): Promise<unknown> {
  const search = `in:${folder} to:${email} subject:("${subject.replace(/["\\]/g, " ")}")`;
  location.hash = `#search/${encodeURIComponent(search)}`;
  const row = await wait(() => [...document.querySelectorAll<HTMLElement>(s.gmail.rows.join(","))].find(r => textOf(first(r, s.gmail.rowSubject)) === subject && !r.hidden), signal, 30000);
  row.click(); await sleep(800, signal);
  if (folder === "drafts") { await wait(() => document.querySelector(s.gmail.subject[0]), signal); return { opened: true, url: location.href }; }
  const url = await wait(() => gmailThread(location.href), signal);
  return { opened: true, url };
}
export async function scanMessages(signal: AbortSignal): Promise<unknown> {
  await sleep(1500, signal); const searchHash = location.hash;
  const subjects = [...document.querySelectorAll<HTMLElement>(s.gmail.rows.join(","))].map(r => textOf(first(r, s.gmail.rowSubject))).filter(Boolean).slice(0, 30);
  const result: Array<ReturnType<typeof messageData> & { url: string }> = [];
  for (let i = 0; i < subjects.length; i++) {
    guard(signal);
    const rows = [...document.querySelectorAll<HTMLElement>(s.gmail.rows.join(","))]; const row = rows[i]; if (!row) break;
    row.click(); await wait(() => document.querySelector(s.gmail.messageBody[0]), signal, 5000);
    result.push({ ...messageData(document), url: gmailThread(location.href) ?? "" });
    location.hash = searchHash; await wait(() => document.querySelector(s.gmail.rows[0]), signal, 5000); await sleep(300, signal);
  } return result;
}
