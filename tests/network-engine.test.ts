import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, emptyNetwork, type NetworkContact } from '../src/shared/network';
import { getNetwork, networkTick, updateNetwork } from '../src/background/network';
import { networkCommand, networkTab } from '../src/background/network-browser';
import { prepareInvitation } from '../src/background/network-ai';
import { clearDatabase, closeDatabase } from '../src/storage/database';

vi.mock('../src/background/network-ai', () => ({
  askChatGpt: vi.fn().mockRejectedValue(new Error('not available')),
  clearAiJobs: vi.fn(),
  prepareInvitation: vi.fn().mockResolvedValue('AI note'),
  prepareIntroduction: vi.fn().mockResolvedValue('AI intro'),
  prepareDossier: vi.fn().mockResolvedValue('dossier'),
}));
vi.mock('../src/background/network-browser', () => ({
  closeWorkWindow: vi.fn().mockResolvedValue(undefined),
  networkCommand: vi.fn(),
  networkTab: vi.fn().mockResolvedValue(9),
  readyNetworkTab: vi.fn(),
  showWorkTab: vi.fn(),
  openWorkTab: vi.fn().mockResolvedValue(9),
}));

const me = { name: 'Arpit Singh', url: 'https://www.linkedin.com/in/arpit45/', headline: 'PGDM', location: 'India', about: '' };
const card = (slug: string, headline: string, degree = 2) => ({
  name: slug.replace(/-/g, ' '),
  url: `https://www.linkedin.com/in/${slug}/`,
  headline,
  location: 'Pune, Maharashtra, India',
  about: '',
  degree,
});
const person = (slug: string, patch: Partial<NetworkContact> = {}): NetworkContact => ({
  ...card(slug, 'Recruiter at Acme'),
  rawText: 'Recruiter at Acme',
  state: 'shortlisted',
  reason: 'Recruiting / people team',
  score: 100,
  addedAt: 1,
  checkedAt: 0,
  requestedAt: 0,
  messagedAt: 0,
  message: '',
  ...patch,
});
async function seed(patch: Partial<ReturnType<typeof emptyNetwork>> = {}, settings: Partial<typeof defaultSettings> = {}) {
  return updateNetwork(() => ({
    ...emptyNetwork(),
    active: true,
    profile: me,
    ownerVerifiedAt: Date.now(),
    dossier: '',
    location: 'India',
    ...patch,
    settings: { ...defaultSettings, roles: ['Product Management internship'], ...settings },
  }));
}
const urls = () => vi.mocked(networkTab).mock.calls.map(c => new URL(String(c[0])));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 9, 11, 0, 0));
  vi.mocked(networkCommand).mockReset();
  vi.mocked(networkTab).mockReset().mockResolvedValue(9);
  vi.mocked(prepareInvitation).mockClear();
  vi.stubGlobal('chrome', {
    runtime: { id: 'abc', onMessage: { addListener: vi.fn() } },
    tabs: { sendMessage: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    alarms: { create: vi.fn() },
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await clearDatabase();
  await closeDatabase();
  vi.unstubAllGlobals();
});

it('searches with a boolean query and LinkedIn’s degree filter, queues 2nd/3rd-degree people for an invitation and 1st-degree people for a direct message', async () => {
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
  expect(JSON.parse(url.searchParams.get('network')!)).toEqual(['F', 'S', 'O']);
  expect(url.searchParams.get('geoUrn')).toBe('["102713980"]'); // India, as LinkedIn's Locations filter
  expect(url.searchParams.get('keywords')).not.toContain('India');
  const saved = await getNetwork();
  expect(saved.contacts.map(c => c.name).sort()).toEqual(['already connected', 'founder', 'good recruiter']);
  expect(saved.contacts.find(c => c.name === 'already connected')).toMatchObject({ state: 'connected', direct: true });
  expect(saved.contacts.find(c => c.name === 'good recruiter')).toMatchObject({
    state: 'shortlisted',
    category: 'recruiter',
    companyName: 'Razorpay',
  });
  expect(saved.status).toMatch(/saved 3 new people, skipped 4/);
});

it('never piles more than three people from one company onto the shortlist', async () => {
  await seed({}, {});
  vi.mocked(networkCommand).mockResolvedValueOnce(['a', 'b', 'c', 'd', 'e'].map(n => card(`rec-${n}`, 'Recruiter at Acme')));
  await networkTick();
  expect((await getNetwork()).contacts).toHaveLength(3);
});

it('explains itself and does not search when the daily limit is reached', async () => {
  const sent = Array.from({ length: 30 }, (_, i) => ({
    at: Date.now() - 1000 * (i + 1),
    kind: 'connect' as const,
    url: `https://www.linkedin.com/in/s${i}/`,
    confirmed: true,
  }));
  await seed({ contacts: [person('next')], actions: sent });
  await networkTick();
  expect(networkTab).not.toHaveBeenCalled();
  expect((await getNetwork()).status).toMatch(/Daily invitation limit reached \(30\)/);
});

it('stops searching while plenty of people are already queued', async () => {
  await seed({ contacts: Array.from({ length: 16 }, (_, i) => person(`q${i}`)), nextActionAt: Date.now() + 3_600_000 });
  await networkTick();
  expect(networkTab).not.toHaveBeenCalled();
});

it('waits quietly outside the active hours and says so', async () => {
  vi.setSystemTime(new Date(2026, 10, 9, 3, 0, 0));
  await seed({ contacts: [person('night')] }, { activeHours: { from: 8, to: 22 } });
  await networkTick();
  expect(networkTab).not.toHaveBeenCalled();
  expect((await getNetwork()).status).toMatch(/Quiet hours: outreach resumes at 08:00/);
});

it('uses the invitation template without ChatGPT when the person chose templates, and queues it for review', async () => {
  await seed(
    { contacts: [person('review-me', { companyName: 'Acme' })], target: 'Product Management internship' },
    { noteMode: 'preferred' },
  );
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
  vi.mocked(networkCommand)
    .mockResolvedValueOnce({ state: 'not-connected' })
    .mockRejectedValueOnce(new Error('Connect is unavailable on this recipient profile.'));
  await networkTick();
  const saved = await getNetwork();
  expect(saved.active).toBe(true);
  expect(saved.contacts.find(c => c.name === 'follow only')).toMatchObject({ state: 'skipped' });
  expect(saved.actions).toHaveLength(0);
});

it('pauses, without losing the person, when LinkedIn reports the weekly invitation limit', async () => {
  await seed({ contacts: [person('limit')] }, { outreachMode: 'automatic', noteMode: 'none' });
  vi.mocked(networkCommand)
    .mockResolvedValueOnce({ state: 'not-connected' })
    .mockRejectedValueOnce(new Error('HALT: LinkedIn weekly invitation limit reached'));
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
  at(5);
  await networkTick();
  expect(vi.mocked(networkCommand).mock.calls.at(-1)![1]).toMatchObject({ url: 'https://www.linkedin.com/in/fine/' });
});

it('sets a person aside after two failed attempts', async () => {
  await seed({ contacts: [person('stubborn')] });
  vi.mocked(networkCommand).mockRejectedValue(new Error('The profile header is not available yet.'));
  await networkTick();
  at(31);
  await networkTick();
  const p = (await getNetwork()).contacts[0]!;
  expect(p.state).toBe('attention');
  expect(p.reason).toMatch(/Could not be processed twice/);
});

it('stops and says why when several pages in a row fail, since LinkedIn probably changed', async () => {
  await seed({ contacts: ['a', 'b', 'c', 'd'].map((n, i) => person(n, { score: 100 - i })) });
  vi.mocked(networkCommand).mockRejectedValue(new Error('The profile header is not available yet.'));
  for (let i = 0; i < 4; i++) {
    at(i);
    await networkTick();
  }
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
  await seed({ nextSweepAt: Date.now() + 3600000, contacts: [person('silent', { state: 'pending', requestedAt: old, nextCheckAt: old })] });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'pending' });
  await networkTick();
  expect((await getNetwork()).contacts[0]).toMatchObject({
    state: 'skipped',
    reason: expect.stringMatching(/No response after 30 days.*withdrawing/),
  });
});

it('spaces out acceptance checks instead of firing them back to back', async () => {
  const requested = Date.now() - 2 * 86400000;
  await seed({
    nextSweepAt: Date.now() + 3600000,
    contacts: [
      person('p1', { state: 'pending', requestedAt: requested, nextCheckAt: requested }),
      person('p2', { state: 'pending', requestedAt: requested, nextCheckAt: requested }),
    ],
  });
  vi.mocked(networkCommand).mockResolvedValue({ state: 'pending' });
  await networkTick();
  await networkTick(); // the second tick comes straight after
  expect(vi.mocked(networkCommand)).toHaveBeenCalledTimes(1);
  expect((await getNetwork()).nextActionAt).toBeGreaterThan(Date.now() + 30000);
});

it('prunes action history older than 35 days', async () => {
  await seed({
    actions: [
      { at: Date.now() - 40 * 86400000, kind: 'connect', url: 'https://www.linkedin.com/in/old/', confirmed: true },
      { at: Date.now() - 86400000, kind: 'connect', url: 'https://www.linkedin.com/in/new/', confirmed: true },
    ],
  });
  expect((await getNetwork()).actions).toHaveLength(2); // reading does not prune
  await updateNetwork(s => ({ ...s, status: 'x' }));
  expect((await getNetwork()).actions.map(a => a.url)).toEqual(['https://www.linkedin.com/in/new/']);
});

it('prefers LinkedIn\'s own "Current: role at company" line over guessing the employer from the headline', async () => {
  await seed();
  vi.mocked(networkCommand).mockResolvedValueOnce([
    { ...card('scout', 'Tech Recruiter | Product & Engineering Hiring'), current: 'Recruiter at LotusFlare' },
  ]);
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
  await seed(
    { contacts: [person('alex', { state: 'review', approvalKind: 'connect', approved: true, invitationNote: 'Hi' })] },
    { aiMode: 'template' },
  );
  vi.mocked(networkCommand)
    .mockResolvedValueOnce({ state: 'not-connected' })
    .mockRejectedValueOnce(new Error('LinkedIn’s Send button did not become available. No invitation was sent.'));
  await networkTick();
  const saved = await getNetwork();
  expect(saved.active).toBe(true);
  expect(saved.contacts[0]).toMatchObject({ state: 'review', approved: true, failures: 1 });
  expect(saved.contacts[0]!.retryAfter).toBeGreaterThan(Date.now());
  expect(saved.actions).toHaveLength(0); // a send that did not happen does not count against the daily limit
});

it('when LinkedIn is slow to confirm, looks again instead of asking the person: Pending counts as sent, and it is never sent twice', async () => {
  await seed(
    { contacts: [person('alex', { state: 'review', approvalKind: 'connect', approved: true, invitationNote: 'Hi' })] },
    { aiMode: 'template' },
  );
  vi.mocked(networkCommand)
    .mockResolvedValueOnce({ state: 'not-connected' })
    .mockRejectedValueOnce(new Error('LinkedIn did not confirm Pending after Send. The invitation may have been submitted.'));
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

it('every 2 hours reads the connections list once and marks everyone who accepted, without visiting each profile', async () => {
  await seed({
    contacts: [
      person('alex', { state: 'pending', requestedAt: Date.now() - 3 * 3600000 }),
      person('bea', { state: 'pending', requestedAt: Date.now() - 3 * 3600000 }),
    ],
    saved: [
      {
        type: 'person',
        url: 'https://www.linkedin.com/in/manual/',
        title: 'Manual Request',
        subtitle: '',
        note: 'message once accepted',
        relation: 'pending',
        savedAt: 1,
      },
    ],
  });
  vi.mocked(networkCommand).mockResolvedValueOnce([
    'https://www.linkedin.com/in/alex/',
    'https://www.linkedin.com/in/manual/',
    'https://www.linkedin.com/in/someone-else/',
  ]);
  await networkTick();
  expect(String(vi.mocked(networkTab).mock.calls[0]![0])).toBe('https://www.linkedin.com/mynetwork/invite-connect/connections/');
  expect(vi.mocked(networkCommand)).toHaveBeenCalledTimes(1);
  const saved = await getNetwork();
  expect(saved.contacts.map(c => [c.name, c.state])).toEqual([
    ['alex', 'connected'],
    ['bea', 'pending'],
  ]);
  expect(saved.contacts[0]!.acceptedAt).toBe(Date.now());
  expect(saved.saved![0]).toMatchObject({ relation: 'connected', acceptedAt: Date.now() });
  expect(saved.status).toMatch(/alex, Manual Request accepted your invitation/);
  expect(saved.nextSweepAt! - Date.now()).toBeGreaterThanOrEqual(2 * 3600000);
});

it('messages an existing 1st-degree connection directly, with wording that does not thank them for connecting', async () => {
  await seed(
    { contacts: [person('alex', { state: 'connected', direct: true, companyName: 'Acme', category: 'recruiter' })] },
    { aiMode: 'chatgpt' },
  );
  vi.mocked(networkCommand)
    .mockResolvedValueOnce({ state: 'connected' })
    .mockResolvedValueOnce(card('alex', 'Recruiter at Acme', 1));
  await networkTick();
  const p = (await getNetwork()).contacts[0]!;
  expect(p).toMatchObject({ state: 'review', approvalKind: 'message' });
  expect(p.message).toBe(
    'Hi alex, hope you’re doing well. I’m Arpit, currently exploring Product Management internship opportunities. Are there any relevant openings at Acme I could apply for, or someone I should speak to?',
  );
});

it('a referral search runs even while outreach is paused, keeps only people at that company, and queues the strongest once it is complete', async () => {
  const jobUrl = 'https://www.linkedin.com/jobs/view/123/';
  await seed({
    active: false,
    referralJobs: [
      {
        url: jobUrl,
        title: 'Product Manager',
        company: 'Acme',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 3,
        found: 0,
        strategyTried: true,
        infoTried: true,
        lookupTried: true,
      },
    ],
  });
  vi.mocked(networkCommand).mockResolvedValueOnce([
    card('rec', 'Senior Recruiter at Acme', 2),
    card('friend', 'Analyst at Acme', 1),
    card('stranger', 'Analyst at Acme', 3),
    card('elsewhere', 'Recruiter at Other Co', 2),
  ]);
  await networkTick();
  const url = urls()[0]!;
  expect(url.searchParams.get('keywords')).toContain('"Acme"');
  const saved = await getNetwork();
  expect(saved.contacts.sort((a, b) => b.score! - a.score!).map(c => [c.name, c.state, c.referralJob === jobUrl])).toEqual([
    ['rec', 'shortlisted', true],
    ['friend', 'connected', true],
  ]);
  expect(saved.contacts.find(c => c.name === 'friend')).toMatchObject({ direct: true, category: 'employee' });
  expect(saved.contacts.every(c => c.auto)).toBe(true);
  expect(saved.referralJobs![0]).toMatchObject({ cursor: 4, found: 2 });
  expect(saved.active).toBe(false);
});

it('"My connections here" only lists people; nobody is queued until asked', async () => {
  await seed({
    active: false,
    referralJobs: [
      {
        url: 'https://www.linkedin.com/jobs/view/9/',
        title: 'Sales Lead',
        company: 'TBX',
        location: '',
        mode: 'connections',
        addedAt: 1,
        cursor: 3,
        found: 0,
        infoTried: true,
        lookupTried: true,
      },
    ],
  });
  vi.mocked(networkCommand).mockResolvedValueOnce([card('pal', 'Account Executive at TBX', 1)]);
  await networkTick();
  expect(JSON.parse(urls()[0]!.searchParams.get('network')!)).toEqual(['F']);
  const saved = await getNetwork();
  expect(saved.contacts[0]).toMatchObject({ name: 'pal', state: 'found' });
  expect(saved.referralJobs![0]!.finishedAt).toBeGreaterThan(0);
  expect(saved.status).toMatch(/TBX: found 1 person/);
});

it('reads the company number from its page first, then searches with the Current company filter', async () => {
  await seed({
    active: false,
    referralJobs: [
      {
        url: 'https://www.linkedin.com/jobs/view/5/',
        title: 'Product Management Intern',
        company: 'DeHaat',
        location: '',
        companyUrl: 'https://www.linkedin.com/company/dehaat/',
        mode: 'connections',
        addedAt: 1,
        cursor: 0,
        found: 0,
      },
    ],
  });
  vi.mocked(networkCommand).mockResolvedValueOnce({ id: '13396287' });
  await networkTick();
  expect(String(vi.mocked(networkTab).mock.calls[0]![0])).toBe('https://www.linkedin.com/company/dehaat/');
  expect((await getNetwork()).referralJobs![0]).toMatchObject({ companyId: '13396287', cursor: 0 });
  vi.mocked(networkCommand).mockResolvedValueOnce([card('friend', 'Sales Manager | Dehaat | Ex Tata Group', 1)]);
  await networkTick();
  const url = urls()[1]!;
  expect(url.searchParams.get('currentCompany')).toBe('["13396287"]');
  expect(url.searchParams.has('keywords')).toBe(false);
  const saved = await getNetwork();
  expect(saved.contacts[0]).toMatchObject({ name: 'friend', state: 'found', category: 'senior' });
  expect(saved.referralJobs![0]!.finishedAt).toBeGreaterThan(0); // fewer than 10 people: no second page needed
});

it('messages the people already known and invites only the chosen number of others (3 unless set), leaving the rest listed', async () => {
  const jobUrl = 'https://www.linkedin.com/jobs/view/77/';
  await seed({
    active: false,
    referralJobs: [
      {
        url: jobUrl,
        title: 'Technology analyst',
        company: 'Infosys',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 3,
        found: 0,
        strategyTried: true,
        infoTried: true,
        lookupTried: true,
      },
    ],
  });
  vi.mocked(networkCommand).mockResolvedValueOnce(
    Array.from({ length: 10 }, (_, i) => card(`rec-${i}`, 'Talent Acquisition at Infosys', i < 2 ? 1 : 2)),
  );
  await networkTick();
  const people = (await getNetwork()).contacts;
  expect(people.filter(p => p.auto && !p.direct).length).toBe(3);
  expect(people.filter(p => p.state === 'found').length).toBe(5);
  expect(people.filter(p => p.auto && p.direct).map(p => p.state)).toEqual(['connected', 'connected']); // people already known are always among the first
});

it('referral outreach sends without a second approval, and leaves general contacts alone while only referrals are running', async () => {
  const jobUrl = 'https://www.linkedin.com/jobs/view/77/';
  await seed({
    scope: 'referrals',
    referralJobs: [
      {
        url: jobUrl,
        title: 'Technology analyst',
        company: 'Infosys',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 4,
        found: 1,
        finishedAt: 1,
      },
    ],
    contacts: [
      person('general', { score: 999 }),
      person('ref', { referralJob: jobUrl, auto: true, companyName: 'Infosys', category: 'recruiter', score: 300 }),
    ],
  });
  vi.mocked(networkCommand).mockResolvedValueOnce({ state: 'not-connected' }).mockResolvedValueOnce({ state: 'pending', noteSent: true });
  await networkTick();
  const saved = await getNetwork();
  expect(saved.contacts.find(c => c.name === 'ref')).toMatchObject({ state: 'pending' });
  expect(saved.contacts.find(c => c.name === 'general')).toMatchObject({ state: 'shortlisted' });
  expect(vi.mocked(networkCommand).mock.calls[1]![1]).toMatchObject({
    action: 'connect',
    body: 'Hi ref, I’m Arpit. I’m applying for the Technology analyst role at Infosys. Would love to connect about it.',
  });
  vi.mocked(networkCommand).mockClear();
  vi.setSystemTime(Date.now() + 10 * 60000);
  await networkTick();
  expect(vi.mocked(networkCommand).mock.calls.some(c => (c[1] as { action: string }).action === 'search')).toBe(false); // no general searching
});

/* ---------- job search pipeline ---------- */
it('plans once, searches each planned title, then offers one job per company with the best ones ticked', async () => {
  const { askChatGpt } = await import('../src/background/network-ai');
  vi.mocked(askChatGpt).mockResolvedValueOnce(
    JSON.stringify({
      searchTerms: ['operations intern', 'supply chain intern'],
      referralTitles: { large: ['recruiter', 'team lead', 'CEO'], mid: ['HR'], small: ['founder'] },
      note: 'Hi {firstName}, I’m {myFirstName}. I’m applying for the {title} role at {company} and would love to connect.',
      ask: 'Hi {firstName}, I’m applying for {title} at {company}: {jobUrl} Could you refer me?',
    }),
  );
  await seed({ active: false, jobSearch: { status: 'finding', cursor: 0, found: [], startedAt: 1 } }, { roles: ['Operations intern'] });
  await networkTick(); // the plan: one ChatGPT prompt
  let saved = await getNetwork();
  expect(saved.plan).toMatchObject({ source: 'chatgpt', terms: ['Operations intern', 'supply chain intern'] });
  expect(saved.plan!.titles.large).toEqual(['recruiter', 'team lead']); // a CEO is never targeted at a large company, whatever the model says
  vi.mocked(networkCommand).mockResolvedValueOnce([
    { id: '11', title: 'Operations Intern', company: 'Stripe', location: 'Bengaluru', insight: '3 connections work here' },
    { id: '12', title: 'Senior Operations Manager', company: 'Acme', location: 'Pune', insight: '' },
  ]);
  await networkTick();
  expect(urls()[0]!.searchParams.get('geoId')).toBe('102713980');
  vi.mocked(networkCommand).mockResolvedValueOnce([
    { id: '13', title: 'Supply Chain Intern', company: 'Stripe', location: 'Bengaluru', insight: '' },
    { id: '14', title: 'Supply Chain Intern', company: 'Lane', location: 'Bengaluru', insight: '' },
  ]);
  await networkTick();
  await networkTick(); // no terms left: build the shortlist
  saved = await getNetwork();
  expect(saved.jobSearch!.status).toBe('choosing');
  expect(saved.jobSearch!.found.map(j => [j.company, j.id, j.picked])).toEqual([
    ['Stripe', '11', true],
    ['Lane', '14', true],
    ['Acme', '12', false],
  ]);
  expect(vi.mocked(askChatGpt)).toHaveBeenCalledTimes(2);
});

it('falls back to built-in titles when ChatGPT is not available, and says so', async () => {
  const { askChatGpt } = await import('../src/background/network-ai');
  vi.mocked(askChatGpt).mockRejectedValueOnce(new Error('Sign in to ChatGPT or resolve its challenge in the visible tab.'));
  await seed({ active: false, jobSearch: { status: 'finding', cursor: 0, found: [], startedAt: 1 } }, { roles: ['Operations intern'] });
  await networkTick();
  const saved = await getNetwork();
  expect(saved.plan).toMatchObject({ source: 'rules' });
  expect(saved.plan!.terms).toEqual(expect.arrayContaining(['Operations intern', 'supply chain intern', 'logistics intern']));
  expect(saved.status).toMatch(/ChatGPT was not available/);
});

it('for a chosen company: opens the job, reads the company size, and asks before looking wider when the person already knows people there', async () => {
  const jobUrl = 'https://www.linkedin.com/jobs/view/11/';
  await seed({
    scope: 'referrals',
    referralJobs: [
      {
        url: jobUrl,
        title: 'Operations Intern',
        company: 'Stripe',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 0,
        found: 0,
        strategyTried: true,
        perCompany: 4,
      },
    ],
  });
  vi.mocked(networkCommand).mockResolvedValueOnce({
    companyUrl: 'https://www.linkedin.com/company/stripe/',
    location: 'Bengaluru',
    suggested: [],
  });
  await networkTick();
  vi.mocked(networkCommand).mockResolvedValueOnce({ id: '2135371', size: '5K-10K employees' });
  await networkTick();
  expect((await getNetwork()).referralJobs![0]).toMatchObject({ companyId: '2135371', size: 'large' });
  vi.mocked(networkCommand).mockResolvedValueOnce([card('friend', 'Operations Associate at Stripe', 1)]);
  await networkTick();
  let saved = await getNetwork();
  expect(saved.referralJobs![0]).toMatchObject({ waiting: true, known: 1 });
  expect(saved.status).toMatch(/You already know 1 person at Stripe/);
  vi.mocked(networkCommand).mockClear();
  await networkTick(); // nothing more is searched for this company until the person decides
  expect(vi.mocked(networkCommand).mock.calls.some(c => (c[1] as { action: string }).action === 'search')).toBe(false);
});

it('asks ChatGPT once, for every chosen company together, who can refer there, before any company is searched', async () => {
  const { askChatGpt } = await import('../src/background/network-ai');
  const job = (n: number, company: string, title: string) => ({
    url: `https://www.linkedin.com/jobs/view/9${n}/`,
    title,
    company,
    location: '',
    mode: 'referral' as const,
    addedAt: n,
    cursor: 0,
    found: 0,
  });
  await seed({ scope: 'referrals', referralJobs: [job(1, 'Microsoft', 'Sales Intern'), job(2, 'Tinyco', 'Operations Intern')] });
  vi.mocked(askChatGpt).mockClear();
  vi.mocked(askChatGpt).mockResolvedValueOnce(
    JSON.stringify({
      companies: [
        {
          company: 'Microsoft',
          type: 'enterprise',
          why: 'Referrals go through employees in sales.',
          searchTitles: ['CEO', 'account executive', 'sales manager'],
          avoid: ['CFO'],
          ask: 'Hi {firstName}, I am applying for {title} at {company}: {jobUrl}. Would you refer me?',
        },
        {
          company: 'Tinyco',
          type: 'startup',
          why: 'The founder hires directly.',
          searchTitles: ['founder', 'head of operations'],
          avoid: [],
        },
      ],
    }),
  );
  vi.mocked(networkCommand).mockClear();
  await networkTick();
  const saved = await getNetwork(),
    [ms, tiny] = saved.referralJobs!;
  expect(vi.mocked(askChatGpt)).toHaveBeenCalledTimes(1);
  const prompt = vi.mocked(askChatGpt).mock.calls[0]![0] as string;
  expect(prompt).toContain('Microsoft');
  expect(prompt).toContain('Tinyco');
  expect(prompt).toContain('Sales Intern');
  expect(vi.mocked(networkCommand)).not.toHaveBeenCalled(); // the plan comes first; LinkedIn is not touched in that turn
  expect(ms!.strategy).toMatchObject({ type: 'enterprise', titles: ['account executive', 'sales manager'], source: 'chatgpt' }); // no CEO at an enterprise
  expect(ms!.strategy!.avoid).toEqual(expect.arrayContaining(['CFO', 'CEO', 'founder']));
  expect(ms!.strategy!.ask).toContain('{jobUrl}');
  expect(tiny!.strategy).toMatchObject({ type: 'startup', titles: ['founder', 'head of operations'] });
  expect(saved.status).toMatch(/planned who to ask at 2 companies/);
  await networkTick(); // no second prompt
  expect(vi.mocked(askChatGpt)).toHaveBeenCalledTimes(1);
});

it('carries on with built-in rules, and says so, when ChatGPT cannot plan the companies', async () => {
  const { askChatGpt } = await import('../src/background/network-ai');
  await seed({
    scope: 'referrals',
    referralJobs: [
      {
        url: 'https://www.linkedin.com/jobs/view/95/',
        title: 'Operations Intern',
        company: 'Stripe',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 0,
        found: 0,
      },
    ],
  });
  vi.mocked(askChatGpt).mockClear();
  vi.mocked(askChatGpt).mockRejectedValueOnce(new Error('Sign in to ChatGPT or resolve its challenge in the visible tab.'));
  await networkTick();
  let saved = await getNetwork();
  expect(saved.referralJobs![0]).toMatchObject({ strategyTried: true });
  expect(saved.referralJobs![0]!.strategy).toBeUndefined();
  expect(saved.status).toMatch(/ChatGPT was not available.*Built-in rules/);
  vi.mocked(networkCommand).mockResolvedValueOnce({
    companyUrl: 'https://www.linkedin.com/company/stripe/',
    location: 'Bengaluru',
    suggested: [],
  });
  await networkTick(); // the search itself still goes ahead
  expect(vi.mocked(askChatGpt)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(networkCommand).mock.calls.some(c => (c[1] as { action: string }).action === 'jobInfo')).toBe(true);
});

it('Pause stops searches as well as sending, and Resume carries on from the same place', async () => {
  const { pauseNetwork } = await import('../src/background/network');
  await seed({
    scope: 'referrals',
    referralJobs: [
      {
        url: 'https://www.linkedin.com/jobs/view/61/',
        title: 'Ops Intern',
        company: 'Stripe',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 3,
        found: 0,
        infoTried: true,
        lookupTried: true,
        strategyTried: true,
      },
    ],
  });
  await pauseNetwork();
  vi.mocked(networkCommand).mockClear();
  await networkTick();
  expect(vi.mocked(networkCommand)).not.toHaveBeenCalled();
  expect((await getNetwork()).referralJobs![0]!.cursor).toBe(3);
  await updateNetwork(s => {
    delete s.paused;
    return s;
  });
  vi.mocked(networkCommand).mockResolvedValueOnce([]);
  await networkTick();
  expect((await getNetwork()).referralJobs![0]!.cursor).toBe(4);
});

it('a company whose search page cannot be read does not stop anything: it is closed and the next company is searched', async () => {
  const job = (n: number, company: string) => ({
    url: `https://www.linkedin.com/jobs/view/7${n}/`,
    title: 'Ops Intern',
    company,
    location: '',
    mode: 'referral' as const,
    addedAt: n,
    cursor: 3,
    found: 0,
    infoTried: true,
    lookupTried: true,
    strategyTried: true,
  });
  await seed({ active: false, referralJobs: [job(1, 'Brokenco'), job(2, 'Fineco')] });
  vi.mocked(networkCommand).mockRejectedValueOnce(new Error('The results list was not found.'));
  await networkTick();
  let saved = await getNetwork();
  expect(saved.referralJobs![0]!.finishedAt).toBeGreaterThan(0);
  expect(saved.paused).toBeFalsy();
  vi.mocked(networkCommand).mockResolvedValueOnce([]);
  await networkTick();
  saved = await getNetwork();
  expect(saved.referralJobs![1]!.cursor).toBe(4);
});

it('runs the shortlist past ChatGPT once and takes out the listings it rejects, keeping the reasons to show', async () => {
  const { askChatGpt } = await import('../src/background/network-ai');
  const found = (id: string, title: string, company: string, promoted = false) => ({
    id,
    url: `https://www.linkedin.com/jobs/view/${id}/`,
    title,
    company,
    location: 'India',
    insight: '',
    term: 'pm intern',
    score: 50,
    picked: false,
    ...(promoted ? { promoted } : {}),
  });
  await seed({
    plan: {
      forRoles: 'Product Management internship',
      terms: ['pm intern'],
      titles: { large: [], mid: [], small: [] },
      source: 'rules',
      at: 1,
    },
    jobSearch: {
      status: 'finding',
      cursor: 1,
      startedAt: 1,
      found: [
        found('111111', 'Product Intern', 'Acme'),
        found('222222', 'Sales Intern', 'Sellco'),
        found('333333', 'Product Management Course with Placement', 'SkillMill', true),
      ],
    },
  });
  vi.mocked(askChatGpt).mockClear();
  vi.mocked(askChatGpt).mockResolvedValueOnce(
    JSON.stringify({
      remove: [
        { id: '333333', why: 'Paid course, not a job' },
        { id: '999', why: 'unknown id is ignored' },
      ],
    }),
  );
  await networkTick();
  const saved = await getNetwork();
  expect(vi.mocked(askChatGpt)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(askChatGpt).mock.calls[0]![0]).toContain('"promoted":true');
  expect(saved.jobSearch!.status).toBe('choosing');
  expect(saved.jobSearch!.found.map(j => j.company).sort()).toEqual(['Acme', 'Sellco']);
  expect(saved.jobSearch!.dropped).toEqual([
    { title: 'Product Management Course with Placement', company: 'SkillMill', why: 'Paid course, not a job' },
  ]);
  expect(saved.status).toMatch(/ChatGPT removed 1 advert or poor match/);
});

it('finds the company page through LinkedIn company search when the job did not give it, so the Current company filter is still used', async () => {
  const jobUrl = 'https://www.linkedin.com/jobs/view/81/';
  await seed({
    active: false,
    referralJobs: [
      {
        url: jobUrl,
        title: 'Product Intern',
        company: 'Ketto',
        location: 'Mumbai, Maharashtra, India',
        mode: 'referral',
        addedAt: 1,
        cursor: 0,
        found: 0,
        infoTried: true,
        strategyTried: true,
      },
    ],
  });
  vi.mocked(networkTab).mockClear();
  vi.mocked(networkCommand).mockResolvedValueOnce([
    { name: 'KETTO', url: 'https://www.linkedin.com/company/ketto-france/', lines: ['IT Services', 'Laventie'] },
    {
      name: 'Ketto',
      url: 'https://www.linkedin.com/company/ketto-online-ventures-private-limited/',
      lines: ['Fundraising', 'MUMBAI, MAHARASHTRA'],
    },
    { name: 'Ketto Foundation', url: 'https://www.linkedin.com/company/kettofoundation/', lines: [] },
  ]);
  await networkTick();
  expect(urls()[0]!.pathname).toBe('/search/results/companies/');
  expect((await getNetwork()).referralJobs![0]).toMatchObject({
    lookupTried: true,
    companyUrl: 'https://www.linkedin.com/company/ketto-online-ventures-private-limited/',
  });
  vi.mocked(networkCommand).mockResolvedValueOnce({ id: '3686501', size: '201-500 employees' });
  await networkTick();
  vi.mocked(networkTab).mockClear();
  vi.mocked(networkCommand).mockResolvedValueOnce([]);
  await networkTick();
  expect(urls()[0]!.searchParams.get('currentCompany')).toBe('["3686501"]'); // every people search is filtered by current company
});

it('remembers what was running when paused (even if paused twice), and can say what is left to do', async () => {
  const { pauseNetwork } = await import('../src/background/network');
  const { unfinished } = await import('../src/shared/network');
  await seed({
    scope: 'all',
    contacts: [person('queued')],
    plan: { forRoles: 'x', terms: ['a', 'b', 'c'], titles: { large: [], mid: [], small: [] }, source: 'rules', at: 1 },
    jobSearch: { status: 'finding', cursor: 1, found: [], startedAt: 1 },
    referralJobs: [
      {
        url: 'https://www.linkedin.com/jobs/view/1/',
        title: 'T',
        company: 'Acme',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 2,
        found: 0,
      },
    ],
  });
  await pauseNetwork();
  await pauseNetwork('LinkedIn is signed out.'); // an error after a pause must not forget that sending was on
  const saved = await getNetwork();
  expect(saved).toMatchObject({ active: false, paused: true, resumeTo: { active: true, scope: 'all' }, status: 'LinkedIn is signed out.' });
  expect(unfinished(saved)).toEqual([
    'the job search (1 of 3 titles done)',
    'people searches at 1 company',
    '1 message or invitation to send',
  ]);
});

it('does not drop a request that arrives while the previous step is still finishing', async () => {
  await seed({
    active: false,
    referralJobs: [
      {
        url: 'https://www.linkedin.com/jobs/view/2/',
        title: 'T',
        company: 'Acme',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 3,
        found: 0,
        infoTried: true,
        lookupTried: true,
        strategyTried: true,
      },
    ],
  });
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  let release!: (v: unknown[]) => void;
  vi.mocked(networkCommand).mockReturnValueOnce(
    new Promise(r => {
      release = r as never;
    }) as never,
  );
  const first = networkTick();
  await networkTick(); // arrives mid-step: must be queued, not ignored
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  release([]);
  await first;
  expect(vi.getTimerCount()).toBeGreaterThan(0); // a follow-up run is scheduled
  vi.useRealTimers();
});
