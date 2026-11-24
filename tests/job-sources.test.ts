import { describe, expect, it, vi } from 'vitest';
import {
  linkedinAdapter,
  naukriAdapter,
  parseCompensation,
  parseEmploymentType,
  parsePosted,
  parseSeniority,
  parseWorkMode,
  registry,
  searchAll,
  toJob,
  userUrlAdapter,
  type Health,
  type RawJobCard,
  type SearchQuery,
} from '../src/connectors/job-sources';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const query: SearchQuery = { terms: ['product intern'], location: 'India' };
const signal = new AbortController().signal;

const card = (over: Partial<RawJobCard> = {}): RawJobCard => ({
  title: 'Product Operations Intern',
  company: 'Razorpay',
  location: 'Bengaluru, India',
  url: 'https://www.linkedin.com/jobs/view/123',
  ...over,
});

const ready = async (): Promise<Health> => ({ state: 'ready', message: 'Signed in.', lastCheckedAt: NOW });

describe('parsing what boards write', () => {
  it('reads relative posting dates', () => {
    expect(parsePosted('3 days ago', NOW)).toBe(NOW - 3 * DAY);
    expect(parsePosted('2 weeks ago', NOW)).toBe(NOW - 14 * DAY);
  });

  it('leaves an unreadable date undefined rather than calling it today', () => {
    expect(parsePosted('Posted recently', NOW)).toBeUndefined();
    expect(parsePosted(undefined, NOW)).toBeUndefined();
  });

  it('keeps the original pay text beside the numbers it parsed', () => {
    const c = parseCompensation('₹25,000 - ₹30,000 /month')!;
    expect(c.min).toBe(25000);
    expect(c.max).toBe(30000);
    expect(c.currency).toBe('INR');
    expect(c.period).toBe('month');
    expect(c.raw).toContain('25,000');
  });

  it('understands Indian pay scales', () => {
    expect(parseCompensation('12 LPA')!.min).toBe(1_200_000);
  });

  it('reads employment type and work mode, and admits when it cannot', () => {
    expect(parseEmploymentType('Internship')).toBe('internship');
    expect(parseEmploymentType('Something odd')).toBe('unknown');
    expect(parseWorkMode('Remote (India)')).toBe('remote');
    expect(parseWorkMode('Bengaluru')).toBe('unknown');
  });

  it('reads seniority from the title', () => {
    expect(parseSeniority('Senior Product Manager')).toBe('senior');
    expect(parseSeniority('Product Operations Intern')).toBe('intern');
    expect(parseSeniority('Product Manager')).toBe('unknown');
  });
});

describe('normalisation', () => {
  it('produces a canonical job with its provenance', () => {
    const { job, provenance } = toJob(
      'linkedin',
      'LinkedIn Jobs',
      card({ postedText: '3 days ago' }),
      undefined,
      { type: 'easy-apply', effort: 'low' },
      NOW,
    );
    expect(job.companyName).toBe('Razorpay');
    expect(job.seniority).toBe('intern');
    expect(job.employmentType).toBe('internship');
    expect(job.postedAt).toBe(NOW - 3 * DAY);
    expect(provenance).toMatchObject({ source: 'linkedin', retrievedAt: NOW, url: card().url });
  });

  it('never claims a job is open just because its card was seen', () => {
    const { job } = toJob('linkedin', 'LinkedIn Jobs', card(), undefined, { type: 'unknown', effort: 'unknown' }, NOW);
    expect(job.availability).toBe('unknown');
  });

  it('hashes the description so two listings can be told apart', () => {
    const a = toJob('linkedin', 'L', card(), { description: 'Build things' }, { type: 'ats', effort: 'medium' }, NOW).job;
    const b = toJob('linkedin', 'L', card(), { description: 'Build other things' }, { type: 'ats', effort: 'medium' }, NOW).job;
    expect(a.descriptionHash).not.toBe(b.descriptionHash);
  });
});

describe('apply routes', () => {
  it('recognises Easy Apply as the low-effort route', () => {
    const a = linkedinAdapter(async () => [], ready);
    expect(a.resolveApplyRoute(card({ snippet: 'Easy Apply' }), undefined)).toMatchObject({ type: 'easy-apply', effort: 'low' });
  });

  it('recognises a known ATS host', () => {
    const a = linkedinAdapter(async () => [], ready);
    const route = a.resolveApplyRoute(card({ url: 'https://boards.greenhouse.io/acme/jobs/1' }), undefined);
    expect(route.type).toBe('ats');
    expect(route.atsHost).toContain('greenhouse');
  });

  it('says unknown rather than guessing for an unrecognised site', () => {
    const a = linkedinAdapter(async () => [], ready);
    expect(a.resolveApplyRoute(card({ url: 'https://acme.example/careers/1' }), undefined).type).toBe('unknown');
  });
});

describe('the LinkedIn adapter', () => {
  it('searches each planned term and drops repeats of one job', async () => {
    const collect = vi.fn(async () => [card(), card({ url: 'https://www.linkedin.com/jobs/view/456' })]);
    const a = linkedinAdapter(collect, ready);
    const found = await a.search({ terms: ['product intern', 'ops intern'], location: 'India' }, signal);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(found).toHaveLength(2);
  });

  it('respects a result limit so one board cannot swamp the pool', async () => {
    const collect = async () => Array.from({ length: 10 }, (_, i) => card({ url: `https://www.linkedin.com/jobs/view/${i}` }));
    const found = await linkedinAdapter(collect, ready).search({ ...query, limit: 4 }, signal);
    expect(found).toHaveLength(4);
  });
});

describe('sources that are not connected yet', () => {
  it('reports its state honestly instead of pretending to search', async () => {
    const health = await naukriAdapter().healthCheck();
    expect(health.state).toBe('not-implemented');
    expect(health.message).toContain('not connected yet');
  });

  it('still normalises a job the person opens from that site', () => {
    const { job } = naukriAdapter().normalise(card({ url: 'https://www.naukri.com/job-listings-1' }), undefined, NOW);
    expect(job.sourceName).toBe('Naukri');
  });

  it('accepts a job the person pasted in and records that they chose it', () => {
    const { provenance } = userUrlAdapter().normalise(card({ url: 'https://acme.example/jobs/9' }), undefined, NOW);
    expect(provenance.query).toBe('Added by you');
  });
});

describe('running sources together', () => {
  it('keeps going when one source fails, and reports which one', async () => {
    const good = linkedinAdapter(async () => [card()], ready);
    const bad = {
      ...linkedinAdapter(async () => [], ready),
      id: 'wellfound' as const,
      name: 'Wellfound',
      search: async () => {
        throw new Error('Wellfound timed out.');
      },
    };
    const runs = await searchAll([good, bad], query, signal);
    expect(runs.find(r => r.source === 'linkedin')!.cards).toHaveLength(1);
    const failed = runs.find(r => r.source === 'wellfound')!;
    expect(failed.health.state).toBe('unavailable');
    expect(failed.error).toContain('timed out');
  });

  it('skips a source that is not ready without calling its search', async () => {
    const search = vi.fn(async () => [card()]);
    const offline = {
      ...linkedinAdapter(search, async () => ({ state: 'needs-sign-in' as const, message: 'Sign in to LinkedIn.', lastCheckedAt: NOW })),
    };
    const runs = await searchAll([offline], query, signal);
    expect(search).not.toHaveBeenCalled();
    expect(runs[0]!.health.state).toBe('needs-sign-in');
  });

  it('builds a registry the campaign can filter down to chosen sources', () => {
    const list = registry({ collectLinkedin: async () => [], linkedinHealth: ready, enabled: ['linkedin', 'naukri'] });
    expect(list.map(a => a.id)).toEqual(['linkedin', 'naukri']);
  });
});
