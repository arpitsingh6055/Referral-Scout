import type { Campaign, CompanyCard, DayBudget, Lead } from "../shared/runtime";
import { read, write, leads, saveLead } from "../storage/state";
import { localTime, sendSlots, ramp } from "../shared/time";
import { logs } from "../storage/state";
import { openPage, command, delay } from "../background/browser";
export async function today(c: Campaign): Promise<DayBudget> {
  const day = localTime().day, old = await read<DayBudget>(`day:${day}`); if (old) return old;
  const days = new Set((await logs()).filter(l => l.state === "sent" && !l.mock).map(l => localTime(l.at).day));
  const cap = ramp(days.has(day) ? days.size : days.size + 1, c.settings.dailyHardCap);
  const value: DayBudget = { day, search: 0, profiles: 0, actions: 0, nextAction: 0, slots: sendSlots(day, c.settings, cap) }; await write(`day:${day}`, value); return value;
}
export async function linkedinPage(c: Campaign, url: string, page: "companies" | "company" | "people" | "contact" | "jobs", signal: AbortSignal): Promise<unknown | undefined> {
  const budget = await today(c), search = page === "companies" || page === "people";
  if (Date.now() < budget.nextAction || (search ? budget.search >= c.settings.searchPageBudget : budget.profiles >= c.settings.profilePageBudget)) return undefined;
  if (search) budget.search++; else budget.profiles++;
  budget.actions += page === "contact" ? 2 : page === "company" ? 2 : 4;
  budget.nextAction = Date.now() + (budget.actions >= 15 ? 120000 + Math.random() * 180000 : 4000 + Math.random() * 6000);
  if (budget.actions >= 15) budget.actions = 0;
  await write(`day:${budget.day}`, budget);
  await delay(4000 + Math.random() * 6000, signal);
  const tabId = await openPage("linkedin", url, signal);
  return command(tabId, { kind: "linkedin.read", page }, signal, 90000);
}
export function newLead(card: CompanyCard, mock: boolean, id = card.url): Lead {
  return { ...card, id, createdAt: Date.now(), updatedAt: Date.now(), stage: "Discovered", domain: "", score: 0, breakdown: {}, contacts: [], contact: null, fact: "", factUrl: "", email: "", method: "published-web", sourceUrl: "", evidence: "", confirmed: false, mx: false, roles: [], role: "", suggested: false, draft: null, provider: "gemini", subject: "", attempts: 0, step: "company", manualReason: "", pendingJob: "", threadUrl: "", sentAt: 0, followups: 0, followupAfter: 0, optOut: false, mock };
}
export function scoreCompany(lead: CompanyCard, c: Campaign): Record<string, number> {
  const text = `${lead.industry} ${lead.description}`.toLowerCase();
  return { industry: c.settings.keywords.some(k => text.includes(k.toLowerCase())) ? 35 : 0,
    size: lead.employees !== null && lead.employees >= c.settings.minEmployees && lead.employees <= c.settings.maxEmployees ? 30 : 0,
    india: /india|bengaluru|bangalore|delhi|hyderabad|pune|mumbai|gurugram|gurgaon|noida|chennai/i.test(lead.location + " " + lead.description) ? 25 : 0,
    signals: /hiring|funding|raised|recruit|careers/i.test(text) ? 10 : 0 };
}
export async function discover(c: Campaign, signal: AbortSignal): Promise<void> {
  if (c.mock) {
    if (c.discoveryCursor >= 10) return;
    const n = c.discoveryCursor++;
    const lead = newLead({ name: `Example Product ${String.fromCharCode(65 + n)}`, url: `https://www.linkedin.com/company/example-${n}/`, industry: "AI SaaS", location: "Bengaluru, India", description: "Product workflow software. Hiring in India.", employees: 50 }, true, `mock-${n}`);
    await saveLead(lead); await write("campaign", c); return;
  }
  const combinations = c.settings.keywords.length * c.settings.cities.length;
  const cursor = c.discoveryCursor, pair = cursor % combinations;
  const keyword = c.settings.keywords[pair % c.settings.keywords.length] ?? "AI", city = c.settings.cities[Math.floor(pair / c.settings.keywords.length)] ?? "India";
  const url = new URL("https://www.linkedin.com/search/results/companies/"); url.searchParams.set("keywords", `${keyword} ${city}`); url.searchParams.set("page", String(Math.floor(cursor / combinations) + 1));
  const result = await linkedinPage(c, url.href, "companies", signal); if (!result) return;
  const cards = result as CompanyCard[]; const existing = new Set((await leads()).map(l => l.url));
  for (const card of cards) if (!existing.has(card.url)) await saveLead(newLead(card, false));
  c.discoveryCursor++; await write("campaign", c);
}
