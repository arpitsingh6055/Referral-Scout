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
export interface FoundJob {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string;
  insight: string;
  term: string;
  score: number;
  picked: boolean;
  promoted?: boolean | undefined;
  /** Set when the job fits a qualification the seeker chose to prioritise. Prioritise-only, never excludes. */
  prioritized?: boolean | undefined;
  /** The matched qualification labels (badge text), e.g. ["MBA/PGDM"]. */
  matched?: string[] | undefined;
  /** ChatGPT's 0-100 fit score against the seeker's qualifications/specialisation (used for ordering). */
  fit?: number | undefined;
  /** Why it was prioritised: "degree" (the description asks for the qualification) or "domain" (the work fits the field). */
  basis?: 'degree' | 'domain' | undefined;
  /** ChatGPT's one-line reason for the fit score, shown under the job so the ranking can be checked. */
  why?: string | undefined;
}
export interface JobSearch {
  status: 'finding' | 'choosing' | 'working';
  cursor: number;
  found: FoundJob[];
  startedAt: number;
  /** Listings ChatGPT took out of the shortlist as adverts or poor matches, with its reason. Shown, never hidden silently. */
  dropped?: { title: string; company: string; why: string }[];
  /** While job descriptions are being read and ranked: how many of how many. */
  ranking?: { done: number; total: number } | undefined;
  /** The person asked to choose now: ranking stops after the job in hand and the list is shown with what was ranked. */
  rankStop?: boolean | undefined;
}
export type CompanySize = 'small' | 'mid' | 'large';
export interface SearchPlan {
  forRoles: string;
  terms: string[];
  titles: Record<CompanySize, string[]>;
  /** Optional wording with {firstName} {myFirstName} {title} {company} {jobUrl}. Missing ones use the built-in text. */
  note?: string;
  ask?: string;
  followUp?: string;
  source: 'chatgpt' | 'rules';
  at: number;
}
export const MAX_COMPANIES = 20,
  PRETICKED = 10,
  MAX_TERMS = 6;

/* ---------- parallel job titles (rules; ChatGPT improves on these) ---------- */
const PARALLEL: [RegExp, string[]][] = [
  [
    /operation|\bops\b|supply|logistic/i,
    ['operations', 'supply chain', 'logistics', 'procurement', 'business operations', 'program management'],
  ],
  [/product/i, ['product management', 'associate product manager', 'product analyst', 'product operations', 'program manager']],
  [/market|brand|growth/i, ['marketing', 'brand management', 'growth', 'digital marketing', 'content marketing']],
  [/sales|business development|account/i, ['sales', 'business development', 'account management', 'inside sales', 'partnerships']],
  [/financ|bank|treasur/i, ['finance', 'financial analyst', 'investment banking', 'corporate finance', 'treasury']],
  [/data|analy/i, ['data analyst', 'business analyst', 'analytics', 'data science', 'business intelligence']],
  [
    /software|engineer|develop|\bsde\b/i,
    ['software engineer', 'software developer', 'backend engineer', 'frontend engineer', 'full stack developer'],
  ],
  [/\bhr\b|human|talent|people/i, ['human resources', 'talent acquisition', 'people operations', 'HR generalist']],
  [/consult|strategy|founder/i, ['consulting', 'strategy', 'business analyst', "founder's office", 'management trainee']],
  [/design|\bux\b|\bui\b/i, ['product design', 'UX design', 'UI design', 'visual design']],
];
const levelOf = (role: string): string =>
  /intern/i.test(role) ? ' intern' : /trainee|graduate|fresher|entry/i.test(role) ? ' graduate' : '';
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
    large: [
      ...hiring,
      'team lead',
      'senior consultant',
      'senior associate',
      'assistant manager',
      ...(fn ? [`${fn} manager`, `senior ${fn}`] : ['manager']),
    ],
    mid: [...hiring, 'team lead', ...(fn ? [`${fn} manager`, `${fn} lead`, `head of ${fn}`] : ['manager', 'lead'])],
    small: ['founder', 'co-founder', 'CEO', ...(fn ? [`head of ${fn}`, `${fn} lead`] : ['head']), 'HR', 'recruiter', 'chief of staff'],
  };
}
export const rulesPlan = (roles: string[], now = Date.now()): SearchPlan => ({
  forRoles: roles.join('|'),
  terms: fallbackTerms(roles),
  titles: fallbackTitles(roles),
  source: 'rules',
  at: now,
});

/** "1K-5K employees", "51-200 employees", "10K+ employees" -> size class. Unknown text counts as mid-size. */
export function sizeOf(text: string | undefined): CompanySize {
  const numbers = [...(text ?? '').matchAll(/([\d,.]+)\s*(k)?/gi)]
    .map(m => Number(m[1]!.replace(/,/g, '')) * (m[2] ? 1000 : 1))
    .filter(n => n > 0);
  const top = Math.max(0, ...numbers);
  return !top ? 'mid' : top > 1000 ? 'large' : top > 200 ? 'mid' : 'small';
}

/* ---------- the one ChatGPT prompt ---------- */
export function planPrompt(roles: string[], location: string, about: string): string {
  return [
    'You are helping a job seeker plan a job search and referral requests on LinkedIn. Reply with ONLY one JSON object, no prose.',
    `TARGET ROLES: ${JSON.stringify(roles)}`,
    `LOCATION: ${JSON.stringify(location)}`,
    `ABOUT THE SEEKER: ${JSON.stringify(about.slice(0, 1500))}`,
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
  referralTitles: z.object({
    large: z.array(z.string().trim().min(2).max(50)).max(12),
    mid: z.array(z.string().trim().min(2).max(50)).max(12),
    small: z.array(z.string().trim().min(2).max(50)).max(12),
  }),
  note: z.string().max(400).optional(),
  ask: z.string().max(900).optional(),
  followUp: z.string().max(900).optional(),
});
const unsafe = /https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}\d/i;
const usable = (text: string | undefined, needs: string[], max: number): string | undefined =>
  text &&
  text.length <= max &&
  needs.every(n => text.includes(n)) &&
  !unsafe.test(text.replace(/\{jobUrl\}/g, '')) &&
  !/\{(?!firstName\}|myFirstName\}|title\}|company\}|jobUrl\})[^}]*\}/.test(text)
    ? text.trim()
    : undefined;
/** Turns ChatGPT's reply into a plan. Anything missing or unsafe is replaced by the built-in rule for that part. */
export function planFromReply(json: unknown, roles: string[], now = Date.now()): SearchPlan {
  const parsed = reply.parse(json),
    rules = rulesPlan(roles, now),
    clean = (list: string[], max: number): string[] => {
      const seen = new Set<string>();
      return list
        .map(t => t.replace(/["()]/g, '').trim())
        .filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
        .slice(0, max);
    };
  const lower = roles.map(r => r.toLowerCase()),
    terms = clean([...roles, ...parsed.searchTerms.filter(t => !lower.includes(t.toLowerCase()))], MAX_TERMS);
  const big = clean(parsed.referralTitles.large, 8).filter(t => !/founder|\bceo\b|chief|director|vice president|\bvp\b|president/i.test(t)); // never trust the model on this point
  const note = usable(parsed.note, ['{firstName}'], 190),
    ask = usable(parsed.ask, ['{firstName}', '{company}'], 700),
    followUp = usable(parsed.followUp, ['{firstName}', '{company}'], 700);
  return {
    forRoles: roles.join('|'),
    terms,
    source: 'chatgpt',
    at: now,
    titles: {
      large: big.length ? big : rules.titles.large,
      mid: clean(parsed.referralTitles.mid, 8).length ? clean(parsed.referralTitles.mid, 8) : rules.titles.mid,
      small: clean(parsed.referralTitles.small, 8).length ? clean(parsed.referralTitles.small, 8) : rules.titles.small,
    },
    ...(note ? { note } : {}),
    ...(ask ? { ask } : {}),
    ...(followUp ? { followUp } : {}),
  };
}
export function fill(
  template: string,
  v: { firstName: string; myFirstName: string; title: string; company: string; jobUrl: string },
): string {
  return template
    .replace(/\{firstName\}/g, v.firstName)
    .replace(/\{myFirstName\}/g, v.myFirstName)
    .replace(/\{title\}/g, v.title)
    .replace(/\{company\}/g, v.company)
    .replace(/\{jobUrl\}/g, v.jobUrl)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ---------- jobs ---------- */
export function jobsSearchUrl(term: string, location: string): string {
  const url = new URL('https://www.linkedin.com/jobs/search-results/'),
    geo = geoFor(location);
  url.searchParams.set('keywords', geo || !location.trim() ? term : `${term} ${location.trim()}`);
  if (geo) url.searchParams.set('geoId', geo);
  return url.href;
}
/** How well a job fits the target roles, plus LinkedIn's own hint that the person has a way in ("3 connections work here"). */
export const PROMOTED_PENALTY = 15;
export function scoreJob(
  job: Pick<FoundJob, 'title' | 'insight'> & { promoted?: boolean | undefined },
  roles: string[],
  terms: string[],
): number {
  const title = job.title.toLowerCase(),
    words = functionWords([...roles, ...terms]);
  let score = words.filter(w => title.includes(w.toLowerCase())).length * 10 - (job.promoted ? PROMOTED_PENALTY : 0); // paid adverts rank below organic matches
  if (terms.some(t => title.includes(t.toLowerCase().replace(/ intern$| graduate$/, '')))) score += 20;
  const wantsIntern = roles.some(r => /intern/i.test(r)),
    isIntern = /intern|trainee|apprentice/i.test(title);
  score += wantsIntern === isIntern ? 25 : -25;
  if (/\b(senior|sr\.?|lead|principal|director|head|vp|manager)\b/i.test(title) && wantsIntern) score -= 30;
  const n = Number(/(\d+)/.exec(job.insight)?.[1] ?? 0);
  if (/connections? works? here/i.test(job.insight)) score += 30 + Math.min(n, 10);
  else if (/school alum/i.test(job.insight)) score += 15 + Math.min(n, 10);
  else if (/company alum/i.test(job.insight)) score += 8;
  return score;
}
const titleKey = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** The same opening: the same LinkedIn job, or the same title at the same company (a repost gets a new address). */
export const sameJob = (a: { url: string; title: string; company: string }, b: { url: string; title: string; company: string }): boolean =>
  a.url === b.url || (normalizeCompany(a.company) === normalizeCompany(b.company) && titleKey(a.title) === titleKey(b.title));
/**
 * One job per company (the best fit), best companies first, the top ones ticked for the person to confirm.
 * A job that was already taken on is never offered again; a different job at the same company is.
 */
export function shortlist(
  jobs: FoundJob[],
  alreadyPursued: string[] = [],
  done: { url: string; title: string; company: string }[] = [],
): FoundJob[] {
  const taken = new Set(alreadyPursued.map(normalizeCompany)),
    best = new Map<string, FoundJob>();
  for (const job of jobs) {
    const key = normalizeCompany(job.company);
    if (!key || taken.has(key) || done.some(d => sameJob(d, job))) continue;
    const held = best.get(key);
    if (!held || job.score > held.score) best.set(key, job);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_COMPANIES * 2)
    .map((job, i) => ({ ...job, picked: i < PRETICKED && job.score > 0 }));
}

/* ---------- the per-company plan: ChatGPT decides who can refer at each company ---------- */
export type CompanyType = 'startup' | 'scaleup' | 'mid' | 'enterprise';
export interface CompanyStrategy {
  type: CompanyType;
  why: string;
  /** Titles to search for at this company, most valuable first. Recruiters are always added by the code. */
  titles: string[];
  /** Titles not worth contacting here as a stranger (for example CEO and CFO at an enterprise). */
  avoid: string[];
  note?: string;
  ask?: string;
  followUp?: string;
  source: 'chatgpt' | 'rules';
}
export const sizeForType: Record<CompanyType, CompanySize> = { startup: 'small', scaleup: 'mid', mid: 'mid', enterprise: 'large' };
/** Recruiters and HR are asked at every company, whatever else the plan says. */
export const ALWAYS = ['recruiter', 'talent acquisition', 'HR'];
export const withRecruiters = (titles: string[]): string[] => {
  const seen = new Set<string>();
  return [...ALWAYS, ...titles].filter(t => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, 10);
};

/**
 * One prompt for every company chosen in a run. ChatGPT knows what kind of company each one is far better than a
 * size bucket does, so it decides who is worth asking there; the code then only executes its list.
 */
export function companyPlanPrompt(
  companies: { company: string; title: string; size?: string | undefined; fit?: string | undefined }[],
  roles: string[],
  about: string,
): string {
  return [
    'You are an experienced recruiter and career coach. A job seeker will ask people at specific companies for a REFERRAL for a specific job, through LinkedIn. For each company, decide WHO is worth approaching: people whose referral carries weight for that job AND who would realistically reply to a polite stranger.',
    '',
    'How to think about it:',
    '- First judge what kind of company it is from your own knowledge of it: "enterprise" (a large or multinational company such as Microsoft, Infosys, Barclays, Deloitte, Unilever), "mid" (an established company of a few hundred to a few thousand people), "scaleup" (a funded, fast-growing company of roughly 100 to 1,000 people) or "startup" (under about 100 people). If you do not recognise the company, use the size hint if one is given, otherwise assume "mid" and say so in "why".',
    '- ENTERPRISE example, a Sales Intern job at Microsoft: messaging the CEO, CFO, a VP or a director is pointless; they will not reply and do not handle hiring. Worth approaching: campus or university recruiters, talent acquisition partners, HR business partners, and people one or two levels above the role in the SAME function, such as "account executive", "senior account manager", "sales manager", "team lead". Their referral goes through the normal employee-referral process, which is what counts.',
    '- STARTUP example, an Operations Intern job at a 40-person startup: the founder, co-founder, "head of operations" or "chief of staff" often hires directly and does reply. Approach them, plus any HR or talent person.',
    '- SCALEUP or MID example, a Product Analyst job at a 600-person fintech: "product manager", "senior product manager", "head of product", "talent partner", "HRBP". A founder is usually too far from this hire; list founders under "avoid" unless the company is clearly small.',
    '- Match the FUNCTION of the job. For an operations role, senior operations people; for software, engineering managers and senior engineers; for sales, senior sales people. A senior person in an unrelated function carries little weight.',
    '- Match the LEVEL. For an internship or entry-level job, people one to three levels above (senior associate, senior consultant, assistant manager, manager, team lead) are right. Do not list interns, trainees or other entry-level staff.',
    '- Recruiters and HR are always worth approaching; you do not need to list them, they are added automatically. Spend your list on the function-specific people.',
    '',
    `THE SEEKER wants: ${JSON.stringify(roles)}. About them: ${JSON.stringify(about.slice(0, 1200))}`,
    `COMPANIES AND JOBS: ${JSON.stringify(companies.map(c => ({ company: c.company, job: c.title, ...(c.size ? { sizeHint: c.size } : {}), ...(c.fit ? { seekerFit: c.fit } : {}) })))}`,
    ...(companies.some(c => c.fit)
      ? [
          'Where an entry has "seekerFit", it says why the seeker suits that job, read from the job description (for example the degree it asks for). The note, ask and followUp may mention that in a few plain words; add nothing beyond it.',
        ]
      : []),
    '',
    'Reply with ONLY one JSON object: {"companies":[ ... ]} with one entry per company above, in the same order, each exactly:',
    '{"company": the name exactly as given, "type": "enterprise" | "mid" | "scaleup" | "startup", "why": one short sentence on why these people, "searchTitles": 4 to 7 job titles to search for at this company, most valuable first, written as they appear in LinkedIn headlines, 1 to 3 words each, no company names, "avoid": up to 5 titles NOT to approach at this company as a stranger, "note": a connection note of at most 170 characters using {firstName}, {myFirstName}, {title}, {company}, "ask": a 40 to 70 word message to someone the seeker ALREADY knows there, using {firstName}, {myFirstName}, {title}, {company}, {jobUrl}, asking whether they would refer them or point them to the right person, "followUp": the same request for a stranger who has just accepted the connection request, opening with thanks for connecting}',
    'Wording rules for note, ask and followUp: plain, warm, specific to the job; no flattery, no list of achievements, no invented facts, no links except {jobUrl}, no emails or phone numbers. Use the placeholders literally.',
  ].join('\n');
}
const strategyReply = z.object({
  companies: z
    .array(
      z.object({
        company: z.string(),
        type: z.enum(['enterprise', 'mid', 'scaleup', 'startup']),
        why: z.string().max(400).default(''),
        searchTitles: z.array(z.string().trim().min(2).max(50)).min(1).max(12),
        avoid: z.array(z.string().trim().min(2).max(50)).max(10).default([]),
        note: z.string().max(400).optional(),
        ask: z.string().max(900).optional(),
        followUp: z.string().max(900).optional(),
      }),
    )
    .min(1)
    .max(40),
});
const TOP = /founder|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|chief|vice president|\bvp\b|president|managing director/i;
/** ChatGPT's reply, per company (keyed by the normalised name). Anything unsafe or missing is dropped, not trusted. */
export function strategiesFromReply(json: unknown): Map<string, CompanyStrategy> {
  const out = new Map<string, CompanyStrategy>(),
    tidy = (list: string[], max: number): string[] => {
      const seen = new Set<string>();
      return list
        .map(t => t.replace(/["()]/g, '').trim())
        .filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
        .slice(0, max);
    };
  for (const c of strategyReply.parse(json).companies) {
    // If the model itself says "enterprise", top executives are not searched for, even if it also listed them.
    const titles = tidy(c.searchTitles, 7).filter(t => c.type !== 'enterprise' || !TOP.test(t));
    if (!titles.length) continue;
    const avoid = tidy([...c.avoid, ...(c.type === 'enterprise' ? ['CEO', 'CFO', 'founder', 'vice president', 'director'] : [])], 8);
    const note = usable(c.note, ['{firstName}'], 190),
      ask = usable(c.ask, ['{firstName}', '{company}'], 700),
      followUp = usable(c.followUp, ['{firstName}', '{company}'], 700);
    out.set(normalizeCompany(c.company), {
      type: c.type,
      why: c.why.trim().slice(0, 300),
      titles,
      avoid,
      source: 'chatgpt',
      ...(note ? { note } : {}),
      ...(ask ? { ask } : {}),
      ...(followUp ? { followUp } : {}),
    });
  }
  return out;
}

/** Title words that mark a LinkedIn listing as an internship / trainee (LinkedIn labels these in the title). */
export const INTERN_TITLE =
  /\bintern(ship|s|ing)?\b|\btrainee\b|\bapprentice(ship)?\b|\bsummer\b|\barticleship\b|\bindustrial training\b|\bco-?op\b|\bwinter intern/i;
export type EmploymentIntent = 'internship' | 'full-time' | 'any';
/** What employment type the seeker is after: the explicit setting wins; otherwise read it from the role text. */
export function employmentIntent(employmentType: string | undefined, roles: string[]): EmploymentIntent {
  if (employmentType === 'internship' || employmentType === 'full-time') return employmentType;
  // No explicit setting: read it from the roles. A role that names an internship means internships; a plain role name
  // with no intern/trainee word means a regular full-time job, so internships are excluded. A mix of both keeps both.
  const intern = roles.filter(r => INTERN_TITLE.test(r)).length;
  if (intern === 0) return 'full-time';
  if (intern === roles.length) return 'internship';
  return 'any';
}
/**
 * A clear employment-type mismatch by title. LinkedIn names internships in the title, so a title with no intern/trainee
 * word is treated as full-time. Returns a short removal reason, or null when the title fits the intent. Deterministic,
 * so full-time roles are dropped from an internship search (and vice versa) even when ChatGPT keeps them.
 */
export function employmentMismatch(title: string, intent: EmploymentIntent): string | null {
  if (intent === 'any') return null;
  const isIntern = INTERN_TITLE.test(title);
  if (intent === 'internship' && !isIntern) return 'Full-time role — you asked for an internship';
  if (intent === 'full-time' && isIntern) return 'Internship — you asked for a full-time role';
  return null;
}

/* ---------- the shortlist check: ChatGPT removes adverts and poor matches before the person sees the list ---------- */
export function reviewPrompt(jobs: FoundJob[], roles: string[], location: string, employmentType?: string): string {
  const intent = employmentIntent(employmentType, roles);
  const typeRule =
    intent === 'internship'
      ? '- The wrong employment type. The seeker wants an INTERNSHIP, so remove full-time and permanent roles: a title such as "Product Manager", "Senior Product Manager" or "Associate Product Manager", or anything with "Manager", "Lead", "Director" or "Senior" and no sign of being an internship, is full-time. Keep only internships, traineeships, apprenticeships or summer roles in the right function.'
      : intent === 'full-time'
        ? '- The wrong employment type. The seeker wants a FULL-TIME role, so remove internships, traineeships, apprenticeships and summer roles. Keep permanent roles in the right function.'
        : '- The wrong level, such as a Director or VP when the seeker wants an entry-level or mid-level role. Internships and full-time roles are both fine here unless the role text says otherwise.';
  return [
    'You are a careful career coach checking a list of LinkedIn job listings for a job seeker before they see it. Remove only the listings that would waste their time. When unsure about function or quality, KEEP the listing.',
    '',
    'Remove a listing when it is:',
    '- Not a real opening at a real employer: a training institute or course that charges fees, a "pay after placement" programme, a "campus ambassador" or "earn from home" scheme, or a staffing agency posting a vague mass listing with no named client.',
    '- The wrong function. Example: the seeker wants "Product Management internship"; "Sales Intern", "Telecaller" and "HR Intern" are wrong, while "Associate Product Manager Intern", "Product Analyst Intern", "Program Management Intern" and "Product Operations Intern" are close enough to keep.',
    typeRule,
    '- Marked "promoted": true (a paid advert) AND not a clearly good match for the roles. A promoted listing that fits well stays.',
    'Never remove more than half the list. Do not judge companies by fame or size.',
    '',
    `THE SEEKER wants: ${JSON.stringify(roles)}${location ? `, location: ${JSON.stringify(location)}` : ''}${intent !== 'any' ? `, employment type: ${intent}` : ''}`,
    `LISTINGS: ${JSON.stringify(jobs.map(j => ({ id: j.id, title: j.title, company: j.company, location: j.location, ...(j.promoted ? { promoted: true } : {}) })))}`,
    '',
    'Reply with ONLY one JSON object: {"remove":[{"id": the id exactly as given, "why": the reason in at most 12 plain words}]}. Use an empty list if nothing should be removed.',
  ].join('\n');
}
const reviewReply = z.object({
  remove: z.array(z.object({ id: z.union([z.string(), z.number()]).transform(String), why: z.string().max(200).default('') })).max(60),
});
/** Which listings to remove, by id. A reply that removes most of the list is not trusted and removes nothing. */
export function reviewFromReply(json: unknown, ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of reviewReply.parse(json).remove) if (ids.includes(r.id)) out.set(r.id, r.why.trim() || 'Not a good match');
  return out.size > ids.length * 0.6 ? new Map() : out;
}

/* ---------- deep qualification ranking: ChatGPT reads the FULL job descriptions in small batches and, for every job
   it keeps, scores how well it fits the seeker's qualifications - from an explicit degree line where there is one, and
   otherwise from how well the actual work suits their specialisation. Batched so one prompt stays small; the pipeline
   pulls more batches until enough matches are found. ---------- */
export const RANK_BATCH = 10; // jobs whose full descriptions go into one ChatGPT call, to keep the prompt small
export const RANK_TARGET = 10; // stop pulling batches once this many jobs are prioritised
export const RANK_MAX_BATCHES = 3; // safety cap on how deep to read
export const PRIORITY_FIT = 55; // a fit score at or above this marks a job as prioritised
/** A job description as plain text, capped, so a batch of full descriptions stays a sane prompt size. */
export function clampDescription(text: string, max = 3500): string {
  return (text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
export interface JobRank {
  fit: number;
  basis: 'degree' | 'domain' | 'none';
  quals: string[];
  why: string;
}
export function rankPrompt(
  jobs: FoundJob[],
  roles: string[],
  location: string,
  employmentType: string | undefined,
  qualifications: string[],
  descriptions: Record<string, string>,
  about = '',
): string {
  const intent = employmentIntent(employmentType, roles);
  return [
    'You are an expert career coach ranking LinkedIn jobs for a job seeker, reading the FULL job description of each. Do two things: remove listings that would waste their time, and for EVERY listing you keep, score how well it fits the seeker’s qualifications and field.',
    '',
    'Remove a listing when it is: not a real opening (a paid course or training institute, a "pay after placement" programme, a "campus ambassador" or "earn from home" scheme, or a staffing agency mass-posting with no named client); the wrong FUNCTION for the roles' +
      (intent !== 'any' ? `; or the wrong employment type (the seeker wants ${intent}). ` : '. ') +
      'A promoted/advert listing that genuinely fits may stay. Never remove more than half of this batch.',
    '',
    `THE SEEKER'S QUALIFICATIONS / SPECIALISATIONS: ${JSON.stringify(qualifications)}.`,
    ...(about.trim()
      ? [
          `ABOUT THE SEEKER (use it to judge "domain" fit - two people with the same degree but different experience fit different jobs): ${JSON.stringify(about.slice(0, 900))}`,
        ]
      : []),
    'For EACH listing you KEEP, read its "description" and return a "fit" score from 0 to 100 and a "basis":',
    '- "basis":"degree" when the description explicitly requires or prefers one of these qualifications (for example "MBA/PGDM required", "B.E./B.Tech in CS or IT", "CA preferred"). Score 80-100. Put the matching qualification labels, copied EXACTLY from the list above, in "quals".',
    '- "basis":"domain" when the description does NOT state a degree, but the actual work clearly suits the seeker’s specialisation - for example an MBA/PGDM suits strategy, product, consulting, operations, marketing or finance roles; a CS/IT engineering background suits software, data, platform or analytics roles; a CA or commerce background suits finance, audit, FP&A, tax or accounting roles. Score 40-79 by how strong the fit is. "quals" may be empty.',
    '- "basis":"none" when there is no meaningful relation to the seeker’s qualifications or field. Score 0-39.',
    'Judge "degree" only from the description text, never from the title alone, and do not count a qualification the text says is NOT required. Scoring never removes a listing - a low score is still kept.',
    '',
    `THE SEEKER wants: ${JSON.stringify(roles)}${location ? `, location: ${JSON.stringify(location)}` : ''}${intent !== 'any' ? `, employment type: ${intent}` : ''}`,
    `LISTINGS: ${JSON.stringify(
      jobs.map(j => ({
        id: j.id,
        title: j.title,
        company: j.company,
        location: j.location,
        ...(j.promoted ? { promoted: true } : {}),
        description: descriptions[j.id] ?? '',
      })),
    )}`,
    '',
    'Reply with ONLY one JSON object: {"remove":[{"id": the id exactly as given, "why": at most 12 plain words}], "rank":[{"id": the id exactly as given, "fit": 0-100, "basis": "degree"|"domain"|"none", "quals": [matching labels copied exactly], "why": at most 12 plain words}]}. Score EVERY listing you keep. A listing is in at most one of the two lists.',
  ].join('\n');
}
const rankReply = z.object({
  remove: z
    .array(z.object({ id: z.union([z.string(), z.number()]).transform(String), why: z.string().max(200).default('') }))
    .max(40)
    .default([]),
  rank: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        fit: z.coerce.number().catch(0),
        basis: z.enum(['degree', 'domain', 'none']).catch('none'),
        quals: z.array(z.string().max(60)).max(12).default([]),
        why: z.string().max(200).default(''),
      }),
    )
    .max(40)
    .default([]),
});
/**
 * One batch's reply: which to remove, and a fit ranking for the rest. Only real ids and offered qualification labels
 * survive (hallucinations dropped), fit is clamped to 0-100, and a batch that removes most of itself is not trusted
 * to remove anything.
 */
export function rankFromReply(
  json: unknown,
  ids: string[],
  allowed: string[],
): { remove: Map<string, string>; rank: Map<string, JobRank> } {
  const parsed = rankReply.parse(json);
  const byLower = new Map(allowed.map(a => [a.toLowerCase(), a]));
  let remove = new Map<string, string>();
  for (const r of parsed.remove) if (ids.includes(r.id)) remove.set(r.id, r.why.trim() || 'Not a good match');
  if (remove.size > ids.length * 0.6) remove = new Map(); // do not trust a batch that nukes most of itself
  const rank = new Map<string, JobRank>();
  for (const r of parsed.rank) {
    if (!ids.includes(r.id) || remove.has(r.id)) continue;
    const quals = [...new Set(r.quals.map(q => byLower.get(q.trim().toLowerCase())).filter((q): q is string => !!q))];
    const fit = Math.max(0, Math.min(100, Math.round(r.fit)));
    rank.set(r.id, { fit, basis: r.basis, quals, why: r.why.trim() });
  }
  return { remove, rank };
}
