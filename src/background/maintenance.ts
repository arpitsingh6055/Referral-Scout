import { all, clearDatabase, remove } from "../storage/database";
import { campaign, leads, logs, write } from "../storage/state";
import type { Job } from "../shared/runtime";
export function csvCell(value: unknown): string {
  let text = String(value ?? ""); if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export async function exportCsv(): Promise<string> {
  const rows = await logs(), columns = ["email", "sourceUrl", "evidence", "confirmed", "timestamp", "subject", "provider", "state", "method", "followup", "mock"];
  return [columns.map(csvCell).join(","), ...rows.sort((a, b) => a.at - b.at).map(r => [r.email, r.sourceUrl, r.evidence, r.confirmed, new Date(r.at).toISOString(), r.subject, r.provider, r.state, r.method, r.followup, r.mock].map(csvCell).join(","))].join("\r\n");
}
export async function retain(now = Date.now()): Promise<void> {
  const day = 86400000, expired = new Set<string>();
  for (const lead of await leads()) if (now - lead.createdAt >= 180 * day || (["Skipped", "Bounced"].includes(lead.stage) && now - lead.updatedAt >= 90 * day)) {
    expired.add(lead.id); await remove("meta", `lead:${lead.id}`);
    for (const name of ["company", "person", "email", "role", "draft"] as const) await remove(name, lead.id);
  }
  for (const log of await logs()) if (expired.has(log.leadId) || now - log.at >= 180 * day) { await remove("meta", `sendlog:${log.id}`); await remove("send", log.id); }
  for (const entry of await all("meta")) {
    const value = entry.value as Record<string, unknown> | null;
    if (entry.id.startsWith("job:")) {
      const job = value as unknown as Job;
      if (now - job.createdAt >= 180 * day || [...expired].some(id => job.id.startsWith(id + ":"))) { await remove("meta", entry.id); await remove("meta", `result:${job.id}`); await remove("meta", `result:${job.id}:repair`); }
    } else if (entry.id.startsWith("auto:") && [...expired].some(id => entry.id.includes(id))) await remove("meta", entry.id);
    else if (entry.id === "cv-task" && typeof value?.startedAt === "number" && now - value.startedAt > day) await remove("meta", entry.id);
  }
  for (const entry of await all("event")) if (now - entry.createdAt >= 180 * day) await remove("event", entry.id);
  const settingsAt = (await chrome.storage.sync.get("settingsUpdatedAt")).settingsUpdatedAt as number | undefined;
  const c = await campaign();
  if (c && now - c.startedAt >= 180 * day) { await clearDatabase(); await chrome.storage.sync.clear(); chrome.power.releaseKeepAwake(); }
  else if (settingsAt && now - settingsAt >= 180 * day && c?.status !== "active") await chrome.storage.sync.clear();
  await write("last-retention", now);
}
