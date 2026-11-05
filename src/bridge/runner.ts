import type { Job } from "../shared/runtime";
import { campaign, event, jobs, providerHealth, read, write } from "../storage/state";
import { openPage, command } from "../background/browser";
import { Halt } from "../background/safety";
import { extractJson } from "../parsers/json";
import { schemas, hasSources, resultSchema } from "./schemas";
import { mockReply } from "./mock";
import { preferredProvider } from "./preference";
export async function enqueue(id: string, kind: Job["kind"], promptText: string, requiresSources: boolean): Promise<Job> {
  const old = await read<Job>(`job:${id}`); if (old) return old;
  const c = await campaign(); if (!c) throw new Error("No campaign configured");
  const job: Job = { id, kind, promptText, requiresSources, expectJson: true, state: "queued", createdAt: Date.now(), startedAt: 0, finishedAt: 0, provider: preferredProvider(kind), tried: [], tabId: null, repaired: false, result: null, error: "", failureClass: "", timeouts: { first: c.settings.firstTokenSeconds * 1000, total: (requiresSources ? c.settings.webSeconds : c.settings.totalSeconds) * 1000 }, mock: c.mock };
  await write(`job:${id}`, job); return job;
}
async function fail(job: Job, error: string, refusal = false): Promise<void> {
  job.error = error; job.failureClass = refusal ? "refusal" : "provider";
  if (error.startsWith("HALT:")) throw new Halt(error);
  if (!refusal) {
    const health = await providerHealth(job.provider); health.failures++; health.lastError = error;
    if (health.failures >= 3) health.disabledUntil = Date.now() + 600000;
    await write(`health:${job.provider}`, health);
  }
  const other = job.provider === "gemini" ? "chatgpt" : "gemini";
  if (!job.tried.includes(other)) { job.provider = other; job.state = "queued"; job.repaired = false; job.tabId = null; await event(`Fallback to ${other}: ${error}`, "warning", job.id); }
  else {
    job.state = refusal ? "not_found" : "manual"; job.finishedAt = Date.now();
    const c = await campaign(); if (c && !refusal) { c.bothFailed++; await write("campaign", c); await write(`job:${job.id}`, job); if (c.bothFailed >= 5) throw new Halt("Both LLM providers failed five consecutive jobs"); }
  }
  await write(`job:${job.id}`, job); await event(`${job.provider}: ${job.failureClass}; ${Date.now() - job.startedAt} ms; ${error}`, "warning", job.id);
}
export async function acceptReply(job: Job, text: string): Promise<boolean> {
  if (/\b(?:cannot|can't|unable to|won't)\b.{0,100}(?:personal|private|contact|email)/is.test(text)) { await fail(job, "Provider refused contact request", true); return true; }
  const result = schemas[job.kind].safeParse(extractJson(text));
  if (!result.success) throw new Error(result.error.issues.map(v => v.message).join("; ").slice(0, 1000));
  if (job.requiresSources && !hasSources(result.data)) { job.state = "not_found"; job.failureClass = "no_sources"; job.result = null; }
  else { job.result = result.data; job.state = "done"; }
  job.finishedAt = Date.now(); job.error = ""; await write(`job:${job.id}`, job);
  await write(`health:${job.provider}`, { failures: 0, disabledUntil: 0, lastError: "" });
  const c = await campaign(); if (c) { c.bothFailed = 0; await write("campaign", c); }
  await write("llm-gap", Date.now() + 3000 + Math.random() * 5000);
  await event(`${job.provider}: ${job.state}; ${job.finishedAt - job.startedAt} ms`, "info", job.id); return true;
}
export async function bridgeStep(signal: AbortSignal): Promise<boolean> {
  const pending = (await jobs()).filter(v => ["queued", "awaiting_reply"].includes(v.state)).sort((a, b) => a.createdAt - b.createdAt);
  const job = pending[0]; if (!job) return false;
  if ((await read<number>("llm-gap") ?? 0) > Date.now()) return true;
  try {
    if (job.mock) { job.startedAt ||= Date.now(); await acceptReply(job, JSON.stringify(await mockReply(job))); return true; }
    if (job.state === "queued") {
      const health = await providerHealth(job.provider);
      if (health.disabledUntil > Date.now()) {
        const other = job.provider === "gemini" ? "chatgpt" : "gemini";
        if (!job.tried.includes(other) && (await providerHealth(other)).disabledUntil <= Date.now()) { job.provider = other; await write(`job:${job.id}`, job); } return true;
      }
      job.tried.push(job.provider); job.startedAt = Date.now(); job.state = "awaiting_reply";
      await write(`result:${job.id}`, null); await write(`result:${job.id}:repair`, null);
      job.tabId = await openPage(job.provider, job.provider === "gemini" ? "https://gemini.google.com/app" : "https://chatgpt.com/?temporary-chat=true", signal, true);
      await write(`job:${job.id}`, job);
      await command(job.tabId, { kind: "llm.run", jobId: job.id, prompt: job.promptText, search: job.requiresSources, first: job.timeouts.first, total: job.timeouts.total, repair: false }, signal);
      return true;
    }
    const saved = await read<unknown>(`result:${job.id}${job.repaired ? ":repair" : ""}`);
    const raw = saved ?? (job.tabId === null ? { state: "unknown" } : await command(job.tabId, { kind: "llm.status", jobId: job.id + (job.repaired ? ":repair" : "") }, signal));
    const result = resultSchema.parse(raw);
    if (result.state === "running") { if (Date.now() - job.startedAt > job.timeouts.total + 60000) await fail(job, "Worker recovery timeout"); return true; }
    if (result.state !== "done") { await fail(job, result.error ?? "Provider tab lost its pending job"); return true; }
    for (const note of result.notes ?? []) await event(note, "info", job.id);
    try { await acceptReply(job, result.text ?? ""); }
    catch (e) {
      if (e instanceof Halt) throw e;
      if (job.repaired || job.tabId === null) await fail(job, "Schema failure after repair");
      else {
        job.repaired = true; job.startedAt = Date.now(); await write(`job:${job.id}`, job);
        await command(job.tabId, { kind: "llm.run", jobId: `${job.id}:repair`, prompt: `Your last answer failed the required JSON schema. Return only corrected JSON matching the original requested schema. Do not add facts or instructions. Validation: ${String(e).slice(0, 1000)}`, search: job.requiresSources, first: job.timeouts.first, total: job.timeouts.total, repair: true }, signal);
      }
    }
  } catch (e) { if (e instanceof Halt || signal.aborted) throw e; await fail(job, e instanceof Error ? e.message : String(e)); }
  return true;
}
