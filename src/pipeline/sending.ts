import type { Campaign, Lead, SendLog } from "../shared/runtime";
import { logs, saveLead, write, read, event } from "../storage/state";
import { FOOTER } from "../validators/draft";
import { openPage, command } from "../background/browser";
import { Halt } from "../background/safety";
import { eligible } from "./policy";
import { manual } from "./qualification";
import { addSendingDays, localTime, inWindow } from "../shared/time";
import { today } from "./discovery";
import { put } from "../storage/database";
export async function sendLead(lead: Lead, c: Campaign, signal: AbortSignal): Promise<void> {
  if (!lead.draft) { await manual(lead, "Draft missing"); return; }
  const followup = lead.step.startsWith("followup");
  const history = await logs(), reason = eligible(lead, c, history.filter(l => l.id !== `${lead.id}:${lead.followups}:${lead.step.includes("dry") ? "dry" : "send"}`), followup);
  if (reason && !["filled", "sending", "dry-filled", "followup-filled", "followup-sending"].includes(lead.step)) {
    if (reason === "Company domain cooldown") return;
    lead.stage = "Skipped"; lead.manualReason = reason; await saveLead(lead); return;
  }
  const day = await today(c), sentToday = history.filter(l => l.mock === c.mock && ["sent", "intent", "uncertain"].includes(l.state) && localTime(l.at).day === day.day).length;
  const live = c.settings.mode === "autopilot" && !c.mock;
  if (live && (!inWindow(c.settings) || sentToday >= day.slots.length || Date.now() < (day.slots[sentToday] ?? Infinity))) return;
  if (live && !await chrome.permissions.contains({ origins: ["https://*/*"] })) throw new Halt("Source confirmation permission was removed. Autopilot cannot continue.");
  const body = `${lead.draft.body}\n\n${FOOTER}`, base = `https://mail.google.com/mail/u/${c.profile.accountIndex}/`;
  const compose = { to: lead.email, from: c.profile.gmail, subject: lead.subject, body, reply: followup };
  const id = `${lead.id}:${lead.followups}:${live ? "send" : "dry"}`;
  const previous = await read<SendLog>(`sendlog:${id}`);
  if (previous && ["intent", "uncertain"].includes(previous.state)) { await manual(lead, "Send result is uncertain. Inspect Sent and do not resend automatically."); return; }
  const log: SendLog = previous ?? { id, leadId: lead.id, at: Date.now(), email: lead.email, domain: lead.domain, sourceUrl: lead.sourceUrl, evidence: lead.evidence, confirmed: lead.confirmed, method: lead.method, subject: lead.subject, body, provider: lead.provider, state: "intent", followup, mock: c.mock };
  if (c.mock) { log.state = "dry"; await write(`sendlog:${id}`, log); lead.stage = "DryRunFilled"; lead.step = "mock-dry"; await saveLead(lead); return; }
  if (lead.step === "sending" || lead.step === "followup-sending") { await manual(lead, "Interrupted send; verify Sent manually before any further action"); return; }
  let tab = await read<number>(`compose:${lead.id}`);
  if (lead.stage === "Drafted" || lead.step === "initial" || lead.step === "followup" || lead.step === "approved-dry") {
    if (followup) {
      if (!lead.threadUrl.startsWith(base)) { await manual(lead, "Verified Gmail thread is required for follow-up"); return; }
      tab = await openPage("gmail", lead.threadUrl, signal);
    } else if (lead.step === "approved-dry") {
      tab = await openPage("gmail", `${base}#drafts`, signal);
      await command(tab, { kind: "gmail.find", subject: lead.subject, email: lead.email, folder: "drafts" }, signal, 40000);
    } else {
      const url = new URL(base); url.search = new URLSearchParams({ view: "cm", fs: "1", to: lead.email, su: lead.subject, body: body.length < 1500 ? body : "" }).toString();
      lead.stage = "Queued"; lead.step = "opening"; await saveLead(lead);
      tab = await openPage("gmail", url.href, signal);
    }
    await write(`compose:${lead.id}`, tab); await command(tab, { kind: "gmail.fill", ...compose }, signal);
    lead.stage = "Queued"; lead.step = followup ? "followup-filled" : "filled"; await saveLead(lead); return;
  }
  if (lead.step === "opening") { await manual(lead, "Interrupted draft creation. Inspect Gmail Drafts to avoid duplicate drafts"); return; }
  if (tab === undefined) { await manual(lead, "Compose tab was lost"); return; }
  if (!live) {
    await command(tab, { kind: "gmail.saved" }, signal, 35000); log.state = "dry"; await write(`sendlog:${id}`, log);
    lead.stage = "DryRunFilled"; lead.step = "dry-filled"; await saveLead(lead); await chrome.tabs.remove(tab).catch(() => undefined); return;
  }
  // Persist intent before Send; any uncertain outcome is never retried automatically.
  log.at = Date.now(); log.state = "intent"; await write(`sendlog:${id}`, log);
  lead.step = followup ? "followup-sending" : "sending"; await saveLead(lead);
  try {
    await command(tab, { kind: "gmail.send", ...compose }, signal, 25000);
    log.state = "sent"; await write(`sendlog:${id}`, log);
    lead.stage = "Sent";
    if (followup) lead.followups++; else lead.sentAt = log.at;
    lead.followupAfter = addSendingDays(lead.sentAt, lead.followups === 0 ? 5 : 12, c.settings.holidays); lead.step = "locate-sent"; await saveLead(lead);
    const found = await command(tab, { kind: "gmail.find", subject: lead.subject, email: lead.email, folder: "sent" }, signal, 45000) as { url: string };
    lead.threadUrl = found.url; lead.step = "sent"; await saveLead(lead);
    await put("send", { id, createdAt: log.at, updatedAt: Date.now(), stage: "Sent", personId: lead.id, companyId: lead.id, emailId: lead.id, draftId: lead.id, subjectVariant: lead.subject === lead.draft.subject_a ? "a" : "b", sentAt: log.at, threadId: lead.threadUrl.split("/").at(-1) ?? null });
    await event(`Sent ${followup ? "follow-up" : "initial message"} for ${lead.name}`);
  } catch (e) {
    if (log.state === "sent") { await manual(lead, "Send confirmed, but thread lookup failed. Do not resend; locate the Sent thread."); }
    else { log.state = "uncertain"; await write(`sendlog:${id}`, log); await manual(lead, "Send may have occurred. Inspect Gmail Sent; automatic retry is blocked."); }
    if (e instanceof Halt) throw e;
  }
}
