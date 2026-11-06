import { z } from "zod";

export const DAY = 86400000;
export const networkKey = "network-v1";
export function profileUrl(value: string): string | null {
  try {
    const u = new URL(value, "https://www.linkedin.com");
    if (u.protocol !== "https:" || u.username || u.password || u.port || !["www.linkedin.com", "linkedin.com"].includes(u.hostname)) return null;
    const match = /^\/in\/([^/]+)\/?$/.exec(u.pathname);
    return match ? `https://www.linkedin.com/in/${match[1]}/` : null;
  } catch { return null; }
}
export const networkProfileSchema = z.object({ name: z.string().min(1).max(150), url: z.string().refine(v => profileUrl(v) === v), headline: z.string().max(500), location: z.string().max(200), about: z.string().max(3000), rawText: z.string().max(60000).optional() });
export type NetworkProfile = z.infer<typeof networkProfileSchema>;
export type ContactState = "shortlisted" | "requesting" | "pending" | "connected" | "messaging" | "messaged" | "attention" | "skipped";
export interface NetworkContact extends NetworkProfile {
  state: ContactState; reason: string; addedAt: number; requestedAt: number; checkedAt: number; messagedAt: number; message: string;
}
export interface NetworkState {
  profile: NetworkProfile | null; target: string; location: string; template: string;
  cv: { name: string; type: string; text: string; data: string; textVersion?: number } | null;
  dossier?: string;
  dossierSavedAt?: number;
  active: boolean; revision: number; status: string; contacts: NetworkContact[];
  searchCursor: number; nextDiscoveryAt: number; nextActionAt: number;
  actions: { at: number; kind: "connect" | "message"; url: string }[];
  intent: { id: string; tabId: number; url: string; kind: "connect" | "message"; at: number; body: string; revision: number; claimed: boolean } | null;
}
export const defaultTemplate = "Hi {firstName}, thanks for connecting! I’m exploring {target} opportunities and would love to learn whether there might be a fit on your team. Would you be open to a quick conversation?";
export function suggestedTarget(headline: string): string {
  for (const [pattern, target] of [[/product/i, "Product Management"], [/software|developer|programmer/i, "Software Engineering"], [/data|analytics/i, "Data Analytics"], [/design|\bUX\b|\bUI\b/i, "Product Design"], [/marketing|growth/i, "Marketing and Growth"], [/finance/i, "Finance"]] as const) if (pattern.test(headline)) return target;
  return "internship";
}
export function emptyNetwork(): NetworkState {
  return { profile: null, target: "Product Management internship", location: "India", template: defaultTemplate, cv: null, active: false, revision: 0, status: "", contacts: [], searchCursor: 0, nextDiscoveryAt: 0, nextActionAt: 0, actions: [], intent: null };
}
export function introduction(s: Pick<NetworkState, "template" | "target">, person: Pick<NetworkProfile, "name">): string {
  return s.template.replace(/\{firstName\}/g, person.name.split(/\s+/)[0] || person.name).replace(/\{target\}/g, s.target);
}
export function relevance(headline: string, target: string): string | null {
  if (/\brecruit(er|ing|ment)\b|talent acquisition|\bHR\b|people (?:partner|operations|lead|head)/i.test(headline)) return "Recruiting / people team";
  if (/\bfounder\b|co-founder|\bCEO\b/i.test(headline)) return "Founder / company leader";
  const words = target.toLowerCase().match(/[a-z]{3,}/g)?.filter(w => !["internship", "intern", "opportunities", "management", "role"].includes(w)) ?? [];
  if (/\b(head|lead|director|manager|VP)\b/i.test(headline) && words.some(w => headline.toLowerCase().includes(w))) return "Relevant team leader";
  return null;
}
export function nextContact(s: NetworkState, now = Date.now()): NetworkContact | undefined {
  const available = (kind: "connect" | "message") => s.actions.filter(a => a.kind === kind && now - a.at < DAY).length < 5;
  return s.contacts.find(p => p.state === "pending" && now - p.checkedAt >= DAY)
    ?? (available("message") ? s.contacts.find(p => p.state === "connected") : undefined)
    ?? (available("connect") && s.contacts.filter(p => p.state === "pending").length < 50 ? s.contacts.find(p => p.state === "shortlisted") : undefined);
}
export const networkRequest = z.discriminatedUnion("action", [
  z.object({ kind: z.literal("network"), action: z.literal("analyze") }),
  z.object({ kind: z.literal("network"), action: z.literal("status") }),
  z.object({ kind: z.literal("network"), action: z.literal("import") }),
  z.object({ kind: z.literal("network"), action: z.literal("start") }),
  z.object({ kind: z.literal("network"), action: z.literal("pause") }),
  z.object({ kind: z.literal("network"), action: z.literal("clear"), confirm: z.literal(true) }),
  z.object({ kind: z.literal("network"), action: z.literal("save"), target: z.string().trim().min(3).max(150), location: z.string().trim().max(150), template: z.string().trim().min(20).max(1500) }),
  z.object({ kind: z.literal("network"), action: z.literal("saveCv"), name: z.string().trim().min(1).max(200), type: z.string().max(120), text: z.string().max(200000), data: z.string().max(3000000) }),
  z.object({ kind: z.literal("network"), action: z.literal("prepare"), url: z.string() }),
  z.object({ kind: z.literal("network"), action: z.literal("skip"), url: z.string() })
]);
export type NetworkRequest = z.infer<typeof networkRequest>;
export const networkPageCommand = z.object({
  kind: z.literal("network.page"), requestId: z.uuid(), deadline: z.number(),
  action: z.enum(["identity", "profile", "search", "relationship", "connect", "message"]),
  url: z.string().default(""),   owner: z.string().default(""), intentId: z.string().default(""), body: z.string().max(2000).default(""), attachment: z.object({ name: z.string().max(200), type: z.string().max(120), data: z.string().max(3000000) }).nullable().default(null)
});
export type NetworkPageCommand = z.infer<typeof networkPageCommand>;
export const networkReplySchema = z.object({ requestId: z.uuid(), ok: z.boolean(), data: z.unknown().optional(), error: z.string().max(2000).optional() });

