import { z } from 'zod';
import { COMPANY_KINDS, classify, companyMatches, functionWords } from './targeting';
import type { CompanySize, CompanyStrategy } from './jobsearch';

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
  location: z.string().max(200).default(''),
  /** The company's own LinkedIn page, when the job page links to it. Used once to read the company's number for the Current company filter. */
  companyUrl: z.string().regex(/^https:\/\/www\.linkedin\.com\/company\/[^/?#]+\/$/).optional(),
  /** People LinkedIn itself lists on the job page under "People you can reach out to". Checked and ranked like everyone else. */
  suggested: z.array(z.object({ url: z.string().max(300), name: z.string().max(150), headline: z.string().max(500), degree: z.number().int().min(1).max(3).optional(), alum: z.boolean().optional() })).max(10).optional()
});
export const referralMessage = z.object({ kind: z.literal('network.referral'), mode: z.enum(['referral', 'connections']), job: referralJobInput });
export interface ReferralJob extends z.infer<typeof referralJobInput> {
  mode: 'referral' | 'connections'; addedAt: number;
  /** How many of the planned searches are done. The scan is finished when this reaches the plan's length. */
  cursor: number; found: number; finishedAt?: number;
  /** LinkedIn's number for the company, once read. `idTried` stops a second attempt when it could not be read. */
  companyId?: string; idTried?: boolean;
  /** Read from the job's own page when the job came from a search list and not from a click on a job page. */
  infoTried?: boolean;
  size?: CompanySize; sizeText?: string;
  /** How many invitations this company gets (3 to 5). People already known are messaged on top of that. */
  perCompany?: number;
  /** People the person already knows there. When there are some, the person decides: ask only them, or also look for stronger referrers. */
  known?: number; decision?: 'known' | 'widen'; waiting?: boolean;
  /** Who to approach at this company, decided by ChatGPT from what it knows of the company. `strategyTried` stops a second prompt. */
  strategy?: CompanyStrategy; strategyTried?: boolean;
  /** Pages that could not be read for this company. After three the company is closed with what was found, so one bad company never blocks the rest. */
  failures?: number; error?: string;
}
/** How many people one "Ask for referrals" click contacts by itself: the strongest few. A whole recruiting team is not messaged at once. */
export const REFERRAL_AUTO = 8;
export interface ReferralSearch { label: string; keywords: string; network: ('F' | 'S' | 'O')[]; page?: number }

/**
 * The searches for one company, most valuable first.
 *
 * With the company's LinkedIn number (read once from its company page) every search uses LinkedIn's own
 * "Current company" filter, so only people who work there now come back, however they word their headline.
 * Without it the company name is used as a keyword and each result is checked against the name.
 */
export function referralPlan(job: Pick<ReferralJob, 'company' | 'title' | 'mode' | 'companyId' | 'size'>, titles?: string[]): ReferralSearch[] {
  const fn = functionWords([job.title])[0] ?? '', at = job.company;
  if (job.companyId) {
    const known: ReferralSearch[] = [{ label: `people you already know at ${at}`, keywords: '', network: ['F'] }, { label: `more people you know at ${at}`, keywords: '', network: ['F'], page: 2 }];
    if (job.mode === 'connections') return known;
    if (titles?.length) {
      // Planned titles for a company of this size, searched in two groups so each query stays short enough for LinkedIn.
      const groups = [titles.slice(0, 5), titles.slice(5, 10)].filter(g => g.length);
      return [...known, ...groups.map((g, i) => ({ label: i ? `more likely referrers at ${at}` : `likely referrers at ${at}`, keywords: `(${g.map(t => /\s/.test(t) ? `"${t}"` : t).join(' OR ')})`, network: ['S', 'O'] as ('S' | 'O')[] }))];
    }
    return [known[0]!,
      { label: `recruiters and HR at ${at}`, keywords: COMPANY_KINDS[0]!, network: ['S', 'O'] },
      { label: `more recruiters and HR at ${at}`, keywords: COMPANY_KINDS[0]!, network: ['S', 'O'], page: 2 },
      // Without a recognisable function in the job title this would repeat the managers search below.
      ...(fn ? [{ label: `the ${fn} team at ${at}`, keywords: fn, network: ['S', 'O'] as ('S' | 'O')[] }] : []),
      { label: `managers and leaders at ${at}`, keywords: COMPANY_KINDS[1]!, network: ['S', 'O'] },
      { label: `founders at ${at}`, keywords: COMPANY_KINDS[2]!, network: ['S', 'O'] }];
  }
  const company = `"${at.replace(/"/g, '')}"`, everyone: ('F' | 'S' | 'O')[] = job.mode === 'connections' ? ['F'] : ['F', 'S', 'O'];
  return [
    { label: `recruiters at ${at}`, keywords: `${company} ${COMPANY_KINDS[0]}`, network: everyone },
    { label: `the hiring team at ${at}`, keywords: `${company} ${COMPANY_KINDS[1]} ${fn}`.trim(), network: everyone },
    { label: `founders at ${at}`, keywords: `${company} ${COMPANY_KINDS[2]}`, network: everyone },
    { label: `people you already know at ${at}`, keywords: company, network: ['F'] },
  ];
}
/** The LinkedIn people-search address for one step of the plan. */
export function referralSearchUrl(step: ReferralSearch, companyId?: string): string {
  const url = new URL('https://www.linkedin.com/search/results/people/');
  if (step.keywords) url.searchParams.set('keywords', step.keywords);
  if (companyId) url.searchParams.set('currentCompany', JSON.stringify([companyId]));
  url.searchParams.set('network', JSON.stringify(step.network));
  if (step.page && step.page > 1) url.searchParams.set('page', String(step.page));
  url.searchParams.set('origin', 'FACETED_SEARCH');
  return url.href;
}

export type ReferralKind = 'recruiter' | 'leader' | 'founder' | 'senior' | 'peer' | 'employee';
export interface ReferralVerdict { kind: ReferralKind; score: number; reason: string }
const WEIGHT: Record<ReferralKind, number> = { recruiter: 300, leader: 260, founder: 220, senior: 200, peer: 180, employee: 150 };
const WHY: Record<ReferralKind, string> = { recruiter: 'Recruiter', leader: 'On the hiring team', founder: 'Founder', senior: 'Senior person', peer: 'Works in the same team area', employee: 'Works there' };
// For a referral the test is wider than for general outreach: anyone in hiring or people teams, and anyone senior
// at the company, can put a name forward even when their own function differs from the job's.
const HIRING = /recruit|talent|sourc(?:er|ing)|\bh\.?r\.?\b|\bhrbp\b|\bhr\s*bp\b|human\s+(?:resources?|capital)|people\s*(?:&|and|ops|operations|partner|business|team|success|experience|\bculture)|\bta\b|hiring|staffing|campus|university\s+(?:relations|recruit)|early\s+careers?|employer\s+brand/i;
const SENIOR = /\b(?:head|director|vp|vice president|president|chief|c[tfoepm]o|manager|lead|principal|partner|avp|svp|evp)\b/i;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether this person can help with a referral at this company, and how much.
 * `verified` means LinkedIn's Current company filter was used, so they are known to work there.
 * A plain employee in an unrelated team only counts if the person already knows them (1st degree):
 * a stranger who merely works there is the unhelpful suggestion this is meant to avoid.
 */
export function rankReferral(person: { headline: string; current?: string | undefined; degree?: number | undefined; alum?: boolean | undefined }, job: Pick<ReferralJob, 'company' | 'title' | 'size'>, verified = false, titles: string[] = [], avoid: string[] = []): ReferralVerdict | null {
  const headline = person.headline;
  if (!verified && !companyMatches(`${person.current ?? ''} | ${headline}`, job.company)) return null;
  // "Ex Tata Group" must not rule out someone now at this company; only "ex-<this company>" does.
  if (new RegExp(`\\b(?:ex|former(?:ly)?|previously)\\b[-\\s:@]*(?:at\\s+)?${escape(job.company)}`, 'i').test(headline)) return null;
  // Interns, trainees and job seekers cannot put a name forward, even when they do work there.
  if (/\b(?:open to work|seeking|aspiring|looking for|intern|internship|trainee|apprentice|student)\b/i.test(headline) && !/\b(?:recruit|talent|hr|campus|early careers?)\b/i.test(headline)) return null;
  const fn = functionWords([job.title])[0];
  const kind: ReferralKind = classify({ headline }, { roles: [job.title] })?.category
    ?? (HIRING.test(headline) ? 'recruiter' : SENIOR.test(headline) ? 'senior' : fn && new RegExp(`\\b${escape(fn)}`, 'i').test(headline) ? 'peer' : 'employee');
  const degree = person.degree ?? 3;
  // At a large company a founder, director or VP will not answer a stranger about a referral. Keep them only if already known.
  const tooSenior = job.size === 'large' && (kind === 'founder' || /\b(?:director|vp|vice president|president|chief|c[tfoepm]o|founder|ceo|managing director)\b/i.test(headline)) && !HIRING.test(headline);
  if (tooSenior && degree !== 1) return null;
  // Titles the plan says not to approach at this company as a stranger. People who hire are never ruled out this way.
  if (degree !== 1 && !HIRING.test(headline) && avoid.some(t => new RegExp(`\\b${escape(t)}\\b`, 'i').test(headline))) return null;
  const planned = titles.some(t => new RegExp(`\\b${escape(t)}`, 'i').test(headline));
  if (kind === 'employee' && degree !== 1 && !planned) return null;
  if (kind === 'peer' && degree > 2) return null; // same-team peers only when there is at least a mutual connection
  // Someone from the same school is noticeably more willing to help; LinkedIn flags them on the job page.
  const score = WEIGHT[kind] + (degree === 1 ? 60 : degree === 2 ? 20 : 0) + (person.alum ? 25 : 0) + (planned ? 40 : 0) - (tooSenior ? 80 : 0);
  return { kind, score, reason: `${WHY[kind]} at ${job.company}${degree === 1 ? ', already your connection' : ''}${person.alum ? ', from your school' : ''}. For: ${job.title}` };
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
