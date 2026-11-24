import { describe, expect, it } from 'vitest';
import {
  advance,
  canSend,
  checkMessage,
  dueFollowUp,
  EMAIL_RULES,
  mayEmail,
  OutreachTransitionError,
  personKeyOf,
  planFollowUps,
  stopFor,
  type OutreachTask,
} from '../src/shared/domain/outreach';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const task = (over: Partial<OutreachTask> = {}): OutreachTask => ({
  id: 'out:1',
  campaignId: 'camp:1',
  contactId: 'c:1',
  channel: 'linkedin-invite',
  state: 'sent',
  messageVersion: 1,
  followUps: planFollowUps(NOW),
  sentAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  history: [],
  ...over,
});

describe('person identity', () => {
  it('treats one LinkedIn profile as one person wherever they turn up', () => {
    expect(personKeyOf({ profileUrl: 'https://www.linkedin.com/in/asha-m/', name: 'Asha M', companyName: 'A' })).toBe(
      personKeyOf({ profileUrl: 'https://linkedin.com/in/asha-m?x=1', name: 'Asha Mehta', companyName: 'B' }),
    );
  });

  it('falls back to name and employer when there is no profile link', () => {
    expect(personKeyOf({ name: 'Asha Mehta', companyName: 'Razorpay' })).toBe(
      personKeyOf({ name: 'ASHA  MEHTA', companyName: 'Razorpay' }),
    );
  });
});

describe('outreach states', () => {
  it('only sends what has been approved', () => {
    expect(canSend('approved')).toBe(true);
    expect(canSend('draft-ready')).toBe(false);
    expect(canSend('ranked')).toBe(false);
  });

  it('refuses a jump that would skip approval', () => {
    expect(() => advance(task({ state: 'draft-ready' }), 'sent', 'no')).toThrow(OutreachTransitionError);
  });

  it('records why each change happened', () => {
    const t = advance(task(), 'accepted', 'They accepted the invitation.', NOW + 1);
    expect(t.history.at(-1)).toMatchObject({ from: 'sent', to: 'accepted', reason: 'They accepted the invitation.' });
  });

  it('cancels scheduled follow-ups the moment someone replies', () => {
    const t = advance(task({ nextFollowUpAt: NOW + DAY }), 'replied', 'They replied.', NOW + 1);
    expect(t.nextFollowUpAt).toBeUndefined();
    expect(t.stopReason).toContain('replied');
    expect(dueFollowUp(t, NOW + 10 * DAY)).toBeUndefined();
  });

  it('sends nothing further to someone who opted out', () => {
    const t = advance(task(), 'opted-out', 'They asked not to be contacted.', NOW + 1);
    expect(dueFollowUp(t, NOW + 10 * DAY)).toBeUndefined();
  });
});

describe('stop rules', () => {
  it('treats a reply as a stop and brings it to the person', () => {
    const r = stopFor('reply');
    expect(r.state).toBe('replied');
    expect(r.needsYou).toBe(true);
  });

  it('does not treat an out-of-office as a reply, and waits for their return', () => {
    const back = NOW + 5 * DAY;
    const r = stopFor('out-of-office', { returnAt: back });
    expect(r.state).toBe('sent');
    expect(r.postponeUntil).toBe(back);
    expect(r.needsYou).toBeUndefined();
  });

  it('suppresses an opt-out everywhere, not just on this campaign', () => {
    expect(stopFor('opt-out').suppressEverywhere).toBe(true);
  });

  it('stops the address on a bounce', () => {
    expect(stopFor('bounce').state).toBe('bounced');
  });
});

describe('follow-up cadence', () => {
  it('plans one follow-up around day 3 and a final around day 7', () => {
    const plan = planFollowUps(NOW);
    expect(plan).toHaveLength(2);
    expect(plan[0]!.dueAt).toBe(NOW + 3 * DAY);
    expect(plan[1]!.dueAt).toBe(NOW + 7 * DAY);
  });

  it('does not fire a follow-up before it is due', () => {
    expect(dueFollowUp(task(), NOW + DAY)).toBeUndefined();
    expect(dueFollowUp(task(), NOW + 4 * DAY)?.sequence).toBe(1);
  });
});

describe('message checks', () => {
  it('flags an opening that could have been sent to anyone', () => {
    const r = checkMessage('Hi Asha, I hope this message finds you well. I would like to connect.', { recipientName: 'Asha Mehta' });
    expect(r.ok).toBe(false);
    expect(r.warnings.join(' ')).toContain('template');
  });

  it('flags a figure the profile does not support', () => {
    const r = checkMessage('Hi Asha, I grew retention 40% at my last role.', { recipientName: 'Asha', evidence: ['grew activation 12%'] });
    expect(r.unsupportedClaims).toContain('40%');
  });

  it('accepts a figure the profile backs up', () => {
    const r = checkMessage('Hi Asha, I grew activation 12% on the payments team.', {
      recipientName: 'Asha',
      evidence: ['grew activation 12% on payments'],
    });
    expect(r.unsupportedClaims).toHaveLength(0);
  });

  it('notices the message never uses their name', () => {
    expect(checkMessage('Hello, I saw the product role.', { recipientName: 'Asha Mehta' }).warnings.join(' ')).toContain('their name');
  });

  it('reports going over the channel limit', () => {
    expect(checkMessage('x'.repeat(320), { limit: 300 }).warnings.join(' ')).toContain('limit is 300');
  });
});

describe('email provenance', () => {
  it('never sends to an address guessed from a pattern', () => {
    expect(EMAIL_RULES.likely.canSend).toBe(false);
    expect(mayEmail('likely', 'send-verified')).toBe(false);
  });

  it('sends to a sourced address only once the person enabled sending', () => {
    expect(mayEmail('verified', 'send-verified')).toBe(true);
    expect(mayEmail('verified', 'draft')).toBe(false);
  });

  it('takes no email action without an address', () => {
    expect(EMAIL_RULES.unknown.canDraft).toBe(false);
  });
});
