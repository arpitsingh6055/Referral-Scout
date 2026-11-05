import "./styles.css";
import { appRoot, element, errorText } from "./render";
import { control } from "../shared/commands";
import type { snapshot } from "../background/controls";
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
const root = appRoot(); root.append(element("h1", "Cold Contact Pro"));
const notice = element("p"); notice.setAttribute("role", "status");
const toolbar = element("div"), content = element("div"); root.append(notice, toolbar, content);
let busy = false, last: Snapshot | null = null;
function button(label: string, action: () => Promise<void>, parent: HTMLElement = toolbar): HTMLButtonElement {
  const b = element("button", label); b.type = "button";
  b.addEventListener("click", () => { b.disabled = true; busy = true; void action().catch(e => { notice.textContent = errorText(e); }).finally(() => { b.disabled = false; busy = false; }); }); parent.append(b); return b;
}
const open = async (path: string) => { await chrome.tabs.create({ url: chrome.runtime.getURL(path) }); };
button("Set up from my CV", () => open("onboarding.html")); button("Settings", async () => chrome.runtime.openOptionsPage());
async function run(action: Parameters<typeof control>[0], extra: Parameters<typeof control>[1] = {}): Promise<void> { await control(action, extra); await refresh(); }
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = element("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function render(data: Snapshot): void {
  last = data; content.replaceChildren(); const c = data.campaign;
  content.append(element("h2", c ? `${c.mock ? "Mock test" : c.settings.mode === "dry-run" ? "Dry run" : "Autopilot"} · ${c.status}` : "Ready to set up"));
  content.append(element("p", c?.reason || (c ? "One step runs each minute. Outside sending hours, the campaign waits." : "Complete your profile in Settings, then start with drafts. No message is sent until you review ten real drafts and approve.")));
  const actions = element("div"); content.append(actions);
  if (!c || (c.mock && c.status !== "active")) button("Start campaign", () => run("start"), actions);
  if (c?.status === "active") button("Pause", () => run("pause"), actions);
  if (c && ["paused", "stopped"].includes(c.status)) button("Resume", () => run("resume"), actions);
  if (c && !["stopped", "complete"].includes(c.status)) button("Stop", () => run("stop"), actions);
  if (c?.status === "review" && !c.mock) button("Approve and switch to Autopilot", async () => {
    if (confirm("Have you reviewed all ten Gmail drafts? Approval enables sending and follow-ups within your limits.")) await run("approve", { confirm: true });
  }, actions);
  content.append(element("p", `Today's sends: ${data.todaySent} / ${data.budget?.slots.length ?? 0}. LinkedIn pages: ${data.budget?.search ?? 0} searches, ${data.budget?.profiles ?? 0} company/profile pages.`));
  const counts = Object.entries(data.leads.reduce<Record<string, number>>((acc, l) => { acc[l.stage] = (acc[l.stage] ?? 0) + 1; return acc; }, {}));
  content.append(element("p", counts.map(([stage, n]) => `${stage}: ${n}`).join(" · ") || "No contacts discovered yet."));
  const previews = element("details"); previews.append(element("summary", "Draft previews"));
  for (const lead of data.leads.filter(l => l.draft)) {
    const card = element("section"); card.append(element("h3", lead.name), element("p", `${lead.email} · ${lead.method} · ${lead.confirmed ? "address confirmed" : lead.method === "inferred-pattern" ? "target inferred; example confirmed" : "not confirmed"}`));
    card.append(element("strong", lead.subject), element("pre", lead.draft?.body ?? ""), element("p", "If this isn't relevant, reply 'no thanks' and I won't write again."));
    previews.append(card);
  } content.append(previews);
  const manual = element("details"); manual.open = data.leads.some(l => l.stage === "NeedsManual"); manual.append(element("summary", "Needs your attention"));
  for (const lead of data.leads.filter(l => l.stage === "NeedsManual" || (l.stage === "Skipped" && l.manualReason.includes("LinkedIn")))) {
    const card = element("section"); card.append(element("h3", lead.name), element("p", lead.manualReason));
    if (lead.pendingJob) {
      const box = element("textarea"); box.rows = 6; box.setAttribute("aria-label", `JSON reply for ${lead.name}`); box.placeholder = "Paste the provider's JSON reply"; card.append(box);
      button("Use this reply", () => run("manual", { id: lead.pendingJob, text: box.value }), card);
    }
    if (lead.sentAt || /send|Sent/.test(lead.manualReason)) button("Check Sent (never resend)", () => run("reconcile", { id: lead.id }), card);
    button("Skip contact", () => run("skip", { id: lead.id }), card); manual.append(card);
  } content.append(manual);
  const diagnostics = element("details"); diagnostics.append(element("summary", "Activity and diagnostics"));
  diagnostics.append(element("p", `Gemini: ${data.health.gemini.disabledUntil > Date.now() ? "cooling down" : "available"}. ChatGPT: ${data.health.chatgpt.disabledUntil > Date.now() ? "cooling down" : "available"}.`));
  for (const row of data.events) diagnostics.append(element("p", `${new Date(row.createdAt).toLocaleString()} · ${row.level} · ${row.message}`));
  button("Test AI bridge", () => run("probe"), diagnostics);
  button("Copy debug log", async () => { await navigator.clipboard.writeText(JSON.stringify({ health: last?.health, jobs: last?.jobs, events: last?.events }, null, 2)); notice.textContent = "Debug log copied. Review it before sharing."; }, diagnostics);
  content.append(diagnostics);
  button("Export send log", async () => { const csv = await control("export"); if (typeof csv !== "string") throw new Error("Invalid export"); download("cold-contact-send-log.csv", csv, "text/csv;charset=utf-8"); }, content);
  button("Delete all extension data", async () => { if (confirm("Delete your profile, campaign records, drafts in the dashboard and logs? Gmail messages/drafts and AI website history will not be deleted.")) { await control("delete", { confirm: true }); notice.textContent = "Extension data deleted."; await refresh(); } }, content);
}
async function refresh(): Promise<void> { render(await control("status") as Snapshot); }
void refresh().catch(e => { notice.textContent = errorText(e); });
const timer = setInterval(() => { if (!busy) void refresh().catch(e => { notice.textContent = errorText(e); }); }, 5000);
addEventListener("pagehide", () => clearInterval(timer), { once: true });
