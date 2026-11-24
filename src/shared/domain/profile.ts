/**
 * The candidate profile (specification 5.1): the structured record behind every answer the product gives on the
 * person's behalf.
 *
 * Two things shape the design. First, these are records, not fields: someone has more than one degree and more
 * than one job, and collapsing them into "your university" loses the one the form is asking about. Second, every
 * item carries where it came from and when it was confirmed, because an answer typed into a real application needs
 * to be traceable to something the person actually said — a line extracted from a CV is a good suggestion and a
 * poor declaration.
 */

export type EvidenceSource = 'user' | 'cv' | 'profile' | 'model';

export interface Provenance {
  source: EvidenceSource;
  /** 0-1. Anything the person did not type themselves starts below 1 and is shown as a suggestion. */
  confidence: number;
  /** The document or record it came from, and the text it was read out of, so a claim can be checked. */
  documentId?: string;
  sourceSpan?: string;
  capturedAt: number;
  verifiedAt?: number;
}

export const unverified = (source: EvidenceSource, now = Date.now()): Provenance => ({
  source,
  confidence: source === 'user' ? 1 : source === 'model' ? 0.6 : 0.8,
  capturedAt: now,
  ...(source === 'user' ? { verifiedAt: now } : {}),
});

export const isVerified = (p: Provenance): boolean => !!p.verifiedAt && p.confidence >= 0.8;

/* ---------- records ---------- */
export interface EducationRecord {
  id: string;
  /** '10th', '12th', 'bachelors', 'masters', 'diploma', 'certificate' — kept open because boards vary by country. */
  level: string;
  institution: string;
  board?: string;
  qualification?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  /** The number as the person records it, with its scale kept beside it: 8.4 on a 10 scale is not 8.4%. */
  grade?: string;
  gradeScale?: string;
  backlogs?: number;
  provenance: Provenance;
}

export interface EmploymentRecord {
  id: string;
  employer: string;
  title: string;
  location?: string;
  workType?: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  responsibilities: string[];
  achievements: string[];
  technologies: string[];
  teamContext?: string;
  provenance: Provenance;
}

export interface ProjectRecord {
  id: string;
  name: string;
  summary?: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  skills: string[];
  outcomes: string[];
  links: string[];
  provenance: Provenance;
}

export interface SkillRecord {
  id: string;
  skill: string;
  proficiency?: string;
  /** Which education, employment or project record backs this skill up. */
  evidenceRefs: string[];
  provenance: Provenance;
}

export type DocumentKind = 'cv' | 'cv-variant' | 'cover-letter' | 'supporting';

export interface DocumentRecord {
  id: string;
  kind: DocumentKind;
  name: string;
  mimeType: string;
  size: number;
  /** Which role families this variant is for, so the queue can attach the right one. */
  roleFamilies: string[];
  /** Extracted text, kept for building prompts without re-reading the file every time. */
  text?: string;
  version: number;
  savedAt: number;
  isDefault?: boolean;
}

export interface ProfilePreferences {
  targetRoleFamilies: string[];
  locations: string[];
  workModes: string[];
  employmentTypes: string[];
  companyStages: string[];
  expectedCompensation?: string;
  willingToRelocate?: boolean;
}

export interface ProfileEligibility {
  /** Countries the person may work in without sponsorship. */
  authorisedIn: string[];
  needsSponsorship?: boolean;
  languages: string[];
  notes?: string;
}

export interface CareerNarrative {
  strengths?: string;
  careerGoal?: string;
  motivation?: string;
  leadershipExample?: string;
  challengeExample?: string;
}

export interface CandidateProfile {
  id: string;
  /** Bumped on every edit. An application records the version it filled from, so later edits never rewrite history. */
  profileVersion: number;
  identity: {
    fullName?: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;
    country?: string;
    address?: string;
    postalCode?: string;
    profileUrl?: string;
    portfolioLinks: string[];
  };
  education: EducationRecord[];
  employment: EmploymentRecord[];
  projects: ProjectRecord[];
  skills: SkillRecord[];
  preferences: ProfilePreferences;
  eligibility: ProfileEligibility;
  narrative: CareerNarrative;
  documents: DocumentRecord[];
  createdAt: number;
  updatedAt: number;
}

export function emptyProfile(now = Date.now()): CandidateProfile {
  return {
    id: 'profile:default',
    profileVersion: 1,
    identity: { portfolioLinks: [] },
    education: [],
    employment: [],
    projects: [],
    skills: [],
    preferences: { targetRoleFamilies: [], locations: [], workModes: [], employmentTypes: [], companyStages: [] },
    eligibility: { authorisedIn: [], languages: [] },
    narrative: {},
    documents: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Every edit bumps the version, which is what lets an application say exactly which profile it was filled from. */
export const touch = (p: CandidateProfile, now = Date.now()): CandidateProfile => ({
  ...p,
  profileVersion: p.profileVersion + 1,
  updatedAt: now,
});

/* ---------- derived values ---------- */
const parseDate = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const t = Date.parse(/^\d{4}$/.test(s) ? `${s}-01-01` : /^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s);
  return Number.isFinite(t) ? t : undefined;
};

/**
 * Years of experience, worked out from the employment records rather than asked for again. Overlapping jobs are
 * merged so holding two roles at once does not read as double the career.
 */
export function yearsOfExperience(records: readonly EmploymentRecord[], now = Date.now()): number | undefined {
  const spans = records
    .map(r => ({ from: parseDate(r.startDate), to: r.current ? now : parseDate(r.endDate) }))
    .filter((s): s is { from: number; to: number } => s.from !== undefined && s.to !== undefined && s.to >= s.from)
    .sort((a, b) => a.from - b.from);
  if (!spans.length) return undefined;
  let total = 0;
  let cursor = 0;
  for (const s of spans) {
    const from = Math.max(s.from, cursor);
    if (s.to > from) total += s.to - from;
    cursor = Math.max(cursor, s.to);
  }
  return Math.round((total / (365.25 * 86_400_000)) * 10) / 10;
}

export const latestEducation = (records: readonly EducationRecord[]): EducationRecord | undefined =>
  [...records].sort((a, b) => (parseDate(b.endDate) ?? 0) - (parseDate(a.endDate) ?? 0))[0];

export const currentEmployment = (records: readonly EmploymentRecord[]): EmploymentRecord | undefined =>
  records.find(r => r.current) ?? [...records].sort((a, b) => (parseDate(b.endDate) ?? 0) - (parseDate(a.endDate) ?? 0))[0];

/** The CV to attach for a given role family, falling back to the default master CV. */
export function documentFor(profile: CandidateProfile, roleFamily?: string): DocumentRecord | undefined {
  const cvs = profile.documents.filter(d => d.kind === 'cv' || d.kind === 'cv-variant');
  if (roleFamily) {
    const variant = cvs.find(d => d.roleFamilies.some(f => f.toLowerCase() === roleFamily.toLowerCase()));
    if (variant) return variant;
  }
  return cvs.find(d => d.isDefault) ?? cvs.find(d => d.kind === 'cv') ?? cvs[0];
}

/* ---------- conflicts ---------- */
export interface Conflict {
  key: string;
  label: string;
  values: { value: string; source: EvidenceSource; where: string }[];
}

/**
 * Two sources disagreeing about a fact is a decision for the person, not something to resolve by preferring the
 * newer one. A graduation year that differs between the CV and the LinkedIn profile goes on a real application
 * either way, so the product surfaces both and asks (specification 11, P0 data conflict).
 */
export function conflicts(profile: CandidateProfile): Conflict[] {
  const out: Conflict[] = [];
  const grads = profile.education.filter(e =>
    /bachelor|master|graduat|b\.?tech|b\.?e\b|mba|pgdm/i.test(`${e.level} ${e.qualification ?? ''}`),
  );
  const years = new Map<string, EducationRecord[]>();
  for (const g of grads) {
    const y = (g.endDate ?? '').slice(0, 4);
    if (!y) continue;
    years.set(y, [...(years.get(y) ?? []), g]);
  }
  if (years.size > 1 && grads.length > years.size)
    out.push({
      key: 'graduationYear',
      label: 'Graduation year',
      values: [...years.entries()].map(([year, records]) => ({
        value: year,
        source: records[0]!.provenance.source,
        where: records[0]!.institution,
      })),
    });
  return out;
}
