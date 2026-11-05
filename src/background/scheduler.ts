import { acquire, renew, release } from "./lease";
import { campaign, leads, logs, read, saveLead, event, mutate } from "../storage/state";
import type { Campaign } from "../shared/runtime";
import { Halt, pause, checkBounces, ensureActive } from "./safety";
import { inWindow } from "../shared/time";
import { bridgeStep } from "../bridge/runner";
import { discover, today } from "../pipeline/discovery";
import { qualify, manual } from "../pipeline/qualification";
import { draftLead } from "../pipeline/drafting";
import { sendLead } from "../pipeline/sending";
import { monitor } from "../pipeline/monitoring";
import { campaignHealth } from "./health";
import { retain } from "./maintenance";
let controller: AbortController | null = null, running: Promise<void> | null = null;
export async function cancelWork(): Promise<void> {
  controller?.abort();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) if (tab.id !== undefined && tab.url && /https:\/\/(?:www\.)?(?:linkedin.com|mail.google.com|gemini.google.com|chatgpt.com)\//.test(tab.url))
    void chrome.tabs.sendMessage(tab.id, { kind: "cancel", requestId: crypto.randomUUID(), deadline: Date.now() + 10000 }).catch(() => undefined);
  await running;
}
export async function campaignStep(c: Campaign, signal: AbortSignal): Promise<void> {
  await ensureActive(c, signal);
  if (!c.mock && !inWindow(c.settings)) return;
  if (await bridgeStep(signal)) return;
  if (!c.healthAt || Date.now() - c.healthAt >= 21600000) { await campaignHealth(c, signal); return; }
  await checkBounces();
  if (Date.now() - c.lastMonitor >= 1800000) { await monitor(c, signal); return; }
  const all = (await leads()).filter(l => l.mock === c.mock), history = await logs();
  const dry = history.filter(l => l.state === "dry" && !l.followup && l.mock === c.mock);
  if (c.settings.mode === "dry-run" && dry.length >= 10) {
    await mutate<Campaign>("campaign", old => { if (!old) throw new Error("Missing campaign"); return old.status === "active" ? { ...old, status: c.mock ? "complete" : "review", reason: c.mock ? "Mock run complete: ten fixture drafts. No websites or emails were touched." : "Ten Gmail drafts are ready. Review them, then explicitly approve Autopilot." } : old; });
    chrome.power.releaseKeepAwake(); return;
  }
  const sentInitial = history.filter(l => l.state === "sent" && !l.followup && l.mock === c.mock).length;
  const due = all.find(l => l.stage === "Sent" && l.followups < 2 && Date.now() >= l.followupAfter && !l.optOut && l.threadUrl);
  if (due && c.settings.mode === "autopilot") {
    await monitor(c, signal, due); const updated = (await leads()).find(l => l.id === due.id);
    if (!updated || updated.stage !== "Sent" || updated.followupAfter > Date.now()) return;
    updated.followupCheckAt = Date.now(); updated.step = "followup"; updated.attempts = 0; updated.stage = "RolesChecked"; await saveLead(updated); return;
  }
  const active = all.filter(l => !["Sent", "Replied", "Bounced", "Skipped", "NeedsManual", "DryRunFilled"].includes(l.stage) && (l.retryAfter ?? 0) <= Date.now());
  const budget = await today(c), ready = all.filter(l => l.email && !["Sent", "Replied", "Bounced", "Skipped"].includes(l.stage)).length;
  const priority = ["Queued", "Drafted", "RolesChecked", "EmailFound", "PeopleFound", "Vetted", "Discovered"];
  const lead = active.sort((a, b) => priority.indexOf(a.stage) - priority.indexOf(b.stage) || a.updatedAt - b.updatedAt)
    .find(l => (!(["Discovered", "Vetted"].includes(l.stage)) || ready < 3 * budget.slots.length) && (sentInitial < c.settings.targetSends || l.step.startsWith("followup")));
  if (lead) {
    try {
      if (lead.stage === "RolesChecked") await draftLead(lead, c, lead.step.startsWith("followup"));
      else if (lead.stage === "Drafted" || lead.stage === "Queued") await sendLead(lead, c, signal);
      else await qualify(lead, c, signal);
    } catch (e) {
      if (e instanceof Halt || signal.aborted) throw e;
      lead.errors = (lead.errors ?? 0) + 1; lead.retryAfter = Date.now() + Math.min(3600000, 60000 * 2 ** lead.errors);
      if (lead.errors >= 3) await manual(lead, e instanceof Error ? e.message : String(e)); else await saveLead(lead);
      await event(`Step failed; retry delayed: ${String(e).slice(0, 500)}`, "warning");
    } return;
  }
  if (sentInitial >= c.settings.targetSends) {
    if (!all.some(l => l.sentAt && l.followups < 2 && !["Replied", "Bounced", "Skipped", "NeedsManual"].includes(l.stage))) {
      await mutate<Campaign>("campaign", old => { if (!old) throw new Error("Missing campaign"); return old.status === "active" ? { ...old, status: "complete", reason: "Target reached and follow-ups finished." } : old; }); chrome.power.releaseKeepAwake();
    } return;
  }
  if (ready < 3 * budget.slots.length) await discover(c, signal);
}
async function runTick(): Promise<void> {
  const owner = crypto.randomUUID(); if (!await acquire(owner)) return;
  const abort = new AbortController(); controller = abort;
  const timer = setInterval(() => { void renew(owner).then(ok => { if (!ok) abort.abort(); }); }, 20000);
  try {
    if (Date.now() - (await read<number>("last-retention") ?? 0) > 86400000) { await retain(); return; }
    const c = await campaign(); if (!c || c.status !== "active") return;
    chrome.power.requestKeepAwake("system"); await campaignStep(c, abort.signal);
  } catch (e) { if (!abort.signal.aborted) await pause(e instanceof Error ? e.message : String(e)); }
  finally { clearInterval(timer); controller = null; await release(owner); }
}
export async function tick(): Promise<void> { if (running) return; running = runTick(); try { await running; } finally { running = null; } }
