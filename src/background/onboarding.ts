import { cvRequestSchema, cvControlSchema, cvPrompt, extractedSchema, type CvTask } from "../shared/onboarding";
import { read, write, mutate } from "../storage/state";
import { openPage, command } from "./browser";
import { acquire, renew, release } from "./lease";
import { extractJson } from "../parsers/json";
import { resultSchema } from "../bridge/schemas";
import { trustedExtension, trustedSite } from "../validators/security";
let active: AbortController | null = null;
async function save(task: CvTask): Promise<void> {
  await mutate<CvTask>("cv-task", old => old && (old.id !== task.id || old.state === "cancelled") ? old : task);
}
export async function cvTick(): Promise<void> {
  const owner = crypto.randomUUID(); if (!await acquire(owner)) return;
  const abort = new AbortController(); active = abort;
  const timer = setInterval(() => { void renew(owner).then(ok => { if (!ok) abort.abort(); }); }, 20000);
  try {
    const task = await read<CvTask>("cv-task"); if (!task || !["queued", "running"].includes(task.state)) return;
    try {
      if (task.state === "queued") {
        if (!task.request) throw new Error("CV input missing; please upload again");
        task.tabId = await openPage("chatgpt", "https://chatgpt.com/?temporary-chat=true", abort.signal, true);
        task.state = "running"; task.startedAt = Date.now(); await save(task);
        await command(task.tabId, { kind: "llm.run", jobId: task.id, prompt: cvPrompt(task.request.text), search: false, first: 20000, total: 150000, repair: false, ...(task.request.attachment ? { attachment: task.request.attachment } : {}) }, abort.signal);
        return;
      }
      if (task.tabId === null) throw new Error("CV extraction tab was closed");
      const result = resultSchema.parse(await command(task.tabId, { kind: "llm.status", jobId: task.id + (task.repaired ? ":repair" : "") }, abort.signal));
      if (result.state === "running" && Date.now() - task.startedAt < 240000) return;
      if (result.state !== "done") throw new Error(result.error || "CV extraction timed out or the tab was reloaded. Retry, paste CV text, or enter your details manually.");
      try { task.result = extractedSchema.parse(extractJson(result.text ?? "")); }
      catch {
        if (task.repaired) throw new Error("ChatGPT did not return a valid profile after repair. Enter your details manually or retry with pasted CV text.");
        task.repaired = true; task.startedAt = Date.now(); await save(task);
        await command(task.tabId, { kind: "llm.run", jobId: `${task.id}:repair`, prompt: "Correct your previous response. Return only the originally requested JSON object with name, gmail, education, and proofPoints. No extra fields. Use empty strings for unknown facts; never invent. Proof IDs must be P1, P2, P3.", search: false, first: 20000, total: 90000, repair: true }, abort.signal); return;
      }
      task.state = "done"; task.request = null; await save(task);
    } catch (e) {
      task.state = "error"; task.error = e instanceof Error ? e.message : String(e); task.request = null; await save(task);
    }
  } finally { clearInterval(timer); if (active === abort) active = null; await release(owner); }
}
export function registerOnboarding(): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (!trustedExtension(sender, chrome.runtime.id)) return false;
    const extract = cvRequestSchema.safeParse(input), control = cvControlSchema.safeParse(input);
    if (!extract.success && !control.success) return false;
    const requestId = extract.success ? extract.data.requestId : control.success ? control.data.requestId : "";
    void (async () => {
      if (extract.success) {
        await mutate<CvTask>("cv-task", old => {
          if (old && ["queued", "running"].includes(old.state)) throw new Error("A CV is already being processed. Wait or cancel it first.");
          return { id: extract.data.requestId, state: "queued", request: extract.data, tabId: null, startedAt: Date.now(), repaired: false, result: null, resumeUrl: extract.data.resumeUrl, error: "" };
        });
        await chrome.alarms.create("cv-progress", { periodInMinutes: 1 }); void cvTick();
      } else if (control.success && control.data.kind === "onboarding.cancel") {
        active?.abort(); const old = await read<CvTask>("cv-task");
        if (old) { old.state = "cancelled"; old.request = null; old.result = null; await write("cv-task", old); if (old.tabId !== null) await command(old.tabId, { kind: "cancel" }, new AbortController().signal).catch(() => undefined); }
      }
      const task = await read<CvTask>("cv-task");
      return task ? { id: task.id, state: task.state, result: task.result, resumeUrl: task.resumeUrl, error: task.error } : null;
    })().then(data => respond({ requestId, ok: true, data })).catch((e: unknown) => respond({ requestId, ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "cv-heartbeat") return;
    if (!port.sender || !trustedSite(port.sender, chrome.runtime.id) || !port.sender.url?.startsWith("https://chatgpt.com/")) { port.disconnect(); return; }
    port.onMessage.addListener(() => { /* Receipt of a validated port message renews worker activity. */ });
  });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "cv-progress") void cvTick(); });
}
export async function resumeOnboarding(): Promise<void> {
  const task = await read<CvTask>("cv-task");
  if (task && Date.now() - task.startedAt > 86400000) { await write("cv-task", { ...task, state: "cancelled", request: null, result: null, error: "Expired CV import was removed" }); return; }
  if (task && ["queued", "running"].includes(task.state)) await chrome.alarms.create("cv-progress", { periodInMinutes: 1 });
}
