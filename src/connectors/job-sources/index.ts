/**
 * The source registry, and the adapters behind it.
 *
 * LinkedIn is the one that actually searches today: it wraps the existing discovery flow, which already knows how
 * to read job cards. The other four are declared with honest health states rather than left out. That matters for
 * two reasons — the sources screen can show the person exactly what is and is not connected, and the work of
 * adding a board later is writing one adapter rather than threading a new code path through the engine.
 *
 * Recognising a host for form-filling is not the same as discovering jobs from it. The application engine already
 * handles Naukri and Wellfound pages the person opens; that is why their adapters report `not-implemented` for
 * search instead of pretending to be connected.
 */

import { jobsSearchUrl } from '../../shared/jobsearch';
import { normalizeTitle, type Availability, type Job } from '../../shared/domain/job';
import {
  hashText,
  notImplemented,
  parseCompensation,
  parseEmploymentType,
  parsePosted,
  parseSeniority,
  parseWorkMode,
  type ApplyRoute,
  type Health,
  type JobDetails,
  type Provenance,
  type RawJobCard,
  type SearchQuery,
  type SourceAdapter,
  type SourceId,
} from './contract';

export * from './contract';

/** Shared normalisation: every adapter produces the same canonical record from whatever its board gave. */
export function toJob(
  source: SourceId,
  sourceName: string,
  card: RawJobCard,
  details: JobDetails | undefined,
  route: ApplyRoute,
  now = Date.now(),
): { job: Job; provenance: Provenance } {
  const description = details?.description;
  const postedAt = card.postedAt ?? parsePosted(card.postedText, now);
  const employmentType = details?.employmentType ?? parseEmploymentType(`${card.employmentTypeText ?? ''} ${card.title}`);
  const workMode = details?.workMode ?? parseWorkMode(`${card.location ?? ''} ${card.snippet ?? ''}`);
  const compensation = details?.compensation ?? parseCompensation(card.compensationText);

  const job: Job = {
    id: `job:${source}:${card.sourceJobId ?? hashText(card.url)}`,
    sourceId: card.sourceJobId ?? hashText(card.url),
    sourceName,
    canonicalUrl: card.url,
    alternateUrls: [],
    duplicateGroupId: '',
    companyName: card.company,
    title: card.title,
    normalizedTitle: normalizeTitle(card.title),
    seniority: parseSeniority(card.title),
    employmentType,
    location: card.location ?? '',
    workMode,
    ...(details?.durationMonths !== undefined ? { durationMonths: details.durationMonths } : {}),
    ...(compensation ? { compensation } : {}),
    ...(postedAt ? { postedAt } : {}),
    observedAt: now,
    ...(details?.deadline ? { deadline: details.deadline } : {}),
    // Seeing a card is not evidence the vacancy is open; only an explicit check can say that.
    availability: 'unknown',
    ...(description ? { description, descriptionHash: hashText(description) } : {}),
    requirements: details?.requirements ?? [],
    responsibilities: details?.responsibilities ?? [],
    applyType: route.type,
    ...(route.url ? { applyUrl: route.url } : {}),
    ...(route.atsHost ? { atsHost: route.atsHost } : {}),
    effort: route.effort,
    createdAt: now,
    updatedAt: now,
  };
  return { job, provenance: { source, sourceName, retrievedAt: now, url: card.url } };
}

const ATS_HOST =
  /(greenhouse|lever|workday|myworkdayjobs|ashby|smartrecruiters|icims|taleo|successfactors|oraclecloud|jobvite|workable|zohorecruit|keka|darwinbox)/i;

function routeFor(card: RawJobCard, details: JobDetails | undefined): ApplyRoute {
  if (details?.applyType)
    return {
      type: details.applyType,
      ...(details.applyUrl ? { url: details.applyUrl } : {}),
      ...(details.atsHost ? { atsHost: details.atsHost } : {}),
      effort: details.applyType === 'easy-apply' ? 'low' : 'medium',
    };
  const target = details?.applyUrl ?? card.url;
  const host = (() => {
    try {
      return new URL(target).host;
    } catch {
      return '';
    }
  })();
  const ats = ATS_HOST.exec(host)?.[1];
  if (ats) return { type: 'ats', url: target, atsHost: host, effort: 'medium' };
  return { type: 'unknown', url: target, effort: 'unknown' };
}

/* ---------- LinkedIn ---------- */
/**
 * Wraps the discovery that already exists. The search itself runs in the content script against the person's own
 * signed-in session, so this adapter builds the query and reports health; the cards come back through the
 * existing flow rather than through a fetch from the background, which LinkedIn would refuse anyway.
 */
export const linkedinAdapter = (
  collect: (url: string, query: SearchQuery, signal: AbortSignal) => Promise<RawJobCard[]>,
  probe: () => Promise<Health>,
): SourceAdapter => ({
  id: 'linkedin',
  name: 'LinkedIn Jobs',
  hosts: ['https://www.linkedin.com/*'],
  async search(query, signal) {
    const cards: RawJobCard[] = [];
    const seen = new Set<string>();
    for (const term of query.terms.slice(0, 6)) {
      signal.throwIfAborted();
      for (const card of await collect(jobsSearchUrl(term, query.location), query, signal)) {
        if (seen.has(card.url)) continue;
        seen.add(card.url);
        cards.push(card);
      }
      if (query.limit && cards.length >= query.limit) break;
    }
    return query.limit ? cards.slice(0, query.limit) : cards;
  },
  async readDetails() {
    // The job description is read from the page by the content script when the application opens it.
    return {};
  },
  normalise(card, details, now) {
    return toJob('linkedin', 'LinkedIn Jobs', card, details, this.resolveApplyRoute(card, details), now);
  },
  async checkAvailability(card) {
    // Nothing here can see the page, so the honest answer is unknown. Guessing "closed" would drop a live job.
    void card;
    return { state: 'unknown' as Availability, observedAt: Date.now() };
  },
  resolveApplyRoute(card, details) {
    if (/easy apply/i.test(`${card.snippet ?? ''} ${card.extra?.applyType ?? ''}`))
      return { type: 'easy-apply', url: card.url, effort: 'low' };
    return routeFor(card, details);
  },
  healthCheck: probe,
});

/* ---------- sources declared but not yet searching ---------- */
function placeholder(id: SourceId, name: string, hosts: string[]): SourceAdapter {
  return {
    id,
    name,
    hosts,
    async search() {
      throw new Error(`${name} discovery is not connected yet.`);
    },
    async readDetails() {
      return {};
    },
    normalise(card, details, now) {
      return toJob(id, name, card, details, routeFor(card, details), now);
    },
    async checkAvailability() {
      return { state: 'unknown' as Availability, observedAt: Date.now() };
    },
    resolveApplyRoute(card, details) {
      return routeFor(card, details);
    },
    async healthCheck() {
      return notImplemented(name);
    },
  };
}

export const internshalaAdapter = (): SourceAdapter => placeholder('internshala', 'Internshala', ['https://internshala.com/*']);
export const naukriAdapter = (): SourceAdapter => placeholder('naukri', 'Naukri', ['https://www.naukri.com/*']);
export const instahyreAdapter = (): SourceAdapter => placeholder('instahyre', 'Instahyre', ['https://www.instahyre.com/*']);
export const wellfoundAdapter = (): SourceAdapter => placeholder('wellfound', 'Wellfound', ['https://wellfound.com/*']);

/* ---------- a job the person pasted in ---------- */
/**
 * One URL the person supplied. It reads only that page, and its provenance says the person chose it — which is
 * what distinguishes it from a scrape and is why it needs no source-wide host permission.
 */
export const userUrlAdapter = (): SourceAdapter => ({
  id: 'user-url',
  name: 'Job you added',
  hosts: [],
  async search() {
    return [];
  },
  async readDetails() {
    return {};
  },
  normalise(card, details, now) {
    const result = toJob('user-url', 'Job you added', card, details, routeFor(card, details), now);
    return { ...result, provenance: { ...result.provenance, query: 'Added by you' } };
  },
  async checkAvailability() {
    return { state: 'unknown' as Availability, observedAt: Date.now() };
  },
  resolveApplyRoute(card, details) {
    return routeFor(card, details);
  },
  async healthCheck() {
    return { state: 'ready', message: 'Paste a job link and it is added to the queue.', lastCheckedAt: Date.now() };
  },
});

export interface RegistryOptions {
  collectLinkedin: (url: string, query: SearchQuery, signal: AbortSignal) => Promise<RawJobCard[]>;
  linkedinHealth: () => Promise<Health>;
  enabled?: SourceId[];
}

export function registry(options: RegistryOptions): SourceAdapter[] {
  const all: SourceAdapter[] = [
    linkedinAdapter(options.collectLinkedin, options.linkedinHealth),
    internshalaAdapter(),
    naukriAdapter(),
    instahyreAdapter(),
    wellfoundAdapter(),
    userUrlAdapter(),
  ];
  return options.enabled ? all.filter(a => options.enabled!.includes(a.id)) : all;
}
