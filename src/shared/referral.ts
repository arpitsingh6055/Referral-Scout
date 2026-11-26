import { z } from 'zod';
import { COMPANY_KINDS, classify, companyMatches, functionWords, normalizeCompany } from './targeting';
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
  /** The LinkedIn job, or the job's own page on the company's site when it was applied for there. */
  url: z.union([z.string().regex(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/$/), z.string().url().max(500).startsWith('https://')]),
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(1).max(200),
  location: z.string().max(200).default(''),
  /** The company's own LinkedIn page, when the job page links to it. Used once to read the company's number for the Current company filter. */
  companyUrl: z
    .string()
    .regex(/^https:\/\/www\.linkedin\.com\/company\/[^/?#]+\/$/)
    .optional(),
  /** People LinkedIn itself lists on the job page under "People you can reach out to". Checked and ranked like everyone else. */
  suggested: z
    .array(
      z.object({
        url: z.string().max(300),
        name: z.string().max(150),
        headline: z.string().max(500),
        degree: z.number().int().min(1).max(3).optional(),
        alum: z.boolean().optional(),
      }),
    )
    .max(10)
    .optional(),
});
export const referralMessage = z.object({
  kind: z.literal('network.referral'),
  mode: z.enum(['referral', 'connections']),
  job: referralJobInput,
});
export interface ReferralJob extends z.infer<typeof referralJobInput> {
  mode: 'referral' | 'connections';
  addedAt: number;
  /** How many of the planned searches are done. The scan is finished when this reaches the plan's length. */
  cursor: number;
  found: number;
  finishedAt?: number;
  /** LinkedIn's number for the company, once read. `idTried` stops a second attempt when it could not be read. */
  companyId?: string;
  idTried?: boolean;
  /** Read from the job's own page when the job came from a search list and not from a click on a job page. */
  infoTried?: boolean;
  size?: CompanySize;
  sizeText?: string;
  /** How many invitations this company gets (3 to 5). People already known are messaged on top of that. */
  perCompany?: number;
  /** People the person already knows there. When there are some, the person decides: ask only them, or also look for stronger referrers. */
  known?: number;
  decision?: 'known' | 'widen';
  waiting?: boolean;
  /** Who to approach at this company, decided by ChatGPT from what it knows of the company. `strategyTried` stops a second prompt. */
  strategy?: CompanyStrategy;
  strategyTried?: boolean;
  /** Pages that could not be read for this company. After three the company is closed with what was found, so one bad company never blocks the rest. */
  failures?: number;
  error?: string;
  /** The company page was looked up through LinkedIn's company search, because the job itself did not give it. */
  lookupTried?: boolean;
  /** When the person marked this job as applied for. */
  applied?: number;
  /** Why the seeker suits this job, from the description ranking (e.g. "asks for MBA/PGDM; strategy role"). Used in outreach wording. */
  fitNote?: string;
}
/** How many people one "Ask for referrals" click contacts by itself: the strongest few. A whole recruiting team is not messaged at once. */
export const REFERRAL_AUTO = 8;
export interface ReferralSearch {
  label: string;
  keywords: string;
  network: ('F' | 'S' | 'O')[];
  page?: number;
  /** A search for people from the person's own school: everyone it returns counts as an alum. */
  alum?: boolean;
}
/**
 * The person's schools, read from their profile's Education section (stored as one line of text), for the alumni
 * search. A school is a run of capitalised words around Institute, University, College, School or Academy, cut at the
 * first comma: "Institute of Management Technology, Ghaziabad" becomes the name LinkedIn's keyword search matches
 * best. At most two.
 */
const DEGREE =
  /^(?:[A-Z]{2,6}|B\.\S*|M\.\S*|Bachelor'?s?|Master'?s?|Post|Postgraduate|Graduate|Diploma|Doctor|PhD|Ph\.D\.?|Executive|Class|Grade)$/;
export function schoolsOf(education: string | undefined): string[] {
  const text = (education ?? '').replace(/\s+/g, ' ');
  const word = "[A-Z][A-Za-z&.'-]*";
  const re = new RegExp(
    `((?:${word} ){0,4}(?:Institute|University|College|School|Academy|Vidyapeeth|Vishwavidyalaya)(?: (?:of|for|and|&|${word}))*)`,
    'g',
  );
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const words = m[1]!.trim().split(' ');
    // Drop a section heading or a degree written in capitals in front of the name ("Education", "PGDM", "MBA").
    while (words.length > 1 && (/^education$/i.test(words[0]!) || DEGREE.test(words[0]!)) && !/^(?:IIT|IIM|NIT|IIIT|BITS)$/.test(words[0]!))
      words.shift();
    // ...and the degree written after it ("Delhi University Bachelor of Commerce", "IIT Delhi B.Tech").
    const cut = words.findIndex((w, i) => i > 0 && DEGREE.test(w));
    if (cut > 0) words.splice(cut);
    while (words.length > 1 && /^(?:of|for|and|&)$/i.test(words[words.length - 1]!)) words.pop();
    const name = words.join(' ');
    if (name.length >= 6 && !out.some(o => o.toLowerCase() === name.toLowerCase())) out.push(name);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * The searches for one company, most valuable first.
 *
 * With the company's LinkedIn number (read once from its company page) every search uses LinkedIn's own
 * "Current company" filter, so only people who work there now come back, however they word their headline.
 * Without it the company name is used as a keyword and each result is checked against the name.
 */
export function referralPlan(
  job: Pick<ReferralJob, 'company' | 'title' | 'mode' | 'companyId' | 'size'>,
  titles?: string[],
  schools: string[] = [],
): ReferralSearch[] {
  const fn = functionWords([job.title])[0] ?? '',
    at = job.company;
  if (job.companyId) {
    const known: ReferralSearch[] = [
      { label: `people you already know at ${at}`, keywords: '', network: ['F'] },
      { label: `more people you know at ${at}`, keywords: '', network: ['F'], page: 2 },
    ];
    if (job.mode === 'connections') return known;
    // Alumni of the person's own school are among the most willing referrers, whatever their team: searched right
    // after the people already known, with the school name as the keyword inside LinkedIn's Current company filter.
    const alumni: ReferralSearch[] = schools.map(school => ({
      label: `people from ${school} at ${at}`,
      keywords: `"${school.replace(/"/g, '')}"`,
      network: ['S', 'O'],
      alum: true,
    }));
    // The team the job sits in (product, engineering, ...) is always searched: a planned list of titles for a company
    // of this size is mostly recruiters and general managers, and would miss the people the person would work with.
    const team: ReferralSearch[] = fn ? [{ label: `the ${fn} team at ${at}`, keywords: fn, network: ['S', 'O'] }] : [];
    if (titles?.length) {
      // Planned titles for a company of this size, searched in two groups so each query stays short enough for LinkedIn.
      const groups = [titles.slice(0, 5), titles.slice(5, 10)].filter(g => g.length);
      return [
        ...known,
        ...alumni,
        ...groups.map((g, i) => ({
          label: i ? `more likely referrers at ${at}` : `likely referrers at ${at}`,
          keywords: `(${g.map(t => (/\s/.test(t) ? `"${t}"` : t)).join(' OR ')})`,
          network: ['S', 'O'] as ('S' | 'O')[],
        })),
        ...team,
      ];
    }
    return [
      known[0]!,
      ...alumni,
      { label: `recruiters and HR at ${at}`, keywords: COMPANY_KINDS[0]!, network: ['S', 'O'] },
      { label: `more recruiters and HR at ${at}`, keywords: COMPANY_KINDS[0]!, network: ['S', 'O'], page: 2 },
      // Without a recognisable function in the job title this would repeat the managers search below.
      ...(fn ? [{ label: `the ${fn} team at ${at}`, keywords: fn, network: ['S', 'O'] as ('S' | 'O')[] }] : []),
      { label: `managers and leaders at ${at}`, keywords: COMPANY_KINDS[1]!, network: ['S', 'O'] },
      { label: `founders at ${at}`, keywords: COMPANY_KINDS[2]!, network: ['S', 'O'] },
    ];
  }
  const company = `"${at.replace(/"/g, '')}"`,
    everyone: ('F' | 'S' | 'O')[] = job.mode === 'connections' ? ['F'] : ['F', 'S', 'O'];
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
export interface ReferralVerdict {
  kind: ReferralKind;
  score: number;
  reason: string;
}
const WEIGHT: Record<ReferralKind, number> = { recruiter: 300, leader: 260, founder: 220, senior: 200, peer: 180, employee: 150 };
const WHY: Record<ReferralKind, string> = {
  recruiter: 'Recruiter',
  leader: 'On the hiring team',
  founder: 'Founder',
  senior: 'Senior person',
  peer: 'Works in the same team area',
  employee: 'Works there',
};
// For a referral the test is wider than for general outreach: anyone in hiring or people teams, and anyone senior
// at the company, can put a name forward even when their own function differs from the job's.
const HIRING =
  /recruit|talent|sourc(?:er|ing)|\bh\.?r\.?\b|\bhrbp\b|\bhr\s*bp\b|human\s+(?:resources?|capital)|people\s*(?:&|and|ops|operations|partner|business|team|success|experience|\bculture)|\bta\b|hiring|staffing|campus|university\s+(?:relations|recruit)|early\s+careers?|employer\s+brand/i;
const SENIOR = /\b(?:head|director|vp|vice president|president|chief|c[tfoepm]o|manager|lead|leader|principal|partner|avp|svp|evp)\b/i;
// "HR" alone is not hiring: HR operations, payroll, HRIS and HR analytics people rarely have a say in who is hired.
// They count as recruiters only when the headline also says they recruit or partner with the business.
const RECRUITING =
  /recruit|talent|sourc(?:er|ing)|campus|university\s+(?:relations|hiring)|early\s+careers?|hiring|staffing|employer\s+brand|\bhr\s*bp\b|\bhrbp\b|business\s+partner|people\s+partner|\bta\b|\bhr\s+(?:manager|head|director|generalist|leader)|head\s+of\s+(?:hr|people)|(?:chief|vp)\s+(?:people|hr)/i;
const HR_SUPPORT =
  /\b(?:hr|human\s+resources?)\b[^|]{0,30}\b(?:operations|ops|analytics|payroll|hris|benefits|compensation|shared\s+services|systems|technology)\b|payroll|\bhris\b|data\s+analyst/i;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether this person can help with a referral at this company, and how much.
 * `verified` means LinkedIn's Current company filter was used, so they are known to work there.
 * A plain employee in an unrelated team only counts if the person already knows them (1st degree):
 * a stranger who merely works there is the unhelpful suggestion this is meant to avoid.
 */
export function rankReferral(
  person: { headline: string; current?: string | undefined; degree?: number | undefined; alum?: boolean | undefined },
  job: Pick<ReferralJob, 'company' | 'title' | 'size'>,
  verified = false,
  titles: string[] = [],
  avoid: string[] = [],
): ReferralVerdict | null {
  const headline = person.headline;
  if (!verified && !companyMatches(`${person.current ?? ''} | ${headline}`, job.company)) return null;
  // "Ex Tata Group" must not rule out someone now at this company; only "ex-<this company>" does.
  if (new RegExp(`\\b(?:ex|former(?:ly)?|previously)\\b[-\\s:@]*(?:at\\s+)?${escape(job.company)}`, 'i').test(headline)) return null;
  // Interns, trainees and job seekers cannot put a name forward, even when they do work there.
  if (
    /\b(?:open to work|seeking|aspiring|looking for|intern|internship|trainee|apprentice|student)\b/i.test(headline) &&
    !/\b(?:recruit|talent|hr|campus|early careers?)\b/i.test(headline)
  )
    return null;
  const fn = functionWords([job.title])[0];
  let kind: ReferralKind =
    classify({ headline }, { roles: [job.title] })?.category ??
    (HIRING.test(headline)
      ? 'recruiter'
      : SENIOR.test(headline)
        ? fn && new RegExp(`\\b${escape(fn)}`, 'i').test(headline)
          ? 'leader' // a senior person in the job's own team ("Product Leader" for a product role)
          : 'senior'
        : fn && new RegExp(`\\b${escape(fn)}`, 'i').test(headline)
          ? 'peer'
          : 'employee');
  if (kind === 'recruiter' && !RECRUITING.test(headline) && HR_SUPPORT.test(headline)) kind = SENIOR.test(headline) ? 'senior' : 'employee';
  const degree = person.degree ?? 3;
  // A school alum is treated like someone with a mutual connection: likelier to answer and to help.
  const alum = person.alum === true,
    reach = alum ? Math.min(degree, 2) : degree;
  // At a large company a founder, director or VP will not answer a stranger about a referral. Keep them only if already known.
  const tooSenior =
    job.size === 'large' &&
    (kind === 'founder' || /\b(?:director|vp|vice president|president|chief|c[tfoepm]o|founder|ceo|managing director)\b/i.test(headline)) &&
    !HIRING.test(headline);
  if (tooSenior && degree !== 1 && !alum) return null;
  // Titles the plan says not to approach at this company as a stranger. People who hire are never ruled out this way.
  if (degree !== 1 && !HIRING.test(headline) && avoid.some(t => new RegExp(`\\b${escape(t)}\\b`, 'i').test(headline))) return null;
  const planned = titles.some(t => new RegExp(`\\b${escape(t)}`, 'i').test(headline));
  if (kind === 'employee' && degree !== 1 && !planned && !alum) return null;
  if (kind === 'peer' && reach > 2) return null; // same-team peers only when there is at least a mutual connection, or a shared school
  // Someone from the same school is noticeably more willing to help; LinkedIn flags them on the job page.
  const score = WEIGHT[kind] + (degree === 1 ? 60 : degree === 2 ? 20 : 0) + (alum ? 110 : 0) + (planned ? 40 : 0) - (tooSenior ? 80 : 0);
  return {
    kind,
    score,
    reason: `${WHY[kind]} at ${job.company}${degree === 1 ? ', already your connection' : ''}${alum ? ', from your school' : ''}. For: ${job.title}`,
  };
}

const ACRONYMS = new Set([
  'PM',
  'APM',
  'UI',
  'UX',
  'AI',
  'ML',
  'SDE',
  'QA',
  'HR',
  'HRBP',
  'VP',
  'B2B',
  'B2C',
  'SAAS',
  'SQL',
  'IT',
  'IOS',
  'CFO',
  'CTO',
  'CEO',
  'COO',
  'CRM',
  'ERP',
  'FP&A',
]);

/**
 * Strips scraped job-board noise from a raw job title so outreach notes sound human:
 * removes parentheticals `(Paid - India/Remote)`, brackets `[Hybrid]`, Req IDs, trailing
 * location/work-mode/employment-type qualifiers, and normalizes ALL-CAPS yelling.
 */
export function humanizeJobTitle(raw: string): string {
  let s = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // Remove parenthetical and bracketed metadata (e.g., "(Paid - India/Remote)", "(Growth, Recruiting & Ops)", "[Hybrid]").
  s = s.replace(/\s*\([^)]*\)/g, ' ').replace(/\s*\[[^\]]*\]/g, ' ');

  // Remove Req/Job IDs.
  s = s.replace(/\b(?:req|requisition|job\s*id|id)\s*[:#-]?\s*[a-z0-9-]{3,}\b/gi, ' ').replace(/#\d{3,}\b/g, ' ');

  // Remove trailing qualifiers after -, –, —, |, or / (e.g., "- Full Time", "| Core Payments", "- Bengaluru 2026").
  s = s.replace(
    /\s*[-–—|]\s*(?:remote|hybrid|on-?site|onsite|paid|unpaid|stipend|india|bengaluru|bangalore|mumbai|delhi|ncr|gurgaon|gurugram|hyderabad|pune|chennai|full[- ]?time|part[- ]?time|contract|immediate(?:\s+joiner)?|urgent|hiring|202\d|core\s+.+|ai\/ml\s+.+)\b.*$/i,
    '',
  );

  // Strip trailing standalone pipe/dash fragments if anything was left dangling.
  s = s
    .replace(/\s*[-–—|/]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Normalize ALL-CAPS titles into Title Case while preserving acronyms.
  const letters = s.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) {
    s = s
      .toLowerCase()
      .split(' ')
      .map(w => {
        const upper = w.toUpperCase();
        if (ACRONYMS.has(upper)) return upper;
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ');
  }

  // If still excessively long (> 44 chars), condense at a separator or word boundary.
  if (s.length > 44) {
    const parts = s.split(/\s*[-–—|]\s*/);
    if (parts[0] && parts[0].length >= 8 && parts[0].length <= 44) {
      s = parts[0].trim();
    } else {
      const cut = s
        .slice(0, 44)
        .replace(/\s+\S*$/, '')
        .trim();
      if (cut.length >= 8) s = cut;
    }
  }

  return s || raw.trim();
}

/**
 * Strips accelerator batches `(YC W22)`, legal suffixes (`Pvt. Ltd.`, `Private Limited`, `Inc.`, `LLC`),
 * and redundant corporate noise from scraped company names.
 */
export function humanizeCompanyName(raw: string): string {
  let s = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // Remove parenthetical accelerator batches or locations, e.g. "(YC W22)", "(Techstars '23)", "(India)".
  s = s.replace(/\s*\([^)]*\)/g, ' ').replace(/\s*\[[^\]]*\]/g, ' ');

  // Remove trailing legal suffixes iteratively.
  s = s
    .replace(
      /[,.]?\s*\b(?:private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|inc\.?|incorporated|llc|llp|corp\.?|corporation|gmbh|technologies|solutions|services)\b\.?$/gi,
      '',
    )
    .replace(
      /[,.]?\s*\b(?:private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|inc\.?|incorporated|llc|llp|corp\.?|corporation|gmbh|technologies|solutions|services)\b\.?$/gi,
      '',
    );

  return (
    s
      .replace(/[,.\s]+$/, '')
      .replace(/\s+/g, ' ')
      .trim() || raw.trim()
  );
}

const first = (name: string): string => name.split(/\s+/)[0] || name;
const role = (job: Pick<ReferralJob, 'title' | 'company'>): string =>
  `the ${humanizeJobTitle(job.title)} role at ${humanizeCompanyName(job.company)}`;
/** "I’ve applied for" once the application is in (a referral then attaches to a real application), else "I’m applying for". */
const applying = (job: { applied?: number | undefined }): string => (job.applied ? 'I’ve applied for' : 'I’m applying for');
/** Connection note for someone not yet connected. Fits within LinkedIn's 200-char (free) or 300-char (Premium) limit without mid-word truncation. */
export function referralNote(
  job: Pick<ReferralJob, 'title' | 'company'> & { applied?: number | undefined },
  person: { name: string; category?: string | undefined },
  me: string,
  limit = 200,
): string {
  const ask = person.category === 'recruiter' ? 'Would love to connect about it.' : 'Would love to connect and hear your view of the team.';
  const full = `Hi ${first(person.name)}, I’m ${first(me)}. ${applying(job)} ${role(job)}. ${ask}`;
  if (full.length <= limit) return full;

  const shortAsk = 'Would love to connect.';
  const compact = `Hi ${first(person.name)}, I’m ${first(me)}. ${applying(job)} ${role(job)}. ${shortAsk}`;
  if (compact.length <= limit) return compact;

  const bare = `Hi ${first(person.name)}, I’m ${first(me)}. ${applying(job)} ${role(job)}.`;
  if (bare.length <= limit) return bare;

  const cut = bare
    .slice(0, Math.max(0, limit - 1))
    .replace(/\s+\S*$/, '')
    .trim();
  return cut ? `${cut}…` : bare.slice(0, limit);
}
/** Message to someone who is, or has just become, a connection. `accepted` adds the thank-you. */
export function referralAsk(
  job: Pick<ReferralJob, 'title' | 'company' | 'url'> & { applied?: number | undefined },
  person: { name: string; category?: string | undefined },
  me: string,
  accepted: boolean,
): string {
  const open = accepted ? `Hi ${first(person.name)}, thanks for connecting!` : `Hi ${first(person.name)}, hope you’re doing well.`;
  const ask =
    person.category === 'recruiter'
      ? 'Could you tell me the best way to be considered, or who is hiring for it?'
      : 'Would you be open to referring me, or pointing me to the right person?';
  return `${open} I’m ${first(me)}, and ${applying(job)} ${role(job)}: ${job.url} ${ask} Happy to share my CV.`;
}

/**
 * The right company among LinkedIn's company search results: the same name, and when several share it,
 * the one in the job's own place. Nothing is returned for a loose match; a wrong company is worse than none.
 */
export function pickCompany(rows: { name: string; url: string; lines: string[] }[], company: string, location = ''): string | null {
  const want = normalizeCompany(company),
    ok = /^https:\/\/www\.linkedin\.com\/company\/[^/?#]+\/$/;
  const same = rows.filter(r => ok.test(r.url) && normalizeCompany(r.name) === want);
  if (!same.length) return null;
  const places = location
    .toLowerCase()
    .split(/[,·|()]/)
    .map(x => x.trim())
    .filter(x => x.length > 2);
  return (same.find(r => places.some(p => r.lines.join(' ').toLowerCase().includes(p.split(' ')[0]!))) ?? same[0]!).url;
}

/**
 * The next reply in a conversation with someone who was asked for a referral. ChatGPT reads what has been said
 * and writes what the seeker would say next; the person edits and sends it themselves.
 */
export function replyPrompt(input: {
  me: string;
  about: string;
  roles: string[];
  person: { name: string; headline: string; companyName?: string | undefined };
  job?: { title: string; company: string; url: string } | undefined;
  messages: { mine: boolean; text: string }[];
}): string {
  const first = input.person.name.split(/\s+/)[0] ?? input.person.name;
  return [
    `You are helping ${input.me}, a job seeker, write the NEXT message in a LinkedIn conversation. They contacted ${input.person.name} to ask for help with a job. Write only what ${input.me} would send now.`,
    '',
    'Read the conversation and answer what the other person actually said. Typical situations:',
    `- They agreed to refer or help ("Sure, share your CV"): thank them in one line, say the CV is attached, give the job link if there is one, and ask if they need anything else. Example: "Thank you, ${first}, I really appreciate it. I have attached my CV. The role is <job link>. Is there anything else you need from me?"`,
    '- They asked a question (about experience, notice period, location, which role): answer it plainly from the facts below. If the facts below do not contain the answer, write a short bracketed note for the seeker to fill in, like [your notice period], rather than inventing it.',
    '- They pointed to someone else or to a careers page: thank them, and ask one specific follow-up at most (for example whether they could introduce you).',
    '- They said they cannot help: thank them warmly in one or two lines and do not ask again.',
    '- They only said hello or thanks for connecting: state the request in two sentences, with the job, and ask whether they would be open to referring you or pointing you to the right person.',
    `- The last message is from ${input.me} and has not been answered: write a brief, polite nudge of one or two sentences that adds something useful, not "just following up".`,
    '',
    'Rules: 30 to 90 words. Plain, warm, specific. Match their tone and language. No flattery, no list of achievements, no invented facts, no emojis unless they used them, no phone numbers or email addresses. Do not paste the CV; the seeker attaches it themselves. Use the job link only if one is given below.',
    '',
    `THE SEEKER: ${JSON.stringify({ name: input.me, lookingFor: input.roles, about: input.about.slice(0, 1200) })}`,
    `THE OTHER PERSON: ${JSON.stringify({ name: input.person.name, headline: input.person.headline, ...(input.person.companyName ? { company: humanizeCompanyName(input.person.companyName) } : {}) })}`,
    `THE JOB: ${input.job ? JSON.stringify({ title: humanizeJobTitle(input.job.title), company: humanizeCompanyName(input.job.company), link: input.job.url }) : 'no specific job on record'}`,
    `THE CONVERSATION SO FAR, oldest first: ${JSON.stringify(input.messages.map(m => ({ from: m.mine ? input.me : input.person.name, text: m.text })))}`,
    '',
    'Reply with ONLY one JSON object: {"reply": the message text}.',
  ].join('\n');
}
