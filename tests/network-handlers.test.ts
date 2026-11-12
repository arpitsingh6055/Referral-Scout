/**
 * The handlers behind the side panel's buttons: what each one saves, what it refuses, and what it starts.
 * The engine step itself (networkTick) is replaced, so only the handler's own effect is checked.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, emptyNetwork, type NetworkContact, type NetworkState } from '../src/shared/network';
import { getNetwork, networkTick, updateNetwork } from '../src/background/network';
import { clearDatabase, closeDatabase } from '../src/storage/database';

vi.mock('../src/background/network', async original => ({
  ...(await original<typeof import('../src/background/network')>()),
  networkTick: vi.fn().mockResolvedValue(undefined),
}));
const savedApi: { value: unknown } = { value: null };
vi.mock('../src/background/network-ai', () => ({
  askChatGpt: vi.fn().mockRejectedValue(new Error('not available')),
  clearAiJobs: vi.fn(),
  prepareInvitation: vi.fn(),
  prepareIntroduction: vi.fn(),
  prepareDossier: vi.fn(),
  apiConfig: vi.fn(async () => savedApi.value),
  saveApiConfig: vi.fn(async (v: unknown) => {
    savedApi.value = v;
  }),
  askApi: vi.fn().mockResolvedValue('OK'),
}));
vi.mock('../src/background/network-browser', () => ({
  closeWorkWindow: vi.fn().mockResolvedValue(undefined),
  networkCommand: vi.fn(),
  networkTab: vi.fn().mockResolvedValue(9),
  readyNetworkTab: vi.fn(),
  showWorkTab: vi.fn(),
  openWorkTab: vi.fn().mockResolvedValue(9),
}));

const ID = 'ext-id';
const me = { name: 'Arpit Singh', url: 'https://www.linkedin.com/in/arpit45/', headline: 'PGDM', location: 'India', about: '' };
const person = (slug: string, patch: Partial<NetworkContact> = {}): NetworkContact => ({
  name: slug,
  url: `https://www.linkedin.com/in/${slug}/`,
  headline: 'Recruiter at Acme',
  location: '',
  about: '',
  rawText: '',
  state: 'shortlisted',
  reason: '',
  score: 1,
  addedAt: 1,
  checkedAt: 0,
  requestedAt: 0,
  messagedAt: 0,
  message: '',
  ...patch,
});
const job = (n: number, patch = {}) => ({
  url: `https://www.linkedin.com/jobs/view/${n}/`,
  title: 'Ops Intern',
  company: `Company ${n}`,
  location: '',
  mode: 'referral' as const,
  addedAt: n,
  cursor: 0,
  found: 0,
  ...patch,
});
type Reply = { ok: boolean; data?: NetworkState; error?: string };
let listener!: (input: unknown, sender: unknown, respond: (r: unknown) => void) => boolean | void;

const seed = (patch: Partial<NetworkState> = {}) =>
  updateNetwork(() => ({
    ...emptyNetwork(),
    profile: me as never,
    ownerVerifiedAt: Date.now(),
    settings: { ...defaultSettings, roles: ['Ops intern'] },
    ...patch,
  }));
const send = (request: Record<string, unknown>, sender: Record<string, unknown> = { id: ID }) =>
  new Promise<Reply | 'ignored'>(resolve => {
    if (listener({ kind: 'network', ...request }, sender, r => resolve(r as Reply)) !== true) setTimeout(() => resolve('ignored'), 20);
  });
const ok = async (request: Record<string, unknown>): Promise<NetworkState> => {
  const r = (await send(request)) as Reply;
  expect(r.error).toBeUndefined();
  return r.data!;
};

beforeEach(async () => {
  savedApi.value = null;
  vi.mocked(networkTick).mockClear();
  vi.stubGlobal('chrome', {
    runtime: {
      id: ID,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
    tabs: { sendMessage: vi.fn().mockResolvedValue(undefined), query: vi.fn().mockResolvedValue([]) },
    sidePanel: {},
  });
  (await import('../src/background/network-messages')).registerNetworkMessages();
});
afterEach(async () => {
  await clearDatabase();
  await closeDatabase();
  vi.unstubAllGlobals();
});

it('ignores a request that does not come from the extension itself', async () => {
  await seed();
  expect(await send({ action: 'pause' }, { id: 'someone-else' })).toBe('ignored');
  expect((await getNetwork()).paused).toBeFalsy();
});

it('Pause then Resume restores sending and its mode exactly, and says what continues', async () => {
  await seed({ active: true, scope: 'all', contacts: [person('queued')], referralJobs: [job(1)] });
  expect(await ok({ action: 'pause' })).toMatchObject({ active: false, paused: true, resumeTo: { active: true, scope: 'all' } });
  const resumed = await ok({ action: 'resume' });
  expect(resumed).toMatchObject({ active: true, scope: 'all' });
  expect(resumed.paused).toBeUndefined();
  expect(resumed.resumeTo).toBeUndefined();
  expect(resumed.status).toBe('Resumed: people searches at 1 company; 1 message or invitation to send.');
  await vi.waitFor(() => expect(networkTick).toHaveBeenCalled());
});

it('Resume after a pause during a search does not switch sending on', async () => {
  await seed({ active: false, referralJobs: [job(1)] });
  await ok({ action: 'pause' });
  expect(await ok({ action: 'resume' })).toMatchObject({ active: false, status: 'Resumed: people searches at 1 company.' });
});

it('"Resume sending" without a pause turns on referral sending only', async () => {
  await seed({ active: false, contacts: [person('a', { referralJob: job(1).url })], referralJobs: [job(1, { finishedAt: 1 })] });
  expect(await ok({ action: 'resume' })).toMatchObject({ active: true, scope: 'referrals' });
});

it('starting a job search lifts a pause; a refused request does not', async () => {
  await seed({ paused: true });
  expect((await ok({ action: 'findJobs' })).jobSearch).toMatchObject({ status: 'finding', cursor: 0, found: [] });
  await vi.waitFor(async () => expect((await getNetwork()).paused).toBeUndefined());
  await updateNetwork(s => ({ ...s, profile: null as never, paused: true }));
  expect(await send({ action: 'findJobs' })).toMatchObject({ ok: false, error: 'Read your LinkedIn profile first.' });
  await new Promise(r => setTimeout(r, 30));
  expect((await getNetwork()).paused).toBe(true);
});

it('answers the per-company question either way and lets that company carry on', async () => {
  await seed({ referralJobs: [job(1, { waiting: true, known: 2 }), job(2, { waiting: true, known: 1 })] });
  const only = (await ok({ action: 'referralDecision', url: job(1).url, widen: false })).referralJobs![0]!;
  expect(only.waiting).toBeFalsy();
  expect(only.decision).toBe('known');
  const wider = (await ok({ action: 'referralDecision', url: job(2).url, widen: true })).referralJobs![1]!;
  expect(wider.waiting).toBeFalsy();
  expect(wider.decision).toBe('widen');
});

it('records what came of a request, clears it again, and marks a job as applied', async () => {
  await seed({ contacts: [person('a', { state: 'messaged', messagedAt: 5 })], referralJobs: [job(1)] });
  const marked = await ok({ action: 'outcome', url: person('a').url, outcome: 'referred' });
  expect(marked.contacts[0]).toMatchObject({ outcome: 'referred' });
  expect(marked.status).toMatch(/agreed to refer you/);
  expect((await ok({ action: 'outcome', url: person('a').url, outcome: null })).contacts[0]!.outcome).toBeUndefined();
  expect((await ok({ action: 'jobApplied', url: job(1).url, applied: true })).referralJobs![0]!.applied).toBeGreaterThan(0);
  expect((await ok({ action: 'jobApplied', url: job(1).url, applied: false })).referralJobs![0]!.applied).toBeUndefined();
  expect(await send({ action: 'outcome', url: 'https://www.linkedin.com/in/nobody/', outcome: 'replied' })).toMatchObject({
    ok: false,
    error: 'That person is no longer on your list.',
  });
});

it('saves an API key without ever putting it in the state the panel or an export sees, and removes it again', async () => {
  await seed();
  const key = 'sk-test-0123456789abcdefghijWXYZ';
  const saved = await ok({ action: 'saveApi', key, model: 'some-model' });
  expect(saved.api).toEqual({ model: 'some-model', ending: 'WXYZ' });
  expect(JSON.stringify(await ok({ action: 'export' }))).not.toContain(key);
  expect(JSON.stringify(await getNetwork())).not.toContain(key);
  expect((await ok({ action: 'testApi' })).status).toBe('The API key works with some-model.');
  expect((await ok({ action: 'clearApi' })).api).toBeUndefined();
  expect(savedApi.value).toBeNull();
  expect(await send({ action: 'testApi' })).toMatchObject({ ok: false, error: 'Save an API key and a model name first.' });
});

it('refuses a setting that is out of range in plain words instead of going silent', async () => {
  await seed();
  const r = (await send({
    action: 'save',
    target: 'Ops intern',
    location: 'India',
    template: 'Hi {firstName}, thanks for connecting!',
    settings: { ...defaultSettings, roles: ['Ops intern'], paceMinutes: 0.01 },
  })) as Reply;
  expect(r).toMatchObject({ ok: false });
  expect(r.error).toMatch(/^Not saved\. Please check: Seconds between sends/);
});

it('Skip stops a person for good, and Approve all approves every waiting draft at once', async () => {
  await seed({
    active: true,
    contacts: [
      person('a'),
      person('b', { state: 'review', approvalKind: 'connect', invitationNote: 'Hi' }),
      person('c', { state: 'review', approvalKind: 'connect', invitationNote: 'Hi' }),
    ],
  });
  expect((await ok({ action: 'skip', url: person('a').url })).contacts[0]).toMatchObject({ state: 'skipped' });
  expect((await ok({ action: 'approve', url: '*' })).contacts.filter(p => p.approved).map(p => p.name)).toEqual(['b', 'c']);
});

it('lets the person leave any stage: stop a job search with what was found, stop looking for people, stop one company', async () => {
  const found = [
    {
      id: '111111',
      url: 'https://www.linkedin.com/jobs/view/111111/',
      title: 'Ops Intern',
      company: 'Acme',
      location: '',
      insight: '',
      term: 'x',
      score: 5,
      picked: false,
    },
  ];
  await seed({ jobSearch: { status: 'finding', cursor: 1, found: [], startedAt: 1 } });
  expect(await send({ action: 'finishJobSearch' })).toMatchObject({
    ok: false,
    error: 'Nothing has been found yet. Wait for the first results, or stop the search.',
  });
  await updateNetwork(s => ({ ...s, jobSearch: { status: 'finding', cursor: 1, found, startedAt: 1 } }));
  expect((await ok({ action: 'finishJobSearch' })).jobSearch!.cursor).toBeGreaterThan(1000);

  await seed({
    active: false,
    referralJobs: [job(1), job(2, { waiting: true })],
    contacts: [person('a', { state: 'found', referralJob: job(1).url, degree: 2 })],
  });
  const stopped = await ok({ action: 'finishScans' });
  expect(stopped.referralJobs!.every(j => j.finishedAt! > 0 && !j.waiting)).toBe(true);
  expect(stopped).toMatchObject({ active: true, scope: 'referrals' });
  expect(stopped.status).toBe('Stopped searching at 2 companies. Reaching out to the people already found.');

  await seed({ referralJobs: [job(1), job(2)] });
  const one = await ok({ action: 'skipCompany', url: job(1).url });
  expect(one.referralJobs![0]!.finishedAt).toBeGreaterThan(0);
  expect(one.referralJobs![1]!.finishedAt).toBeUndefined();
});

it('"Stop asking here" takes unsent people out of the queue and leaves anyone already asked alone', async () => {
  await seed({
    referralJobs: [job(1)],
    contacts: [
      person('queued', { referralJob: job(1).url, auto: true }),
      person('draft', { referralJob: job(1).url, state: 'review', approved: true }),
      person('asked', { referralJob: job(1).url, state: 'pending', requestedAt: 5 }),
      person('other', { referralJob: job(2).url }),
    ],
  });
  const after = await ok({ action: 'stopCompany', url: job(1).url });
  expect(after.contacts.map(p => p.state)).toEqual(['found', 'found', 'pending', 'shortlisted']);
  expect(after.status).toBe('Company 1: stopped. 2 people were taken out of the queue; anyone already asked is unchanged.');
});

it('"Check now" asks the engine for an immediate look', async () => {
  await seed();
  expect((await ok({ action: 'checkNow' })).checkRequested).toBe(true);
  await vi.waitFor(() => expect(networkTick).toHaveBeenCalled());
});

it('keeps a conversation in step for someone who was asked, marks the reply, and drafts the next message without sending anything', async () => {
  const { askChatGpt } = await import('../src/background/network-ai');
  const page = {
    id: ID,
    frameId: 0,
    tab: { id: 4 },
    url: 'https://www.linkedin.com/messaging/thread/2-abc==/',
    origin: 'https://www.linkedin.com',
  };
  const talk = (action: string, extra = {}) =>
    new Promise<Record<string, unknown>>(resolve => {
      listener(
        {
          kind: 'network.thread',
          action,
          id: 'ACoAAB-123456',
          name: 'Ananya Rao',
          messages: [
            { mine: true, text: 'Hi Ananya' },
            { mine: false, text: 'Sure, share your CV' },
          ],
          ...extra,
        },
        page,
        r => resolve(r as Record<string, unknown>),
      );
    });
  await seed({
    contacts: [
      person('ananya', { name: 'Ananya Rao', state: 'messaged', messagedAt: 5 }),
      person('stranger', { name: 'Someone Else', messagedAt: 0 }),
    ],
  });
  expect(await talk('sync', { name: 'Not On The List' })).toEqual({ ours: false });
  expect(await talk('sync')).toEqual({ ours: true });
  const saved = (await getNetwork()).contacts[0]!;
  expect(saved).toMatchObject({ messagingId: 'ACoAAB-123456', outcome: 'replied' });
  expect(saved.thread).toHaveLength(2);
  expect(JSON.stringify(await ok({ action: 'status' }))).not.toContain('Sure, share your CV'); // conversations never reach the side panel

  vi.mocked(askChatGpt).mockResolvedValueOnce('{"reply":"Thank you, Ananya. I have attached my CV."}');
  expect(await talk('draft')).toEqual({ ok: true, text: 'Thank you, Ananya. I have attached my CV.' });
  expect(vi.mocked(askChatGpt).mock.calls.at(-1)![0]).toContain('Sure, share your CV');
  vi.mocked(askChatGpt).mockRejectedValueOnce(new Error('Sign in to ChatGPT.'));
  expect(await talk('draft')).toMatchObject({ ok: false, error: 'ChatGPT could not draft a reply: Sign in to ChatGPT.' });
});
