import { domainSchema } from "../shared/schemas";
import { httpUrl } from "./security";
import type { EmailMethod } from "../shared/types";

export function emailSyntax(address: string): boolean {
  const parts = address.split("@");
  const local = parts[0], domain = parts[1];
  return parts.length === 2 && !/\s/.test(address) && address.length <= 254 && !!local && local.length <= 64 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) && !local.startsWith(".") && !local.endsWith(".") &&
    !local.includes("..") && domainSchema.safeParse(domain).success;
}
export function sourceContainsEmail(text: string, mailtos: string[], address: string): boolean {
  if (!emailSyntax(address)) return false;
  const expected = address.toLowerCase();
  const visible = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  if (visible.some(v => v.toLowerCase() === expected)) return true;
  return mailtos.some(href => {
    if (!/^mailto:/i.test(href)) return false;
    try { return decodeURIComponent(href.slice(7).split("?")[0] ?? "").split(",").some(v => v.trim().toLowerCase() === expected); }
    catch { return false; }
  });
}
export function mxValid(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const value = response as { Status?: unknown; Answer?: unknown };
  return value.Status === 0 && Array.isArray(value.Answer) && value.Answer.some((v: unknown) => {
    if (!v || typeof v !== "object") return false;
    const record = v as { type?: unknown; data?: unknown };
    if (record.type !== 15 || typeof record.data !== "string") return false;
    const match = /^(\d{1,5})\s+([^\s]+)\.?$/.exec(record.data.trim());
    return !!match && Number(match[1]) <= 65535 && domainSchema.safeParse(match[2]?.replace(/\.$/, "")).success;
  });
}
export interface EmailCandidate {
  address: string; companyDomain: string; aliases: string[]; method: EmailMethod;
  sourceUrl: string | null; confirmed: boolean; allowPattern: boolean; patternSourced: boolean; patternSentToday: number; patternBounced: boolean;
}
export function emailErrors(c: EmailCandidate): string[] {
  const errors: string[] = [];
  if (!emailSyntax(c.address)) errors.push("Invalid email syntax");
  const domain = c.address.split("@")[1]?.toLowerCase() ?? "";
  const free = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "proton.me", "protonmail.com"].includes(domain);
  const sourced = !!c.sourceUrl && httpUrl(c.sourceUrl) && c.confirmed;
  if (![c.companyDomain, ...c.aliases].map(v => v.toLowerCase()).includes(domain) && !(free && sourced)) errors.push("Domain does not match company or known alias");
  if (free && !sourced) errors.push("Free-mail address needs literal source confirmation");
  if (c.method === "inferred-pattern") {
    if (!c.allowPattern || !c.patternSourced || c.patternSentToday >= 3 || c.patternBounced || free) errors.push("Pattern inference is not permitted");
    if (!c.sourceUrl || !httpUrl(c.sourceUrl)) errors.push("Pattern example needs a valid source URL");
  } else if (!sourced) errors.push("Published address needs a confirmed source");
  if (c.method === "published-role-address" && !/^(careers|jobs|hr|talent|people|recruiting)@/i.test(c.address)) errors.push("Not an allowed role address");
  return errors;
}
