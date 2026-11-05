import { z } from "zod";
import { urlSchema } from "../shared/schemas";
import { draftSchema } from "../validators/draft";
const bounded = z.string().max(2000), urls = z.array(urlSchema).max(30);
export const schemas = {
  vet: z.strictObject({ is_active: z.boolean(), funding_summary: bounded, india_presence: z.boolean(), red_flags: z.array(bounded).max(20), source_urls: urls }),
  email: z.strictObject({ email: z.email().nullable(), source_url: urlSchema.nullable(), evidence_quote: bounded.nullable(), company_email_pattern: z.string().max(200).nullable(), pattern_example_url: urlSchema.nullable(), confidence: z.enum(["published", "pattern_only", "not_found"]) }),
  roleEmail: z.strictObject({ email: z.email().nullable(), source_url: urlSchema.nullable(), evidence_quote: bounded.nullable() }),
  roles: z.strictObject({ roles: z.array(z.strictObject({ title: z.string().min(1).max(200), source_url: urlSchema })).max(30), source_urls: urls }),
  draft: draftSchema, followup: draftSchema, probe: z.strictObject({ ok: z.literal(true) })
};
export function hasSources(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, v] of Object.entries(value)) {
    if ((key === "source_url" || key === "pattern_example_url") && typeof v === "string" && urlSchema.safeParse(v).success) return true;
    if (key === "source_urls" && Array.isArray(v) && v.some(u => urlSchema.safeParse(u).success)) return true;
    if (key === "roles" && Array.isArray(v) && v.some(hasSources)) return true;
  } return false;
}
export const resultSchema = z.strictObject({ state: z.enum(["running", "done", "failed", "unknown"]), text: z.string().max(100000).optional(), sources: z.array(urlSchema).max(100).optional(), error: z.string().max(2000).optional(), notes: z.array(z.string().max(500)).max(10).optional() });
