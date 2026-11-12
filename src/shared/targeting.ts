/**
 * Who is worth contacting, and how to find them. Pure functions, no browser or storage access,
 * so every rule here is unit-tested.
 */
export type PersonCategory = 'recruiter' | 'leader' | 'founder';
export interface Classification {
  category: PersonCategory;
  score: number;
  reason: string;
  company?: string;
}
export interface PersonCard {
  headline: string;
  location?: string;
  degree?: number;
}

/** Words that describe the role, not the function ("Product Management internship" -> product). */
const GENERIC = new Set([
  'internship',
  'intern',
  'interns',
  'trainee',
  'summer',
  'associate',
  'role',
  'roles',
  'management',
  'manager',
  'junior',
  'senior',
  'entry',
  'level',
  'fresher',
  'graduate',
  'job',
  'jobs',
  'opportunities',
  'opportunity',
  'full',
  'time',
  'part',
  'and',
  'the',
  'for',
]);
const FUNCTIONS: [RegExp, string[]][] = [
  [/product|\bpm\b/, ['product', 'pm']],
  [
    /software|engineer|developer|sde|backend|frontend|full ?stack/,
    ['software', 'engineering', 'engineer', 'developer', 'technology', 'platform'],
  ],
  [/data|analytic|\bml\b|machine learning|\bai\b/, ['data', 'analytics', 'insights', 'ml', 'ai', 'machine learning']],
  [/design|\bux\b|\bui\b|creative/, ['design', 'ux', 'ui', 'creative']],
  [/market|growth|brand|content|seo/, ['marketing', 'growth', 'brand', 'content', 'demand generation']],
  [/financ|banking|invest|treasury|equity/, ['finance', 'fp&a', 'investment', 'banking', 'treasury']],
  [/consult|strategy|business analyst/, ['consulting', 'strategy', 'business']],
  [/operations|supply|logistics|\bops\b/, ['operations', 'supply chain', 'ops', 'logistics']],
  [/sales|business development|\bbd\b/, ['sales', 'business development', 'bd', 'revenue']],
  [/\bhr\b|human resources|people/, ['people', 'hr', 'human resources']],
];
export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Function keywords implied by the user's target roles (stems plus synonyms). */
export function functionWords(roles: string[]): string[] {
  const out = new Set<string>();
  for (const role of roles) {
    const low = role.toLowerCase();
    for (const [pattern, words] of FUNCTIONS) if (pattern.test(low)) words.forEach(w => out.add(w));
    for (const token of low.match(/[a-z&]{3,}/g) ?? []) if (!GENERIC.has(token)) out.add(token);
  }
  return [...out];
}

const OPEN_TO_WORK =
  /\b(open to work|#opentowork|seeking|looking for (?:new )?(?:opportunit|role|job|internship)|job ?seeker|aspiring|aspirant|fresher|student|studying|pursuing|undergraduate|incoming|class of|batch of)\b/i;
const STUDENT_TITLE = /\b(mba|pgdm|pgp|b\.?tech|m\.?tech|bba|candidate|intern|trainee)\b/i;
/** "Former CEO", "Ex-Google Recruiter": the role is in the past. */
const FORMER_ROLE =
  /\b(?:ex|former|previously)[-\s]+(?:[\w&]+\s+){0,2}(?:recruit|talent|ceo|founder|co-?founder|head|director|hr\b|manager|vp|chief|lead|owner)/i;
const NOT_DECISION_MAKER =
  /founder'?s'?\s+office|assistant to|executive assistant|chief of staff|office of the|ceo'?s office|associate to|\bPA to\b/i;

const RECRUITER =
  /\b(recruit(?:er|ers|ing|ment)|talent\s+(?:acquisition|partner|advisor|scout|sourcer|sourcing|lead|manager|specialist|head|team|attraction)|sourcer|head\s+of\s+talent|hiring\s+(?:manager|lead|partner|team)|campus\s+(?:hiring|recruit\w*|relations)|university\s+(?:relations|recruit\w*|hiring)|early\s+careers|human\s+resources|hrbp|hr\s+(?:business\s+partner|manager|lead|head|generalist|executive|director|partner|specialist|operations|ops|recruiter)|people\s+(?:partner|operations|ops|team|lead|head|&\s*culture|and\s+culture|success|experience)|head\s+of\s+people|chief\s+people)\b/i;
const FOUNDER =
  /\b(co[-\s]?founder|cofounder|founder|business owner|proprietor|ceo|chief\s+executive(?:\s+officer)?|managing\s+director|founding\s+(?:partner|team|member))\b/i;
const SENIOR_LEADER = /\b(head|director|vp|vice\s+president|chief|principal|group|general\s+manager|gm)\b/i;
const ANY_LEADER = /\b(head|director|vp|vice\s+president|chief|principal|manager|lead|group)\b/i;
const NOT_A_LEADER = /leadership|lead\s+gen(?:eration)?\b|team\s+lead\b.*\bintern/i;

/** "Talent Acquisition at Razorpay | MBA" -> {title:"Talent Acquisition", company:"Razorpay"} for each segment. */
export function segments(headline: string): { title: string; company?: string }[] {
  return headline
    .split(/\s*[|•·]\s*|\s+[-–—]\s+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [title = '', company] = part.split(/\s+(?:at|@)\s+|\s*@\s*/i);
      return { title: title.trim(), ...(company?.trim() ? { company: company.trim() } : {}) };
    });
}

export function companyOf(headline: string): string | undefined {
  return (
    segments(headline)
      .find(s => s.company)
      ?.company?.replace(/\s*[|•·].*$/, '')
      .trim() || undefined
  );
}
const SUFFIXES =
  /\b(pvt|private|ltd|limited|inc|incorporated|llc|llp|corp|corporation|co|company|technologies|technology|solutions|software|services|labs|india|global|group|holdings)\b\.?/g;
export const normalizeCompany = (name: string): string =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** True when the headline visibly names the company, tolerating "Pvt Ltd" style suffixes. */
export function companyMatches(headline: string, company: string): boolean {
  const wanted = normalizeCompany(company),
    have = normalizeCompany(headline);
  if (wanted.length < 2) return false;
  return ` ${have} `.includes(` ${wanted} `) || wanted.split(' ').every(t => t.length > 1 && have.split(' ').includes(t));
}

export function locationFits(cardLocation: string | undefined, wanted: string): boolean | null {
  const w = wanted.trim().toLowerCase();
  if (!w || /^(any|anywhere|remote|worldwide|global)$/.test(w) || !cardLocation?.trim()) return null;
  const have = cardLocation.toLowerCase();
  return (w.match(/[a-z]{3,}/g) ?? []).some(t => have.includes(t));
}

/** Decide whether a LinkedIn search result is a worthwhile recipient, and rank them. null = do not contact. */
export function classify(card: PersonCard, ctx: { roles: string[]; location?: string; company?: string }): Classification | null {
  const headline = card.headline.replace(/\s+/g, ' ').trim();
  if (!headline || card.degree === 1) return null; // already connected: nothing to invite
  if (OPEN_TO_WORK.test(headline) || NOT_DECISION_MAKER.test(headline)) return null;
  const parts = segments(headline);
  const first = parts[0]?.title ?? '';
  if (STUDENT_TITLE.test(first) && !RECRUITER.test(first) && !FOUNDER.test(first)) return null; // peers, not decision makers

  const fn = functionWords(ctx.roles);
  let best: { category: PersonCategory; base: number; reason: string; company?: string } | null = null;
  const consider = (candidate: NonNullable<typeof best>): void => {
    if (!best || candidate.base > best.base) best = candidate;
  };
  for (const part of parts) {
    if (FORMER_ROLE.test(part.title)) continue;
    const title = part.title,
      company = part.company;
    if (RECRUITER.test(title) || /^hr\b|\bhr$|\bhr\b(?=\s*(?:at|@|,)|$)/i.test(title)) {
      consider({
        category: 'recruiter',
        base: /campus|university|early careers|intern/i.test(title) ? 105 : 100,
        reason: 'Recruiting / people team',
        ...(company ? { company } : {}),
      });
    } else if (FOUNDER.test(title)) {
      consider({ category: 'founder', base: 70, reason: 'Founder / company leader', ...(company ? { company } : {}) });
    } else if (
      ANY_LEADER.test(title) &&
      !NOT_A_LEADER.test(title) &&
      fn.some(w => new RegExp(`(^|[^a-z])${escapeRegex(w)}([^a-z]|$)`, 'i').test(title))
    ) {
      consider({
        category: 'leader',
        base: SENIOR_LEADER.test(title) ? 85 : 70,
        reason: 'Relevant team leader',
        ...(company ? { company } : {}),
      });
    }
  }
  const found = best as { category: PersonCategory; base: number; reason: string; company?: string } | null;
  if (!found) return null;
  let score = found.base;
  if (card.degree === 2) score += 10;
  if (ctx.company && companyMatches(headline, ctx.company)) score += 15;
  const fits = locationFits(card.location, ctx.location ?? '');
  if (fits === true) score += 5;
  else if (fits === false) score -= 15;
  return {
    category: found.category,
    score: Math.max(0, Math.min(130, score)),
    reason: found.reason,
    ...(found.company ? { company: found.company } : {}),
  };
}

export interface SearchCombo {
  role: string;
  kind: 'recruiter' | 'campus' | 'leader' | 'founder';
  keywords: string;
}
export const MAX_SEARCH_PAGES = 5;
const primaryFunction = (role: string): string => functionWords([role]).find(w => w.length > 2) ?? role;
/** The full grid of searches for the user's roles: every role is combined with every kind of contact. */
/**
 * LinkedIn's own numbers for places, used with its Locations filter (`geoUrn`). A filter is exact; the place
 * typed as a keyword only matches people who happen to write it in their profile. India was checked live
 * (November 2026); a place not listed here falls back to the keyword.
 */
const GEO: Record<string, string> = {
  india: '102713980',
  'united states': '103644278',
  usa: '103644278',
  us: '103644278',
  'united kingdom': '101165590',
  uk: '101165590',
  canada: '101174742',
  australia: '101452733',
  germany: '101282230',
  singapore: '102454443',
  'united arab emirates': '104305776',
  uae: '104305776',
  france: '105015875',
  netherlands: '102890719',
  ireland: '104738515',
  spain: '105646813',
};
export function geoFor(location: string): string | undefined {
  const text = location.trim().toLowerCase().replace(/\./g, '');
  return GEO[text] ?? GEO[text.split(',').pop()!.trim()];
}
export function searchCombos(roles: string[], location: string): SearchCombo[] {
  // With a Locations filter the place is not repeated as a keyword: it would only narrow results to profiles that spell it out.
  const place =
    location.trim() && !/^(any|anywhere|worldwide|global)$/i.test(location.trim()) && !geoFor(location) ? ` ${location.trim()}` : '';
  return roles.flatMap(role => {
    const fn = primaryFunction(role),
      early = /intern|trainee|fresher|graduate|entry|campus/i.test(role);
    return [
      {
        role,
        kind: 'recruiter' as const,
        keywords: `(recruiter OR "talent acquisition" OR "talent partner" OR sourcer OR HR OR HRBP OR "human resources") ${fn}${place}`,
      },
      ...(early
        ? [
            {
              role,
              kind: 'campus' as const,
              keywords: `(campus OR university OR "early careers" OR intern) (recruiter OR "talent acquisition" OR hiring)${place}`,
            },
          ]
        : []),
      { role, kind: 'leader' as const, keywords: `(head OR director OR VP OR manager OR lead) ${fn}${place}` },
      { role, kind: 'founder' as const, keywords: `(founder OR "co-founder" OR CEO) ${fn}${place}` },
    ];
  });
}
/** cursor -> which combo and which result page. exhausted once every combo has been paged through. */
export function planSearch(roles: string[], location: string, cursor: number): { combo: SearchCombo; page: number } | null {
  const combos = searchCombos(roles, location);
  if (!combos.length) return null;
  const page = Math.floor(cursor / combos.length) + 1;
  return page > MAX_SEARCH_PAGES ? null : { combo: combos[cursor % combos.length]!, page };
}
// People who hire rarely all call themselves "recruiter": HR, HRBP, people partners and campus teams are included.
export const COMPANY_KINDS = [
  '(recruiter OR recruitment OR "talent acquisition" OR "talent partner" OR sourcer OR HR OR HRBP OR "human resources" OR "people partner" OR "people operations" OR campus)',
  '(head OR director OR manager OR lead OR VP)',
  '(founder OR CEO OR "co-founder")',
];

/** Generic target suggestion: the profile's function if it has one, otherwise an internship the user can edit. */
export function suggestTarget(headline: string, experienceText = ''): string {
  const studentLike = /\b(pgdm|pgp|mba|bba|b\.?tech|student|batch|class of|university|institute|college)\b/i.test(headline);
  const area = (text: string): string | null => {
    for (const [pattern, label] of [
      [/product/i, 'Product Management'],
      [/software|developer|programmer|engineer/i, 'Software Engineering'],
      [/data|analytics/i, 'Data Analytics'],
      [/design|\bUX\b|\bUI\b/i, 'Product Design'],
      [/marketing|growth|brand/i, 'Marketing and Growth'],
      [/financ|banking/i, 'Finance'],
      [/consult|strategy/i, 'Consulting'],
      [/operations|supply/i, 'Operations'],
      [/sales|business development/i, 'Sales and Business Development'],
    ] as const)
      if (pattern.test(text)) return label;
    return null;
  };
  const found = area(headline) ?? area(experienceText.slice(0, 600));
  if (found) return studentLike && !/intern/i.test(found) ? `${found} internship` : found;
  return studentLike ? 'Summer internship' : 'internship';
}
