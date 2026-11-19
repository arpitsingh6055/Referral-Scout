/**
 * The seeker's own background, as ChatGPT should see it when judging job fit: their full LinkedIn profile (every
 * section the extension read - About, Experience, Education, Skills, Certifications, Projects...) and their CV.
 * A qualification label alone is misleading: an MBA who spent five years in sales, or a B.Tech who moved into
 * marketing, fits jobs that the degree alone would not suggest. So the ranking gets the whole picture.
 *
 * Each section has its own budget, so a long Experience section cannot push Education or Skills out of the prompt.
 */
import { detectSpecializations } from './specializations';

export interface SeekerSource {
  headline?: string | undefined;
  location?: string | undefined;
  about?: string | undefined;
  /** Section title (lower case) -> text, when stored. */
  sections?: Record<string, string> | undefined;
  /** "Name\nHeadline\nLocation\n\nABOUT\n...\n\nEXPERIENCE\n..." as stored by the profile reader. */
  rawText?: string | undefined;
  cvText?: string | undefined;
}

/** The profile's sections, from the stored map or recovered from the stored raw text. */
export function profileSections(src: SeekerSource): Record<string, string> {
  if (src.sections && Object.keys(src.sections).length) return src.sections;
  const out: Record<string, string> = {};
  const blocks = (src.rawText ?? '').split(/\n\s*\n/).slice(1); // the first block is name / headline / location
  for (const block of blocks) {
    const [title, ...rest] = block.split('\n');
    const text = rest.join(' ').replace(/\s+/g, ' ').trim();
    if (title && text && title.trim() === title.trim().toUpperCase() && /[A-Z]/.test(title)) out[title.trim().toLowerCase()] = text;
  }
  return out;
}

// Most decision-relevant first; every section not listed still gets a small share.
const BUDGETS: [RegExp, number][] = [
  [/^about/, 1200],
  [/^experience/, 3000],
  [/^education/, 1000],
  [/licen|certif/, 500],
  [/^skills?/, 600],
  [/^projects?/, 700],
];
const OTHER_BUDGET = 300;

/**
 * Plain-text evidence about the seeker for a ChatGPT prompt. The person's name is left out: it says nothing about fit.
 * Returns '' when there is nothing to go on, so the prompt can say so instead of guessing.
 */
export function seekerEvidence(src: SeekerSource, max = 9000): string {
  const parts: string[] = [];
  if (src.headline?.trim()) parts.push(`HEADLINE: ${src.headline.trim()}`);
  if (src.location?.trim()) parts.push(`LOCATION: ${src.location.trim()}`);
  const sections = profileSections(src);
  const keys = Object.keys(sections);
  const used = new Set<string>();
  for (const [pattern, budget] of BUDGETS)
    for (const key of keys)
      if (!used.has(key) && pattern.test(key)) {
        used.add(key);
        parts.push(`${key.toUpperCase()}: ${sections[key]!.slice(0, budget)}`);
      }
  for (const key of keys) if (!used.has(key)) parts.push(`${key.toUpperCase()}: ${sections[key]!.slice(0, OTHER_BUDGET)}`);
  if (!keys.length && src.about?.trim()) parts.push(`ABOUT: ${src.about.trim().slice(0, 1500)}`);
  const cv = (src.cvText ?? '').replace(/\s+/g, ' ').trim();
  if (cv) parts.push(`CV: ${cv.slice(0, 3000)}`);
  return parts.join('\n').slice(0, max);
}

/**
 * Qualifications to pre-tick, read from where people actually list them: the headline, the Education and
 * Certifications sections, and the CV. Experience text is left out on purpose, so "mentored MBA interns" or
 * "worked with CA firms" does not make someone an MBA or a CA.
 */
export function suggestSpecializationsFromProfile(src: SeekerSource): string[] {
  const sections = profileSections(src);
  const study = Object.entries(sections)
    .filter(([key]) => /educat|licen|certif/.test(key))
    .map(([, text]) => text);
  return detectSpecializations([src.headline ?? '', ...study, src.cvText ?? ''].join('\n'));
}
