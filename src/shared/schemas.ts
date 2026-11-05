import { z } from "zod";
import { httpUrl } from "../validators/security";

const text = (max: number) => z.string().trim().max(max).refine(v => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v), "Control characters are not allowed");
const list = (max = 200) => z.array(text(200).min(1)).max(max);
export const urlSchema = text(2048).refine(httpUrl, "Use an absolute http/https URL without credentials");
export const domainSchema = z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
export const proofSchema = z.strictObject({ id: z.string().regex(/^P[1-9]\d{0,2}$/), text: text(500).min(1) });
export const profileSchema = z.strictObject({
  name: text(100), gmail: z.union([z.literal(""), z.email()]), accountIndex: z.int().min(0).max(20),
  education: text(300), target: text(200), proofPoints: z.array(proofSchema).max(10),
  resumeUrl: z.union([z.literal(""), urlSchema]), availability: text(300),
  tone: z.literal("concise, specific, respectful, no flattery")
}).refine(p => new Set(p.proofPoints.map(v => v.id)).size === p.proofPoints.length, "Proof-point IDs must be unique");
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
}, "Invalid calendar date");
export const campaignSchema = z.strictObject({
  cities: list(30).min(1), keywords: list(30).min(1), minEmployees: z.int().min(11).max(500), maxEmployees: z.int().min(11).max(500),
  targetSends: z.int().min(1).max(10000), windowStart: clock, windowEnd: clock,
  timezone: z.literal("Asia/Kolkata"), holidays: z.array(dateSchema).max(100),
  mode: z.enum(["dry-run", "autopilot"]), allowPatternInferred: z.boolean(), patternDailyCap: z.int().min(0).max(3),
  dailyHardCap: z.int().min(1).max(25), searchPageBudget: z.int().min(1).max(10), profilePageBudget: z.int().min(1).max(40),
  optOutPeople: list(), optOutDomains: z.array(domainSchema).max(200), alreadyContacted: list(),
  mockMode: z.boolean(), firstTokenSeconds: z.int().min(5).max(60), totalSeconds: z.int().min(20).max(300), webSeconds: z.int().min(30).max(300)
}).refine(s => s.minEmployees <= s.maxEmployees, "Minimum size exceeds maximum")
  .refine(s => s.windowStart < s.windowEnd, "Sending window must end after it starts")
  .refine(s => s.firstTokenSeconds < s.totalSeconds && s.totalSeconds <= s.webSeconds, "Timeouts must increase: first token, total, web");
export type Profile = z.infer<typeof profileSchema>;
export type CampaignSettings = z.infer<typeof campaignSchema>;
export function readiness(profile: Profile, settings: CampaignSettings, sourcePermission: boolean): string[] {
  const errors: string[] = [];
  for (const key of ["name", "gmail", "education", "target", "resumeUrl", "availability"] as const)
    if (!profile[key] || /\[(?:YOUR|DEGREE|URL|START)/i.test(profile[key])) errors.push(`Complete ${key}`);
  if (!profile.proofPoints.length) errors.push("Add at least one proof point");
  if (settings.mode === "autopilot" && !sourcePermission) errors.push("Autopilot requires source-confirmation permission");
  return errors;
}
