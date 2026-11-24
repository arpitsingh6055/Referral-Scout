import { describe, expect, it } from 'vitest';
import {
  canonicalCompany,
  canonicalJobUrl,
  checkEligibility,
  dedupeKey,
  freshnessOf,
  normalizeTitle,
  qualify,
  rankScore,
  scoreFit,
  scorePreferences,
  type CandidateRequirements,
  type Job,
} from '../src/shared/domain/job';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const job = (over: Partial<Job> = {}): Job => ({
  id: 'job:1',
  sourceId: '1',
  sourceName: 'linkedin',
  canonicalUrl: 'https://www.linkedin.com/jobs/view/1',
  alternateUrls: [],
  duplicateGroupId: 'g1',
  companyName: 'Razorpay',
  title: 'Product Operations Intern',
  normalizedTitle: 'product operations',
  seniority: 'intern',
  employmentType: 'internship',
  location: 'Bengaluru, India',
  workMode: 'onsite',
  observedAt: NOW,
  availability: 'open',
  requirements: [],
  responsibilities: [],
  applyType: 'ats',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const me = (over: Partial<CandidateRequirements> = {}): CandidateRequirements => ({
  authorisedIn: ['India'],
  skills: [],
  preferredLocations: [],
  preferredWorkModes: [],
  preferredEmploymentTypes: [],
  ...over,
});

describe('canonical identity', () => {
  it('treats one employer written several ways as one employer', () => {
    expect(canonicalCompany('Razorpay Pvt Ltd')).toBe(canonicalCompany('RAZORPAY'));
    expect(canonicalCompany('Acme Technologies Private Limited')).toBe(canonicalCompany('Acme'));
  });

  it('keeps different employers apart', () => {
    expect(canonicalCompany('Swiggy')).not.toBe(canonicalCompany('Zomato'));
  });

  it('strips tracking from a job link so one vacancy is one link', () => {
    expect(canonicalJobUrl('https://www.linkedin.com/jobs/view/123/?refId=abc&trk=xyz')).toBe(
      canonicalJobUrl('https://linkedin.com/jobs/view/123'),
    );
  });

  it('keeps the job id when the board puts it in the query', () => {
    expect(canonicalJobUrl('https://boards.greenhouse.io/x?gh_jid=99&utm_source=li')).toContain('gh_jid=99');
  });

  it('ignores decoration in a title but not the role itself', () => {
    expect(normalizeTitle('Product Operations Intern (Remote)')).toBe(normalizeTitle('Product Operations'));
    expect(normalizeTitle('Business Analyst')).not.toBe(normalizeTitle('Product Analyst'));
  });
});

describe('deduplication', () => {
  it('uses the source job id when both came from one source', () => {
    expect(dedupeKey({ company: 'A', title: 'B', location: 'C', source: 'naukri', sourceJobId: '7' })).toBe('naukri:7');
  });

  it('falls back to the canonical URL before the fingerprint', () => {
    const key = dedupeKey({ company: 'A', title: 'B', location: 'C', canonicalUrl: 'https://x.com/jobs/1' });
    expect(key.startsWith('url:')).toBe(true);
  });

  it('merges the same vacancy carried by two boards', () => {
    const a = { company: 'Razorpay Pvt Ltd', title: 'Product Operations Intern', location: 'Bengaluru, Karnataka, India' };
    const b = { company: 'Razorpay', title: 'Product Operations Intern (Remote)', location: 'Bengaluru' };
    expect(dedupeKey(a)).toBe(dedupeKey(b));
  });

  it('keeps two genuinely different openings at one employer apart', () => {
    const a = { company: 'Swiggy', title: 'Business Analyst Intern', location: 'Bengaluru' };
    const b = { company: 'Swiggy', title: 'Product Design Intern', location: 'Bengaluru' };
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });

  it('keeps an internship and a full-time role of the same name apart', () => {
    const a = { company: 'X', title: 'Analyst', location: 'Pune', employmentType: 'internship' as const };
    const b = { company: 'X', title: 'Analyst', location: 'Pune', employmentType: 'full-time' as const };
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });
});

describe('hard eligibility', () => {
  it('does not turn silence about sponsorship into eligibility', () => {
    const r = checkEligibility(job({ location: 'Berlin, Germany' }), me({ authorisedIn: ['India'] }));
    expect(r.state).toBe('unknown');
    expect(r.checks.find(c => c.key === 'work-authorisation')!.state).toBe('unknown');
  });

  it('blocks a role that says it cannot sponsor when the person needs sponsorship', () => {
    const r = checkEligibility(
      job({ location: 'Austin, United States', description: 'We are unable to sponsor visas for this role.' }),
      me({ authorisedIn: ['India'], needsSponsorship: true }),
    );
    expect(r.state).toBe('ineligible');
  });

  it('passes a role in a country the person may work in', () => {
    expect(checkEligibility(job(), me({ authorisedIn: ['India'] })).state).toBe('eligible');
  });

  it('blocks a role asking for far more experience than the person has', () => {
    const r = checkEligibility(job({ requirements: ['8+ years experience in product'] }), me({ yearsExperience: 1 }));
    expect(r.state).toBe('ineligible');
  });

  it('does not block a role asking for one year more than the person has', () => {
    const r = checkEligibility(job({ requirements: ['3+ years experience in product'] }), me({ yearsExperience: 2 }));
    expect(r.checks.find(c => c.key === 'experience')!.state).toBe('eligible');
  });

  it('blocks a closed posting', () => {
    expect(checkEligibility(job({ availability: 'closed' }), me()).state).toBe('ineligible');
  });

  it('blocks an employment type the person is not looking for', () => {
    const r = checkEligibility(job({ employmentType: 'contract' }), me({ preferredEmploymentTypes: ['internship'] }));
    expect(r.state).toBe('ineligible');
  });
});

describe('fit', () => {
  it('counts requirements the profile answers and names what matched', () => {
    const r = scoreFit(job({ requirements: ['SQL and analytics', 'Stakeholder communication'] }), me({ skills: ['SQL', 'Python'] }));
    expect(r.fit).toBe(50);
    expect(r.evidence[0]!.state).toBe('met');
    expect(r.evidence[1]!.state).toBe('missing');
  });

  it('separates a requirement with nothing to match from one the profile contradicts', () => {
    const r = scoreFit(job({ requirements: ['Kubernetes'] }), me({ skills: ['SQL'] }));
    // 'missing' means not found in the profile, which the card must not word as "you lack this".
    expect(r.evidence[0]!.state).toBe('missing');
  });

  it('explains preference mismatches rather than silently lowering a score', () => {
    const r = scorePreferences(
      job({ location: 'Gurugram, India', workMode: 'onsite' }),
      me({ preferredLocations: ['Pune'], preferredWorkModes: ['remote'] }),
    );
    expect(r.score).toBe(0);
    expect(r.notes.join(' ')).toContain('Gurugram');
  });
});

describe('qualification', () => {
  it('never calls an ineligible job a strong match, however well it fits', () => {
    const q = qualify(job({ availability: 'closed', requirements: ['SQL'] }), me({ skills: ['SQL'] }), NOW);
    expect(q.eligibility).toBe('ineligible');
    expect(q.tier).toBe('blocked');
    expect(q.rejectionReasons.length).toBeGreaterThan(0);
  });

  it('keeps a well-matched open role as strong', () => {
    const q = qualify(
      job({ requirements: ['SQL', 'analytics'], postedAt: NOW - DAY, description: 'x' }),
      me({ skills: ['SQL', 'analytics'], preferredLocations: ['Bengaluru'] }),
      NOW,
    );
    expect(q.tier).toBe('strong');
  });

  it('marks an old posting stale and keeps it out of the strong tier', () => {
    expect(freshnessOf({ postedAt: NOW - 90 * DAY, availability: 'open' }, NOW)).toBe('stale');
    const q = qualify(job({ requirements: ['SQL'], postedAt: NOW - 90 * DAY }), me({ skills: ['SQL'] }), NOW);
    expect(q.tier).not.toBe('strong');
  });

  it('leaves freshness unknown rather than guessing when no date was published', () => {
    expect(freshnessOf({ availability: 'unknown' }, NOW)).toBe('unknown');
  });
});

describe('ranking', () => {
  it('refuses to rank a blocked job at all', () => {
    const blocked = job({ qualification: qualify(job({ availability: 'closed' }), me(), NOW) });
    expect(rankScore(blocked, NOW)).toBe(-1);
  });

  it('puts a better-fitting role above an easier but weaker one', () => {
    const strong = job({
      effort: 'high',
      qualification: qualify(job({ requirements: ['SQL', 'analytics'], postedAt: NOW }), me({ skills: ['SQL', 'analytics'] }), NOW),
    });
    const easy = job({
      effort: 'low',
      qualification: qualify(job({ requirements: ['SQL', 'kubernetes'], postedAt: NOW }), me({ skills: ['SQL'] }), NOW),
    });
    expect(rankScore(strong, NOW)).toBeGreaterThan(rankScore(easy, NOW));
  });

  it('uses low effort as a tie-breaker between comparable jobs', () => {
    const q = qualify(job({ requirements: ['SQL'], postedAt: NOW }), me({ skills: ['SQL'] }), NOW);
    expect(rankScore(job({ effort: 'low', qualification: q }), NOW)).toBeGreaterThan(
      rankScore(job({ effort: 'high', qualification: q }), NOW),
    );
  });
});
