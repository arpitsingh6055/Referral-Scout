import type { Campaign } from "../shared/runtime";
import { openPage } from "./browser";
import { checkTab } from "../shared/messages";
import { write, event } from "../storage/state";
import { Halt } from "./safety";
export async function campaignHealth(c: Campaign, signal: AbortSignal): Promise<void> {
  if (c.mock) { c.healthAt = Date.now(); await write("campaign", c); return; }
  const checks: string[] = [];
  const urls = [
    ["linkedin", "https://www.linkedin.com/search/results/companies/?keywords=" + encodeURIComponent(c.settings.keywords[0] ?? "AI")],
    ["gmail-health", `https://mail.google.com/mail/u/${c.profile.accountIndex}/?view=cm&fs=1`],
    ["gemini", "https://gemini.google.com/app"], ["chatgpt", "https://chatgpt.com/?temporary-chat=true"]
  ];
  for (const pair of urls) {
    const key = pair[0], url = pair[1]; if (!key || !url) continue;
    const tabId = await openPage(key, url, signal); const report = await checkTab(tabId);
    checks.push(`${report.site}: ${report.ok ? "ready" : "needs attention"} ${report.checks.filter(v => !v.found).map(v => v.name).join(", ")} ${report.warnings.join("; ")}`);
    if (!report.ok) { await write("last-health-report", { at: Date.now(), text: checks.join("\n") }); throw new Halt(`Health check failed: ${checks.at(-1)}. Inspect the automation window and Resume after fixing it.`); }
    if (key === "gmail-health") await chrome.tabs.remove(tabId).catch(() => undefined);
  }
  c.healthAt = Date.now(); await write("campaign", c); await write("last-health-report", { at: Date.now(), text: checks.join("\n") }); await event("Website health checks passed");
}
