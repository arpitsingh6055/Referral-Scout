/**
 * The canonical job and the employer behind it, plus the qualification that decides whether it is worth applying
 * for (specification sections 8 and 12.1).
 *
 * The central rule here is that eligibility and fit are different questions and must never be averaged into one
 * number. Eligibility asks whether the person can hold the job at all — the right to work, the degree the posting
 * demands, the experience band. Fit asks how well their evidence matches the work. A role the person is barred
 * from is not a 40% match; it is a no. Blending the two produces a shortlist full of jobs that look plausible and
 * cannot be applied for, which costs the person far more time than a thin shortlist would.
 *
 * The second rule: missing evidence is not negative evidence. A posting that never mentions a visa says nothing
 * about sponsorship, and a CV that never mentions SQL does not prove the person cannot use it. Both resolve to
 * `unknown`, which is shown as unknown and never quietly rounded to eligible.
 */

export type WorkMode = 'onsite' | 'hybrid' | 'remote' | 'unknown';
export type EmploymentType = 'internship' | 'full-time' | 'part-time' | 'contract' | 'graduate-programme' | 'unknown';
export type Seniority = 'intern' | 'entry' | 'mid' | 'senior' | 'lead' | 'unknown';
export type ApplyType = 'easy-apply' | 'ats' | 'employer-site' | 'email' | 'unknown';
export type Availability = 'open' | 'closed' | 'unknown';

/* ---------- employer ---------- */
export type SizeBand = 'startup' | 'scaleup' | 'mid' | 'enterprise' | 'unknown';

export interface Company {
  id: string;
  canonicalName: string;
  /** The employer's own domain, which is what makes an email address verifiable later. */
  domain?: string;
  sourceIds: string[];
  sizeBand: SizeBand;
  industry?: string;
  /** 0-1 in the identity itself: several real employers share a name, and guessing merges two companies into one. */
  confidence: number;
  /** Set when more than one employer matched, so the UI can ask rather than pick. */
  ambiguousWith?: string[];
  createdAt: number;
  updatedAt: number;
}

const COMPANY_NOISE =
  /\b(pvt|private|ltd|limited|inc|incorporated|llp|llc|corp|corporation|co|gmbh|technologies|technology|labs|solutions|services|india)\b/g;

const flatten = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** "Razorpay", "Razorpay Pvt Ltd" and "RAZORPAY TECHNOLOGIES" are one employer. */
export const canonicalCompany = (name: string): string => flatten(name).replace(COMPANY_NOISE, ' ').replace(/\s+/g, ' ').trim();

/* ---------- the job ---------- */
export interface Compensation {
  min?: number;
  max?: number;
  currency?: string;
  period?: 'month' | 'year' | 'hour' | 'total';
  /** The text the posting actually used, kept so a parsed figure can always be checked against the source. */
  raw?: string;
}

export interface JobEvidence {
  /** A requirement as the posting worded it. */
  requirement: string;
  /** What in the person's profile answers it, and where that came from. */
  matchedWith?: string;
  evidenceRef?: string;
  state: 'met' | 'missing' | 'unknown';
}

export interface Job {
  id: string;
  sourceId: string;
  sourceName: string;
  canonicalUrl: string;
  /** Other boards carrying the same vacancy, kept so the preferred application route can be chosen. */
  alternateUrls: string[];
  duplicateGroupId: string;

  companyId?: string;
  companyName: string;
  companyDomain?: string;

  title: string;
  normalizedTitle: string;
  roleFamily?: string;
  function?: string;
  seniority: Seniority;
  employmentType: EmploymentType;

  location: string;
  workMode: WorkMode;
  durationMonths?: number;
  compensation?: Compensation;

  postedAt?: number;
  observedAt: number;
  deadline?: number;
  lastVerifiedAt?: number;
  availability: Availability;

  description?: string;
  descriptionHash?: string;
  requirements: string[];
  /** Fit returned by the signed-in ChatGPT ranking pass, when available. */
  aiFit?: number;
  profileFit?: number;
  fitSource?: 'chatgpt' | 'specialization';
  fitProfileVersion?: number;
  aiWhy?: string;
  responsibilities: string[];

  applyType: ApplyType;
  applyUrl?: string;
  atsHost?: string;
  /** Rough number of form steps, used only to break ties between comparable jobs. */
  effort?: 'low' | 'medium' | 'high' | 'unknown';

  qualification?: Qualification;
  /** The person's own call, which always outranks the computed one. */
  userJudgement?: 'shortlisted' | 'rejected' | 'applied' | 'none';
  userReason?: string;

  createdAt: number;
  updatedAt: number;
}

const TITLE_NOISE =
  /\b(intern|internship|trainee|fresher|remote|hybrid|onsite|on site|full time|fulltime|part time|contract|permanent|india|urgent|hiring|immediate|joiner|new|wfh)\b/g;

export const normalizeTitle = (title: string): string => flatten(title).replace(TITLE_NOISE, ' ').replace(/\s+/g, ' ').trim();

/* ---------- deduplication ---------- */
/**
 * One vacancy, however many boards carry it. The source's own id is exact and used when both sides came from that
 * source; the canonical URL is next; the fingerprint is the conservative fallback. It is deliberately conservative:
 * wrongly merging two real openings at one employer hides a job the person would have applied for, which is worse
 * than showing one listing twice.
 */
export function dedupeKey(job: {
  company: string;
  title: string;
  location: string;
  source?: string;
  sourceJobId?: string;
  canonicalUrl?: string;
  employmentType?: EmploymentType;
  descriptionHash?: string;
}): string {
  if (job.sourceJobId && job.source) return `${job.source}:${job.sourceJobId}`;
  if (job.canonicalUrl) {
    const normalised = canonicalJobUrl(job.canonicalUrl);
    if (normalised) return `url:${normalised}`;
  }
  // Boards write places differently — "Bengaluru" against "Bengaluru, Karnataka, India" — so only the city counts.
  const place = flatten(job.location.split(',')[0] ?? '')
    .split(' ')
    .slice(0, 2)
    .join(' ');
  const type = job.employmentType && job.employmentType !== 'unknown' ? `|${job.employmentType}` : '';
  const hash = job.descriptionHash ? `|${job.descriptionHash.slice(0, 8)}` : '';
  return `k:${canonicalCompany(job.company)}|${normalizeTitle(job.title)}|${place}${type}${hash}`;
}

/** Strips the tracking that makes one job look like several different links. */
export function canonicalJobUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = '';
    const keep = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (/^(jobid|currentjobid|gh_jid|job_id|id)$/i.test(k)) keep.set(k.toLowerCase(), v);
    u.search = keep.toString();
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return null;
  }
}

/* ---------- qualification ---------- */
export type EligibilityState = 'eligible' | 'ineligible' | 'unknown';

export interface EligibilityCheck {
  key: string;
  label: string;
  state: EligibilityState;
  /** Why, in words the person can argue with. */
  reason: string;
}

export interface Qualification {
  /** The hard gate. Any single ineligible check makes the whole job ineligible, whatever the fit score says. */
  eligibility: EligibilityState;
  checks: EligibilityCheck[];
  /** 0-100 evidence coverage. A compact signal that never replaces the explanation below it. */
  fit: number;
  fitEvidence: JobEvidence[];
  /** How well it matches what the person said they wanted: location, mode, pay, type. */
  preferenceFit: number;
  preferenceNotes: string[];
  /** 0-1 in the listing and the details read from it. */
  sourceConfidence: number;
  freshness: 'fresh' | 'recent' | 'stale' | 'unknown';
  tier: 'strong' | 'possible' | 'weak' | 'blocked';
  rejectionReasons: string[];
  qualifiedAt: number;
}

export interface CandidateRequirements {
  /** Countries the person may work in without sponsorship, for the authorisation check. */
  authorisedIn: string[];
  needsSponsorship?: boolean;
  highestQualification?: string;
  graduationYear?: number;
  yearsExperience?: number;
  skills: string[];
  preferredLocations: string[];
  preferredWorkModes: WorkMode[];
  preferredEmploymentTypes: EmploymentType[];
  minCompensation?: number;
}

const DAY = 86_400_000;

export function freshnessOf(job: Pick<Job, 'postedAt' | 'deadline' | 'availability'>, now = Date.now()): Qualification['freshness'] {
  if (job.availability === 'closed') return 'stale';
  if (job.deadline && job.deadline < now) return 'stale';
  if (!job.postedAt) return 'unknown';
  const days = (now - job.postedAt) / DAY;
  return days <= 7 ? 'fresh' : days <= 30 ? 'recent' : 'stale';
}

/**
 * The hard gate. Each check answers eligible, ineligible or unknown on its own, and unknown stays unknown: a
 * posting that is silent about work authorisation has not said the person is eligible, and treating silence as a
 * yes is how a false declaration ends up on a real application.
 */
export function checkEligibility(job: Job, me: CandidateRequirements): { state: EligibilityState; checks: EligibilityCheck[] } {
  const checks: EligibilityCheck[] = [];
  const text = `${job.description ?? ''} ${job.requirements.join(' ')}`.toLowerCase();
  const country = job.location.split(',').pop()?.trim().toLowerCase() ?? '';

  if (!country)
    checks.push({
      key: 'work-authorisation',
      label: 'Right to work',
      state: 'unknown',
      reason: 'The posting does not say where the job is.',
    });
  else if (me.authorisedIn.some(c => c.toLowerCase() === country))
    checks.push({
      key: 'work-authorisation',
      label: 'Right to work',
      state: 'eligible',
      reason: `You are authorised to work in ${country}.`,
    });
  else if (
    /\b(no sponsorship|without sponsorship|must (be )?(a )?(citizen|permanent resident)|unable to sponsor)\b/.test(text) &&
    me.needsSponsorship
  )
    checks.push({
      key: 'work-authorisation',
      label: 'Right to work',
      state: 'ineligible',
      reason: 'The posting says it cannot sponsor and you need sponsorship.',
    });
  else
    checks.push({
      key: 'work-authorisation',
      label: 'Right to work',
      state: 'unknown',
      reason: `You have not confirmed you can work in ${country}.`,
    });

  // Only checked when the posting actually asks for a number of years. A posting that says nothing about
  // experience has no requirement to fail, and raising an `unknown` there would mark almost every job unknown for
  // a student with no employment records — which would make the whole eligibility signal useless.
  const years = /\b(\d{1,2})\s*\+?\s*(?:to|-|–)?\s*(\d{1,2})?\s*(?:\+)?\s*years?(?:'| of)?\s+(?:of\s+)?experience/.exec(text);
  if (years) {
    const min = Number(years[1]);
    if (me.yearsExperience === undefined)
      checks.push({
        key: 'experience',
        label: 'Experience',
        state: 'unknown',
        reason: `Asks for ${min}+ years; your experience is not recorded yet.`,
      });
    // A minimum two years above what the person has is a real gate; one year under is normal and not a barrier.
    else if (Number.isFinite(min) && me.yearsExperience + 2 < min)
      checks.push({
        key: 'experience',
        label: 'Experience',
        state: 'ineligible',
        reason: `Asks for ${min}+ years; you have ${me.yearsExperience}.`,
      });
    else
      checks.push({
        key: 'experience',
        label: 'Experience',
        state: 'eligible',
        reason: `Asks for ${min}+ years; you have ${me.yearsExperience}.`,
      });
  }

  if (job.employmentType !== 'unknown' && me.preferredEmploymentTypes.length && !me.preferredEmploymentTypes.includes(job.employmentType))
    checks.push({
      key: 'employment-type',
      label: 'Employment type',
      state: 'ineligible',
      reason: `This is a ${job.employmentType} role and you are looking for ${me.preferredEmploymentTypes.join(' or ')}.`,
    });

  if (job.availability === 'closed')
    checks.push({ key: 'open', label: 'Still open', state: 'ineligible', reason: 'This posting has closed.' });

  const state: EligibilityState = checks.some(c => c.state === 'ineligible')
    ? 'ineligible'
    : checks.every(c => c.state === 'eligible')
      ? 'eligible'
      : 'unknown';
  return { state, checks };
}

const tokenise = (s: string): Set<string> =>
  new Set(
    flatten(s)
      .split(' ')
      .filter(w => w.length > 2),
  );

/**
 * Fit is evidence coverage: how many of the posting's stated requirements the person's profile actually answers.
 * A requirement with nothing to match it is `missing`, which the explanation card must word as "not found in your
 * profile" rather than "you lack this" — the two mean different things to someone deciding whether to apply.
 */
export function scoreFit(job: Job, me: CandidateRequirements): { fit: number; evidence: JobEvidence[] } {
  const mine = new Set<string>();
  for (const s of me.skills) for (const w of tokenise(s)) mine.add(w);
  const requirements = job.requirements.length ? job.requirements : [job.title];
  const evidence: JobEvidence[] = requirements.slice(0, 12).map(req => {
    const words = tokenise(req);
    const hit = [...words].find(w => mine.has(w));
    return hit
      ? { requirement: req, matchedWith: me.skills.find(s => tokenise(s).has(hit)) ?? hit, state: 'met' as const }
      : { requirement: req, state: words.size ? ('missing' as const) : ('unknown' as const) };
  });
  const scored = evidence.filter(e => e.state !== 'unknown');
  const fit = scored.length ? Math.round((evidence.filter(e => e.state === 'met').length / scored.length) * 100) : 0;
  return { fit, evidence };
}

export function scorePreferences(job: Job, me: CandidateRequirements): { score: number; notes: string[] } {
  const notes: string[] = [];
  let hits = 0;
  let total = 0;

  if (me.preferredLocations.length) {
    total++;
    const place = flatten(job.location);
    if (me.preferredLocations.some(l => place.includes(flatten(l)))) hits++;
    else notes.push(`In ${job.location}, not your preferred ${me.preferredLocations.join(' or ')}.`);
  }
  if (me.preferredWorkModes.length && job.workMode !== 'unknown') {
    total++;
    if (me.preferredWorkModes.includes(job.workMode)) hits++;
    else notes.push(`This role is ${job.workMode}.`);
  }
  if (me.minCompensation !== undefined && job.compensation?.max !== undefined) {
    total++;
    if (job.compensation.max >= me.minCompensation) hits++;
    else notes.push(`Pay tops out below what you asked for${job.compensation.raw ? ` (${job.compensation.raw})` : ''}.`);
  }
  return { score: total ? Math.round((hits / total) * 100) : 100, notes };
}

/**
 * Puts the whole judgement together. Eligibility decides the tier before fit is consulted at all, so an ineligible
 * job can never present itself as a strong match.
 */
export function qualify(job: Job, me: CandidateRequirements, now = Date.now()): Qualification {
  const { state, checks } = checkEligibility(job, me);
  const { fit, evidence } = scoreFit(job, me);
  const preference = scorePreferences(job, me);
  const freshness = freshnessOf(job, now);
  const sourceConfidence = job.description ? 0.9 : 0.5;

  const rejectionReasons = checks.filter(c => c.state === 'ineligible').map(c => c.reason);
  if (freshness === 'stale') rejectionReasons.push('This posting is old or has closed.');

  const tier: Qualification['tier'] =
    state === 'ineligible'
      ? 'blocked'
      : fit >= 70 && preference.score >= 60 && freshness !== 'stale'
        ? 'strong'
        : fit >= 45
          ? 'possible'
          : 'weak';

  return {
    eligibility: state,
    checks,
    fit,
    fitEvidence: evidence,
    preferenceFit: preference.score,
    preferenceNotes: preference.notes,
    sourceConfidence,
    freshness,
    tier,
    rejectionReasons,
    qualifiedAt: now,
  };
}

/**
 * The ordering of the shortlist. Quality first; effort only separates jobs that are otherwise comparable, so a
 * quick Easy Apply never outranks a clearly better role that happens to have a longer form.
 */
export function rankScore(job: Job, now = Date.now()): number {
  const q = job.qualification;
  if (!q || q.tier === 'blocked') return -1;
  const freshness = { fresh: 30, recent: 15, unknown: 5, stale: 0 }[q.freshness];
  const effort = { low: 8, medium: 4, unknown: 2, high: 0 }[job.effort ?? 'unknown'];
  const deadline = job.deadline && job.deadline - now < 7 * DAY ? 12 : 0;
  return q.fit * 10 + q.preferenceFit * 2 + freshness + deadline + effort * (q.fit >= 60 ? 1 : 0) + q.sourceConfidence * 10;
}
