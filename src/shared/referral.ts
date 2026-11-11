import { z } from 'zod';
import { COMPANY_KINDS, classify, companyMatches, functionWords } from './targeting';

/*
 * Referrals for one job.
 *
 * From a LinkedIn job page the person can ask for two things:
 *   "referral"     find the people at that company most able to help (recruiters, the hiring team, founders,
 *                  and anyone they already know there) and reach out to them about this job;
 *   "connections"  only list the people they already know at that company, most useful first, without contacting anyone.
 *
 * LinkedIn's own "people you can reach out to" box is often filled with people who cannot help. This ranks by
 * who can actually move an application: recruiters first, then the hiring team, then founders, then other
 * employees, and within each group people the person already knows come first.
 */
export const referralJobInput = z.object({
  url: z.string().regex(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/$/),
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(1).max(200),
  location: z.string().max(200).default('')
});
export const referralMessage = z.object({ kind: z.literal('network.referral'), mode: z.enum(['referral', 'connections']), job: referralJobInput });
export interface ReferralJob extends z.infer<typeof referralJobInput> {
  mode: 'referral' | 'connections'; addedAt: number;
  /** How many of the planned searches are done. The scan is finished when this reaches the plan's length. */
  cursor: number; found: number; finishedAt?: number;
}
export interface ReferralSearch { label: string; keywords: string; network: ('F' | 'S' | 'O')[] }

/** The searches for one company, most valuable first. Four page loads at most. */
export function referralPlan(job: Pick<ReferralJob, 'company' | 'title' | 'mode'>): ReferralSearch[] {
  const company = `"${job.company.replace(/"/g, '')}"`, fn = functionWords([job.title])[0] ?? '';
  const everyone: ('F' | 'S' | 'O')[] = job.mode === 'connections' ? ['F'] : ['F', 'S', 'O'];
  return [
    { label: `recruiters at ${job.company}`, keywords: `${company} ${COMPANY_KINDS[0]}`, network: everyone },
    { label: `the hiring team at ${job.company}`, keywords: `${company} ${COMPANY_KINDS[1]} ${fn}`.trim(), network: everyone },
    { label: `founders at ${job.company}`, keywords: `${company} ${COMPANY_KINDS[2]}`, network: everyone },
    { label: `people you already know at ${job.company}`, keywords: company, network: ['F'] },
  ];
}

export type ReferralKind = 'recruiter' | 'leader' | 'founder' | 'employee';
export interface ReferralVerdict { kind: ReferralKind; score: number; reason: string }
const WEIGHT: Record<ReferralKind, number> = { recruiter: 300, leader: 260, founder: 220, employee: 150 };
const WHY: Record<ReferralKind, string> = { recruiter: 'Recruiter', leader: 'On the hiring team', founder: 'Founder', employee: 'Works there' };

/**
 * Whether this person can help with a referral at this company, and how much.
 * They must visibly work at the company. A plain employee only counts if the person already knows them (1st degree):
 * a stranger who is "just an engineer there" is exactly the unhelpful suggestion this is meant to avoid.
 */
export function rankReferral(person: { headline: string; current?: string | undefined; degree?: number | undefined }, job: Pick<ReferralJob, 'company' | 'title'>): ReferralVerdict | null {
  const evidence = `${person.current ?? ''} | ${person.headline}`;
  if (!companyMatches(evidence, job.company)) return null;
  if (/\b(former|ex[- ]|previously|retired|student|intern\b|aspiring|open to work|seeking)/i.test(person.headline)) return null;
  const kind: ReferralKind = classify({ headline: person.headline }, { roles: [job.title] })?.category ?? 'employee';
  const degree = person.degree ?? 3;
  if (kind === 'employee' && degree !== 1) return null;
  const score = WEIGHT[kind] + (degree === 1 ? 60 : degree === 2 ? 20 : 0);
  return { kind, score, reason: `${WHY[kind]} at ${job.company}${degree === 1 ? ', already your connection' : ''}. For: ${job.title}` };
}

const first = (name: string): string => name.split(/\s+/)[0] || name;
const role = (job: Pick<ReferralJob, 'title' | 'company'>): string => `the ${job.title} role at ${job.company}`;
/** Connection note for someone not yet connected. Within LinkedIn's 200 characters; shortened by the caller if a title is very long. */
export function referralNote(job: Pick<ReferralJob, 'title' | 'company'>, person: { name: string; category?: string | undefined }, me: string): string {
  const ask = person.category === 'recruiter' ? 'Would love to connect about it.' : 'Would love to connect and hear your view of the team.';
  return `Hi ${first(person.name)}, I’m ${first(me)}. I’m applying for ${role(job)}. ${ask}`;
}
/** Message to someone who is, or has just become, a connection. `accepted` adds the thank-you. */
export function referralAsk(job: Pick<ReferralJob, 'title' | 'company' | 'url'>, person: { name: string; category?: string | undefined }, me: string, accepted: boolean): string {
  const open = accepted ? `Hi ${first(person.name)}, thanks for connecting!` : `Hi ${first(person.name)}, hope you’re doing well.`;
  const ask = person.category === 'recruiter'
    ? 'Could you tell me the best way to be considered, or who is hiring for it?'
    : 'Would you be open to referring me, or pointing me to the right person?';
  return `${open} I’m ${first(me)}, and I’m applying for ${role(job)}: ${job.url} ${ask} Happy to share my CV.`;
}
