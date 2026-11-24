import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDatabase, closeDatabase } from '../src/storage/database';
import { read, write } from '../src/storage/state';

/**
 * The gate that stands between the product and somebody's inbox.
 *
 * Nothing else in the extension can cause mail to leave: the page may only click Send after this approves the
 * exact address sitting in the compose window. These tests are the specification of that promise.
 */

const INTENT_KEY = 'gmail-intent';

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', onMessage: { addListener: () => undefined } },
    tabs: { query: async () => [], create: async () => ({ id: 1 }), sendMessage: async () => ({ ok: true, data: {} }) },
    scripting: { executeScript: async () => [] },
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearDatabase();
  await closeDatabase();
});

const load = async () => (await import('../src/background/gmail')).authorizeSend;

const intent = (over: Record<string, unknown> = {}) => ({
  id: 'intent-1',
  to: 'asha@razorpay.com',
  outreachId: 'out:1',
  at: Date.now(),
  ...over,
});

describe('the send gate', () => {
  it('approves the address it issued the intent for', async () => {
    const authorizeSend = await load();
    await write(INTENT_KEY, intent());
    expect(await authorizeSend('intent-1', 'asha@razorpay.com', true)).toBe(true);
  });

  it('refuses a different recipient, even with the right intent', async () => {
    const authorizeSend = await load();
    await write(INTENT_KEY, intent());
    // This is the case that matters: the compose window was changed after the draft was prepared.
    expect(await authorizeSend('intent-1', 'someone.else@razorpay.com', true)).toBe(false);
  });

  it('ignores case and stray spacing in the address', async () => {
    const authorizeSend = await load();
    await write(INTENT_KEY, intent());
    expect(await authorizeSend('intent-1', '  ASHA@Razorpay.com ', true)).toBe(true);
  });

  it('refuses an intent id it did not issue', async () => {
    const authorizeSend = await load();
    await write(INTENT_KEY, intent());
    expect(await authorizeSend('made-up', 'asha@razorpay.com', true)).toBe(false);
  });

  it('refuses when there is no intent at all', async () => {
    const authorizeSend = await load();
    expect(await authorizeSend('intent-1', 'asha@razorpay.com', true)).toBe(false);
  });

  it('refuses an intent older than two minutes', async () => {
    const authorizeSend = await load();
    await write(INTENT_KEY, intent({ at: Date.now() - 130_000 }));
    expect(await authorizeSend('intent-1', 'asha@razorpay.com', true)).toBe(false);
  });

  it('spends an intent once, so a replayed message cannot send a second copy', async () => {
    const authorizeSend = await load();
    await write(INTENT_KEY, intent());
    expect(await authorizeSend('intent-1', 'asha@razorpay.com', true)).toBe(true);
    expect(await authorizeSend('intent-1', 'asha@razorpay.com', true)).toBe(false);
  });

  it('marks the intent claimed when it approves', async () => {
    const authorizeSend = await load();
    await write(INTENT_KEY, intent());
    await authorizeSend('intent-1', 'asha@razorpay.com', true);
    expect(await read<{ claimed?: boolean }>(INTENT_KEY)).toMatchObject({ claimed: true });
  });

  it('does not claim anything when it refuses', async () => {
    const authorizeSend = await load();
    await write(INTENT_KEY, intent());
    await authorizeSend('intent-1', 'wrong@example.com', true);
    expect(await read<{ claimed?: boolean }>(INTENT_KEY)).not.toMatchObject({ claimed: true });
  });
});

describe('what may be sent at all', () => {
  it('never sends to an address guessed from a company pattern', async () => {
    const { sendMail } = await import('../src/background/gmail');
    await expect(
      sendMail({ to: 'a.mehta@razorpay.com', subject: 'Hello', body: 'Hi', confidence: 'likely' }, 'out:1', 'send-verified'),
    ).rejects.toThrow(/Confirm before sending/i);
  });

  it('never sends when the campaign has sending switched off', async () => {
    const { sendMail } = await import('../src/background/gmail');
    await expect(
      sendMail({ to: 'asha@razorpay.com', subject: 'Hello', body: 'Hi', confidence: 'verified' }, 'out:1', 'off'),
    ).rejects.toThrow();
    await expect(
      sendMail({ to: 'asha@razorpay.com', subject: 'Hello', body: 'Hi', confidence: 'verified' }, 'out:1', 'draft'),
    ).rejects.toThrow();
  });

  it('refuses to draft anything for an address it does not have', async () => {
    const { draftMail } = await import('../src/background/gmail');
    await expect(draftMail({ to: '', subject: 'Hello', body: 'Hi', confidence: 'unknown' })).rejects.toThrow(/No defensible address/i);
  });

  it('will draft to an unverified address, since a draft reaches nobody', async () => {
    const { draftMail } = await import('../src/background/gmail');
    // The stubbed tab replies ok, so this resolves; the point is that it is not refused outright.
    await expect(draftMail({ to: 'a.mehta@razorpay.com', subject: 'Hello', body: 'Hi', confidence: 'likely' })).resolves.toBeDefined();
  });
});

describe('the search it runs', () => {
  it('asks only for a narrow slice of the mailbox', async () => {
    const { searchQuery } = await import('../src/shared/gmail');
    const q = searchQuery({ label: 'Referral-Scout', sinceDays: 14, from: ['asha@razorpay.com'] });
    expect(q).toContain('label:Referral-Scout');
    expect(q).toContain('newer_than:14d');
    expect(q).toContain('from:asha@razorpay.com');
    expect(q).toContain('-in:chats');
  });

  it('never builds a query that would read everything', async () => {
    const { searchQuery } = await import('../src/shared/gmail');
    expect(searchQuery({ sinceDays: 7 })).toBe('newer_than:7d -in:chats');
  });
});
