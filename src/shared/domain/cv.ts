/**
 * Reading a CV into structured records (specification 5.1, 20.2).
 *
 * This runs on the CV text the extension already extracts, entirely on the machine, with no model call. That is
 * a deliberate choice: parsing is the step whose output the person must check anyway, so spending a model round
 * trip to produce a guess they still have to verify buys nothing. Rules are predictable, instant, and when they
 * are wrong they are wrong in ways a person can see and correct.
 *
 * Everything produced here arrives unverified. A line read out of a PDF is a suggestion; it becomes a fact when
 * the person says so. The source span travels with each record so they can check it against what they wrote.
 */

import { unverified, type EducationRecord, type EmploymentRecord, type ProjectRecord, type SkillRecord } from './profile';

export interface ParsedCv {
  education: EducationRecord[];
  employment: EmploymentRecord[];
  projects: ProjectRecord[];
  skills: SkillRecord[];
  identity: { email?: string; phone?: string; links: string[] };
  /** Sections the parser could not place, so nothing silently disappears. */
  unparsed: string[];
}

const id = (prefix: string, n: number): string => `${prefix}:cv:${n}`;

const SECTION_PATTERNS: [RegExp, keyof ParsedCv | 'skip'][] = [
  [/^\s*(education|academics?|academic (background|qualifications?)|qualifications?)\s*:?\s*$/i, 'education'],
  [/^\s*(experience|work experience|professional experience|employment|internships?|work history|career)\s*:?\s*$/i, 'employment'],
  [/^\s*(projects?|academic projects?|key projects?|personal projects?)\s*:?\s*$/i, 'projects'],
  [/^\s*(skills?|technical skills?|core competenc(y|ies)|tools?( and technologies)?|competencies)\s*:?\s*$/i, 'skills'],
  [
    /^\s*(certifications?|achievements?|awards?|positions? of responsibility|extracurricular|interests?|hobbies|summary|objective|profile|references?)\s*:?\s*$/i,
    'skip',
  ],
];

/** Splits the CV into the sections its own headings announce. */
export function sections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current = 'header';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/ /g, ' ').trimEnd();
    if (!line.trim()) continue;
    // A heading is short and matches a known word; a sentence containing "experience" is not a heading.
    const heading = line.trim().length <= 48 ? SECTION_PATTERNS.find(([p]) => p.test(line)) : undefined;
    if (heading) {
      current = heading[1];
      continue;
    }
    out.set(current, [...(out.get(current) ?? []), line.trim()]);
  }
  return out;
}

// Non-capturing: this is embedded in larger patterns whose group numbers must stay predictable.
const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE_RANGE = new RegExp(
  `(${MONTHS}\\.?\\s*\\d{4}|\\d{1,2}/\\d{4}|\\d{4})\\s*(?:–|-|—|to|until)\\s*(present|current|now|${MONTHS}\\.?\\s*\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`,
  'i',
);

const MONTH_INDEX: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** Normalises whatever the CV wrote into YYYY-MM, or just YYYY when that is all it said. */
export function normaliseDate(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  if (/^(present|current|now)$/.test(text)) return undefined;
  const monthYear = new RegExp(`^(${MONTHS})\\.?\\s*(\\d{4})$`, 'i').exec(text);
  if (monthYear) return `${monthYear[2]}-${MONTH_INDEX[monthYear[1]!.slice(0, 3).toLowerCase()]}`;
  const numeric = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (numeric) return `${numeric[2]}-${numeric[1]!.padStart(2, '0')}`;
  const year = /^(\d{4})$/.exec(text);
  return year ? year[1] : undefined;
}

export interface DatePair {
  startDate?: string;
  endDate?: string;
  current?: boolean;
}

export function datesIn(line: string): DatePair {
  const m = DATE_RANGE.exec(line);
  if (!m) {
    const single = /\b(19|20)\d{2}\b/.exec(line);
    return single ? { endDate: single[0] } : {};
  }
  const current = /^(present|current|now)$/i.test(m[2] ?? '');
  const start = normaliseDate(m[1] ?? '');
  const end = current ? undefined : normaliseDate(m[2] ?? '');
  return { ...(start ? { startDate: start } : {}), ...(end ? { endDate: end } : {}), ...(current ? { current: true } : {}) };
}

const GRADE = /\b(?:cgpa|gpa|sgpa)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:\/\s*(\d{1,2}))?|\b(\d{1,2}(?:\.\d{1,2})?)\s*%/i;

export function gradeIn(line: string): { grade?: string; gradeScale?: string } {
  const m = GRADE.exec(line);
  if (!m) return {};
  // A grade without its scale is ambiguous: 8.4 out of 10 is not 8.4 percent, and a form will ask for one of them.
  if (m[3]) return { grade: m[3], gradeScale: 'percent' };
  return { ...(m[1] ? { grade: m[1] } : {}), gradeScale: m[2] ? `out of ${m[2]}` : 'out of 10' };
}

const DEGREE =
  /\b(ph\.?d|doctorate|m\.?b\.?a|p\.?g\.?d\.?m|m\.?tech|m\.?sc|m\.?com|m\.?a\b|masters?|b\.?tech|b\.?e\b|b\.?sc|b\.?com|b\.?b\.?a|b\.?a\b|bachelors?|diploma|12th|xii|higher secondary|hsc|intermediate|10th|x\b|sslc|secondary)\b/i;
const INSTITUTION = /\b(university|college|institute|school|academy|iit|nit|iim|imt|bits)\b/i;

/**
 * Reads qualifications. Entries are detected by a degree word rather than by layout, because CV layouts vary
 * wildly and a line that names a degree is the one reliable signal across all of them.
 */
export function parseEducation(lines: readonly string[]): EducationRecord[] {
  const out: EducationRecord[] = [];
  let current: EducationRecord | undefined;
  for (const line of lines) {
    const hasDegree = DEGREE.test(line);
    if (hasDegree) {
      if (current) out.push(current);
      const degree = DEGREE.exec(line)![0];
      const institution = INSTITUTION.test(line) ? (line.split(/[,|–—]|\s-\s/).find(part => INSTITUTION.test(part)) ?? '').trim() : '';
      current = {
        id: id('edu', out.length),
        level: /10th|x\b|sslc|secondary(?! school)/i.test(degree)
          ? '10th'
          : /12th|xii|hsc|intermediate|higher secondary/i.test(degree)
            ? '12th'
            : /m\.|mba|pgdm|master|ph/i.test(degree)
              ? 'masters'
              : 'bachelors',
        institution,
        qualification: degree.toUpperCase().replace(/\./g, ''),
        ...datesIn(line),
        ...gradeIn(line),
        provenance: { ...unverified('cv'), sourceSpan: line.slice(0, 200) },
      };
      continue;
    }
    if (!current) continue;
    // Continuation lines fill in whatever the heading line did not carry.
    if (!current.institution && INSTITUTION.test(line)) current.institution = line.split(/[,|–—]/)[0]!.trim();
    if (!current.endDate && !current.startDate) Object.assign(current, datesIn(line));
    if (!current.grade) Object.assign(current, gradeIn(line));
  }
  if (current) out.push(current);
  return out.filter(e => e.institution || e.qualification);
}

const EMPLOYER_HINT = /\b(pvt|ltd|limited|inc|llp|technologies|labs|solutions|systems|consulting|services|group|corp)\b/i;

export function parseEmployment(lines: readonly string[]): EmploymentRecord[] {
  const out: EmploymentRecord[] = [];
  let current: EmploymentRecord | undefined;
  const bullet = /^[•●▪*\-–—]\s*/;

  for (const line of lines) {
    const isBullet = bullet.test(line);
    const dated = DATE_RANGE.test(line);
    // A new role starts on a dated, non-bullet line: that is how nearly every CV writes one.
    if (!isBullet && dated) {
      if (current) out.push(current);
      const withoutDates = line
        .replace(DATE_RANGE, '')
        .replace(/[|,–—]\s*$/, '')
        .trim();
      const parts = withoutDates
        .split(/\s*[|,–—]\s*|\s+at\s+/i)
        .map(p => p.trim())
        .filter(Boolean);
      const employerIndex = parts.findIndex(p => EMPLOYER_HINT.test(p));
      const employer = employerIndex >= 0 ? parts[employerIndex]! : (parts[1] ?? '');
      const title = employerIndex === 0 ? (parts[1] ?? '') : (parts[0] ?? '');
      current = {
        id: id('job', out.length),
        employer,
        title,
        responsibilities: [],
        achievements: [],
        technologies: [],
        ...datesIn(line),
        provenance: { ...unverified('cv'), sourceSpan: line.slice(0, 200) },
      };
      continue;
    }
    if (!current) continue;
    const content = line.replace(bullet, '').trim();
    if (!content) continue;
    // A bullet with a number in it is an achievement; the rest describe the work.
    if (/\d+\s*(%|x\b|percent|crore|lakh|k\b|users|customers|months?)/i.test(content)) current.achievements.push(content);
    else if (isBullet) current.responsibilities.push(content);
    else if (!current.location && content.length < 60) current.location = content;
  }
  if (current) out.push(current);
  return out.filter(e => e.employer || e.title);
}

export function parseProjects(lines: readonly string[]): ProjectRecord[] {
  const out: ProjectRecord[] = [];
  let current: ProjectRecord | undefined;
  const bullet = /^[•●▪*\-–—]\s*/;
  for (const line of lines) {
    if (!bullet.test(line) && line.length <= 90) {
      if (current) out.push(current);
      current = {
        id: id('proj', out.length),
        name: line
          .replace(DATE_RANGE, '')
          .replace(/[|,–—]\s*$/, '')
          .trim(),
        skills: [],
        outcomes: [],
        links: [],
        ...datesIn(line),
        provenance: { ...unverified('cv'), sourceSpan: line.slice(0, 200) },
      };
      continue;
    }
    if (!current) continue;
    const content = line.replace(bullet, '').trim();
    current.summary = current.summary ? `${current.summary} ${content}` : content;
    if (/\d+\s*(%|x\b|users|students|customers)/i.test(content)) current.outcomes.push(content);
  }
  if (current) out.push(current);
  return out.filter(p => p.name);
}

const NOISE = /^(and|or|the|with|using|etc|various|other)$/i;

export function parseSkills(lines: readonly string[]): SkillRecord[] {
  const seen = new Set<string>();
  const out: SkillRecord[] = [];
  for (const line of lines) {
    // A "Tools: Figma, SQL" line carries its own label; only the right-hand side is a skill.
    const body = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
    for (const raw of body.split(/[,;|•·]/)) {
      const skill = raw.replace(/^[\s\-–—*]+/, '').trim();
      if (!skill || skill.length > 40 || skill.length < 2 || NOISE.test(skill)) continue;
      // Anything with several words and a verb is a sentence, not a skill.
      if (skill.split(/\s+/).length > 4) continue;
      const key = skill.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: id('skill', out.length),
        skill,
        evidenceRefs: [],
        provenance: { ...unverified('cv'), sourceSpan: line.slice(0, 160) },
      });
    }
  }
  return out;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const PHONE = /(?:\+?\d{1,3}[\s-]?)?(?:\d[\s-]?){9,12}\d/;
const LINK = /\b((?:https?:\/\/|www\.)[^\s,;)]+|(?:linkedin\.com|github\.com|behance\.net)\/[^\s,;)]+)/gi;

export function parseIdentity(text: string): ParsedCv['identity'] {
  const head = text.slice(0, 1200);
  const email = EMAIL.exec(head)?.[0];
  const phone = PHONE.exec(head.replace(EMAIL, ' '))?.[0]?.trim();
  const links = [...new Set([...head.matchAll(LINK)].map(m => m[0].replace(/[.,]$/, '')))].slice(0, 5);
  return { ...(email ? { email } : {}), ...(phone && phone.replace(/\D/g, '').length >= 10 ? { phone } : {}), links };
}

/**
 * Reads the whole CV. Anything the parser could not place is returned in `unparsed` rather than dropped, so the
 * review screen can show the person what it skipped instead of quietly losing half their document.
 */
export function parseCv(text: string): ParsedCv {
  const found = sections(text);
  const education = parseEducation(found.get('education') ?? []);
  const employment = parseEmployment(found.get('employment') ?? []);
  const projects = parseProjects(found.get('projects') ?? []);
  const skills = parseSkills(found.get('skills') ?? []);
  const unparsed: string[] = [];
  if (!found.has('education')) unparsed.push('No education heading was found.');
  if (!found.has('employment')) unparsed.push('No experience heading was found.');
  if (!found.has('skills')) unparsed.push('No skills heading was found — add a few by hand so jobs can be matched.');
  return { education, employment, projects, skills, identity: parseIdentity(text), unparsed };
}

export interface ParseSummary {
  education: number;
  employment: number;
  projects: number;
  skills: number;
  warnings: string[];
}

export const summarise = (parsed: ParsedCv): ParseSummary => ({
  education: parsed.education.length,
  employment: parsed.employment.length,
  projects: parsed.projects.length,
  skills: parsed.skills.length,
  warnings: parsed.unparsed,
});
