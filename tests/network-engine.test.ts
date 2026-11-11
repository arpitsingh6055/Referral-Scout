import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, emptyNetwork, type NetworkContact } from '../src/shared/network';
import { getNetwork, networkTick, updateNetwork } from '../src/background/network';
import { networkCommand, networkTab } from '../src/background/network-browser';
import { prepareInvitation } from '../src/background/network-ai';
import { clearDatabase, closeDatabase } from '../src/storage/database';

vi.mock('../src/background/network-ai', () => ({ clearAiJobs: vi.fn(), prepareInvitation: vi.fn().mockResolvedValue('AI note'), prepareIntroduction: vi.fn().mockResolvedValue('AI intro'), prepareDossier: vi.fn().mockResolvedValue('dossier') }));
vi.mock('../src/background/network-browser', () => ({ networkCommand: vi.fn(), networkTab: vi.fn().mockResolvedValue(9), readyNetworkTab: vi.fn(), showWorkTab: vi.fn(), openWorkTab: vi.fn().mockResolvedValue(9) }));

const me = { name: 'Arpit Singh', url: 'https://www.linkedin.com/in/arpit45/', headline: 'PGDM', location: 'India', about: '' };
const card = (slug: string, headline: string, degree = 2) => ({ name: slug.replace(/-/g, ' '), url: `https://www.linkedin.com/in/${slug}/`, headline, location: 'Pune, Maharashtra, India', about: '', degree });
const person = (slug: string, patch: Partial<NetworkContact> = {}): NetworkContact => ({ ...card(slug, 'Recruiter at Acme'), rawText: 'Recruiter at Acme', state: 'shortlisted', reason: 'Recruiting / people team', score: 100, addedAt: 1, checkedAt: 0, requestedAt: 0, messagedAt: 0, message: '', ...patch });
async function seed(patch: Partial<ReturnType<typeof emptyNetwork>> = {}, settings: Partial<typeof defaultSettings> = {}) {
  return updateNetwork(() => ({ ...emptyNetwork(), active: true, profile: me, ownerVerifiedAt: Date.now(), dossier: '', location: 'India', ...patch, settings: { ...defaultSettings, roles: ['Product Management internship'], ...settings } }));
}
const urls = () => vi.mocked(networkTab).mock.calls.map(c => new URL(String(c[0])));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 9, 11, 0, 0));
  vi.mocked(networkCommand).mockReset(); vi.mocked(networkTab).mockReset().mockResolvedValue(9); vi.mocked(prepareInvitation).mockClear();
  vi.stubGlobal('chrome', { runtime: { id: 'abc', onMessage: { addListener: vi.fn() } }, tabs: { sendMessage: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) }, alarms: { create: vi.fn() } });
});
afterEach(async () => { vi.useRealTimers(); await clearDatabase(); await closeDatabase(); vi.unstubAllGlobals(); });

it('searches with a boolean query and the 2nd/3rd-degree filter, then saves only people worth contacting', async () => {
  await seed({}, {});
  vi.mocked(networkCommand).mockResolvedValueOnce([
    card('good-recruiter', 'Talent Acquisition at Razorpay'),
    card('already-connected', 'Recruiter at Razorpay', 1),
    card('mba-student', 'MBA (HR) student at IMT Ghaziabad'),
    card('former-ceo', 'Former CEO at Acme'),
    card('assistant', 'Executive Assistant to the CEO'),
    card('founder', 'Co-Founder at Acme Labs', 3),
    card('engineer', 'Software Engineer at Google'),
  ]);
  await networkTick();
  const url = urls()[0]!;
  expect(url.pathname).toBe('/search/results/people/');
  expect(url.searchParams.get('keywords')).toContain('recruiter OR "talent acquisition"');
  expect(JSON.parse(url.searchParams.get('network')!)).toEqual(['S', 'O']);
  const saved = await getNetwork();
  expect(saved.contacts.map(c => c.name).sort()).toEqual(['Co Founder'.length ? 'founder' : '', 'good recruiter'].sort());
  expect(saved.contacts.find(c => c.name === 'good recruiter')).toMatchObject({ state: 'shortlisted', category: 'recruiter', companyName: 'Razorpay' });
  expect(saved.status).toMatch(/saved 2 new people, skipped 5/);
});

it('never piles more than three people from one company onto the shortlist', async () => {
  await seed({}, {});
  vi.mocked(networkCommand).mockResolvedValueOnce(['a', 'b', 'c', 'd', 'e'].map(n => card(`rec-${n}`, 'Recruiter at Acme')));
  await networkTick();
  expect((await getNetwork()).contacts).toHaveLength(3);
});


it('explains itself and does not search when the daily limit is reached', async () => {
  const sent = Array.from({ length: 15 }, (_, i) => ({ at: Date.now() - 1000 * (i + 1), kind: 'connect' as const, url: `https://www.linkedin.com/in/s${i}/`, confirmed: true }));
  await seed({ contacts: [person('next')], actions: sent });
  await networkTick();
  expect(networkTab).not.toHaveBeenCalled();
  expect((await getNetwork()).status).toMatch(/Daily invitation limit reached \(15\)/);
});

it('stops searching while plenty of people are already queued', async () => {
  await seed({ contacts: Array.from({ length: 16 }, (_, i) => person(`q${i}`)), nextActionAt: Date.now() + 3_600_000 });
  await networkTick();
  expect(networkTab).not.toHaveBeenCalled();
});

it('waits quietly outside the active hours and says so', async () => {
  vi.setSystemTime(new Date(2026, 10, 9, 3, 0, 0));
  await seed({ contacts: [person('night')] });
  await networkTick();
  expect(networkTab).not.toHaveBeenCalled();
  expect((await getNetwork()).status).toMatch(/Quiet hours: outreach resumes at 08:00/);
});

it('uses the invitation template without ChatGPT when the person chose templates, and queues it for review', async () => {
  await seed({ contacts: [person('review-me', { companyName: 'Acme' })], target: 'Product Management internship' }, { noteMode: 'preferred' });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' });
  await networkTick();
  const p = (await getNetwork()).contacts[0]!;
  expect(prepareInvitation).not.toHaveBeenCalled();
  expect(p.state).toBe('review');
  expect(p.invitationNote).toMatch(/^Hi review.*Arpit.*Acme/);
  expect(p.invitationNote!.length).toBeLessThanOrEqual(200);
});

it('falls back to the template when ChatGPT personalisation fails, instead of stopping the campaign', async () => {
  vi.mocked(prepareInvitation).mockRejectedValueOnce(new Error('ChatGPT is signed out'));
  await seed({ contacts: [person('fallback')], dossier: 'dossier' }, { aiMode: 'chatgpt', noteMode: 'preferred' });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' });
  await networkTick();
  const saved = await getNetwork();
  expect(saved.active).toBe(true);
  expect(saved.contacts[0]).toMatchObject({ state: 'review' });
  expect(saved.contacts[0]!.invitationNote).toMatch(/^Hi fallback/);
});

it('skips one unusable profile and keeps the campaign running', async () => {
  await seed({ contacts: [person('follow-only'), person('second', { score: 50 })] }, { outreachMode: 'automatic', noteMode: 'none' });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' }).mockRejectedValueOnce(new Error('Connect is unavailable on this recipient profile.'));
  await networkTick();
  const saved = await getNetwork();
  expect(saved.active).toBe(true);
  expect(saved.contacts.find(c => c.name === 'follow only')).toMatchObject({ state: 'skipped' });
  expect(saved.actions).toHaveLength(0);
});

it('pauses, without losing the person, when LinkedIn reports the weekly invitation limit', async () => {
  await seed({ contacts: [person('limit')] }, { outreachMode: 'automatic', noteMode: 'none' });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' }).mockRejectedValueOnce(new Error('HALT: LinkedIn weekly invitation limit reached'));
  await networkTick();
  const saved = await getNetwork();
  expect(saved.active).toBe(false);
  expect(saved.status).toMatch(/weekly invitation limit/i);
  expect(saved.contacts[0]).toMatchObject({ state: 'shortlisted' });
});

// ---- audit follow-ups: cursors, failure isolation, pacing, expiry
const at = (minutes: number) => vi.setSystemTime(new Date(2026, 10, 9, 11, 0, 0).getTime() + minutes * 60000);


it('a page that cannot be read does not stop the campaign; the person is retried later, then set aside', async () => {
  await seed({ contacts: [person('flaky', { score: 100 }), person('fine', { score: 50 })] });
  vi.mocked(networkCommand).mockRejectedValue(new Error('LinkedIn took too long to respond. Open the contact to check what happened.'));
  await networkTick();
  let saved = await getNetwork();
  expect(saved.active).toBe(true);
  expect(saved.contacts.find(c => c.name === 'flaky')).toMatchObject({ failures: 1, state: 'shortlisted' });
  expect(saved.status).toMatch(/Could not process flaky.*Moving on/);
  // the retry delay moves the next attempt to the other person instead of looping on the same one
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' });
  at(5); await networkTick();
  expect(vi.mocked(networkCommand).mock.calls.at(-1)![1]).toMatchObject({ url: 'https://www.linkedin.com/in/fine/' });
});

it('sets a person aside after two failed attempts', async () => {
  await seed({ contacts: [person('stubborn')] });
  vi.mocked(networkCommand).mockRejectedValue(new Error('The profile header is not available yet.'));
  await networkTick(); at(31); await networkTick();
  const p = (await getNetwork()).contacts[0]!;
  expect(p.state).toBe('attention'); expect(p.reason).toMatch(/Could not be processed twice/);
});

it('stops and says why when several pages in a row fail, since LinkedIn probably changed', async () => {
  await seed({ contacts: ['a', 'b', 'c', 'd'].map((n, i) => person(n, { score: 100 - i })) });
  vi.mocked(networkCommand).mockRejectedValue(new Error('The profile header is not available yet.'));
  for (let i = 0; i < 4; i++) { at(i); await networkTick(); }
  const saved = await getNetwork();
  expect(saved.active).toBe(false);
  expect(saved.status).toMatch(/3 LinkedIn pages in a row could not be handled/);
});

it('pauses straight away for account-level signals such as a checkpoint', async () => {
  await seed({ contacts: [person('x')] });
  vi.mocked(networkCommand).mockRejectedValue(new Error('HALT: CAPTCHA or checkpoint detected'));
  await networkTick();
  expect((await getNetwork()).active).toBe(false);
});

it('stops tracking an invitation after 30 days and tells the user how to withdraw it', async () => {
  const old = Date.now() - 31 * 86400000;
  await seed({ contacts: [person('silent', { state: 'pending', requestedAt: old, nextCheckAt: old })] });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'pending' });
  await networkTick();
  expect((await getNetwork()).contacts[0]).toMatchObject({ state: 'skipped', reason: expect.stringMatching(/No response after 30 days.*withdrawing/) });
});

it('spaces out acceptance checks instead of firing them back to back', async () => {
  const requested = Date.now() - 2 * 86400000;
  await seed({ contacts: [person('p1', { state: 'pending', requestedAt: requested, nextCheckAt: requested }), person('p2', { state: 'pending', requestedAt: requested, nextCheckAt: requested })] });
  vi.mocked(networkCommand).mockResolvedValue({ state: 'pending' });
  await networkTick(); await networkTick();           // the second tick comes straight after
  expect(vi.mocked(networkCommand)).toHaveBeenCalledTimes(1);
  expect((await getNetwork()).nextActionAt).toBeGreaterThan(Date.now() + 30000);
});

it('prunes action history older than 35 days', async () => {
  await seed({ actions: [{ at: Date.now() - 40 * 86400000, kind: 'connect', url: 'https://www.linkedin.com/in/old/', confirmed: true }, { at: Date.now() - 86400000, kind: 'connect', url: 'https://www.linkedin.com/in/new/', confirmed: true }] });
  expect((await getNetwork()).actions).toHaveLength(2);        // reading does not prune
  await updateNetwork(s => ({ ...s, status: 'x' }));
  expect((await getNetwork()).actions.map(a => a.url)).toEqual(['https://www.linkedin.com/in/new/']);
});

it('prefers LinkedIn\'s own "Current: role at company" line over guessing the employer from the headline', async () => {
  await seed();
  vi.mocked(networkCommand).mockResolvedValueOnce([{ ...card('scout', 'Tech Recruiter | Product & Engineering Hiring'), current: 'Recruiter at LotusFlare' }]);
  await networkTick();
  expect((await getNetwork()).contacts[0]).toMatchObject({ name: 'scout', companyName: 'LotusFlare' });
});

it('re-confirms the signed-in account before acting, and stops if it is a different person', async () => {
  await seed({ ownerVerifiedAt: Date.now() - 7 * 3600000, contacts: [person('alex')] });
  vi.mocked(networkCommand).mockResolvedValueOnce({ url: 'https://www.linkedin.com/in/somebody-else/' });
  await networkTick();
  expect(String(vi.mocked(networkTab).mock.calls[0]![0])).toBe('https://www.linkedin.com/in/me/');
  const saved = await getNetwork();
  expect(saved.active).toBe(false);
  expect(saved.status).toMatch(/different LinkedIn account/);
  expect(vi.mocked(networkCommand)).toHaveBeenCalledTimes(1);
});

it('says so in the activity log when ChatGPT is signed out, and still drafts from the template', async () => {
  await seed({ dossier: 'd', contacts: [person('alex')] }, { aiMode: 'chatgpt' });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' });
  vi.mocked(prepareInvitation).mockRejectedValueOnce(new Error('Sign in to ChatGPT or resolve its challenge in the visible tab.'));
  await networkTick();
  const saved = await getNetwork();
  expect(saved.contacts[0]).toMatchObject({ state: 'review' });
  expect(saved.contacts[0]!.invitationNote).toMatch(/^Hi alex/i);
  expect(saved.log?.some(e => e.kind === 'warn' && /ChatGPT is not signed in.*template was used for alex/.test(e.text))).toBe(true);
});

it('uses the template by default, and ChatGPT only when the person chose it (no CV or dossier needed)', async () => {
  await seed({ contacts: [person('alex')] });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' });
  await networkTick();
  expect(prepareInvitation).not.toHaveBeenCalled();
  await seed({ contacts: [person('sam')] }, { aiMode: 'chatgpt' });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' });
  await networkTick();
  expect(prepareInvitation).toHaveBeenCalledTimes(1);
  expect((await getNetwork()).contacts[0]).toMatchObject({ state: 'review', invitationNote: 'AI note' });
});

it('one failed invitation does not stop outreach: it is retried by itself, already approved', async () => {
  await seed({ contacts: [person('alex', { state: 'review', approvalKind: 'connect', approved: true, invitationNote: 'Hi' })] }, { aiMode: 'template' });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' }).mockRejectedValueOnce(new Error('LinkedIn’s Send button did not become available. No invitation was sent.'));
  await networkTick();
  const saved = await getNetwork();
  expect(saved.active).toBe(true);
  expect(saved.contacts[0]).toMatchObject({ state: 'review', approved: true, failures: 1 });
  expect(saved.contacts[0]!.retryAfter).toBeGreaterThan(Date.now());
  expect(saved.actions).toHaveLength(0); // a send that did not happen does not count against the daily limit
});

it('when LinkedIn is slow to confirm, looks again instead of asking the person: Pending counts as sent, and it is never sent twice', async () => {
  await seed({ contacts: [person('alex', { state: 'review', approvalKind: 'connect', approved: true, invitationNote: 'Hi' })] }, { aiMode: 'template' });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' }).mockRejectedValueOnce(new Error('LinkedIn did not confirm Pending after Send. The invitation may have been submitted.'));
  await networkTick();
  let p = (await getNetwork()).contacts[0]!;
  expect(p).toMatchObject({ state: 'review', approved: true });
  expect(p.attemptedAt).toBeGreaterThan(0);
  vi.setSystemTime(Date.now() + 3 * 60000);
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'pending' });
  await networkTick();
  p = (await getNetwork()).contacts[0]!;
  expect(p).toMatchObject({ state: 'pending' });
  expect(p.requestedAt).toBeGreaterThan(0);
  expect(vi.mocked(networkCommand).mock.calls.filter(c => (c[1] as { action: string }).action === 'connect')).toHaveLength(1);
});
