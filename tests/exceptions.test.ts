import { describe, expect, it } from 'vitest';
import {
  groupKey,
  inboxCounts,
  openOnly,
  raise,
  resolve,
  sortInbox,
  waitingApplications,
  type ApplicationException,
} from '../src/shared/domain/exceptions';

const NOW = 1_700_000_000_000;
const base = { campaignId: 'camp:1', now: NOW };

describe('grouping', () => {
  it('asks a recurring fact once across every application waiting for it', () => {
    let list: ApplicationException[] = [];
    for (const [i, company] of ['Razorpay', 'Swiggy', 'Microsoft'].entries()) {
      const label = ['What is your PIN code?', 'Postal code', 'ZIP / Post code'][i]!;
      list = raise(list, { ...base, applicationId: `app:${i}`, company, title: 'Intern', kind: 'reusable-fact', prompt: label }).list;
    }
    expect(list).toHaveLength(1);
    expect(list[0]!.affected).toHaveLength(3);
    expect(list[0]!.canonicalKey).toBe('pincode');
    expect(list[0]!.matchedAs).toBe('PIN / postal code');
  });

  it('keeps current and expected pay as two separate questions', () => {
    let list: ApplicationException[] = [];
    list = raise(list, { ...base, applicationId: 'a', company: 'A', title: 'T', kind: 'reusable-fact', prompt: 'Current CTC' }).list;
    list = raise(list, { ...base, applicationId: 'a', company: 'A', title: 'T', kind: 'reusable-fact', prompt: 'Expected CTC' }).list;
    expect(list).toHaveLength(2);
  });

  it('asks work authorisation again when the country changes', () => {
    let list: ApplicationException[] = [];
    list = raise(list, {
      ...base,
      applicationId: 'a',
      company: 'A',
      title: 'T',
      kind: 'reusable-fact',
      prompt: 'Are you authorised to work?',
      country: 'India',
    }).list;
    list = raise(list, {
      ...base,
      applicationId: 'b',
      company: 'B',
      title: 'T',
      kind: 'reusable-fact',
      prompt: 'Are you authorised to work?',
      country: 'United States',
    }).list;
    expect(list).toHaveLength(2);
  });

  it('never groups a question it does not recognise', () => {
    let list: ApplicationException[] = [];
    const prompt = 'Which of our products would you change first?';
    list = raise(list, { ...base, applicationId: 'a', company: 'A', title: 'T', kind: 'written-review', prompt }).list;
    list = raise(list, { ...base, applicationId: 'b', company: 'B', title: 'T', kind: 'written-review', prompt }).list;
    expect(list).toHaveLength(2);
  });

  it('does not list the same application twice on one question', () => {
    let list: ApplicationException[] = [];
    list = raise(list, { ...base, applicationId: 'a', company: 'A', title: 'T', kind: 'reusable-fact', prompt: 'PIN code' }).list;
    list = raise(list, { ...base, applicationId: 'a', company: 'A', title: 'T', kind: 'reusable-fact', prompt: 'Postal code' }).list;
    expect(list[0]!.affected).toHaveLength(1);
  });

  it('separates a sign-in step per application, since each portal needs its own', () => {
    const a = groupKey({ kind: 'auth', applicationId: 'a', prompt: 'Sign in', scope: 'job' });
    const b = groupKey({ kind: 'auth', applicationId: 'b', prompt: 'Sign in', scope: 'job' });
    expect(a).not.toBe(b);
  });
});

describe('order and counts', () => {
  const list: ApplicationException[] = [
    {
      id: '1',
      campaignId: 'c',
      kind: 'written-review',
      applicationId: 'a',
      prompt: 'Why this role?',
      affected: [{ applicationId: 'a', company: 'A', title: 'T' }],
      scope: 'job',
      status: 'open',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: '2',
      campaignId: 'c',
      kind: 'submission-uncertain',
      applicationId: 'b',
      prompt: 'Did this submit?',
      affected: [{ applicationId: 'b', company: 'B', title: 'T' }],
      scope: 'job',
      status: 'open',
      createdAt: NOW + 10,
      updatedAt: NOW,
    },
    {
      id: '3',
      campaignId: 'c',
      kind: 'reusable-fact',
      applicationId: 'c',
      prompt: 'PIN code',
      canonicalKey: 'pincode',
      affected: [{ applicationId: 'c', company: 'C', title: 'T' }],
      scope: 'global',
      status: 'open',
      createdAt: NOW + 20,
      updatedAt: NOW,
    },
  ];

  it('puts a possibly-submitted application above everything else', () => {
    expect(sortInbox(list)[0]!.id).toBe('2');
  });

  it('puts an optional written review last', () => {
    expect(sortInbox(list).at(-1)!.id).toBe('1');
  });

  it('counts each blocked application once', () => {
    expect(waitingApplications(list)).toBe(3);
    expect(inboxCounts(list)).toMatchObject({ open: 3, urgent: 1, facts: 1, reviews: 1 });
  });
});

describe('resolving', () => {
  it('applies an answer only to the applications that asked for it', () => {
    const { item } = raise([], { ...base, applicationId: 'a', company: 'A', title: 'T', kind: 'reusable-fact', prompt: 'PIN code' });
    const withSecond = raise([item], {
      ...base,
      applicationId: 'b',
      company: 'B',
      title: 'T',
      kind: 'reusable-fact',
      prompt: 'Postal code',
    }).list[0]!;
    const done = resolve(withSecond, { value: '411014', applyTo: ['a', 'b', 'somebody-elses-app'], savedToBank: true });
    expect(done.resolution!.appliedTo).toEqual(['a', 'b']);
    expect(done.status).toBe('resolved');
  });

  it('lets the person apply the answer to only some of the waiting applications', () => {
    const { item } = raise([], { ...base, applicationId: 'a', company: 'A', title: 'T', kind: 'reusable-fact', prompt: 'PIN code' });
    const two = raise([item], { ...base, applicationId: 'b', company: 'B', title: 'T', kind: 'reusable-fact', prompt: 'PIN code' })
      .list[0]!;
    expect(resolve(two, { value: '411014', applyTo: ['a'], savedToBank: false }).resolution!.appliedTo).toEqual(['a']);
  });

  it('takes a resolved item out of the open inbox', () => {
    const { item } = raise([], { ...base, applicationId: 'a', company: 'A', title: 'T', kind: 'auth', prompt: 'Sign in' });
    expect(openOnly([resolve(item, { savedToBank: false })])).toHaveLength(0);
  });
});
