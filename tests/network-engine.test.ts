import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, emptyNetwork, type NetworkContact, type NetworkJob } from '../src/shared/network';
import { getNetwork, networkTick, updateNetwork } from '../src/background/network';
import { networkCommand, networkTab } from '../src/background/network-browser';
import { prepareInvitation } from '../src/background/network-ai';
import { clearDatabase, closeDatabase } from '../src/storage/database';

vi.mock('../src/background/network-ai', () => ({ clearAiJobs: vi.fn(), prepareInvitation: vi.fn().mockResolvedValue('AI note'), prepareIntroduction: vi.fn().mockResolvedValue('AI intro'), prepareDossier: vi.fn().mockResolvedValue('dossier') }));
vi.mock('../src/background/network-browser', () => ({ networkCommand: vi.fn(), networkTab: vi.fn().mockResolvedValue(9), readyNetworkTab: vi.fn() }));

const me = { name: 'Arpit Singh', url: 'https://www.linkedin.com/in/arpit45/', headline: 'PGDM', location: 'India', about: '' };
const card = (slug: string, headline: string, degree = 2) => ({ name: slug.replace(/-/g, ' '), url: `https://www.linkedin.com/in/${slug}/`, headline, location: 'Pune, Maharashtra, India', about: '', degree });
const person = (slug: string, patch: Partial<NetworkContact> = {}): NetworkContact => ({ ...card(slug, 'Recruiter at Acme'), rawText: 'Recruiter at Acme', state: 'shortlisted', reason: 'Recruiting / people team', score: 100, addedAt: 1, checkedAt: 0, requestedAt: 0, messagedAt: 0, message: '', ...patch });
const job = (patch: Partial<NetworkJob> = {}): NetworkJob => ({ id: '111', url: 'https://www.linkedin.com/jobs/view/111/', title: 'Product Management Intern', companyName: 'Razorpay Software Pvt Ltd', location: 'Bengaluru', sourceCapturedAt: 1, captureStatus: 'detail', matchingReasons: ['x'], peopleSearches: 0, ...patch });
async function seed(patch: Partial<ReturnType<typeof emptyNetwork>> = {}, settings: Partial<typeof defaultSettings> = {}) {
  return updateNetwork(() => ({ ...emptyNetwork(), active: true, profile: me, dossier: '', location: 'India', ...patch, settings: { ...defaultSettings, roles: ['Product Management internship'], ...settings } }));
}
const urls = () => vi.mocked(networkTab).mock.calls.map(c => new URL(String(c[0])));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 9, 11, 0, 0));
  vi.mocked(networkCommand).mockReset(); vi.mocked(networkTab).mockReset().mockResolvedValue(9); vi.mocked(prepareInvitation).mockClear();
  vi.stubGlobal('chrome', { runtime: { id: 'abc', onMessage: { addListener: vi.fn() } }, tabs: { sendMessage: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) }, alarms: { create: vi.fn() } });
});
afterEach(async () => { vi.useRealTimers(); await clearDatabase(); await closeDatabase(); vi.unstubAllGlobals(); });

it('searches with a boolean query and the 2nd/3rd-degree filter, then saves only people worth contacting', async () => {
  await seed({}, { searchMode: 'people' });
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
  await seed({}, { searchMode: 'people' });
  vi.mocked(networkCommand).mockResolvedValueOnce(['a', 'b', 'c', 'd', 'e'].map(n => card(`rec-${n}`, 'Recruiter at Acme')));
  await networkTick();
  expect((await getNetwork()).contacts).toHaveLength(3);
});

it('jobs-only mode still finds the recruiters and leaders behind each job (it used to find nobody)', async () => {
  await seed({ jobs: [job()] }, { searchMode: 'jobs' });
  vi.mocked(networkCommand).mockResolvedValueOnce([card('rec', 'Senior Recruiter at Razorpay'), card('stranger', 'Recruiter at Someone Else')]);
  await networkTick();
  expect(urls()[0]!.searchParams.get('keywords')).toContain('Razorpay');
  const saved = await getNetwork();
  expect(saved.contacts.map(c => c.name)).toEqual(['rec']);
  expect(saved.contacts[0]).toMatchObject({ companyName: 'Razorpay Software Pvt Ltd', jobIds: ['111'] });
  expect(saved.jobs![0]!.peopleSearches).toBe(1);
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

it('uses the invitation template without ChatGPT and queues it for review by default', async () => {
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
