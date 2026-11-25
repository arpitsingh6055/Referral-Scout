/**
 * Defensive V3 + legacy flat ChatGPT profile payload normalizer.
 *
 * Bridges nested `schemaVersion: 3` payloads (`raw.identity.fullName`, `raw.identity.email`,
 * `raw.identity.phone`, `raw.identity.city/state/country`, `raw.identity.profileUrl`, `employment[]`,
 * `education[]`, `projects[]`, `skills[]`, `narrative`, `conflicts[]`, `missingInformation[]`) AND legacy
 * flat / v2 formats (`fullName`, `name`, `email`, `linkedinUrl`, `experience[]`, `summary`, `{ name }[]`)
 * without ever discarding nested keys or overwriting existing non-empty user fields.
 */

import { extractJson } from '../parsers/json';
import { aiProfileDraftSchema, type AiProfileDraft } from './profile-draft';
import type { CandidateProfile, StructuredMissingPrompt } from './domain/profile';

export type NormalizedIdentity = AiProfileDraft['identity'] & {
  formattedLocation: string;
};

export type NormalizedChatGptProfile = AiProfileDraft & {
  identity: NormalizedIdentity;
  mergeNotes: string[];
  structuredMissing: StructuredMissingPrompt[];
  sourceVersion: number;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (val: unknown): UnknownRecord | null =>
  val && typeof val === 'object' && !Array.isArray(val) ? (val as UnknownRecord) : null;

const cleanStr = (val: unknown, max = 500): string =>
  typeof val === 'string' ? val.trim().slice(0, max) : typeof val === 'number' ? String(val).slice(0, max) : '';

const firstStr = (...vals: unknown[]): string => {
  for (const v of vals) {
    const s = cleanStr(v, 3000);
    if (s) return s;
  }
  return '';
};

const stringArray = (val: unknown, maxItemLen = 500, maxCount = 60): string[] => {
  if (!Array.isArray(val)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of val) {
    let text = '';
    if (typeof item === 'string') text = item.trim();
    else {
      const obj = asRecord(item);
      if (obj) text = firstStr(obj.name, obj.skill, obj.detail, obj.label, obj.title, obj.value);
    }
    text = text.slice(0, maxItemLen);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxCount) break;
  }
  return out;
};

/** Splits a combined `"City, State, Country"` string cleanly when granular fields are absent. */
function splitLocation(rawLoc: string): { city: string; state: string; country: string } {
  const parts = rawLoc
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length === 1) return { city: parts[0]!, state: '', country: '' };
  if (parts.length === 2) return { city: parts[0]!, state: '', country: parts[1]! };
  if (parts.length >= 3) return { city: parts[0]!, state: parts[1]!, country: parts.slice(2).join(', ') };
  return { city: '', state: '', country: '' };
}

/** Joins non-empty `city`, `state`, `country` cleanly into a single display location. */
export function formatLocation(parts: { city?: string; state?: string; country?: string }): string {
  return [parts.city, parts.state, parts.country]
    .map(v => (v ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

const MERGE_LOG_PATTERN =
  /\b(cv details (have been |were )?retained|retained from (the )?cv|kept from (the )?cv|using cv value|prefer(red)? cv|already (present|captured|extracted|included|listed)|were provided in the linkedin source|not provided in (the )?linkedin( source)?|absent from linkedin|not listed on linkedin)\b/i;

const META_EMPTY_PATTERN = /^(none|n\/a|nil|no missing information|nothing missing|all required fields (are )?present)\.?$/i;

function slugPromptId(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `gap:${(h >>> 0).toString(36)}`;
}

/**
 * Filters out resolved LLM merge/reconciliation notes into `mergeNotes` (green confirmation badges, never form
 * inputs) and transforms genuine unresolved gaps into structured, scannable micro-prompts.
 */
export function sanitizeMissingInformation(
  rawItems: readonly string[],
  context: {
    identity: Partial<AiProfileDraft['identity']>;
    employment?: readonly { employer?: string; title?: string }[];
    education?: readonly { institution?: string; qualification?: string; level?: string }[];
    projects?: readonly { name?: string }[];
  },
): {
  missingInformation: string[];
  structuredMissing: StructuredMissingPrompt[];
  mergeNotes: string[];
} {
  const mergeNotes: string[] = [];
  const mergeSeen = new Set<string>();
  const addMergeNote = (note: string): void => {
    const clean = note.trim();
    if (!clean || mergeSeen.has(clean.toLowerCase())) return;
    mergeSeen.add(clean.toLowerCase());
    mergeNotes.push(clean);
  };

  const missingInformation: string[] = [];
  const structuredMissing: StructuredMissingPrompt[] = [];
  const gapSeen = new Set<string>();

  for (const rawItem of rawItems) {
    const item = rawItem.replace(/\s+/g, ' ').trim();
    if (!item || META_EMPTY_PATTERN.test(item)) continue;

    // Pass 1: Filter resolved merge/retention logs into harmless green info confirmations.
    const mentionsEmail = /\b(e-?mail)\b/i.test(item);
    const mentionsPhone = /\b(phone|mobile|whatsapp)\b/i.test(item);
    const mentionsLocation = /\b(city|state|country|location|address)\b/i.test(item);
    const mentionsLinkedin = /\blinkedin(\s+url|\s+profile|\s+source)?\b/i.test(item);

    const resolvedContactLog =
      (mentionsEmail && !!context.identity.email?.trim() && /\blinkedin|retained|cv\b/i.test(item)) ||
      (mentionsPhone && !!context.identity.phone?.trim() && /\blinkedin|retained|cv\b/i.test(item)) ||
      (mentionsLocation && !!(context.identity.city || context.identity.country) && /\blinkedin|retained|cv\b/i.test(item)) ||
      (mentionsLinkedin && !!context.identity.profileUrl?.trim() && /\bretained|cv|matched\b/i.test(item));

    if (MERGE_LOG_PATTERN.test(item) || resolvedContactLog) {
      if (mentionsEmail && context.identity.email?.trim()) addMergeNote('Email & contact details verified from your CV');
      else if (mentionsPhone && context.identity.phone?.trim()) addMergeNote('Phone number retained from your CV');
      else if (mentionsLinkedin) addMergeNote('Merged CV + LinkedIn cleanly — CV details retained');
      else addMergeNote('Merged CV + LinkedIn sources with zero data loss');
      continue;
    }

    // Pass 2: Structure genuine gaps by target section & concrete placeholder.
    const dedupeKey = item.toLowerCase();
    if (gapSeen.has(dedupeKey)) continue;
    gapSeen.add(dedupeKey);
    missingInformation.push(item);

    const matchedRole = (context.employment ?? []).find(
      e =>
        (e.employer && item.toLowerCase().includes(e.employer.toLowerCase())) ||
        (e.title && item.toLowerCase().includes(e.title.toLowerCase())),
    );
    const matchedEdu = (context.education ?? []).find(e => e.institution && item.toLowerCase().includes(e.institution.toLowerCase()));
    const matchedProj = (context.projects ?? []).find(p => p.name && item.toLowerCase().includes(p.name.toLowerCase()));

    if (matchedRole) {
      const entity = matchedRole.employer || matchedRole.title || 'Role';
      const asksDates = /\b(date|start|end|duration|month|year|period)\b/i.test(item);
      const asksMetrics = /\b(metric|achievement|outcome|impact|number|quantit|responsibilit|detail)\b/i.test(item);
      structuredMissing.push({
        id: slugPromptId(item),
        rawText: item,
        shortLabel: `${entity.slice(0, 22)} · ${asksDates && asksMetrics ? 'Dates & Impact' : asksDates ? 'Dates' : 'Role Details'}`,
        helperQuestion:
          asksDates && asksMetrics
            ? `Add dates or key outcomes for ${entity} (optional)`
            : asksDates
              ? `Add start and end dates for ${entity} (optional)`
              : `Add achievements or responsibilities for ${entity} (optional)`,
        inputPlaceholder: asksDates ? 'e.g., May 2026 – Jul 2026, Built APIs (+20% speed)' : 'e.g., Led feature launch across 3 squads',
        targetSection: 'employment',
        targetHint: entity,
        suggestedAction: 'edit-section',
      });
      continue;
    }

    if (matchedEdu) {
      const school = matchedEdu.institution || 'Education';
      const asksGrade = /\b(grade|cgpa|gpa|score|percent)\b/i.test(item);
      structuredMissing.push({
        id: slugPromptId(item),
        rawText: item,
        shortLabel: `${school.slice(0, 22)} · ${asksGrade ? 'Grade' : 'Dates / Field'}`,
        helperQuestion: asksGrade
          ? `Add CGPA/percentage for ${school} (optional)`
          : `Confirm graduation date or field for ${school} (optional)`,
        inputPlaceholder: asksGrade ? 'e.g., 8.4 / 10' : 'e.g., 2026-06 – 2028-04, Marketing',
        targetSection: 'education',
        targetHint: school,
        suggestedAction: 'edit-section',
      });
      continue;
    }

    if (matchedProj) {
      const proj = matchedProj.name || 'Project';
      structuredMissing.push({
        id: slugPromptId(item),
        rawText: item,
        shortLabel: `${proj.slice(0, 24)} · Outcomes`,
        helperQuestion: `Add tech stack, link, or result for ${proj} (optional)`,
        inputPlaceholder: 'e.g., Built in TypeScript · 200+ weekly active users',
        targetSection: 'projects',
        targetHint: proj,
        suggestedAction: 'edit-section',
      });
      continue;
    }

    let factKey: string | undefined;
    let shortLabel = item.length > 38 ? `${item.slice(0, 35).trim()}…` : item;
    let helperQuestion = item.length > 96 ? `${item.slice(0, 92).trim()}… (optional)` : item;
    let inputPlaceholder = 'Enter detail (optional)…';
    let targetSection: StructuredMissingPrompt['targetSection'] = 'facts';

    if (mentionsEmail && !context.identity.email?.trim()) {
      factKey = 'email';
      targetSection = 'identity';
      shortLabel = 'Contact Email';
      helperQuestion = 'Add the email address applications should use';
      inputPlaceholder = 'e.g., name@university.edu';
    } else if (mentionsPhone && !context.identity.phone?.trim()) {
      factKey = 'phone';
      targetSection = 'identity';
      shortLabel = 'Phone Number';
      helperQuestion = 'Add your phone number with country code';
      inputPlaceholder = 'e.g., +91 9876543210';
    } else if (mentionsLocation && !context.identity.city?.trim()) {
      factKey = 'city';
      targetSection = 'identity';
      shortLabel = 'Current City';
      helperQuestion = 'Add your current city for location matching';
      inputPlaceholder = 'e.g., Bengaluru';
    } else if (/\b(salary|ctc|compensation|stipend)\b/i.test(item)) {
      factKey = 'expected_ctc';
      shortLabel = 'Expected Compensation / Stipend';
      helperQuestion = 'Add expected CTC or monthly stipend (skip for internships if open)';
      inputPlaceholder = 'e.g., ₹25,000/month or Open';
    } else if (/\b(notice|availability|start date)\b/i.test(item)) {
      factKey = 'notice_period';
      shortLabel = 'Notice Period / Availability';
      helperQuestion = 'When can you start a new role or internship?';
      inputPlaceholder = 'e.g., Immediate / May 2026';
    } else if (/\b(authori[sz]|visa|sponsorship)\b/i.test(item)) {
      factKey = 'work_authorization';
      shortLabel = 'Work Authorization';
      helperQuestion = 'Confirm your work authorization in target country';
      inputPlaceholder = 'e.g., Authorized without sponsorship';
    } else if (/\b(portfolio|github|website|links?)\b/i.test(item)) {
      factKey = 'portfolio_url';
      targetSection = 'identity';
      shortLabel = 'Portfolio or GitHub URL';
      helperQuestion = 'Add a portfolio, GitHub, or case-study link (optional)';
      inputPlaceholder = 'e.g., https://github.com/username';
    }

    structuredMissing.push({
      id: slugPromptId(item),
      rawText: item,
      shortLabel,
      helperQuestion,
      inputPlaceholder,
      targetSection,
      ...(factKey ? { factKey } : {}),
      suggestedAction: factKey ? 'inline-fact' : 'skip',
    });
  }

  return { missingInformation, structuredMissing, mergeNotes };
}

/** Normalizes ChatGPT schemaVersion 3 (`identity.*`) OR flat/legacy payloads into canonical V3 structure. */
export function normalizeChatGptResponse(rawPayload: unknown): NormalizedChatGptProfile {
  let obj: UnknownRecord | null = null;
  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed) throw new Error('ChatGPT returned an empty profile draft.');
    try {
      obj = asRecord(JSON.parse(trimmed));
    } catch {
      obj = asRecord(extractJson(trimmed));
    }
  } else {
    obj = asRecord(rawPayload);
  }
  if (!obj) throw new Error('ChatGPT profile draft must be a JSON object.');

  // Unwrap `{ data: ... }` or `{ profile: ... }` containers if ChatGPT added a wrapper key.
  const root = asRecord(obj.data) ?? (asRecord(obj.profile) && !asRecord(obj.identity) ? asRecord(obj.profile)! : obj);
  const rawIdentity = asRecord(root.identity) ?? asRecord(root.contact) ?? {};

  const fallbackLoc = splitLocation(firstStr(rawIdentity.location, root.location));
  const city = firstStr(rawIdentity.city, root.city, fallbackLoc.city).slice(0, 120);
  const state = firstStr(rawIdentity.state, root.state, fallbackLoc.state).slice(0, 120);
  const country = firstStr(rawIdentity.country, root.country, fallbackLoc.country).slice(0, 120);

  const identity: AiProfileDraft['identity'] = {
    fullName: firstStr(rawIdentity.fullName, rawIdentity.name, root.fullName, root.name, root.candidateName).slice(0, 200),
    email: firstStr(rawIdentity.email, rawIdentity.emailAddress, root.email, root.emailAddress).slice(0, 200),
    phone: firstStr(rawIdentity.phone, rawIdentity.phoneNumber, root.phone, root.phoneNumber).slice(0, 60),
    city,
    state,
    country,
    profileUrl: firstStr(rawIdentity.profileUrl, rawIdentity.linkedinUrl, rawIdentity.linkedin, root.profileUrl, root.linkedinUrl).slice(
      0,
      300,
    ),
  };

  const rawEdu = Array.isArray(root.education) ? root.education : [];
  const education = rawEdu.slice(0, 30).flatMap(item => {
    const e = asRecord(item);
    if (!e) return [];
    const institution = firstStr(e.institution, e.school, e.university, e.detail).slice(0, 200);
    const level = firstStr(e.level, e.degree, e.qualification, institution ? 'Education' : '').slice(0, 120);
    if (!institution && !level) return [];
    return [
      {
        level,
        institution,
        qualification: firstStr(e.qualification, e.degree, level).slice(0, 120),
        field: firstStr(e.field, e.major, e.specialization).slice(0, 120),
        startDate: firstStr(e.startDate, e.from).slice(0, 40),
        endDate: firstStr(e.endDate, e.to).slice(0, 40),
        grade: firstStr(e.grade, e.cgpa, e.gpa).slice(0, 40),
        gradeScale: firstStr(e.gradeScale, e.scale).slice(0, 40),
      },
    ];
  });

  const rawEmp = Array.isArray(root.employment) ? root.employment : Array.isArray(root.experience) ? root.experience : [];
  const employment = rawEmp.slice(0, 40).flatMap(item => {
    const e = asRecord(item);
    if (!e) return [];
    const employer = firstStr(e.employer, e.company, e.organization).slice(0, 200);
    const title = firstStr(e.title, e.role, e.position).slice(0, 200);
    if (!employer && !title) return [];
    return [
      {
        employer,
        title,
        location: firstStr(e.location).slice(0, 120),
        startDate: firstStr(e.startDate, e.from).slice(0, 40),
        endDate: firstStr(e.endDate, e.to).slice(0, 40),
        current: Boolean(e.current),
        responsibilities: stringArray(e.responsibilities, 500, 30),
        achievements: stringArray(e.achievements, 500, 30),
        technologies: stringArray(e.technologies ?? e.skills, 100, 60),
      },
    ];
  });

  const rawProj = Array.isArray(root.projects) ? root.projects : [];
  const projects = rawProj.slice(0, 50).flatMap(item => {
    const p = asRecord(item);
    if (!p) return [];
    const name = firstStr(p.name, p.title).slice(0, 200);
    if (!name) return [];
    return [
      {
        name,
        summary: firstStr(p.summary, p.description, p.detail).slice(0, 3000),
        role: firstStr(p.role).slice(0, 120),
        skills: stringArray(p.skills ?? p.technologies, 100, 60),
        outcomes: stringArray(p.outcomes, 500, 30),
        links: stringArray(p.links, 500, 20),
      },
    ];
  });

  const skills = stringArray(root.skills, 100, 150);

  const rawNarrative = asRecord(root.narrative) ?? {};
  const narrative = {
    strengths: firstStr(
      rawNarrative.strengths,
      root.strengths,
      Array.isArray(root.targetRoleStrengths) ? stringArray(root.targetRoleStrengths, 500, 8).join('; ') : '',
      root.summary,
    ).slice(0, 3000),
    careerGoal: firstStr(rawNarrative.careerGoal, root.careerGoal, root.headline).slice(0, 3000),
  };

  const rawConflicts = Array.isArray(root.conflicts) ? root.conflicts : [];
  const conflicts = rawConflicts.slice(0, 50).flatMap(item => {
    const c = asRecord(item);
    if (!c) {
      const detail = cleanStr(item, 500);
      return detail ? [{ field: 'Detail', cvValue: detail, linkedinValue: '', resolution: 'CV preferred' }] : [];
    }
    const field = firstStr(c.field, c.topic, c.label, 'Profile detail').slice(0, 200);
    return [
      {
        field,
        cvValue: firstStr(c.cvValue, c.cv, c.detail).slice(0, 3000),
        linkedinValue: firstStr(c.linkedinValue, c.linkedin).slice(0, 3000),
        resolution: firstStr(c.resolution, 'CV preferred').slice(0, 1000),
      },
    ];
  });

  const rawMissing = stringArray(root.missingInformation, 500, 50);
  const { missingInformation, structuredMissing, mergeNotes } = sanitizeMissingInformation(rawMissing, {
    identity,
    employment,
    education,
    projects,
  });

  const canonical = aiProfileDraftSchema.parse({
    schemaVersion: 3,
    identity,
    education,
    employment,
    projects,
    skills,
    narrative,
    conflicts,
    missingInformation,
  });

  return {
    ...canonical,
    identity: {
      ...canonical.identity,
      formattedLocation: formatLocation(canonical.identity),
    },
    mergeNotes,
    structuredMissing,
    sourceVersion: typeof root.schemaVersion === 'number' ? root.schemaVersion : 3,
  };
}

/** Non-destructive identity merge: fills missing fields and never overwrites non-empty data with empty strings. */
export function mergeCandidateIdentity(
  current: CandidateProfile['identity'],
  incoming: Partial<AiProfileDraft['identity']>,
  options: { overwriteNonEmpty?: boolean } = {},
): CandidateProfile['identity'] {
  const pick = (cur: string | undefined, next: string | undefined): string | undefined => {
    const cleanNext = (next ?? '').trim();
    const cleanCur = (cur ?? '').trim();
    if (!cleanNext) return cleanCur ? cur : undefined;
    if (!cleanCur || options.overwriteNonEmpty) return cleanNext;
    return cur;
  };
  const next: CandidateProfile['identity'] = {
    portfolioLinks: current.portfolioLinks ?? [],
  };
  const set = (key: keyof Omit<CandidateProfile['identity'], 'portfolioLinks'>, val: string | undefined): void => {
    if (val) next[key] = val;
  };
  set('fullName', pick(current.fullName, incoming.fullName));
  set('email', pick(current.email, incoming.email));
  set('phone', pick(current.phone, incoming.phone));
  set('city', pick(current.city, incoming.city));
  set('state', pick(current.state, incoming.state));
  set('country', pick(current.country, incoming.country));
  set('address', pick(current.address, undefined));
  set('postalCode', pick(current.postalCode, undefined));
  set('profileUrl', pick(current.profileUrl, incoming.profileUrl));
  return next;
}
