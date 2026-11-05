import type { Campaign, Lead } from "../shared/runtime";
import { leads, saveLead, write, event } from "../storage/state";
import { openPage, command } from "../background/browser";
import { isAutomatic, isOptOut } from "../parsers/gmail";
import { notify, checkBounces } from "../background/safety";
export interface InboxMessage { sender: string; subject: string; body: string; failed: string[]; url: string }
export async function applyMessages(messages: InboxMessage[], c: Campaign): Promise<void> {
  const targets = await leads();
  for (const message of messages) {
    for (const lead of targets.filter(l => l.email && !l.mock && l.sentAt > 0)) {
      if (/mailer-daemon|postmaster/i.test(message.sender) && message.failed.includes(lead.email.toLowerCase())) {
        lead.stage = "Bounced"; lead.followups = 2;
        if (lead.method === "inferred-pattern") { c.settings.allowPatternInferred = false; await chrome.storage.sync.set({ campaign: c.settings }); }
        await write(`suspect:${lead.method}`, true); await saveLead(lead); await event(`Bounce: ${lead.name} (${lead.method})`, "warning");
      } else if (message.sender.toLowerCase() === lead.email.toLowerCase()) {
        if (isAutomatic(message.subject)) {
          const key = `auto:${lead.id}:${message.url}`; const { read } = await import("../storage/state");
          if (!await read(key)) { lead.followupAfter = Math.max(lead.followupAfter, Date.now() + 3 * 86400000); await write(key, true); await saveLead(lead); }
        } else if (lead.stage !== "Replied") {
          lead.stage = "Replied"; lead.followups = 2;
          if (isOptOut(message.body)) {
            lead.optOut = true; lead.manualReason = "Opt-out reply — review in Gmail";
            c.settings.optOutPeople = [...new Set([...c.settings.optOutPeople, lead.email])]; c.settings.optOutDomains = [...new Set([...c.settings.optOutDomains, lead.domain])];
            await chrome.storage.sync.set({ campaign: c.settings });
          }
          await saveLead(lead); await notify(`Reply received from ${lead.name}. Open Gmail to respond.`);
        }
      }
    }
  }
  await write("campaign", c); await checkBounces();
}
export async function monitor(c: Campaign, signal: AbortSignal, recipient?: Lead): Promise<void> {
  if (c.mock) { c.lastMonitor = Date.now(); await write("campaign", c); return; }
  const base = `https://mail.google.com/mail/u/${c.profile.accountIndex}/`;
  const queries = recipient ? [`in:anywhere from:${recipient.email} newer_than:30d`] : ["from:(mailer-daemon OR postmaster) newer_than:2d", "in:inbox newer_than:2d"];
  for (const query of queries) {
    const tab = await openPage("gmail-monitor", `${base}#search/${encodeURIComponent(query)}`, signal);
    const messages = await command(tab, { kind: "gmail.scan", mode: query.includes("mailer-daemon") ? "bounce" : "reply" }, signal, 180000) as InboxMessage[];
    await applyMessages(messages, c);
  }
  if (!recipient) { c.lastMonitor = Date.now(); await write("campaign", c); }
}
