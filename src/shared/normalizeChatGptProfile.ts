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
import type { CandidateProfile } from './domain/profile';

export type NormalizedIdentity = AiProfileDraft['identity'] & {
  formattedLocation: string;
};

export type NormalizedChatGptProfile = AiProfileDraft & {
  identity: NormalizedIdentity;
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

  const missingInformation = stringArray(root.missingInformation, 500, 50);

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
