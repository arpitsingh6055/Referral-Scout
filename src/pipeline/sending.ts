import type { Campaign, Lead, SendLog } from "../shared/runtime";
import { logs, saveLead, write, read, event } from "../storage/state";
import { FOOTER, draftErrors } from "../validators/draft";
import { openPage, command } from "../background/browser";
import { Halt, ensureActive } from "../background/safety";
import { eligible } from "./policy";
import { manual } from "./qualification";
import { addSendingDays, localTime, inWindow } from "../shared/time";
import { today } from "./discovery";
import { put } from "../storage/database";
import { monitor } from "./monitoring";
export async function sendLead(lead: Lead, expected: Campaign, signal: AbortSignal): Promise<void> {
  const c = await ensureActive(expected, signal);
  if (!lead.draft) { await manual(lead, "Draft missing"); return; }
  const followup = lead.step.startsWith("followup"), sequence = followup ? lead.followups + 1 : 0;
  const live = c.settings.mode === "autopilot" && !c.mock;
  const id = `${lead.id}:${sequence}:${live ? "send" : "dry"}`;
  const previous = await read<SendLog>(`sendlog:${id}`);
  if (previous && ["intent", "uncertain"].includes(previous.state)) { await manual(lead, "Send result is uncertain. Use Check Sent; no automatic retry is allowed."); return; }
  if (previous?.state === "sent") { await finalize(lead, previous, c); return; }
  const history = (await logs()).filter(l => l.mock === c.mock);
  const reason = eligible(lead, c, history, followup);
  if (reason) { if (reason === "Company domain cooldown") { lead.retryAfter = Date.now() + 3600000; await saveLead(lead); return; } lead.stage = "Skipped"; lead.manualReason = reason; await saveLead(lead); return; }
  const day = await today(c), sentToday = history.filter(l => ["sent", "intent", "uncertain"].includes(l.state) && localTime(l.at).day === day.day).length;
  if (live && (!c.approvedAt || !inWindow(c.settings) || sentToday >= day.slots.length || Date.now() < (day.slots[sentToday] ?? Infinity))) return;
  if (live && !await chrome.permissions.contains({ origins: ["https://*/*"] })) throw new Halt("Source permission was removed; Autopilot cannot continue");
  if (live && lead.method === "inferred-pattern") {
    if (!c.settings.allowPatternInferred || await read("suspect:inferred-pattern")) throw new Halt("Pattern inference has been disabled");
    if (history.filter(l => l.method === "inferred-pattern" && ["sent", "intent", "uncertain"].includes(l.state) && localTime(l.at).day === day.day).length >= c.settings.patternDailyCap) return;
  }
  if (followup && (!lead.followupCheckAt || Date.now() - lead.followupCheckAt > 300000)) {
    await monitor(c, signal, lead); const latest = (await read<Lead>(`lead:${lead.id}`));
    if (!latest || latest.stage === "Replied" || latest.stage === "Bounced" || latest.followupAfter > Date.now()) return;
    lead.followupCheckAt = Date.now(); await saveLead(lead);
  }
  const errors = draftErrors(lead.draft, { profile: c.profile, firstName: lead.contact?.name.split(" ")[0] ?? "team", company: lead.name, roleAddress: lead.method === "published-role-address", suggestedRole: lead.suggested, sentBodies: history.filter(l => l.state === "sent").sort((a, b) => a.at - b.at).slice(-30).map(l => l.body), followup });
  if (errors.length) { await manual(lead, `Draft validation failed: ${errors.join("; ")}`); return; }
  const body = `${lead.draft.body}\n\n${FOOTER}`, base = `https://mail.google.com/mail/u/${c.profile.accountIndex}/`;
  const subject = followup ? lead.initialSubject || lead.subject : lead.subject;
  const compose = { to: lead.email, from: c.profile.gmail, subject, body, reply: followup };
  const log: SendLog = { id, leadId: lead.id, at: Date.now(), email: lead.email, domain: lead.domain, sourceUrl: lead.sourceUrl, evidence: lead.evidence, confirmed: lead.confirmed, method: lead.method, subject, body, provider: lead.provider, state: "intent", followup, sequence, mock: c.mock };
  if (c.mock) { log.state = "dry"; await write(`sendlog:${id}`, log); lead.stage = "DryRunFilled"; lead.step = "mock-dry"; await saveLead(lead); return; }
  let tab = await read<number>(`compose:${lead.id}`);
  if (lead.stage === "Drafted" || ["initial", "followup", "approved-dry"].includes(lead.step)) {
    if (followup) {
      if (!lead.threadUrl.startsWith(base)) { await manual(lead, "Verified Gmail thread required"); return; }
      tab = await openPage("gmail", lead.threadUrl, signal);
    } else if (lead.step === "approved-dry") {
      tab = await openPage("gmail", `${base}#drafts`, signal); await command(tab, { kind: "gmail.find", subject, email: lead.email, folder: "drafts" }, signal, 40000);
    } else {
      const url = new URL(base); url.search = new URLSearchParams({ view: "cm", fs: "1", to: lead.email, su: subject, body: body.length < 1500 ? body : "" }).toString();
      lead.stage = "Queued"; lead.step = "opening"; await saveLead(lead); tab = await openPage("gmail", url.href, signal);
    }
    await write(`compose:${lead.id}`, tab); await command(tab, { kind: "gmail.fill", ...compose }, signal);
    lead.stage = "Queued"; lead.step = followup ? "followup-filled" : "filled"; await saveLead(lead); return;
  }
  if (lead.step === "opening") { await manual(lead, "Draft creation was interrupted. Inspect Gmail Drafts before continuing."); return; }
  if (tab === undefined) { await manual(lead, "Compose tab lost; inspect Gmail Drafts"); return; }
  if (!live) {
    await command(tab, { kind: "gmail.saved" }, signal, 35000); log.state = "dry"; await write(`sendlog:${id}`, log);
    lead.stage = "DryRunFilled"; lead.step = "dry-filled"; await saveLead(lead); await chrome.tabs.remove(tab).catch(() => undefined); return;
  }
  await ensureActive(c, signal); log.tabId = tab; await write(`sendlog:${id}`, log);
  try {
    await command(tab, { kind: "gmail.send", sendId: id, ...compose }, signal, 25000);
    log.state = "sent"; await write(`sendlog:${id}`, log); await finalize(lead, log, c);
    const found = await command(tab, { kind: "gmail.find", subject, email: lead.email, folder: "sent" }, signal, 45000) as { url: string };
    log.threadUrl = found.url; await write(`sendlog:${id}`, log); lead.threadUrl = found.url; await saveLead(lead);
  } catch (e) {
    if (log.state !== "sent") { log.state = "uncertain"; await write(`sendlog:${id}`, log); }
    await manual(lead, log.state === "sent" ? "Send confirmed; use Check Sent to recover its thread. Do not resend." : "Send may have occurred. Use Check Sent; no automatic retry.");
    if (e instanceof Halt) throw e;
  }
}
export async function finalize(lead: Lead, log: SendLog, c: Campaign): Promise<void> {
  lead.stage = "Sent"; lead.step = "sent";
  if (log.followup) lead.followups = Math.max(lead.followups, log.sequence ?? 1);
  else { lead.sentAt = log.at; lead.initialSubject = log.subject; lead.initialBody = log.body; }
  if (log.threadUrl) lead.threadUrl = log.threadUrl;
  lead.followupAfter = addSendingDays(lead.sentAt, lead.followups === 0 ? 5 : 12, c.settings.holidays); await saveLead(lead);
  await put("send", { id: log.id, createdAt: log.at, updatedAt: Date.now(), stage: "Sent", personId: lead.id, companyId: lead.id, emailId: lead.id, draftId: lead.id, subjectVariant: log.subject === lead.draft?.subject_a ? "a" : "b", sentAt: log.at, threadId: lead.threadUrl.split("/").at(-1) ?? null });
  await event(`Sent ${log.followup ? "follow-up" : "initial message"} for ${lead.name}`);
}
