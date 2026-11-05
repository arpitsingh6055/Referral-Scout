import { z } from "zod";
import type { Profile } from "../shared/schemas";
export const draftSchema = z.strictObject({
  subject_a: z.string().min(1).max(120), subject_b: z.string().min(1).max(120), body: z.string().min(1).max(3000),
  role_referenced: z.string().min(1).max(200), proof_point_id: z.string().regex(/^P[1-9]\d{0,2}$/),
  personalization_hook: z.string().min(1).max(300), uses_unverified_fact: z.boolean()
});
export type DraftOutput = z.infer<typeof draftSchema>;
export const FOOTER = "If this isn't relevant, reply 'no thanks' and I won't write again.";
const tokens = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const grams = (s: string) => {
  const words = tokens(s), result = new Set<string>();
  for (let i = 0; i + 5 <= words.length; i++) result.add(words.slice(i, i + 5).join(" "));
  return result;
};
export function similarity(a: string, b: string): number {
  const left = grams(a), right = grams(b);
  const union = new Set([...left, ...right]);
  if (!union.size) return tokens(a).join(" ") === tokens(b).join(" ") ? 1 : 0;
  return [...left].filter(v => right.has(v)).length / union.size;
}
const containsWords = (body: string, text: string) => ` ${tokens(body).join(" ")} `.includes(` ${tokens(text).join(" ")} `);
const numbers = (s: string) => s.match(/\d+(?:[,.]\d+)*(?:%|[kKmM])?/g) ?? [];
export interface DraftContext { profile: Profile; firstName: string; company: string; roleAddress: boolean; suggestedRole: boolean; sentBodies: string[]; followup?: boolean }
export function draftErrors(input: unknown, ctx: DraftContext): string[] {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map(v => `${v.path.join(".")}: ${v.message}`);
  const d = parsed.data, errors: string[] = [];
  const words = d.body.trim().split(/\s+/).length;
  if (words >= (ctx.followup ? 60 : 120)) errors.push("Body exceeds word limit");
  const combined = `${d.subject_a}\n${d.subject_b}\n${d.body}`;
  if (/i hope this finds you well|\bpassionate\b|\bleverage\b|amazing company|incredible company|prestigious company/i.test(combined)) errors.push("Banned phrase or generic praise");
  if (/[<>]/.test(combined) || /\b[^\s@]+@[^\s@]+\.[^\s@]+/.test(combined)) errors.push("HTML or email address in draft");
  if (/[\r\n]/.test(d.subject_a + d.subject_b) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(combined)) errors.push("Control characters or subject line break");
  const urls = d.body.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  if (ctx.followup ? urls.length !== 0 : urls.length !== 1 || urls[0] !== ctx.profile.resumeUrl) errors.push("Resume URL rule failed");
  const withoutUrls = d.body.replace(/https?:\/\/[^\s<>"']+/gi, "");
  if (/www\.|\b[a-z0-9-]+\.(?:com|org|net|io|ai|in|dev|co)\b/i.test(withoutUrls + d.subject_a + d.subject_b)) errors.push("Additional link or domain");
  if (/https?:|mailto:|javascript:/i.test(d.subject_a + d.subject_b)) errors.push("Link in subject");
  const proof = ctx.profile.proofPoints.find(p => p.id === d.proof_point_id);
  if (!proof) errors.push("Unknown proof-point ID");
  else if ((` ${tokens(d.body).join(" ")} `.split(` ${tokens(proof.text).join(" ")} `).length - 1) !== 1)
    errors.push("Include the selected proof point exactly once, verbatim");
  const allowed = new Set(numbers(proof?.text ?? ""));
  const numericText = withoutUrls.replace(/\b15[- ]minute\b/gi, "");
  if (numbers(numericText).some(n => !allowed.has(n))) errors.push("Number not supported by selected proof point");
  for (const other of ctx.profile.proofPoints.filter(p => p.id !== d.proof_point_id))
    if (containsWords(d.body, other.text)) errors.push("More than one proof point");
  if (!containsWords(d.body, ctx.roleAddress ? "team" : ctx.firstName) || !containsWords(d.body, ctx.company)) errors.push("Missing recipient or company");
  if (d.uses_unverified_fact) errors.push("Unverified fact");
  if (ctx.suggestedRole && !/enquir|inquir/i.test(d.body)) errors.push("Suggested role must be an enquiry");
  if (ctx.suggestedRole && /applying|your (?:open|posted|advertised) (?:role|position|vacancy)/i.test(d.body)) errors.push("Suggested role presented as a posting");
  if (d.body.includes(FOOTER)) errors.push("Footer must be appended by code");
  if (ctx.sentBodies.slice(-30).some(body => similarity(d.body, body.replace(FOOTER, "")) >= 0.5)) errors.push("Too similar to a recently sent draft");
  return errors;
}
