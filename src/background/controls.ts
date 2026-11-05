import { z } from "zod";
import { controlSchema } from "../shared/commands";
import { campaign, setCampaign, leads, logs, jobs, read, write, saveLead, providerHealth, event, mutate } from "../storage/state";
import { loadSettings } from "../storage/settings";
import { readiness } from "../shared/schemas";
import type { Campaign, Job, Lead } from "../shared/runtime";
import { all, clearDatabase } from "../storage/database";
import { cancelWork, tick } from "./scheduler";
import { campaignHealth } from "./health";
import { notify } from "./safety";
import { inWindow, localTime } from "../shared/time";
import { today } from "../pipeline/discovery";
import { exportCsv } from "./maintenance";
import { acceptReply, enqueue } from "../bridge/runner";
import { confirmSource } from "../pipeline/sources";
import { openPage, command } from "./browser";
import { finalize } from "../pipeline/sending";
import { acquire, renew, release } from "./lease";
type Request = z.infer<typeof controlSchema>;
export async function snapshot() {
  const c = await campaign(), records = await leads(), history = await logs();
  const day = c ? await today(c) : null;
  const events = (await all("event")).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  return { campaign: c ?? null, leads: records, budget: day, todaySent: history.filter(l => !l.mock && l.state === "sent" && localTime(l.at).day === localTime().day).length,
    events, health: { gemini: await providerHealth("gemini"), chatgpt: await providerHealth("chatgpt") },
    jobs: (await jobs()).map(j => ({ id: j.id, kind: j.kind, provider: j.provider, state: j.state, error: j.error, failureClass: j.failureClass, duration: j.finishedAt ? j.finishedAt - j.startedAt : 0 })) };
}
export async function stop(status: "paused" | "stopped", reason: string): Promise<void> {
  if (await campaign()) await mutate<Campaign>("campaign", old => { if (!old) throw new Error("Missing campaign"); return { ...old, status, pausedByAlarm: false, reason }; });
  await cancelWork(); chrome.power.releaseKeepAwake(); await event(reason);
}
async function start(): Promise<void> {
  const settings = await loadSettings(), old = await campaign();
  const cv = await read<{ state: string }>("cv-task"); if (cv && ["queued", "running"].includes(cv.state)) throw new Error("Finish or cancel CV extraction before starting a campaign");
  const missing = readiness(settings.profile, settings.campaign, false); if (missing.length) throw new Error(missing.join("; "));
  if (old && !(old.mock && !settings.campaign.mockMode && old.status !== "active")) throw new Error("A campaign already exists. Use Resume, or export and Delete All Data to start over.");
  if (old?.mock) await clearDatabase();
  const c: Campaign = { status: "active", reason: "", pausedByAlarm: false, startedAt: Date.now(), healthAt: 0, discoveryCursor: 0, lastMonitor: Date.now(), bothFailed: 0, mock: settings.campaign.mockMode, approvedAt: 0, profile: settings.profile, settings: { ...settings.campaign, mode: "dry-run" } };
  await setCampaign(c); await chrome.alarms.create("campaign-tick", { periodInMinutes: 1 });
  if (c.mock || inWindow(c.settings)) await campaignHealth(c, new AbortController().signal);
  else await event("Campaign waiting for its sending window; health checks will run before work starts");
  chrome.power.requestKeepAwake("system");
}
async function resume(): Promise<void> {
  const c = await campaign(); if (!c || c.status === "active" || c.status === "complete") throw new Error("No paused/stopped campaign to resume");
  if (c.status === "review") throw new Error("Review the ten drafts and choose Approve, or keep the campaign paused");
  const current = await loadSettings();
  if (JSON.stringify(current.profile) !== JSON.stringify(c.profile)) throw new Error("The saved profile changed. Export and start a new campaign so existing drafts cannot use stale facts.");
  const mode = c.settings.mode; c.settings = { ...current.campaign, mode, mockMode: c.mock, optOutPeople: [...new Set([...current.campaign.optOutPeople, ...c.settings.optOutPeople])], optOutDomains: [...new Set([...current.campaign.optOutDomains, ...c.settings.optOutDomains])] };
  if (c.mock !== current.campaign.mockMode) throw new Error("Mock/live mode cannot change within an existing campaign");
  await campaignHealth(c, new AbortController().signal);
  c.status = "active"; c.reason = ""; c.pausedByAlarm = false; await setCampaign(c); chrome.power.requestKeepAwake("system");
}
export async function approve(): Promise<void> {
  const c = await campaign(); if (!c || c.status !== "review" || c.mock) throw new Error("Approval requires ten real Gmail drafts, never mock results");
  const dry = (await logs()).filter(l => l.state === "dry" && !l.mock && !l.followup);
  if (new Set(dry.map(l => l.leadId)).size < 10) throw new Error("Ten distinct real drafts are required");
  if (!await chrome.permissions.contains({ origins: ["https://*/*"] })) throw new Error("Grant source-confirmation permission in Settings first");
  const records = (await leads()).filter(l => l.stage === "DryRunFilled" && !l.mock);
  if (records.length < 10) throw new Error("Ten eligible drafts are required; replace skipped drafts first");
  for (const lead of records) if (!lead.confirmed && lead.method !== "inferred-pattern") {
    lead.confirmed = (await confirmSource(lead.sourceUrl, lead.email, new AbortController().signal)).confirmed; await saveLead(lead);
    if (!lead.confirmed) throw new Error(`Could not confirm ${lead.name}'s email on its source page. Skip this draft and replace it before approving.`);
  }
  const settings = await loadSettings(); if (JSON.stringify(settings.profile) !== JSON.stringify(c.profile)) throw new Error("Profile changed after drafting; start a new campaign");
  await campaignHealth(c, new AbortController().signal);
  if ((await campaign())?.status !== "review") throw new Error("Campaign state changed during approval");
  for (const lead of records) { lead.stage = "Queued"; lead.step = "approved-dry"; await saveLead(lead); }
  c.settings.mode = "autopilot"; c.approvedAt = Date.now(); c.status = "active"; c.reason = ""; c.pausedByAlarm = false; await setCampaign(c);
  await event("User approved ten drafts and enabled Autopilot"); chrome.power.requestKeepAwake("system");
}
async function manualReply(id: string, text: string): Promise<void> {
  const job = await read<Job>(`job:${id}`); if (!job || !["manual", "not_found"].includes(job.state)) throw new Error("No manual job with that ID");
  await acceptReply(job, text);
  for (const lead of await leads()) if (lead.pendingJob === id && lead.stage === "NeedsManual") { lead.stage = lead.resumeStage ?? "RolesChecked"; lead.manualReason = ""; lead.errors = 0; lead.retryAfter = 0; await saveLead(lead); }
}
async function reconcile(id: string): Promise<void> {
  const c = await campaign(), lead = await read<Lead>(`lead:${id}`); if (!c || !lead || c.mock) throw new Error("No live message to reconcile");
  const log = (await logs()).filter(l => l.leadId === id && ["intent", "uncertain", "sent"].includes(l.state)).sort((a, b) => b.at - a.at)[0]; if (!log) throw new Error("No persisted send intent");
  const signal = new AbortController().signal;
  const tab = await openPage("gmail", `https://mail.google.com/mail/u/${c.profile.accountIndex}/#sent`, signal);
  const found = await command(tab, { kind: "gmail.find", subject: log.subject, email: log.email, folder: "sent" }, signal, 40000) as { url: string };
  log.state = "sent"; log.threadUrl = found.url; await write(`sendlog:${log.id}`, log); await finalize(lead, log, c);
}
export async function handleControl(request: Request): Promise<unknown> {
  if (request.action === "status") return snapshot();
  if (request.action === "export") return exportCsv();
  if (request.action === "pause" || request.action === "stop") { await stop(request.action === "pause" ? "paused" : "stopped", `User ${request.action === "pause" ? "paused" : "stopped"} the campaign`); return snapshot(); }
  if (request.action === "delete") { if (!request.confirm) throw new Error("Explicit deletion confirmation required"); await stop("stopped", "Deleting all data"); }
  const owner = crypto.randomUUID(); if (!await acquire(owner)) throw new Error("A step is finishing. Pause first, then try again.");
  const renewal = setInterval(() => { void renew(owner); }, 20000);
  try {
    switch (request.action) {
      case "start": await start(); break;
      case "resume": await resume(); break;
      case "approve": if (!request.confirm) throw new Error("Explicit approval required"); await approve(); break;
      case "manual": await manualReply(request.id ?? "", request.text ?? ""); break;
      case "reconcile": await reconcile(request.id ?? ""); break;
      case "skip": {
        const lead = await read<Lead>(`lead:${request.id}`); if (!lead) throw new Error("Contact not found"); lead.stage = "Skipped"; lead.followups = 2; lead.manualReason = "Skipped by user"; await saveLead(lead); break;
      }
      case "probe": {
        if (!await campaign()) throw new Error("Start a mock or live dry-run campaign before testing the bridge"); await enqueue(crypto.randomUUID(), "probe", 'Reply with JSON {"ok":true}', false); break;
      }
      case "delete":
        await cancelWork();
        await clearDatabase();
        await chrome.storage.sync.clear();
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
        await chrome.alarms.clearAll();
        chrome.power.releaseKeepAwake();
        return { deleted: true };
    }
    return await snapshot();
  } catch (e) {
    if (["start", "resume"].includes(request.action) && await campaign()) { await mutate<Campaign>("campaign", old => { if (!old) throw e; return { ...old, status: "paused", pausedByAlarm: true, reason: String(e) }; }); chrome.power.releaseKeepAwake(); await notify(String(e)); }
    throw e;
  } finally { clearInterval(renewal); await release(owner); if (["start", "resume", "approve", "probe"].includes(request.action)) void tick(); }
}
