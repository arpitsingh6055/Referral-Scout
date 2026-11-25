/**
 * The Answer Bank: typed, sourced, scoped facts about the person, reused across applications.
 *
 * The old engine remembered answers under `questionKey(label)` — the label lowercased with punctuation stripped. That
 * is right for a question asked twice in the same words and wrong for everything else: it never merges "PIN code"
 * with "postal code", and worse, it gives no way to say that two similar-looking questions must stay apart. Current
 * CTC and expected CTC are one word apart and must never share a value. Work authorisation in India says nothing
 * about US sponsorship.
 *
 * So matching here is a catalogue of canonical facts with explicit alias patterns and explicit separators, not text
 * similarity. A label that matches nothing stays an unknown question and is asked; guessing is the expensive error.
 */

import { latestEducation, currentEmployment, yearsOfExperience, type CandidateProfile } from './profile';

export type FactType = 'text' | 'longtext' | 'number' | 'money' | 'date' | 'duration' | 'phone' | 'email' | 'url' | 'choice' | 'address';
export type FactSource = 'user' | 'cv' | 'profile' | 'model';
/** Where a saved answer may be reused. Anything narrower than `global` is re-asked outside its scope. */
export type FactScope = 'global' | 'campaign' | 'company' | 'job' | 'country';
export type FactSection = 'identity' | 'education' | 'work' | 'preferences' | 'eligibility' | 'narrative';
export type FactStatus = 'verified' | 'needs-review' | 'stale' | 'empty';

export interface CandidateFact {
  id: string;
  canonicalKey: string;
  displayLabel: string;
  value: string;
  dataType: FactType;
  source: FactSource;
  /** 0-1. Anything below 0.8 is shown as a suggestion, never filled silently into a real form. */
  confidence: number;
  scope: FactScope;
  /** The country or company the value belongs to, when the scope is narrower than global. */
  scopeValue?: string;
  verifiedAt: number;
  updatedAt: number;
  expiresAt?: number;
  /** 'auto' fills without asking; 'confirm' shows the value and waits; 'never' is kept for reference only. */
  reusePolicy: 'auto' | 'confirm' | 'never';
  provenance?: string;
}

export interface FactDefinition {
  key: string;
  label: string;
  section: FactSection;
  type: FactType;
  scope: FactScope;
  /** Labels that mean this fact. First match wins, so order within the catalogue matters. */
  patterns: RegExp[];
  /** Labels that look like this fact but are a different one. Checked before `patterns`. */
  not?: RegExp;
  /** How long before the value should be checked again. Pay, notice period and city go out of date quietly. */
  staleAfterDays?: number;
  /** Asked during the short setup, because these unlock the most forms. */
  core?: boolean;
  /** Never inferred from a CV or a model, whatever the evidence: the person declares these themselves. */
  selfDeclared?: boolean;
}

/**
 * The catalogue. Every `not` here was a real confusion risk, not a hypothetical: the pairs that burn people are
 * current/expected pay, personal/company email, home city/job location, and own/referrer details.
 */
export const CATALOGUE: FactDefinition[] = [
  /* --- identity --- */
  {
    key: 'full_name',
    label: 'Full name',
    section: 'identity',
    type: 'text',
    scope: 'global',
    core: true,
    patterns: [/^(your |candidate |applicant )?(full |legal )?name\b/i, /\bfull name\b/i],
    not: /\b(company|employer|college|school|university|referr?er|manager|supervisor|contact person|father|mother|guardian|spouse)\b/i,
  },
  {
    key: 'email',
    label: 'Email address',
    section: 'identity',
    type: 'email',
    scope: 'global',
    core: true,
    patterns: [/\b(e-?mail|email address)\b/i],
    not: /\b(company|work|official|college|alternate|secondary|referr?er|manager)\s+e-?mail\b/i,
  },
  {
    key: 'phone',
    label: 'Phone number',
    section: 'identity',
    type: 'phone',
    scope: 'global',
    core: true,
    patterns: [/\b(phone|mobile|contact) ?(number|no\.?)?\b/i, /\bwhatsapp\b/i],
    not: /\b(alternate|emergency|landline|office|referr?er|parent|guardian)\b/i,
  },
  {
    key: 'city',
    label: 'Current city',
    section: 'identity',
    type: 'text',
    scope: 'global',
    core: true,
    staleAfterDays: 180,
    patterns: [/\bcurrent (city|location|residence)\b/i, /\bcity\b/i, /\bwhere are you (based|located|living)\b/i],
    // The job's location and a preferred location are questions about the role, not about where the person lives.
    not: /\b(preferred|desired|job|work|office|posting|interview|birth|home ?town|permanent)\b/i,
  },
  {
    key: 'address',
    label: 'Street address',
    section: 'identity',
    type: 'address',
    scope: 'global',
    core: true,
    patterns: [/\b(street |home |residential |current |postal |mailing )?address(?! proof)\b/i, /\baddress line\b/i],
    not: /\b(e-?mail|company|office|employer|permanent|referr?er)\b/i,
  },
  {
    key: 'state',
    label: 'State',
    section: 'identity',
    type: 'text',
    scope: 'global',
    patterns: [/\b(state|province|region)\b/i],
    not: /\b(united states|statement|estate)\b/i,
  },
  {
    key: 'pincode',
    label: 'PIN / postal code',
    section: 'identity',
    type: 'text',
    scope: 'global',
    core: true,
    patterns: [/\b(pin ?code|postal ?code|zip ?code|post ?code|postcode|pincode|zip)\b/i],
  },
  {
    key: 'country',
    label: 'Country',
    section: 'identity',
    type: 'text',
    scope: 'global',
    patterns: [/\bcountry\b/i],
    not: /\b(code|citizenship|nationality|work|authori[sz])\b/i,
  },
  {
    key: 'linkedin_url',
    label: 'LinkedIn profile',
    section: 'identity',
    type: 'url',
    scope: 'global',
    core: true,
    patterns: [/\blinked ?in\b.*\b(url|profile|link)\b/i, /\b(url|profile|link)\b.*\blinked ?in\b/i, /^linked ?in$/i],
  },
  {
    key: 'portfolio_url',
    label: 'Portfolio / website',
    section: 'identity',
    type: 'url',
    scope: 'global',
    patterns: [/\b(portfolio|personal (web)?site|website|github|behance|dribbble)\b/i],
  },

  /* --- education --- */
  {
    key: 'highest_qualification',
    label: 'Highest qualification',
    section: 'education',
    type: 'text',
    scope: 'global',
    core: true,
    patterns: [/\b(highest )?(qualification|degree)\b/i, /\blevel of education\b/i],
    not: /\b(10th|12th|secondary|school)\b/i,
  },
  {
    key: 'graduation_institute',
    label: 'College / university',
    section: 'education',
    type: 'text',
    scope: 'global',
    core: true,
    patterns: [/\b(college|university|institute|institution)\b/i, /\bname of (the )?(college|university|institute)\b/i],
    not: /\b(school|10th|12th|board|employer|company)\b/i,
  },
  {
    key: 'graduation_field',
    label: 'Field of study',
    section: 'education',
    type: 'text',
    scope: 'global',
    patterns: [/\b(field of study|speciali[sz]ation|stream|branch|major|discipline|course)\b/i],
  },
  {
    key: 'graduation_year',
    label: 'Graduation year',
    section: 'education',
    type: 'text',
    scope: 'global',
    core: true,
    patterns: [/\b(year of (passing|graduation)|graduation year|passing year|batch)\b/i, /\bexpected graduation\b/i],
  },
  {
    key: 'graduation_grade',
    label: 'CGPA / percentage',
    section: 'education',
    type: 'text',
    scope: 'global',
    patterns: [/\b(cgpa|gpa|percentage|marks|aggregate|grade)\b/i],
    not: /\b(10th|12th|secondary|high school)\b/i,
  },
  {
    key: 'school_10th',
    label: '10th board result',
    section: 'education',
    type: 'text',
    scope: 'global',
    patterns: [/\b(10th|x(th)?|secondary|sslc|matriculation)\b/i],
  },
  {
    key: 'school_12th',
    label: '12th board result',
    section: 'education',
    type: 'text',
    scope: 'global',
    patterns: [/\b(12th|xii(th)?|higher secondary|hsc|intermediate|senior secondary)\b/i],
  },

  /* --- work --- */
  {
    key: 'current_employer',
    label: 'Current employer',
    section: 'work',
    type: 'text',
    scope: 'global',
    staleAfterDays: 180,
    patterns: [/\bcurrent (employer|company|organi[sz]ation)\b/i, /\b(employer|company) name\b/i],
    not: /\b(previous|last|desired|applying|referr?er)\b/i,
  },
  {
    key: 'current_title',
    label: 'Current job title',
    section: 'work',
    type: 'text',
    scope: 'global',
    staleAfterDays: 180,
    patterns: [/\bcurrent (job )?(title|designation|role|position)\b/i],
    not: /\b(desired|applied|applying|referr?er)\b/i,
  },
  {
    key: 'total_experience',
    label: 'Total years of experience',
    section: 'work',
    type: 'text',
    scope: 'global',
    staleAfterDays: 180,
    patterns: [/\b(total |overall |years of |how many years)\b.*\bexperience\b/i, /\bexperience\b.*\b(years|yrs)\b/i],
    not: /\b(relevant|specific|this (tool|technology)|describe|tell us)\b/i,
  },
  // Current and expected pay are the pair most likely to be crossed, and the damage is immediate and invisible.
  {
    key: 'current_ctc',
    label: 'Current CTC / salary',
    section: 'work',
    type: 'money',
    scope: 'global',
    staleAfterDays: 180,
    patterns: [/\bcurrent (ctc|salary|compensation|pay|package)\b/i, /\b(ctc|salary) ?\(?current\)?\b/i, /\bpresent (ctc|salary)\b/i],
    not: /\b(expected|desired|preferred|minimum|asking|in hand after)\b/i,
  },
  {
    key: 'expected_ctc',
    label: 'Expected CTC / stipend',
    section: 'work',
    type: 'money',
    scope: 'campaign',
    staleAfterDays: 180,
    core: true,
    patterns: [
      /\b(expected|desired|preferred|required|asking) ?(ctc|salary|compensation|pay|package|stipend|rate)\b/i,
      /\b(salary|stipend|compensation) expectations?\b/i,
    ],
    not: /\bcurrent\b/i,
  },
  {
    key: 'notice_period',
    label: 'Notice period',
    section: 'work',
    type: 'duration',
    scope: 'global',
    staleAfterDays: 90,
    core: true,
    patterns: [/\bnotice period\b/i, /\bhow soon can you (join|start)\b/i, /\bavailability to join\b/i],
  },
  {
    key: 'start_date',
    label: 'Earliest start date',
    section: 'work',
    type: 'date',
    scope: 'global',
    staleAfterDays: 90,
    core: true,
    patterns: [/\b(earliest |available |preferred )?start(ing)? date\b/i, /\bwhen can you (start|join)\b/i, /\bdate of joining\b/i],
  },

  /* --- preferences --- */
  {
    key: 'relocate',
    label: 'Willing to relocate',
    section: 'preferences',
    type: 'choice',
    scope: 'job',
    core: true,
    patterns: [/\b(willing|open) to relocat/i, /\brelocation\b/i],
  },
  {
    key: 'work_mode',
    label: 'Work mode preference',
    section: 'preferences',
    type: 'choice',
    scope: 'campaign',
    patterns: [/\b(work mode|remote|hybrid|work from (home|office)|on-?site preference)\b/i],
  },
  {
    key: 'preferred_location',
    label: 'Preferred location',
    section: 'preferences',
    type: 'text',
    scope: 'campaign',
    patterns: [/\b(preferred|desired) (work |job )?location\b/i],
  },
  {
    key: 'employment_type',
    label: 'Employment type',
    section: 'preferences',
    type: 'choice',
    scope: 'campaign',
    patterns: [/\b(employment|job) type\b/i, /\b(full|part)-? ?time or\b/i],
  },
  {
    key: 'notice_of_other_offers',
    label: 'Other offers in hand',
    section: 'preferences',
    type: 'text',
    scope: 'campaign',
    staleAfterDays: 60,
    patterns: [/\bother offers?\b/i, /\boffers? in hand\b/i],
  },

  /* --- eligibility: country-scoped, because the same words mean different things in different places --- */
  {
    key: 'work_authorization',
    label: 'Work authorisation',
    section: 'eligibility',
    type: 'choice',
    scope: 'country',
    core: true,
    patterns: [/\b(work authori[sz]ation|authori[sz]ed to work|legally (allowed|entitled) to work|right to work)\b/i],
  },
  {
    key: 'sponsorship',
    label: 'Sponsorship required',
    section: 'eligibility',
    type: 'choice',
    scope: 'country',
    patterns: [/\b(sponsorship|visa sponsorship|require.*sponsor|need.*visa)\b/i],
  },
  {
    key: 'languages',
    label: 'Languages',
    section: 'eligibility',
    type: 'text',
    scope: 'global',
    patterns: [/\blanguages? (known|spoken|proficiency)\b/i],
  },
  // Declarations about a person's identity or legal status are never inferred from a CV, whatever it contains.
  {
    key: 'gender',
    label: 'Gender',
    section: 'eligibility',
    type: 'choice',
    scope: 'global',
    selfDeclared: true,
    patterns: [/\bgender\b/i],
  },
  {
    key: 'disability',
    label: 'Disability status',
    section: 'eligibility',
    type: 'choice',
    scope: 'global',
    selfDeclared: true,
    patterns: [/\bdisabilit(y|ies)\b/i, /\bdifferently abled\b/i],
  },
  {
    key: 'veteran',
    label: 'Veteran status',
    section: 'eligibility',
    type: 'choice',
    scope: 'global',
    selfDeclared: true,
    patterns: [/\bveteran\b/i],
  },
  {
    key: 'ethnicity',
    label: 'Ethnicity',
    section: 'eligibility',
    type: 'choice',
    scope: 'global',
    selfDeclared: true,
    patterns: [/\b(ethnicity|race|caste|category)\b/i],
  },

  /* --- narrative: drafted, then reviewed; never filled unseen --- */
  {
    key: 'why_this_role',
    label: 'Why this role',
    section: 'narrative',
    type: 'longtext',
    scope: 'job',
    patterns: [/\bwhy (are you |do you want |this |are you interested)\b/i, /\bwhat (interests|excites) you\b/i],
  },
  {
    key: 'about_yourself',
    label: 'About yourself',
    section: 'narrative',
    type: 'longtext',
    scope: 'global',
    patterns: [/\b(tell us about yourself|about (yourself|you)|introduce yourself|summary|profile summary)\b/i],
  },
  {
    key: 'strengths',
    label: 'Strengths',
    section: 'narrative',
    type: 'longtext',
    scope: 'global',
    patterns: [/\b(strengths?|what makes you)\b/i],
  },
  {
    key: 'project_summary',
    label: 'Project summary',
    section: 'narrative',
    type: 'longtext',
    scope: 'global',
    patterns: [/\b(describe|tell us about) (a |your )?(project|work|achievement)\b/i, /\bmost (impressive|significant)\b/i],
  },
  {
    key: 'challenge',
    label: 'A challenge you handled',
    section: 'narrative',
    type: 'longtext',
    scope: 'global',
    patterns: [/\b(challenge|difficult situation|conflict|failure|setback)\b/i],
  },
  {
    key: 'career_goal',
    label: 'Career goal',
    section: 'narrative',
    type: 'longtext',
    scope: 'global',
    patterns: [/\b(career (goal|aspiration|plan)|where do you see yourself|long.?term)\b/i],
  },
];

const BY_KEY = new Map(CATALOGUE.map(d => [d.key, d]));
export const definitionFor = (key: string): FactDefinition | undefined => BY_KEY.get(key);

export const SECTION_LABELS: Record<FactSection, string> = {
  identity: 'Personal & contact',
  education: 'Education',
  work: 'Work & experience',
  preferences: 'Preferences',
  eligibility: 'Eligibility',
  narrative: 'Reusable answers',
};

/** Fields the short setup asks for, because they unlock the most forms for the least typing. */
export const CORE_KEYS: string[] = CATALOGUE.filter(d => d.core).map(d => d.key);

/* ---------- matching a form label to a fact ---------- */
export interface Match {
  key: string;
  definition: FactDefinition;
  /** Shown to the person as "Matched to: PIN / postal code", so an automatic match is always visible and checkable. */
  matchedAs: string;
}

/** A question about somebody else's details is never answered from the person's own facts. */
const ABOUT_SOMEONE_ELSE =
  /\b(referr?er|referee|reference|manager|supervisor|recruiter'?s|emergency|next of kin|parent|guardian|spouse|nominee)\b/i;

/**
 * Finds the one fact a form label is asking for, or nothing. A `not` pattern is checked first, so "Expected CTC"
 * cannot fall through to the current-pay entry just because it contains the word CTC.
 */
export function matchLabel(label: string): Match | undefined {
  const text = label.replace(/\*/g, ' ').trim();
  if (!text || ABOUT_SOMEONE_ELSE.test(text)) return undefined;
  for (const d of CATALOGUE) {
    if (d.not?.test(text)) continue;
    if (d.patterns.some(p => p.test(text))) return { key: d.key, definition: d, matchedAs: d.label };
  }
  return undefined;
}

/**
 * Whether two questions may share one answer. Both must resolve to the same canonical fact — never to the same
 * looking text. Two labels that match nothing are left apart even when they read identically, because an unknown
 * question could be anything.
 */
export function equivalent(a: string, b: string): boolean {
  const x = matchLabel(a);
  const y = matchLabel(b);
  return !!x && !!y && x.key === y.key;
}

/* ---------- reuse ---------- */
export interface ReuseContext {
  campaignId?: string;
  companyId?: string;
  jobId?: string;
  /** Where the job is, for country-scoped eligibility answers. */
  country?: string;
  now?: number;
}

export type ReuseVerdict = { use: true; fact: CandidateFact; matchedAs: string } | { use: false; reason: string; fact?: CandidateFact };

export const isStale = (fact: CandidateFact, now = Date.now()): boolean =>
  (!!fact.expiresAt && fact.expiresAt <= now) ||
  (() => {
    const days = definitionFor(fact.canonicalKey)?.staleAfterDays;
    return !!days && now - fact.verifiedAt > days * 86_400_000;
  })();

/**
 * Decides whether a saved fact may be typed into this form, on this job. The scope test is the point: a work
 * authorisation answer given for India says nothing about a role in the United States, and reusing it there would
 * put a false declaration on a real application.
 */
export function canReuse(fact: CandidateFact, ctx: ReuseContext = {}): ReuseVerdict {
  const now = ctx.now ?? Date.now();
  if (!fact.value.trim()) return { use: false, reason: 'No value saved.' };
  if (fact.reusePolicy === 'never') return { use: false, reason: 'You asked for this one to be filled by hand.', fact };
  if (definitionFor(fact.canonicalKey)?.selfDeclared && fact.source !== 'user')
    return { use: false, reason: 'This is yours to declare; it is never taken from your CV.', fact };
  if (fact.confidence < 0.8) return { use: false, reason: 'Saved as a suggestion, not a confirmed fact.', fact };
  if (isStale(fact, now)) return { use: false, reason: 'This may have changed since you last confirmed it.', fact };
  if (fact.scope === 'country' && fact.scopeValue && ctx.country && fact.scopeValue.toLowerCase() !== ctx.country.toLowerCase())
    return { use: false, reason: `Saved for ${fact.scopeValue}; this job is in ${ctx.country}.`, fact };
  if (fact.scope === 'company' && fact.scopeValue && ctx.companyId && fact.scopeValue !== ctx.companyId)
    return { use: false, reason: 'Saved for a different company.', fact };
  if (fact.scope === 'job' && fact.scopeValue && ctx.jobId && fact.scopeValue !== ctx.jobId)
    return { use: false, reason: 'This is a per-job answer.', fact };
  if (fact.scope === 'campaign' && fact.scopeValue && ctx.campaignId && fact.scopeValue !== ctx.campaignId)
    return { use: false, reason: 'Saved for a different campaign.', fact };
  if (fact.reusePolicy === 'confirm') return { use: false, reason: 'You asked to confirm this one each time.', fact };
  return { use: true, fact, matchedAs: definitionFor(fact.canonicalKey)?.label ?? fact.displayLabel };
}

/** The answer for one form label, when there is one that may be used here. */
export function answerFor(label: string, facts: readonly CandidateFact[], ctx: ReuseContext = {}): ReuseVerdict {
  const match = matchLabel(label);
  if (!match) return { use: false, reason: 'Not a question we have a saved answer for.' };
  const candidates = facts.filter(f => f.canonicalKey === match.key);
  if (!candidates.length) return { use: false, reason: 'Nothing saved yet.' };
  // The most specific scope that fits wins: a per-company answer beats the global one.
  const rank: Record<FactScope, number> = { job: 0, company: 1, country: 2, campaign: 3, global: 4 };
  const sorted = [...candidates].sort((a, b) => rank[a.scope] - rank[b.scope] || b.updatedAt - a.updatedAt);
  let last: ReuseVerdict = { use: false, reason: 'Nothing saved yet.' };
  for (const f of sorted) {
    const v = canReuse(f, ctx);
    if (v.use) return v;
    last = v;
  }
  return last;
}

/* ---------- completeness ---------- */
export interface SectionProgress {
  section: FactSection;
  label: string;
  status: FactStatus;
  filled: number;
  total: number;
  keys: string[];
}

export function statusOf(fact: CandidateFact | undefined, now = Date.now()): FactStatus {
  if (!fact?.value.trim()) return 'empty';
  if (isStale(fact, now)) return 'stale';
  if (fact.confidence < 0.8 || fact.source === 'model') return 'needs-review';
  return 'verified';
}

/**
 * The completeness meter. It counts the core facts rather than all of them, because a bar that only reaches 100%
 * after 40 optional questions tells the person they are failing when they are ready to go.
 */
export function completeness(facts: readonly CandidateFact[], now = Date.now()): { complete: number; total: number; missing: string[] } {
  const byKey = new Map(facts.map(f => [f.canonicalKey, f]));
  const missing: string[] = [];
  let complete = 0;
  for (const key of CORE_KEYS) {
    const s = statusOf(byKey.get(key), now);
    if (s === 'verified') complete++;
    else missing.push(key);
  }
  return { complete, total: CORE_KEYS.length, missing };
}

export function sections(facts: readonly CandidateFact[], now = Date.now()): SectionProgress[] {
  const byKey = new Map(facts.map(f => [f.canonicalKey, f]));
  const order: FactSection[] = ['identity', 'education', 'work', 'preferences', 'eligibility', 'narrative'];
  return order.map(section => {
    const defs = CATALOGUE.filter(d => d.section === section);
    const states = defs.map(d => statusOf(byKey.get(d.key), now));
    const filled = states.filter(s => s === 'verified').length;
    const status: FactStatus = states.some(s => s === 'stale')
      ? 'stale'
      : states.some(s => s === 'needs-review')
        ? 'needs-review'
        : filled === 0
          ? 'empty'
          : filled === defs.length
            ? 'verified'
            : 'needs-review';
    return { section, label: SECTION_LABELS[section], status, filled, total: defs.length, keys: defs.map(d => d.key) };
  });
}

/* ---------- building facts ---------- */
export function makeFact(input: {
  canonicalKey: string;
  value: string;
  source: FactSource;
  now?: number;
  scopeValue?: string;
  confidence?: number;
  displayLabel?: string;
  provenance?: string;
}): CandidateFact {
  const now = input.now ?? Date.now();
  const def = definitionFor(input.canonicalKey);
  const confidence = input.confidence ?? (input.source === 'user' ? 1 : input.source === 'model' ? 0.6 : 0.85);
  const staleDays = def?.staleAfterDays;
  return {
    id: `fact:${input.canonicalKey}:${input.scopeValue ?? 'global'}`,
    canonicalKey: input.canonicalKey,
    displayLabel: input.displayLabel ?? def?.label ?? input.canonicalKey,
    value: input.value.trim(),
    dataType: def?.type ?? 'text',
    source: input.source,
    confidence,
    scope: def?.scope ?? 'global',
    ...(input.scopeValue ? { scopeValue: input.scopeValue } : {}),
    verifiedAt: input.source === 'user' ? now : 0,
    updatedAt: now,
    ...(staleDays ? { expiresAt: now + staleDays * 86_400_000 } : {}),
    reusePolicy: def?.selfDeclared ? 'confirm' : 'auto',
    ...(input.provenance ? { provenance: input.provenance } : {}),
  };
}

/* ---------- migration from the old profile ---------- */
/** The old `ApplyProfile.details` keys, mapped onto canonical facts so nothing the person already typed is lost. */
export const LEGACY_DETAIL_KEYS: Record<string, string> = {
  phone: 'phone',
  email: 'email',
  city: 'city',
  address: 'address',
  state: 'state',
  pincode: 'pincode',
  currentCtc: 'current_ctc',
  expectedCtc: 'expected_ctc',
  noticePeriod: 'notice_period',
  startDate: 'start_date',
  workAuthorization: 'work_authorization',
  relocate: 'relocate',
  links: 'portfolio_url',
};

/**
 * Brings the old profile across. Saved details were typed by the person, so they arrive verified. Remembered
 * answers were typed by the person too, but under a free-text key: only the ones that resolve to a known fact are
 * promoted, and the rest are kept as they were so an exact repeat of the question still works.
 */
export function migrateProfile(
  profile: { details?: Record<string, string | undefined>; answers?: Record<string, string> },
  country?: string,
  now = Date.now(),
): { facts: CandidateFact[]; keptAnswers: Record<string, string> } {
  const facts: CandidateFact[] = [];
  const seen = new Set<string>();
  for (const [legacy, key] of Object.entries(LEGACY_DETAIL_KEYS)) {
    const value = profile.details?.[legacy]?.trim();
    if (!value) continue;
    const def = definitionFor(key);
    const scopeValue = def?.scope === 'country' ? country : undefined;
    facts.push(
      makeFact({
        canonicalKey: key,
        value,
        source: 'user',
        now,
        provenance: 'Your saved application details',
        ...(scopeValue ? { scopeValue } : {}),
      }),
    );
    seen.add(key);
  }
  const keptAnswers: Record<string, string> = {};
  for (const [label, value] of Object.entries(profile.answers ?? {})) {
    const match = matchLabel(label);
    // Only short factual answers are promoted; a written answer stays tied to the question it was written for.
    if (match && !seen.has(match.key) && value.trim().length <= 120 && match.definition.section !== 'narrative') {
      const scopeValue = match.definition.scope === 'country' ? country : undefined;
      facts.push(
        makeFact({
          canonicalKey: match.key,
          value,
          source: 'user',
          now,
          provenance: `Your earlier answer to “${label}”`,
          ...(scopeValue ? { scopeValue } : {}),
        }),
      );
      seen.add(match.key);
    }
    keptAnswers[label] = value;
  }
  return { facts, keptAnswers };
}

/* ---------- smart inference, student/intern defaults & tiered readiness ---------- */
export type CandidatePersona = 'student-intern' | 'experienced';

/** Tier-1 universal essentials every applicant actually needs ready before applying cleanly. */
export const ESSENTIAL_FACT_KEYS = ['full_name', 'email', 'work_authorization', 'notice_period', 'relocate'] as const;

const parseMonthOrYear = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const clean = s.trim();
  const ts = Date.parse(/^\d{4}$/.test(clean) ? `${clean}-06-01` : /^\d{4}-\d{2}$/.test(clean) ? `${clean}-01` : clean);
  return Number.isFinite(ts) ? ts : undefined;
};

/** Detects whether a user is a student / internship seeker vs an experienced hire from profile + campaign. */
export function detectCandidateMode(
  profile: Pick<CandidateProfile, 'education' | 'employment'>,
  campaignEmploymentType?: string,
  now = Date.now(),
): { mode: CandidatePersona; reason: string; gradEnd?: string } {
  const latestEdu = latestEducation(profile.education);
  const gradTs = parseMonthOrYear(latestEdu?.endDate);
  const stillStudying = gradTs !== undefined && gradTs > now - 30 * 86_400_000;
  const years = yearsOfExperience(profile.employment, now) ?? 0;

  if (campaignEmploymentType === 'internship') {
    return {
      mode: 'student-intern',
      reason: latestEdu?.endDate
        ? `Internship search · graduating ${latestEdu.endDate}`
        : 'Internship search — student/fresher defaults apply',
      ...(latestEdu?.endDate ? { gradEnd: latestEdu.endDate } : {}),
    };
  }
  if (stillStudying || years <= 1.2) {
    return {
      mode: 'student-intern',
      reason: stillStudying
        ? `Currently studying${latestEdu?.qualification ? ` (${latestEdu.qualification})` : ''} · ${latestEdu?.endDate}`
        : 'Early-career profile (< 1.2 years full-time experience)',
      ...(latestEdu?.endDate ? { gradEnd: latestEdu.endDate } : {}),
    };
  }
  return { mode: 'experienced', reason: `${years} years of experience recorded` };
}

export interface SmartDefaultItem {
  canonicalKey: string;
  label: string;
  value: string;
  scopeValue?: string;
}

/** Generates safe, honest Student / Fresher Answer Bank presets inferred from CandidateProfile + campaign location. */
export function buildStudentSmartDefaults(
  profile: CandidateProfile,
  options: { country?: string; campaignLocation?: string; now?: number } = {},
): SmartDefaultItem[] {
  const now = options.now ?? Date.now();
  const country =
    options.country?.trim() ||
    profile.eligibility.authorisedIn[0]?.trim() ||
    profile.identity.country?.trim() ||
    options.campaignLocation?.split(',').pop()?.trim() ||
    'India';
  const years = yearsOfExperience(profile.employment, now) ?? 0;
  const expText = years === 0 ? '0 years (Fresher)' : `${years} year${years === 1 ? '' : 's'}`;
  const relocateVal = profile.preferences.willingToRelocate === false ? 'No' : 'Yes';

  return [
    { canonicalKey: 'notice_period', label: 'Notice period', value: 'Immediate' },
    { canonicalKey: 'start_date', label: 'Earliest start date', value: 'Immediately' },
    { canonicalKey: 'current_ctc', label: 'Current CTC / salary', value: 'N/A (Student)' },
    { canonicalKey: 'total_experience', label: 'Total years of experience', value: expText },
    { canonicalKey: 'work_authorization', label: 'Work authorisation', value: `Authorized to work in ${country}`, scopeValue: country },
    { canonicalKey: 'sponsorship', label: 'Sponsorship required', value: 'No', scopeValue: country },
    { canonicalKey: 'relocate', label: 'Willing to relocate', value: relocateVal },
  ];
}

/** Non-punitive readiness score over the Tier-1 Essentials only (never penalizes missing corporate fields). */
export function essentialReadiness(
  facts: readonly CandidateFact[],
  now = Date.now(),
): { complete: number; total: number; missing: string[] } {
  const byKey = new Map<string, CandidateFact>();
  for (const f of facts) {
    if (!byKey.has(f.canonicalKey) || f.value.trim()) byKey.set(f.canonicalKey, f);
  }
  const missing: string[] = [];
  let complete = 0;
  for (const key of ESSENTIAL_FACT_KEYS) {
    const f = byKey.get(key);
    const hasUsable = !!f?.value.trim() && !isStale(f, now) && f.confidence >= 0.8;
    if (hasUsable) complete++;
    else missing.push(key);
  }
  return { complete, total: ESSENTIAL_FACT_KEYS.length, missing };
}

/**
 * Extracts already-known CandidateProfile facts (identity, latest education, current role/experience, preferences)
 * into Answer Bank facts without overwriting any user-entered facts.
 */
export function factsFromProfileSnapshot(
  profile: CandidateProfile,
  existingFacts: readonly CandidateFact[],
  options: { now?: number; identityConfirmed?: boolean } = {},
): CandidateFact[] {
  const now = options.now ?? Date.now();
  const byId = new Map(existingFacts.map(f => [f.id, f]));
  const edu = latestEducation(profile.education);
  const emp = currentEmployment(profile.employment);
  const years = yearsOfExperience(profile.employment, now);
  const country = profile.identity.country?.trim() || profile.eligibility.authorisedIn[0]?.trim();

  const pairs: { key: string; value: string | undefined; scopeValue?: string; source?: FactSource; provenance: string }[] = [
    {
      key: 'full_name',
      value: profile.identity.fullName,
      source: options.identityConfirmed ? 'user' : 'model',
      provenance: 'From your Candidate Profile',
    },
    {
      key: 'email',
      value: profile.identity.email,
      source: options.identityConfirmed ? 'user' : 'model',
      provenance: 'From your Candidate Profile',
    },
    {
      key: 'phone',
      value: profile.identity.phone,
      source: options.identityConfirmed ? 'user' : 'model',
      provenance: 'From your Candidate Profile',
    },
    { key: 'city', value: profile.identity.city, source: 'profile', provenance: 'From your Candidate Profile' },
    { key: 'state', value: profile.identity.state, source: 'profile', provenance: 'From your Candidate Profile' },
    { key: 'country', value: profile.identity.country, source: 'profile', provenance: 'From your Candidate Profile' },
    { key: 'linkedin_url', value: profile.identity.profileUrl, source: 'profile', provenance: 'Your LinkedIn profile' },
    { key: 'portfolio_url', value: profile.identity.portfolioLinks[0], source: 'profile', provenance: 'From your Candidate Profile' },
    {
      key: 'highest_qualification',
      value: edu ? [edu.qualification || edu.level, edu.field].filter(Boolean).join(' in ') : undefined,
      source: 'cv',
      provenance: 'From your Education record',
    },
    { key: 'graduation_institute', value: edu?.institution, source: 'cv', provenance: 'From your Education record' },
    { key: 'graduation_field', value: edu?.field, source: 'cv', provenance: 'From your Education record' },
    { key: 'graduation_year', value: edu?.endDate?.slice(0, 4), source: 'cv', provenance: 'From your Education record' },
    {
      key: 'graduation_grade',
      value: edu?.grade ? `${edu.grade}${edu.gradeScale ? ` / ${edu.gradeScale}` : ''}` : undefined,
      source: 'cv',
      provenance: 'From your Education record',
    },
    { key: 'current_employer', value: emp?.current ? emp.employer : undefined, source: 'cv', provenance: 'From your Experience record' },
    { key: 'current_title', value: emp?.current ? emp.title : undefined, source: 'cv', provenance: 'From your Experience record' },
    {
      key: 'total_experience',
      value: years !== undefined ? `${years} year${years === 1 ? '' : 's'}` : undefined,
      source: 'profile',
      provenance: 'Calculated from Work Experience dates',
    },
    { key: 'preferred_location', value: profile.preferences.locations[0], source: 'profile', provenance: 'From your Preferences' },
    { key: 'employment_type', value: profile.preferences.employmentTypes[0], source: 'profile', provenance: 'From your Preferences' },
    {
      key: 'expected_ctc',
      value: profile.preferences.expectedCompensation,
      source: 'profile',
      provenance: 'From your Preferences',
    },
    ...(country && profile.eligibility.authorisedIn.some(c => c.toLowerCase() === country.toLowerCase())
      ? [
          {
            key: 'work_authorization',
            value: `Authorized to work in ${country}`,
            scopeValue: country,
            source: 'profile' as const,
            provenance: 'From your Eligibility settings',
          },
        ]
      : []),
  ];

  const toSave: CandidateFact[] = [];
  for (const item of pairs) {
    const clean = (item.value ?? '').trim();
    if (!clean) continue;
    const factId = `fact:${item.key}:${item.scopeValue ?? 'global'}`;
    const existing = byId.get(factId);
    if (existing && existing.source === 'user' && existing.value.trim()) continue;
    if (existing && existing.value === clean && existing.source === (item.source ?? 'profile')) continue;
    toSave.push(
      makeFact({
        canonicalKey: item.key,
        value: clean,
        source: item.source ?? 'profile',
        provenance: item.provenance,
        now,
        ...(item.scopeValue ? { scopeValue: item.scopeValue } : {}),
      }),
    );
  }
  return toSave;
}
