/**
 * Academic / professional specializations the seeker can mark so the job search PRIORITISES (never excludes) jobs
 * whose description calls for one of them. A job's description is read from LinkedIn and matched here; a match moves
 * the job to the top of the "choose companies" list and shows a badge. A job with no match is kept exactly as it was.
 *
 * Matching is deliberately two-tier to stay precise on a page full of prose:
 *  - `strong` patterns are unambiguous (full phrases, dotted abbreviations, distinctive ones like PGDM) and count
 *    anywhere in the text.
 *  - `weak` patterns are short, ambiguous abbreviations (CA, CPA) that count only when the text also reads like it is
 *    listing a qualification, so "CA" the US state or "CPA" the marketing metric does not wrongly flag a job.
 */
export interface Specialization {
  id: string;
  /** Full label shown in Settings. */
  label: string;
  /** Compact label shown on the job badge. */
  short: string;
  strong: RegExp[];
  weak?: RegExp[];
}

/** The text reads like it is stating a required/preferred qualification; gates the ambiguous abbreviations. */
const QUALIFICATION_CUE =
  /\b(qualif\w+|eligib\w+|degree|educational?|pursuing|cleared|appeared|intermediate|final[-\s]?year|graduat\w+|preferred|mandatory|required|ICAI|ICSI|ICWA|ICMAI)\b/i;

export const SPECIALIZATIONS: Specialization[] = [
  {
    id: 'mba',
    label: 'MBA / PGDM (management)',
    short: 'MBA/PGDM',
    strong: [
      /\bM\.?\s?B\.?\s?A\b/i,
      /\bP\.?\s?G\.?\s?D\.?\s?M\b/i,
      /\bPGP\b/,
      /post[-\s]?graduate diploma in management/i,
      /master(?:'s)?\s+(?:of|in)\s+business administration/i,
    ],
  },
  {
    id: 'btech-cs',
    label: 'B.Tech / B.E. — CSE / IT / circuit (ECE, EEE)',
    short: 'B.Tech CS/IT',
    strong: [
      // a degree word followed closely by a software/circuit branch
      /\b(?:B\.?\s?Tech|B\.?\s?E\.?\b|M\.?\s?C\.?A|bachelor(?:'s)?(?:\s+of|\s+in)?\s+(?:technology|engineering|science))\b[^.\n]{0,55}\b(?:C\.?S\.?E?|computer science|information technology|E\.?C\.?E|E\.?E\.?E|electronics|electrical|communication)\b/i,
      /\b(?:computer science(?: & engineering| and engineering| engineering)?|information technology)\b/i,
      /\bCSE\b/,
    ],
  },
  {
    id: 'btech-other',
    label: 'B.Tech / B.E. — other branches (mechanical, civil…)',
    short: 'B.Tech/B.E.',
    strong: [
      /\bB\.?\s?Tech\b/i, // "BTech", "B Tech", "B.Tech" — "BTech" is not an ordinary word
      /\bB\.\s?E\.?\b/, // require the dot after B so the ordinary word "be" is never matched
      /bachelor(?:'s)?(?:\s+of|\s+in)?\s+(?:technology|engineering)\b/i,
    ],
  },
  {
    id: 'mtech',
    label: 'M.Tech / M.E.',
    short: 'M.Tech/M.E.',
    strong: [/\bM\.?\s?Tech\b/i, /\bM\.\s?E\.?\b/, /master(?:'s)?\s+(?:of|in)\s+(?:technology|engineering)\b/i],
  },
  {
    id: 'commerce',
    label: 'Commerce / Finance — CA, CS, CMA, B.Com',
    short: 'CA/CS/CMA',
    strong: [
      /chartered accountant/i,
      /company secretary/i,
      /cost (?:and management )?accountant/i,
      /\bICAI\b|\bICSI\b|\bICWA\b|\bICMAI\b/,
      /\bB\.?\s?Com\b/i,
      /\bM\.?\s?Com\b/i,
      /\bC\.?\s?M\.?\s?A\b/i,
      /\bC\.A\.\b/, // dotted form is unambiguous
    ],
    weak: [/\bCA\b/, /\bCS\b/],
  },
  {
    id: 'finance-cert',
    label: 'Finance certifications — CFA, FRM, CPA',
    short: 'CFA/FRM/CPA',
    strong: [/\bCFA\b/, /\bFRM\b/, /chartered financial analyst/i],
    weak: [/\bCPA\b/],
  },
];

export const specializationIds = new Set(SPECIALIZATIONS.map(s => s.id));

/**
 * Which of the selected specializations the given text (job title + description) calls for, as badge labels.
 * Empty when nothing is selected or nothing matches. Order follows SPECIALIZATIONS so badges read consistently.
 */
export function matchSpecializations(text: string, ids: readonly string[]): string[] {
  if (!ids.length || !text) return [];
  const picked = new Set(ids);
  const hasCue = QUALIFICATION_CUE.test(text);
  const out: string[] = [];
  for (const spec of SPECIALIZATIONS) {
    if (!picked.has(spec.id)) continue;
    const strong = spec.strong.some(r => r.test(text));
    const weak = hasCue && !!spec.weak?.some(r => r.test(text));
    if (strong || weak) out.push(spec.short);
  }
  return out;
}
