import "./styles.css";
import { loadSettings, saveSettings } from "../storage/settings";
import { campaignSchema, profileSchema, readiness } from "../shared/schemas";
import { checkTab } from "../shared/messages";
import { siteForHost } from "../shared/selectors.config";
import { put } from "../storage/database";
import { appRoot, element, errorText } from "./render";
import { field, lines, proofLines, type Control } from "./fields";
import { profileImport } from "./profile-import";

const root = appRoot();
const setupLink = element("a", "Set up from your CV — guided setup"); setupLink.href = chrome.runtime.getURL("onboarding.html"); root.append(setupLink);
root.append(element("p", "Provider preference: ChatGPT for email writing and CV extraction; Gemini for company, contact, and role research."));
root.append(element("h1", "Cold Contact Pro"), element("p", "Phase 1 • Settings and read-only diagnostics. Campaign execution is not available yet."));
const status = element("p"); status.setAttribute("role", "status");
const form = element("form");
const fields = new Map<string, Control>();
const add = (section: HTMLElement, id: string, label: string, value: string | number | boolean, type = "text") => fields.set(id, field(section, id, label, value, type));
const value = (id: string) => { const control = fields.get(id); if (!control) throw new Error(`Missing field ${id}`); return control.value; };
const checked = (id: string) => (fields.get(id) as HTMLInputElement).checked;
const section = (title: string) => { const part = element("fieldset"); part.append(element("legend", title)); form.append(part); return part; };
async function main(): Promise<void> {
  const { profile, campaign } = await loadSettings();
  const p = section("Your profile");
  for (const [id, label, type] of [
    ["name", "Name", "text"], ["gmail", "Sending Gmail address", "email"], ["accountIndex", "Gmail account index", "number"],
    ["education", "Degree, college, graduation year", "textarea"], ["target", "Target roles", "textarea"],
    ["resumeUrl", "Resume URL", "url"], ["availability", "Start date, duration, remote/onsite city", "textarea"],
    ["writingStyle", "Email writing style", "textarea"]
  ] as const) add(p, id, label, profile[id], type);
  add(p, "proofPoints", "Proof points — one ID | evidence per line", profile.proofPoints.map(v => `${v.id} | ${v.text}`).join("\n"), "textarea");
  p.append(element("p", `Tone: ${profile.tone}`));
  const targeting = section("Campaign settings");
  for (const [id, label] of [["cities", "Target cities"], ["keywords", "Industry keywords"], ["holidays", "Holidays to skip (YYYY-MM-DD)"]] as const)
    add(targeting, id, `${label} — one per line`, campaign[id].join("\n"), "textarea");
  const numeric = {
    minEmployees: "Minimum company size", maxEmployees: "Maximum company size", targetSends: "Target sent emails",
    dailyHardCap: "Daily hard maximum (up to 25)", patternDailyCap: "Pattern emails per day (up to 3)",
    searchPageBudget: "Daily search pages (up to 10)", profilePageBudget: "Daily company/profile pages (up to 40)",
    firstTokenSeconds: "First token timeout, seconds", totalSeconds: "Total timeout, seconds", webSeconds: "Web-search timeout, seconds"
  } as const;
  for (const [id, label] of Object.entries(numeric)) add(targeting, id, label, campaign[id as keyof typeof numeric], "number");
  add(targeting, "windowStart", "Sending window starts", campaign.windowStart, "time");
  add(targeting, "windowEnd", "Sending window ends", campaign.windowEnd, "time");
  targeting.append(element("p", "Monday–Friday • Asia/Kolkata • Ramp: sending days 1–3: 5; 4–7: 10; 8–14: 15; then 20. Daily hard cap still applies."));
  targeting.append(element("p", "Mode: Dry run. Autopilot requires a later ten-draft review and explicit approval."));
  add(targeting, "allowPatternInferred", "Allow sourced pattern inference (off by default; disabled after any pattern bounce)", campaign.allowPatternInferred, "checkbox");
  add(targeting, "mockMode", "Use mock provider replies when the bridge is available", campaign.mockMode, "checkbox");
  const exclusions = section("Exclusions");
  add(exclusions, "domainAliases", "Known company domain aliases (JSON object; optional)", JSON.stringify(campaign.domainAliases, null, 2), "textarea");
  for (const [id, label] of [["optOutPeople", "Opt-out people (name, email or profile URL)"], ["optOutDomains", "Opt-out domains"], ["alreadyContacted", "Already contacted (email or profile URL)"]] as const)
    add(exclusions, id, `${label} — one per line`, campaign[id].join("\n"), "textarea");
  const save = element("button", "Save settings"); save.type = "submit"; form.append(save);
  form.addEventListener("submit", event => {
    event.preventDefault(); save.disabled = true;
    void (async () => {
      const nextProfile = profileSchema.parse({ ...profile, name: value("name"), gmail: value("gmail"), accountIndex: Number(value("accountIndex")),
        education: value("education"), target: value("target"), resumeUrl: value("resumeUrl"), availability: value("availability"), writingStyle: value("writingStyle"), proofPoints: proofLines(value("proofPoints")) });
      const numbers = Object.fromEntries(Object.keys(numeric).map(id => [id, Number(value(id))]));
      const nextCampaign = campaignSchema.parse({ ...campaign, ...numbers, domainAliases: JSON.parse(value("domainAliases") || "{}") as unknown, mode: "dry-run", cities: lines(value("cities")), keywords: lines(value("keywords")),
        holidays: lines(value("holidays")), windowStart: value("windowStart"), windowEnd: value("windowEnd"), allowPatternInferred: checked("allowPatternInferred"),
        mockMode: checked("mockMode"), optOutPeople: lines(value("optOutPeople")), optOutDomains: lines(value("optOutDomains")), alreadyContacted: lines(value("alreadyContacted")) });
      await saveSettings(nextProfile, nextCampaign);
      const problems = readiness(nextProfile, nextCampaign, await chrome.permissions.contains({ origins: ["https://*/*"] }));
      status.textContent = problems.length ? `Saved as incomplete: ${problems.join("; ")}. Campaign execution is unavailable in Phase 1.` : "Saved. Profile is complete; campaign execution arrives in later phases.";
    })().catch(e => { status.textContent = errorText(e); }).finally(() => { save.disabled = false; });
  });
  root.append(form, status, profileImport());
  const tools = element("section"); tools.append(element("h2", "Source permission and diagnostics"));
  const permissionStatus = element("p");
  const permission = element("button", "Allow HTTPS source confirmation"); permission.type = "button";
  const updatePermission = async () => { permissionStatus.textContent = await chrome.permissions.contains({ origins: ["https://*/*"] }) ? "Source permission granted. This does not enable Autopilot." : "Source permission missing: Dry run only."; };
  permission.addEventListener("click", () => {
    // Request directly within the user gesture, before any await.
    void chrome.permissions.request({ origins: ["https://*/*"] }).then(updatePermission).catch(e => { status.textContent = errorText(e); });
  });
  const health = element("button", "Check selectors in open tabs"); health.type = "button";
  const report = element("pre"); report.setAttribute("aria-live", "polite");
  health.addEventListener("click", () => {
    health.disabled = true; report.textContent = "Checking open tabs…";
    void (async () => {
      const tabs = await chrome.tabs.query({});
      const output: string[] = [], seen = new Set<string>();
      for (const tab of tabs) {
        if (tab.id === undefined || !tab.url) continue;
        const site = siteForHost(new URL(tab.url).hostname); if (!site) continue; seen.add(site);
        try { const r = await checkTab(tab.id); output.push(`${r.site}: ${r.ok ? "PASS for stated scope" : "NEEDS ATTENTION"}\n${r.scope}\n${r.checks.map(c => `${c.found ? "✓" : "✗"} ${c.name}`).join("\n")}\n${r.warnings.join("\n")}`); }
        catch (e) { output.push(`${site}: ${errorText(e)}. Reload this tab after installing/updating the extension.`); }
      }
      for (const site of ["linkedin", "gmail", "gemini", "chatgpt"]) if (!seen.has(site)) output.push(`${site}: no open tab`);
      report.textContent = output.join("\n\n");
      await put("meta", { id: "last-health-report", value: { at: Date.now(), text: report.textContent } });
    })().catch(e => { report.textContent = errorText(e); }).finally(() => { health.disabled = false; });
  });
  tools.append(permissionStatus, permission, element("p", "Open LinkedIn company results, Gmail with an empty compose, and fresh provider chats. These checks do not type, click, or send anything."), health, report);
  root.append(tools); await updatePermission();
}
void main().catch(e => { root.append(element("p", `Settings could not be loaded: ${errorText(e)}`)); });
