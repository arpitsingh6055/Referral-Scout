import { describe, expect, it } from 'vitest';
import {
  answerFor,
  canReuse,
  completeness,
  equivalent,
  isStale,
  makeFact,
  matchLabel,
  migrateProfile,
  statusOf,
  type CandidateFact,
} from '../src/shared/domain/facts';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const fact = (over: Partial<CandidateFact> & Pick<CandidateFact, 'canonicalKey' | 'value'>): CandidateFact => ({
  ...makeFact({ canonicalKey: over.canonicalKey, value: over.value, source: 'user', now: NOW }),
  ...over,
});

describe('matching a form label to a known fact', () => {
  it('merges the wordings of one fact', () => {
    for (const label of ['PIN code', 'Postal code', 'ZIP / Post code', 'Pincode *']) expect(matchLabel(label)?.key).toBe('pincode');
  });

  it('keeps current and expected pay apart', () => {
    expect(matchLabel('Current CTC')?.key).toBe('current_ctc');
    expect(matchLabel('Expected CTC')?.key).toBe('expected_ctc');
    expect(equivalent('Current CTC', 'Expected CTC')).toBe(false);
    expect(equivalent('Expected salary', 'Salary expectations')).toBe(true);
  });

  it('does not answer questions about somebody else from the person’s own facts', () => {
    expect(matchLabel('Referrer email')).toBeUndefined();
    expect(matchLabel('Emergency contact phone number')).toBeUndefined();
    expect(matchLabel('Manager name')).toBeUndefined();
  });

  it('separates where the person lives from where the job is', () => {
    expect(matchLabel('Current city')?.key).toBe('city');
    expect(matchLabel('Preferred work location')?.key).toBe('preferred_location');
    expect(equivalent('Current city', 'Preferred job location')).toBe(false);
  });

  it('leaves an unrecognised question unmatched rather than guessing', () => {
    expect(matchLabel('What is your favourite Razorpay product and why does it matter to merchants?')).toBeUndefined();
  });

  it('never merges two questions it does not recognise, even when they read the same', () => {
    expect(equivalent('Describe your Series B experience', 'Describe your Series B experience')).toBe(false);
  });
});

describe('reuse scope', () => {
  it('refuses an Indian work-authorisation answer on a United States role', () => {
    const f = fact({ canonicalKey: 'work_authorization', value: 'Indian citizen', scope: 'country', scopeValue: 'India' });
    const v = canReuse(f, { country: 'United States', now: NOW });
    expect(v.use).toBe(false);
    if (!v.use) expect(v.reason).toContain('India');
  });

  it('reuses it on another Indian role', () => {
    const f = fact({ canonicalKey: 'work_authorization', value: 'Indian citizen', scope: 'country', scopeValue: 'India' });
    expect(canReuse(f, { country: 'India', now: NOW }).use).toBe(true);
  });

  it('will not fill a declaration that came from a CV rather than from the person', () => {
    const f = fact({ canonicalKey: 'disability', value: 'No', source: 'cv', confidence: 1 });
    const v = canReuse(f, { now: NOW });
    expect(v.use).toBe(false);
    if (!v.use) expect(v.reason).toContain('never taken from your CV');
  });

  it('treats a low-confidence value as a suggestion, not an answer', () => {
    expect(canReuse(fact({ canonicalKey: 'city', value: 'Pune', source: 'model', confidence: 0.6 }), { now: NOW }).use).toBe(false);
  });

  it('asks again for a fact that has gone out of date', () => {
    const f = fact({ canonicalKey: 'notice_period', value: '30 days', verifiedAt: NOW - 200 * DAY, expiresAt: NOW - DAY });
    expect(isStale(f, NOW)).toBe(true);
    expect(canReuse(f, { now: NOW }).use).toBe(false);
  });

  it('prefers the most specific saved answer that fits', () => {
    const global = fact({ canonicalKey: 'expected_ctc', value: '₹20,000 / month', scope: 'global' });
    const campaign = fact({
      ...global,
      id: 'c',
      canonicalKey: 'expected_ctc',
      value: '₹25,000 / month',
      scope: 'campaign',
      scopeValue: 'camp:1',
    });
    const v = answerFor('Expected stipend', [global, campaign], { campaignId: 'camp:1', now: NOW });
    expect(v.use).toBe(true);
    if (v.use) expect(v.fact.value).toBe('₹25,000 / month');
  });

  it('tells the person which fact a form field was matched to', () => {
    const v = answerFor('ZIP / Post code', [fact({ canonicalKey: 'pincode', value: '411014' })], { now: NOW });
    expect(v.use).toBe(true);
    if (v.use) expect(v.matchedAs).toBe('PIN / postal code');
  });
});

describe('completeness', () => {
  it('counts the core facts, not every optional one', () => {
    const c = completeness([fact({ canonicalKey: 'email', value: 'a@b.com' }), fact({ canonicalKey: 'phone', value: '99999' })], NOW);
    expect(c.complete).toBe(2);
    expect(c.total).toBeLessThan(20);
    expect(c.missing).toContain('pincode');
  });

  it('treats an out-of-date fact as not complete', () => {
    const stale = fact({ canonicalKey: 'notice_period', value: '30 days', verifiedAt: NOW - 400 * DAY, expiresAt: NOW - DAY });
    expect(statusOf(stale, NOW)).toBe('stale');
    expect(completeness([stale], NOW).missing).toContain('notice_period');
  });
});

describe('migration from the old profile', () => {
  const profile = {
    details: {
      phone: '9999900000',
      email: 'a@b.com',
      pincode: '411014',
      currentCtc: '₹6 LPA',
      expectedCtc: '₹10 LPA',
      workAuthorization: 'Indian citizen',
    },
    answers: {
      'what is your postal code': '411014',
      'why are you interested in this role': 'A long written answer about the role and the team.',
    },
  };

  it('brings saved details across as verified facts', () => {
    const { facts } = migrateProfile(profile, 'India', NOW);
    const byKey = Object.fromEntries(facts.map(f => [f.canonicalKey, f]));
    expect(byKey.phone!.value).toBe('9999900000');
    expect(byKey.phone!.source).toBe('user');
    expect(byKey.current_ctc!.value).toBe('₹6 LPA');
    expect(byKey.expected_ctc!.value).toBe('₹10 LPA');
  });

  it('scopes work authorisation to the country it was given for', () => {
    const { facts } = migrateProfile(profile, 'India', NOW);
    const auth = facts.find(f => f.canonicalKey === 'work_authorization')!;
    expect(auth.scope).toBe('country');
    expect(auth.scopeValue).toBe('India');
  });

  it('leaves written answers tied to their question rather than promoting them', () => {
    const { facts, keptAnswers } = migrateProfile(profile, 'India', NOW);
    expect(facts.some(f => f.canonicalKey === 'why_this_role')).toBe(false);
    expect(keptAnswers['why are you interested in this role']).toBeTruthy();
  });

  it('does not lose an old answer it could not classify', () => {
    const { keptAnswers } = migrateProfile({ answers: { 'how did you hear about us': 'LinkedIn' } }, 'India', NOW);
    expect(keptAnswers['how did you hear about us']).toBe('LinkedIn');
  });
});
