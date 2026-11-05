import type { Campaign, Lead, Contact } from "../shared/runtime";
import { saveLead, write } from "../storage/state";
import { enqueue } from "../bridge/runner";
import { schemas } from "../bridge/schemas";
import { vettingPrompt, emailPrompt, roleAddressPrompt, rolesPrompt } from "../shared/prompts";
import { linkedinPage, scoreCompany } from "./discovery";
import { emailSyntax } from "../validators/email";
import { tryPattern, validateContact } from "./email-policy";
export async function manual(lead: Lead, reason: string): Promise<void> { if (lead.stage !== "NeedsManual") lead.resumeStage = lead.stage; lead.stage = "NeedsManual"; lead.manualReason = reason; await saveLead(lead); }
export async function jobResult(lead: Lead, kind: Parameters<typeof enqueue>[1], prompt: string, sourced: boolean) {
  const id = `${lead.id}:${kind}:${lead.contact?.url ?? "company"}:${kind === "followup" ? lead.followups : 0}:${lead.attempts}`; lead.pendingJob = id; await saveLead(lead);
  const job = await enqueue(id, kind, prompt, sourced);
  if (job.state === "manual") { await manual(lead, `Both providers failed: ${job.error}. Paste a valid JSON reply below.`); return undefined; }
  if (job.state === "not_found") return null;
  if (job.state !== "done") return undefined;
  lead.provider = job.provider; lead.pendingJob = ""; return job.result;
}
export function chooseContacts(contacts: Contact[], company: string, employees: number | null): Contact[] {
  const rank = (p: Contact) => /talent acquisition/i.test(p.title) ? 0 : /product/i.test(p.title) ? 1 : /recruiter|recruiting/i.test(p.title) ? 2 : /HR|people/i.test(p.title) ? 3 : 4;
  return contacts.filter(p => /india|bengaluru|bangalore|delhi|hyderabad|pune|mumbai|gurugram|gurgaon|noida|chennai/i.test(p.location) && p.title.toLowerCase().includes(company.toLowerCase()) &&
    (/talent acquisition|recruiter|recruiting|\bHR\b|people operations|head of people|product.*(?:head|lead|manager)|(?:head|lead|manager).*product/i.test(p.title) || (employees !== null && employees < 50 && /founder/i.test(p.title)))).sort((a, b) => rank(a) - rank(b));
}
export async function qualify(lead: Lead, c: Campaign, signal: AbortSignal): Promise<void> {
  if (lead.stage === "Discovered") {
    if (lead.step === "company") {
      if (c.mock) { lead.domain = `example${lead.id.replace(/\D/g, "")}.test`; }
      else {
        const info = await linkedinPage(c, `${lead.url.replace(/\/$/, "")}/about/`, "company", signal) as { domain: string; description: string; employees: number | null } | undefined;
        if (!info) return; lead.domain = info.domain; lead.description = info.description || lead.description; lead.employees = info.employees ?? lead.employees;
      }
      lead.breakdown = scoreCompany(lead, c); lead.score = Object.values(lead.breakdown).reduce((a, b) => a + b, 0);
      if (lead.score < 60 || lead.employees === null || lead.employees < c.settings.minEmployees || lead.employees > c.settings.maxEmployees) { lead.stage = "Skipped"; lead.manualReason = "Company size/score not eligible"; }
      else if (!lead.domain) { await manual(lead, "Company's own website domain could not be read from LinkedIn"); return; }
      else lead.step = "vet";
    } else {
      const raw = await jobResult(lead, "vet", vettingPrompt(lead.name, lead.domain), true); if (raw === undefined) return;
      const vet = raw === null ? null : schemas.vet.parse(raw);
      if (!vet?.is_active || !vet.india_presence || vet.red_flags.length) { lead.stage = "Skipped"; lead.manualReason = "Inactive, no India presence, red flags, or no sourced result"; }
      else { lead.fact = vet.funding_summary; lead.factUrl = vet.source_urls[0] ?? ""; lead.stage = "Vetted"; }
    }
  } else if (lead.stage === "Vetted") {
    if (c.mock) lead.contacts = [{ name: `Contact${String.fromCharCode(65 + Number(lead.id.replace(/\D/g, "")))} Recruiter`, title: `Talent Acquisition at ${lead.name}`, location: "Bengaluru, India", url: "https://www.linkedin.com/in/example/", firstDegree: false }];
    else {
      const url = new URL("https://www.linkedin.com/search/results/people/"); url.searchParams.set("keywords", `${lead.name} talent acquisition recruiter product manager India`);
      const people = await linkedinPage(c, url.href, "people", signal) as Contact[] | undefined; if (!people) return; lead.contacts = chooseContacts(people, lead.name, lead.employees);
    }
    lead.contact = lead.contacts[0] ?? null;
    if (!lead.contact) { lead.stage = "Skipped"; lead.manualReason = "No suitable India-based contact"; }
    else { lead.stage = "PeopleFound"; lead.step = "linkedin-email"; }
  } else if (lead.stage === "PeopleFound") {
    if (!lead.contact) return;
    if (lead.step === "linkedin-email") {
      if (lead.contact.firstDegree && !c.mock) {
        const found = await linkedinPage(c, lead.contact.url, "contact", signal) as { email: string | null } | undefined; if (!found) return;
        if (found.email && emailSyntax(found.email)) { lead.email = found.email; lead.method = "verified-linkedin"; lead.sourceUrl = lead.contact.url; lead.evidence = "First-degree LinkedIn contact overlay"; lead.confirmed = true; lead.step = "validate-email"; }
      }
      if (!lead.email) lead.step = "web-email";
    } else if (lead.step === "web-email" || lead.step === "role-email") {
      const role = lead.step === "role-email";
      const raw = await jobResult(lead, role ? "roleEmail" : "email", role ? roleAddressPrompt(lead.name, lead.domain) : emailPrompt(lead.contact.name, lead.contact.title, lead.name, lead.domain, lead.contact.url), true);
      if (raw === undefined) return;
      const result = raw === null ? null : role ? schemas.roleEmail.parse(raw) : schemas.email.parse(raw);
      if (!role && raw) { const published = schemas.email.parse(raw); lead.pattern = published.company_email_pattern ?? ""; lead.patternUrl = published.pattern_example_url ?? ""; }
      if (result?.email && result.source_url) {
        lead.email = result.email; lead.sourceUrl = result.source_url; lead.evidence = result.evidence_quote ?? ""; lead.method = role ? "published-role-address" : "published-web"; lead.step = "validate-email";
      } else if (!role) lead.step = "role-email";
      else if (await tryPattern(lead, c, signal)) lead.step = "validate-email";
      else if (lead.contacts.length > 1 && lead.contact.url === lead.contacts[0]?.url) { lead.contact = lead.contacts[1] ?? lead.contact; lead.step = "linkedin-email"; lead.pendingJob = ""; }
      else { lead.stage = "Skipped"; lead.manualReason = "Needs LinkedIn outreach — no usable public business email"; }
    } else {
      const errors = await validateContact(lead, c, signal);
      if (errors.length || !lead.mx) {
        if (lead.method !== "published-role-address" && lead.method !== "inferred-pattern") { lead.email = ""; lead.confirmed = false; lead.step = "role-email"; }
        else { lead.stage = "Skipped"; lead.manualReason = `Needs LinkedIn outreach — ${errors.join("; ") || "No usable MX"}`; }
      } else { lead.stage = "EmailFound"; lead.step = "linkedin-roles"; }
    }
  } else if (lead.stage === "EmailFound") {
    if (lead.step === "linkedin-roles") {
      if (!c.mock) { const roles = await linkedinPage(c, `${lead.url.replace(/\/$/, "")}/jobs/`, "jobs", signal) as Lead["roles"] | undefined; if (!roles) return; lead.roles = roles; }
      lead.step = "web-roles";
      if (lead.roles.length) { lead.role = lead.roles[0]?.title ?? "Product internship"; lead.suggested = false; lead.stage = "RolesChecked"; }
    } else {
      const raw = await jobResult(lead, "roles", rolesPrompt(lead.name, lead.domain), true); if (raw === undefined) return;
      lead.roles = raw === null ? [] : schemas.roles.parse(raw).roles; lead.role = lead.roles[0]?.title ?? "Product Management internship"; lead.suggested = !lead.roles.length; lead.stage = "RolesChecked";
    }
  }
  await saveLead(lead); await write("last-progress", Date.now());
}
