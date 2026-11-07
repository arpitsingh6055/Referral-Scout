import { selectors as s } from "../shared/selectors.config";
import type { CompanyCard, Contact, FoundRole } from "../shared/runtime";
export const textOf = (node: Element | null): string => (node instanceof HTMLElement ? node.innerText || node.textContent : node?.textContent ?? "")?.replace(/\s+/g, " ").trim() ?? "";
export function first(root: ParentNode, variants: readonly string[]): Element | null { for (const q of variants) { const e = root.querySelector(q); if (e) return e; } return null; }
export function many(root: ParentNode, variants: readonly string[]): Element[] { for (const q of variants) { const es = [...root.querySelectorAll(q)]; if (es.length) return es; } return []; }
export function linkedUrl(href: string, kind: "company" | "in"): string | null {
  try { const u = new URL(href, "https://www.linkedin.com"); return u.protocol === "https:" && ["linkedin.com", "www.linkedin.com"].includes(u.hostname) && new RegExp(`^/${kind}/[^/]+/?$`).test(u.pathname) ? `https://www.linkedin.com${u.pathname.replace(/\/$/, "")}/` : null; } catch { return null; }
}
export function employeeCount(text: string): number | null {
  const match = /([\d,]+)\s*[-–]\s*([\d,]+)\s+employees/i.exec(text);
  return match?.[2] ? Number(match[2].replace(/,/g, "")) : null;
}
export function companyCards(doc: ParentNode): CompanyCard[] {
  const result = new Map<string, CompanyCard>();
  for (const card of many(doc, s.linkedin.cards)) {
    const link = first(card, s.linkedin.companyLink), url = linkedUrl(link?.getAttribute("href") ?? "", "company");
    const name = textOf(first(card, s.linkedin.title)) || textOf(link);
    if (url && name) result.set(url, { name, url, industry: textOf(first(card, s.linkedin.industry)), location: textOf(first(card, s.linkedin.location)), description: textOf(first(card, s.linkedin.summary)).slice(0, 1000), employees: employeeCount(textOf(card)) });
  } return [...result.values()];
}
export function peopleCards(doc: ParentNode): Contact[] {
  const result = new Map<string, Contact>();
  for (const card of many(doc, s.linkedin.cards)) {
    const link = first(card, s.linkedin.peopleLink), url = linkedUrl(link?.getAttribute("href") ?? "", "in");
    const name = textOf(first(card, s.linkedin.title)) || textOf(link);
    if (url && name) {
      const degreeText = textOf(first(card, s.linkedin.firstDegree)) || textOf(card), degree = /\b(1st|2nd|3rd)\b/.exec(degreeText)?.[1];
      result.set(url, { name, url, title: textOf(first(card, s.linkedin.industry)), location: textOf(first(card, s.linkedin.location)), firstDegree: degree === "1st", ...(degree ? { degree: Number(degree[0]) } : {}) });
    }
  } return [...result.values()];
}
export function jobCards(doc: ParentNode): FoundRole[] {
  return many(doc, s.linkedin.jobs).flatMap(card => {
    const link = first(card, s.linkedin.jobTitle), title = textOf(link), href = link?.getAttribute("href");
    if (!href || !/product|\bAPM\b|business analyst|growth/i.test(title)) return [];
    try { const u = new URL(href, "https://www.linkedin.com"); return u.protocol === "https:" && ["linkedin.com", "www.linkedin.com"].includes(u.hostname) && u.pathname.startsWith("/jobs/view/") ? [{ title, source_url: u.href }] : []; } catch { return []; }
  });
}
export function companyDetails(doc: ParentNode): { domain: string; description: string; employees: number | null } {
  const description = textOf(first(doc, s.linkedin.about)).slice(0, 2000);
  let domain = "";
  for (const a of many(doc, s.linkedin.website)) {
    try { const u = new URL(a.getAttribute("href") ?? ""); if (/^https?:$/.test(u.protocol) && !u.hostname.endsWith("linkedin.com")) { domain = u.hostname.replace(/^www\./, ""); break; } } catch { /* skip malformed public link */ }
  }
  return { domain, description, employees: employeeCount(description) };
}
