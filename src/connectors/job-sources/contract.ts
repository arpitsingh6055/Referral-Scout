/**
 * The job-source adapter contract (specification 7.3).
 *
 * Every source sits behind the same six operations so the discovery engine never knows which board it is talking
 * to. The reason is in specification 26.1: one site changing its markup must not break the campaign. An adapter
 * that fails reports its own health and is skipped; the others carry on.
 *
 * Two contract rules are load-bearing. `checkAvailability` may return `unknown` and must never invent `closed` —
 * a job wrongly marked closed is silently dropped from the person's search. And `normalise` returns provenance
 * with every record, because a job whose origin cannot be shown cannot be trusted or re-checked.
 */

import type { ApplyType, Availability, Compensation, EmploymentType, Job, Seniority, WorkMode } from '../../shared/domain/job';

export type SourceId = 'linkedin' | 'internshala' | 'naukri' | 'instahyre' | 'wellfound' | 'user-url';

export interface SearchQuery {
  terms: string[];
  location: string;
  employmentType?: EmploymentType;
  workMode?: WorkMode;
  seniority?: Seniority;
  postedWithinDays?: number;
  /** How many results this source should return at most, so one board cannot swamp the pool. */
  limit?: number;
}

/** What a board gives before normalisation: whatever it happens to carry, nothing assumed. */
export interface RawJobCard {
  sourceJobId?: string;
  title: string;
  company: string;
  location?: string;
  url: string;
  postedText?: string;
  postedAt?: number;
  snippet?: string;
  compensationText?: string;
  employmentTypeText?: string;
  /** Anything source-specific worth keeping for the detail read. */
  extra?: Record<string, string>;
}

export interface JobDetails {
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  compensation?: Compensation;
  employmentType?: EmploymentType;
  workMode?: WorkMode;
  durationMonths?: number;
  deadline?: number;
  applyType?: ApplyType;
  applyUrl?: string;
  atsHost?: string;
}

export interface Provenance {
  source: SourceId;
  sourceName: string;
  query?: string;
  retrievedAt: number;
  url: string;
}

export type HealthState = 'ready' | 'needs-sign-in' | 'rate-limited' | 'unavailable' | 'not-implemented';

export interface Health {
  state: HealthState;
  /** Said in the person's words, because this appears on the sources screen. */
  message: string;
  lastCheckedAt: number;
  lastSuccessAt?: number;
}

export interface ApplyRoute {
  type: ApplyType;
  url?: string;
  atsHost?: string;
  effort: 'low' | 'medium' | 'high' | 'unknown';
}

export interface SourceAdapter {
  id: SourceId;
  name: string;
  /** Hosts this adapter needs access to, requested only when the person turns the source on. */
  hosts: string[];
  search(query: SearchQuery, signal: AbortSignal): Promise<RawJobCard[]>;
  readDetails(card: RawJobCard, signal: AbortSignal): Promise<JobDetails>;
  normalise(card: RawJobCard, details: JobDetails | undefined, now?: number): { job: Job; provenance: Provenance };
  checkAvailability(card: RawJobCard, signal: AbortSignal): Promise<{ state: Availability; observedAt: number }>;
  resolveApplyRoute(card: RawJobCard, details: JobDetails | undefined): ApplyRoute;
  healthCheck(): Promise<Health>;
}

/* ---------- shared helpers every adapter may use ---------- */
export const hashText = (text: string): string => {
  // A small non-cryptographic hash, used only to tell two descriptions apart for deduplication.
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};

const RELATIVE = /(\d+)\s*(minute|hour|day|week|month)s?\s*ago/i;
const UNIT_MS: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 };

/** Boards write dates as "3 days ago" or "Posted 2 weeks ago". Anything unparseable stays undefined, not today. */
export function parsePosted(text: string | undefined, now = Date.now()): number | undefined {
  if (!text) return undefined;
  if (/just now|today|hours? ago|minutes? ago/i.test(text) && !RELATIVE.test(text)) return now;
  const m = RELATIVE.exec(text);
  if (m) {
    const unit = UNIT_MS[m[2]!.toLowerCase()];
    if (unit) return now - Number(m[1]) * unit;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const CURRENCY: Record<string, string> = { '₹': 'INR', $: 'USD', '£': 'GBP', '€': 'EUR' };

/**
 * Reads a pay range out of the text a board shows. The original string is always kept beside the numbers: a
 * parsed figure that nobody can check against the source is worse than no figure at all.
 */
export function parseCompensation(text: string | undefined): Compensation | undefined {
  if (!text?.trim()) return undefined;
  const raw = text.trim();
  const symbol = Object.keys(CURRENCY).find(s => raw.includes(s));
  const currency = symbol ? CURRENCY[symbol] : /\bINR|\bRs\.?/i.test(raw) ? 'INR' : undefined;
  const period: Compensation['period'] = /month|\/mo\b|p\.?m\b/i.test(raw)
    ? 'month'
    : /year|annum|\/yr\b|p\.?a\b|lpa/i.test(raw)
      ? 'year'
      : /hour|\/hr\b/i.test(raw)
        ? 'hour'
        : undefined;
  const scale = /lakh|lpa|\bL\b/i.test(raw) ? 100_000 : /crore/i.test(raw) ? 10_000_000 : 1;
  const numbers = [...raw.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)]
    .map(m => Number(m[1]!.replace(/,/g, '')) * scale)
    .filter(n => Number.isFinite(n));
  return {
    ...(numbers.length ? { min: Math.min(...numbers) } : {}),
    ...(numbers.length > 1 ? { max: Math.max(...numbers) } : numbers.length ? { max: numbers[0]! } : {}),
    ...(currency ? { currency } : {}),
    ...(period ? { period } : {}),
    raw,
  };
}

export function parseEmploymentType(text: string | undefined): EmploymentType {
  if (!text) return 'unknown';
  if (/intern/i.test(text)) return 'internship';
  if (/part[\s-]?time/i.test(text)) return 'part-time';
  if (/contract|temporary|freelance/i.test(text)) return 'contract';
  if (/graduate (programme|program)|trainee programme/i.test(text)) return 'graduate-programme';
  if (/full[\s-]?time|permanent/i.test(text)) return 'full-time';
  return 'unknown';
}

export function parseWorkMode(text: string | undefined): WorkMode {
  if (!text) return 'unknown';
  if (/\bremote\b|work from home|\bwfh\b/i.test(text)) return 'remote';
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\bon[\s-]?site\b|\bin[\s-]?office\b/i.test(text)) return 'onsite';
  return 'unknown';
}

export function parseSeniority(title: string): Seniority {
  if (/\bintern(ship)?\b|\btrainee\b/i.test(title)) return 'intern';
  if (/\b(lead|head|principal|director|vp)\b/i.test(title)) return 'lead';
  if (/\b(senior|sr\.?|staff)\b/i.test(title)) return 'senior';
  if (/\b(junior|jr\.?|associate|graduate|entry|fresher)\b/i.test(title)) return 'entry';
  return 'unknown';
}

export const notImplemented = (name: string, now = Date.now()): Health => ({
  state: 'not-implemented',
  message: `${name} discovery is not connected yet. Jobs from this source can still be applied for if you open them yourself.`,
  lastCheckedAt: now,
});

/* ---------- running several sources at once ---------- */
export interface SourceRun {
  source: SourceId;
  cards: RawJobCard[];
  health: Health;
  error?: string;
}

/**
 * Searches every enabled source and returns what each one gave. A thrown adapter becomes a failed run with its
 * message, never a rejected promise: the campaign must survive one board being down, which is the whole reason
 * these sit behind a contract.
 */
export async function searchAll(adapters: readonly SourceAdapter[], query: SearchQuery, signal: AbortSignal): Promise<SourceRun[]> {
  return Promise.all(
    adapters.map(async (adapter): Promise<SourceRun> => {
      const now = Date.now();
      try {
        const health = await adapter.healthCheck();
        if (health.state !== 'ready') return { source: adapter.id, cards: [], health };
        const cards = await adapter.search(query, signal);
        return { source: adapter.id, cards, health: { ...health, lastSuccessAt: now } };
      } catch (e) {
        const message = e instanceof Error ? e.message : 'This source could not be searched.';
        return {
          source: adapter.id,
          cards: [],
          health: { state: 'unavailable', message, lastCheckedAt: now },
          error: message,
        };
      }
    }),
  );
}
