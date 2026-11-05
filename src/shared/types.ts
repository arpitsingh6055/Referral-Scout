export const stages = ["Discovered", "Vetted", "PeopleFound", "EmailFound", "RolesChecked", "Drafted", "Queued", "DryRunFilled", "Sent", "Replied", "Bounced", "Skipped", "NeedsManual"] as const;
export type Stage = typeof stages[number];
export type Provider = "gemini" | "chatgpt";
export type EmailMethod = "verified-linkedin" | "published-web" | "published-role-address" | "inferred-pattern";
export interface Base { id: string; createdAt: number; updatedAt: number; stage: Stage }
export interface Company extends Base { name: string; url: string; domain: string | null; score: number; breakdown: Record<string, number> }
export interface Person extends Base { companyId: string; name: string; profileUrl: string; title: string; location: string }
export interface Email extends Base { personId: string; address: string; method: EmailMethod; sourceUrl: string | null; evidenceQuote: string; confirmed: boolean; mxCheckedAt: number | null }
export interface Role extends Base { companyId: string; title: string; posted: boolean; sourceUrl: string | null }
export interface Draft extends Base { personId: string; subjectA: string; subjectB: string; body: string; provider: Provider; proofPointId: string }
export interface Send extends Base { personId: string; companyId: string; emailId: string; draftId: string; subjectVariant: "a" | "b"; sentAt: number | null; threadId: string | null }
export interface Event { id: string; createdAt: number; level: "info" | "warning" | "error"; message: string; jobId: string | null }
export interface Meta { id: string; value: unknown }
export interface Records { company: Company; person: Person; email: Email; role: Role; draft: Draft; send: Send; event: Event; meta: Meta }
export type Store = keyof Records;
