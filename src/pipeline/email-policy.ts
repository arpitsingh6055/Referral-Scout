import type { Campaign, Lead } from "../shared/runtime";
import { confirmSource, checkMx } from "./sources";
import { emailErrors } from "../validators/email";
import { inferPattern } from "../validators/pattern";
import { read } from "../storage/state";
export async function tryPattern(lead: Lead, c: Campaign, signal: AbortSignal): Promise<boolean> {
  if (!c.settings.allowPatternInferred || !c.settings.patternDailyCap || await read("suspect:inferred-pattern") || !lead.pattern || !lead.patternUrl || !lead.contact) return false;
  const source = await confirmSource(lead.patternUrl, "", signal);
  const examples = source.text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  for (const example of examples) {
    const address = inferPattern(lead.pattern, lead.contact.name, lead.domain, example); if (!address) continue;
    lead.email = address; lead.method = "inferred-pattern"; lead.patternExample = example;
    lead.sourceUrl = lead.patternUrl; lead.evidence = `Target inferred, not published. Pattern ${lead.pattern}; literal published example: ${example}`;
    lead.confirmed = false; return true;
  } return false;
}
export async function validateContact(lead: Lead, c: Campaign, signal: AbortSignal): Promise<string[]> {
  const permitted = c.mock || await chrome.permissions.contains({ origins: ["https://*/*"] });
  if (c.mock) { lead.confirmed = true; lead.mx = true; }
  else {
    if (!lead.confirmed && lead.method !== "inferred-pattern" && permitted) lead.confirmed = (await confirmSource(lead.sourceUrl, lead.email, signal)).confirmed;
    lead.mx = await checkMx(lead.email.split("@")[1] ?? "", signal);
  }
  let errors = emailErrors({ address: lead.email, companyDomain: lead.domain, aliases: c.settings.domainAliases[lead.domain] ?? [], method: lead.method, sourceUrl: lead.sourceUrl, confirmed: lead.confirmed, allowPattern: c.settings.allowPatternInferred, patternSourced: !!lead.patternExample, patternSentToday: 0, patternBounced: !!await read("suspect:inferred-pattern") });
  if (!permitted && c.settings.mode === "dry-run") errors = errors.filter(v => v !== "Published address needs a confirmed source");
  if (lead.method === "published-role-address") {
    try { if (![lead.domain, ...(c.settings.domainAliases[lead.domain] ?? [])].includes(new URL(lead.sourceUrl).hostname.replace(/^www\./, ""))) errors.push("Role address must be published on the company's own website"); } catch { errors.push("Invalid role source"); }
  }
  if (!lead.mx) errors.push("No usable MX records"); return errors;
}
