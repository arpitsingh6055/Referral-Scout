import { describe, expect, it } from 'vitest';
import {
  allocate,
  EMAIL_RULES,
  mayEmail,
  priorityOf,
  scoreContact,
  summarise,
  type ContactCandidate,
} from '../src/shared/scoring/allocator';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const contact = (over: Partial<ContactCandidate> & Pick<ContactCandidate, 'id' | 'companyId'>): ContactCandidate => ({
  personKey: over.id,
  name: 'Someone',
  company: over.companyId,
  role: 'Product',
  relationship: 'none',
  roleRelation: 'same-function',
  opportunityFit: 80,
  opportunityFreshness: 0.8,
  evidenceConfidence: 0.9,
  channel: 'linkedin',
  ...over,
});

describe('scoring', () => {
  it('explains every part of the score rather than showing a bare number', () => {
    const b = scoreContact(contact({ id: 'a', companyId: 'razorpay', relationship: 'alumni' }));
    expect(b.parts.map(p => p.label)).toEqual(['Relationship', 'Role relevance', 'Hiring relevance', 'Opportunity fit', 'Evidence']);
    for (const p of b.parts) expect(p.why).toBeTruthy();
    expect(b.total).toBeGreaterThan(0);
  });

  it('ranks the recruiter who owns this job above a general alumni contact', () => {
    const recruiter = scoreContact(contact({ id: 'r', companyId: 'x', relationship: 'none', roleRelation: 'recruiter-for-job' }));
    const alum = scoreContact(contact({ id: 'a', companyId: 'x', relationship: 'alumni', roleRelation: 'unrelated' }));
    expect(recruiter.total).toBeGreaterThan(alum.total);
  });

  it('ranks a close alumnus on the hiring team above both', () => {
    const best = scoreContact(contact({ id: 'b', companyId: 'x', relationship: 'existing-connection', roleRelation: 'same-team' }));
    const recruiter = scoreContact(contact({ id: 'r', companyId: 'x', relationship: 'none', roleRelation: 'recruiter-for-job' }));
    expect(best.total).toBeGreaterThan(recruiter.total);
  });

  it('marks a general TA contact with no tie as low priority', () => {
    const weak = scoreContact(
      contact({
        id: 'w',
        companyId: 'x',
        relationship: 'none',
        roleRelation: 'general-recruiter',
        opportunityFit: 50,
        evidenceConfidence: 0.4,
      }),
    );
    expect(priorityOf(weak.total)).toBe('P3');
  });

  it('lowers the score when the evidence is thin', () => {
    const sure = scoreContact(contact({ id: 's', companyId: 'x', evidenceConfidence: 1 }));
    const unsure = scoreContact(contact({ id: 'u', companyId: 'x', evidenceConfidence: 0.2 }));
    expect(sure.total).toBeGreaterThan(unsure.total);
  });
});

describe('allocation across companies', () => {
  const rules = { weeklyBudget: 3, spent: 0, maxPerCompany: 3, diminishingHours: 48, now: NOW };

  it('gives every company its best contact before any company gets a second', () => {
    const list = [
      contact({ id: 'a1', companyId: 'A', relationship: 'existing-connection', roleRelation: 'same-team' }),
      contact({ id: 'a2', companyId: 'A', relationship: 'alumni', roleRelation: 'same-function' }),
      contact({ id: 'a3', companyId: 'A', relationship: 'alumni', roleRelation: 'same-function' }),
      contact({ id: 'b1', companyId: 'B', relationship: 'second-degree', roleRelation: 'recruiter-for-job' }),
      contact({ id: 'c1', companyId: 'C', relationship: 'none', roleRelation: 'general-recruiter' }),
    ];
    const allocated = allocate(list, rules).filter(a => a.status === 'allocated');
    expect(allocated.map(a => a.contact.id).sort()).toEqual(['a1', 'b1', 'c1']);
  });

  it('does not spend the whole budget at one employer', () => {
    const list = Array.from({ length: 5 }, (_, i) => contact({ id: `a${i}`, companyId: 'A', relationship: 'existing-connection' }));
    const allocated = allocate(list, { ...rules, weeklyBudget: 5 }).filter(a => a.status === 'allocated');
    expect(allocated).toHaveLength(3);
  });

  it('holds the second contact at a company until the first has had time to answer', () => {
    const list = [
      contact({ id: 'a1', companyId: 'A', relationship: 'existing-connection' }),
      contact({ id: 'a2', companyId: 'A', relationship: 'alumni', lastApproachAtCompany: NOW - 2 * HOUR }),
    ];
    const result = allocate(list, { ...rules, weeklyBudget: 10 });
    const second = result.find(a => a.contact.id === 'a2')!;
    expect(second.status).toBe('held');
    expect(second.reason).toContain('holding');
  });

  it('lets a pinned company take its second contact straight away', () => {
    const list = [
      contact({ id: 'a1', companyId: 'A', relationship: 'existing-connection' }),
      contact({ id: 'a2', companyId: 'A', relationship: 'alumni', lastApproachAtCompany: NOW - 2 * HOUR }),
    ];
    const result = allocate(list, { ...rules, weeklyBudget: 10, pinned: ['A'] });
    expect(result.find(a => a.contact.id === 'a2')!.status).toBe('allocated');
  });

  it('keeps researching and drafting when the budget is gone', () => {
    const list = [contact({ id: 'a', companyId: 'A' }), contact({ id: 'b', companyId: 'B' })];
    const result = allocate(list, { ...rules, weeklyBudget: 1 });
    expect(result.filter(a => a.status === 'allocated')).toHaveLength(1);
    const held = result.find(a => a.status === 'held')!;
    expect(held.reason).toContain('budget is spent');
  });

  it('leaves out a contact with no way to reach them', () => {
    expect(allocate([contact({ id: 'a', companyId: 'A', channel: 'none' })], rules)).toHaveLength(0);
  });

  it('reports the budget honestly, counting what was already spent', () => {
    const result = allocate([contact({ id: 'a', companyId: 'A' })], { ...rules, weeklyBudget: 10, spent: 4 });
    expect(summarise(result, { weeklyBudget: 10, spent: 4 })).toMatchObject({ weekly: 10, allocated: 5, remaining: 5 });
  });
});

describe('email addresses', () => {
  it('will not send to an address guessed from a pattern', () => {
    expect(EMAIL_RULES.likely.canSend).toBe(false);
    expect(mayEmail('likely', 'send-verified')).toBe(false);
  });

  it('sends to a sourced address only when the person turned sending on', () => {
    expect(mayEmail('verified', 'send-verified')).toBe(true);
    expect(mayEmail('verified', 'draft')).toBe(false);
    expect(mayEmail('verified', 'off')).toBe(false);
  });

  it('takes no email action at all without an address', () => {
    expect(EMAIL_RULES.unknown.canDraft).toBe(false);
  });
});
