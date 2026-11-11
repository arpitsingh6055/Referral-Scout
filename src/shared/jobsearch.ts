import { z } from 'zod';
import { functionWords, geoFor, normalizeCompany } from './targeting';

/*
 * Job search and referral pipeline.
 *
 *   1. PLAN     once per set of target roles: parallel job titles to search for, which titles to approach at
 *               large, mid-size and small companies, and message wording. One ChatGPT prompt, cached; built-in
 *               rules are used when ChatGPT is unavailable, so nothing ever waits on it.
 *   2. FIND     LinkedIn job search for every planned term; jobs are grouped by company and scored.
 *   3. CHOOSE   the person confirms which companies to pursue (the best are pre-ticked).
 *   4. REFER    per company: company page (number and size) -> people the person knows -> who else can refer.
 *   5. REACH    people already known get a message, the strongest few others an invitation.
 */
export interface FoundJob { id: string; url: string; title: string; company: string; location: string; insight: string; term: string; score: number; picked: boolean }
export interface JobSearch { status: 'finding' | 'choosing' | 'working'; cursor: number; found: FoundJob[]; startedAt: number }
export type CompanySize = 'small' | 'mid' | 'large';
export interface SearchPlan {
  forRoles: string; terms: string[]; titles: Record<CompanySize, string[]>;
  /** Optional wording with {firstName} {myFirstName} {title} {company} {jobUrl}. Missing ones use the built-in text. */
  note?: string; ask?: string; followUp?: string;
  source: 'chatgpt' | 'rules'; at: number;
}
export const MAX_COMPANIES = 20, PRETICKED = 15, MAX_TERMS = 6;

/* ---------- parallel job titles (rules; ChatGPT improves on these) ---------- */
const PARALLEL: [RegExp, string[]][] = [
  [/operation|\bops\b|supply|logistic/i, ['operations', 'supply chain', 'logistics', 'procurement', 'business operations', 'program management']],
  [/product/i, ['product management', 'associate product manager', 'product analyst', 'product operations', 'program manager']],
  [/market|brand|growth/i, ['marketing', 'brand management', 'growth', 'digital marketing', 'content marketing']],
  [/sales|business development|account/i, ['sales', 'business development', 'account management', 'inside sales', 'partnerships']],
  [/financ|bank|treasur/i, ['finance', 'financial analyst', 'investment banking', 'corporate finance', 'treasury']],
  [/data|analy/i, ['data analyst', 'business analyst', 'analytics', 'data science', 'business intelligence']],
  [/software|engineer|develop|\bsde\b/i, ['software engineer', 'software developer', 'backend engineer', 'frontend engineer', 'full stack developer']],
  [/\bhr\b|human|talent|people/i, ['human resources', 'talent acquisition', 'people operations', 'HR generalist']],
  [/consult|strategy|founder/i, ['consulting', 'strategy', 'business analyst', "founder's office", 'management trainee']],
  [/design|\bux\b|\bui\b/i, ['product design', 'UX design', 'UI design', 'visual design']],
];
const levelOf = (role: string): string => /intern/i.test(role) ? ' intern' : /trainee|graduate|fresher|entry/i.test(role) ? ' graduate' : '';
export function fallbackTerms(roles: string[]): string[] {
  const out: string[] = [];
  for (const role of roles) {
    out.push(role.trim());
    const level = levelOf(role);
    for (const [pattern, words] of PARALLEL) if (pattern.test(role)) for (const w of words) out.push(`${w}${level}`);
  }
  const seen = new Set<string>();
  return out.filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, MAX_TERMS);
}

/* ---------- who to approach, by company size ---------- */
/**
 * At a large company a founder, director or VP will not answer a stranger about an internship; a recruiter, a team
 * lead or a senior colleague in the same function will, and their referral goes through the normal process.
 * At a small company the founder or a head of function is often the person who hires.
 */
export function fallbackTitles(roles: string[]): Record<CompanySize, string[]> {
  const fn = functionWords(roles)[0] ?? '';
  const hiring = ['recruiter', 'talent acquisition', 'HR', 'HRBP', 'campus recruiter'];
  return {
    large: [...hiring, 'team lead', 'senior consultant', 'senior associate', 'assistant manager', ...(fn ? [`${fn} manager`, `senior ${fn}`] : ['manager'])],
    mid: [...hiring, 'team lead', ...(fn ? [`${fn} manager`, `${fn} lead`, `head of ${fn}`] : ['manager', 'lead'])],
    small: ['founder', 'co-founder', 'CEO', ...(fn ? [`head of ${fn}`, `${fn} lead`] : ['head']), 'HR', 'recruiter', 'chief of staff'],
  };
}
export const rulesPlan = (roles: string[], now = Date.now()): SearchPlan => ({ forRoles: roles.join('|'), terms: fallbackTerms(roles), titles: fallbackTitles(roles), source: 'rules', at: now });

/** "1K-5K employees", "51-200 employees", "10K+ employees" -> size class. Unknown text counts as mid-size. */
export function sizeOf(text: string | undefined): CompanySize {
  const numbers = [...(text ?? '').matchAll(/([\d,.]+)\s*(k)?/gi)].map(m => Number(m[1]!.replace(/,/g, '')) * (m[2] ? 1000 : 1)).filter(n => n > 0);
  const top = Math.max(0, ...numbers);
  return !top ? 'mid' : top > 1000 ? 'large' : top > 200 ? 'mid' : 'small';
}

/* ---------- the one ChatGPT prompt ---------- */
export function planPrompt(roles: string[], location: string, about: string): string {
  return [
    'You are helping a job seeker plan a job search and referral requests on LinkedIn. Reply with ONLY one JSON object, no prose.',
    `TARGET ROLES: ${JSON.stringify(roles)}`, `LOCATION: ${JSON.stringify(location)}`, `ABOUT THE SEEKER: ${JSON.stringify(about.slice(0, 1500))}`,
    'Return exactly these keys:',
    `"searchTerms": up to ${MAX_TERMS} job titles to search for on LinkedIn Jobs. Include the target role and its real parallel titles (for example an "operations intern" search should also try "supply chain intern", "logistics intern", "business operations intern"). Keep the seniority of the target (intern stays intern). 2 to 4 words each.`,
    '"referralTitles": {"large": [...], "mid": [...], "small": [...]} with up to 8 job titles each: the people at a company of that size whose referral for these roles carries weight AND who are likely to answer a polite stranger. For large companies (over 1,000 staff) do NOT list founders, CEOs, directors or VPs: list recruiters, HR/HRBP, campus hiring, team leads, senior consultants, senior associates and managers in the relevant function. For small companies (under 200) founders and heads of function belong on the list. Titles as they appear in LinkedIn headlines, 1 to 3 words each.',
    '"note": a LinkedIn connection note, at most 170 characters, using the placeholders {firstName}, {myFirstName}, {title}, {company}. Friendly, plain, says the seeker is applying for the role and would like to connect. No flattery, no list of achievements, no request for a job.',
    '"ask": a message to someone the seeker ALREADY knows at the company, 40 to 70 words, placeholders {firstName}, {myFirstName}, {title}, {company}, {jobUrl}. Warm and direct: they are applying for this role, would the person be open to referring them or pointing them to the right person; offer to share the CV.',
    '"followUp": the same request for someone who has just accepted a connection request: opens by thanking them for connecting. 40 to 70 words, same placeholders.',
    'Use the placeholders literally. Do not invent facts about the seeker. No links other than {jobUrl}, no emails, no phone numbers.',
  ].join('\n');
}
const reply = z.object({
  searchTerms: z.array(z.string().trim().min(2).max(60)).min(1).max(12),
  referralTitles: z.object({ large: z.array(z.string().trim().min(2).max(50)).max(12), mid: z.array(z.string().trim().min(2).max(50)).max(12), small: z.array(z.string().trim().min(2).max(50)).max(12) }),
  note: z.string().max(400).optional(), ask: z.string().max(900).optional(), followUp: z.string().max(900).optional(),
});
const unsafe = /https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}\d/i;
const usable = (text: string | undefined, needs: string[], max: number): string | undefined =>
  text && text.length <= max && needs.every(n => text.includes(n)) && !unsafe.test(text.replace(/\{jobUrl\}/g, '')) && !/\{(?!firstName\}|myFirstName\}|title\}|company\}|jobUrl\})[^}]*\}/.test(text) ? text.trim() : undefined;
/** Turns ChatGPT's reply into a plan. Anything missing or unsafe is replaced by the built-in rule for that part. */
export function planFromReply(json: unknown, roles: string[], now = Date.now()): SearchPlan {
  const parsed = reply.parse(json), rules = rulesPlan(roles, now), clean = (list: string[], max: number): string[] => {
    const seen = new Set<string>(); return list.map(t => t.replace(/["()]/g, '').trim()).filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, max);
  };
  const lower = roles.map(r => r.toLowerCase()), terms = clean([...roles, ...parsed.searchTerms.filter(t => !lower.includes(t.toLowerCase()))], MAX_TERMS);
  const big = clean(parsed.referralTitles.large, 8).filter(t => !/founder|\bceo\b|chief|director|vice president|\bvp\b|president/i.test(t)); // never trust the model on this point
  const note = usable(parsed.note, ['{firstName}'], 190), ask = usable(parsed.ask, ['{firstName}', '{company}'], 700), followUp = usable(parsed.followUp, ['{firstName}', '{company}'], 700);
  return { forRoles: roles.join('|'), terms, source: 'chatgpt', at: now,
    titles: { large: big.length ? big : rules.titles.large, mid: clean(parsed.referralTitles.mid, 8).length ? clean(parsed.referralTitles.mid, 8) : rules.titles.mid, small: clean(parsed.referralTitles.small, 8).length ? clean(parsed.referralTitles.small, 8) : rules.titles.small },
    ...(note ? { note } : {}), ...(ask ? { ask } : {}), ...(followUp ? { followUp } : {}) };
}
export function fill(template: string, v: { firstName: string; myFirstName: string; title: string; company: string; jobUrl: string }): string {
  return template.replace(/\{firstName\}/g, v.firstName).replace(/\{myFirstName\}/g, v.myFirstName).replace(/\{title\}/g, v.title).replace(/\{company\}/g, v.company).replace(/\{jobUrl\}/g, v.jobUrl).replace(/\s{2,}/g, ' ').trim();
}

/* ---------- jobs ---------- */
export function jobsSearchUrl(term: string, location: string): string {
  const url = new URL('https://www.linkedin.com/jobs/search-results/'), geo = geoFor(location);
  url.searchParams.set('keywords', geo || !location.trim() ? term : `${term} ${location.trim()}`);
  if (geo) url.searchParams.set('geoId', geo);
  return url.href;
}
/** How well a job fits the target roles, plus LinkedIn's own hint that the person has a way in ("3 connections work here"). */
export function scoreJob(job: Pick<FoundJob, 'title' | 'insight'>, roles: string[], terms: string[]): number {
  const title = job.title.toLowerCase(), words = functionWords([...roles, ...terms]);
  let score = words.filter(w => title.includes(w.toLowerCase())).length * 10;
  if (terms.some(t => title.includes(t.toLowerCase().replace(/ intern$| graduate$/, '')))) score += 20;
  const wantsIntern = roles.some(r => /intern/i.test(r)), isIntern = /intern|trainee|apprentice/i.test(title);
  score += wantsIntern === isIntern ? 25 : -25;
  if (/\b(senior|sr\.?|lead|principal|director|head|vp|manager)\b/i.test(title) && wantsIntern) score -= 30;
  const n = Number(/(\d+)/.exec(job.insight)?.[1] ?? 0);
  if (/connections? works? here/i.test(job.insight)) score += 30 + Math.min(n, 10);
  else if (/school alum/i.test(job.insight)) score += 15 + Math.min(n, 10);
  else if (/company alum/i.test(job.insight)) score += 8;
  return score;
}
/** One job per company (the best fit), best companies first, the top ones ticked for the person to confirm. */
export function shortlist(jobs: FoundJob[], alreadyPursued: string[] = []): FoundJob[] {
  const taken = new Set(alreadyPursued.map(normalizeCompany)), best = new Map<string, FoundJob>();
  for (const job of jobs) {
    const key = normalizeCompany(job.company); if (!key || taken.has(key)) continue;
    const held = best.get(key); if (!held || job.score > held.score) best.set(key, job);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, MAX_COMPANIES * 2).map((job, i) => ({ ...job, picked: i < PRETICKED && job.score > 0 }));
}
