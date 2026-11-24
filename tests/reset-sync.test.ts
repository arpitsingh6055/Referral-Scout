import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, emptyNetwork } from '../src/shared/network';
import { newCampaign } from '../src/shared/domain/campaign';
import { emptyProfile } from '../src/shared/domain/profile';
import { makeFact } from '../src/shared/domain/facts';
import {
  activeCampaign,
  allContacts,
  allEvents,
  allFacts,
  allJobs,
  allTasks,
  allThreads,
  getProfile,
  recordEvent,
  saveCampaign,
  saveContacts,
  saveFacts,
  saveJobs,
  saveProfile,
  saveTask,
  saveThreads,
} from '../src/shared/persistence/campaign-store';
import { all, clearDatabase, closeDatabase, get, put } from '../src/storage/database';
import { write } from '../src/storage/state';
import { getNetwork, updateNetwork } from '../src/background/network';
import { settings } from '../src/ui/workbench/screens/settings';
import { setup } from '../src/ui/workbench/screens/setup';
import type { Ctx } from '../src/ui/workbench/shell';

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
vi.mock('../src/background/usage', () => ({ pingUsage: vi.fn().mockResolvedValue(undefined), USAGE_ENDPOINT: '' }));
vi.mock('../src/background/network-browser', () => ({
  closeWorkWindow: vi.fn().mockResolvedValue(undefined),
  networkCommand: vi.fn(),
  networkTab: vi.fn().mockResolvedValue(9),
  readyNetworkTab: vi.fn(),
  showWorkTab: vi.fn(),
  openWorkTab: vi.fn().mockResolvedValue(9),
}));

const ID = 'ext-id';
type Listener = (input: unknown, sender: unknown, respond: (r: unknown) => void) => boolean | void;
const listeners: Listener[] = [];
let sendMessageMock: ReturnType<typeof vi.fn>;
let setPanelBehaviorMock: ReturnType<typeof vi.fn>;

function dispatch<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    let handled = false;
    for (const fn of listeners) {
      const keepOpen = fn(payload, { id: ID }, reply => {
        handled = true;
        resolve(reply as T);
      });
      if (keepOpen === true || handled) return;
    }
    reject(new Error(`No handler accepted ${JSON.stringify(payload)}`));
  });
}

async function seedAllStores(): Promise<void> {
  const now = Date.now();
  await updateNetwork(() => ({
    ...emptyNetwork(),
    profile: { name: 'Arpit Singh', url: 'https://www.linkedin.com/in/arpit45/', headline: 'PGDM', location: 'India', about: '' },
    target: 'Product Intern',
    targetSet: true,
    cv: { name: 'cv.pdf', type: 'application/pdf', text: 'CV body', savedAt: now },
    api: { model: 'gpt-4o-mini', ending: 'WXYZ' },
    settings: { ...defaultSettings, roles: ['Product Intern'], weeklyInvites: 60 },
    contacts: [
      {
        name: 'Recruiter',
        url: 'https://www.linkedin.com/in/recruiter-1/',
        headline: 'Recruiter',
        location: 'India',
        about: '',
        state: 'review',
        approvalKind: 'connect',
        reason: 'Recruiter',
        addedAt: now,
        checkedAt: 0,
        requestedAt: 0,
        messagedAt: 0,
        message: '',
      },
    ],
  }));
  savedApi.value = { key: 'sk-test-0123456789abcdefghijWXYZ', model: 'gpt-4o-mini' };
  await write('llm-api', savedApi.value);
  await write('cv-file', { name: 'cv.pdf', type: 'application/pdf', data: 'AQID', size: 3, savedAt: now });
  await write('apply-profile', { details: { city: 'Delhi' }, eeo: 'leave', answers: {} });
  await write('gmail-identity', 'arpit@example.com');
  await write('default-surface', 'tab');
  await put('aiJobs', { id: 'ai-1', owner: 'https://www.linkedin.com/in/arpit45/', createdAt: now });

  const campaign = newCampaign({ name: 'PM Search', targetRoles: ['Product Intern'], location: 'India' });
  await saveCampaign(campaign);
  const profile = emptyProfile();
  profile.identity.fullName = 'Arpit Singh';
  profile.skills = [{ id: 'skill-1', skill: 'SQL', evidenceRefs: [], provenance: { source: 'user', confidence: 1, capturedAt: now } }];
  await saveProfile(profile);
  await saveFacts([makeFact({ canonicalKey: 'work_authorisation', value: 'India', source: 'user', now })]);
  await saveJobs([
    {
      id: 'job:1',
      sourceId: '1',
      sourceName: 'LinkedIn Jobs',
      canonicalUrl: 'https://www.linkedin.com/jobs/view/1/',
      alternateUrls: [],
      duplicateGroupId: 'dup:1',
      companyName: 'Acme',
      title: 'Product Intern',
      normalizedTitle: 'product intern',
      seniority: 'intern',
      employmentType: 'internship',
      location: 'India',
      workMode: 'onsite',
      observedAt: now,
      availability: 'unknown',
      requirements: ['SQL'],
      responsibilities: [],
      applyType: 'easy-apply',
      effort: 'low',
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await saveContacts([
    {
      id: 'contact:1',
      personKey: 'recruiter-1',
      name: 'Recruiter',
      relationship: 'second-degree',
      category: 'recruiter',
      evidence: [],
      confidence: 0.8,
      emailConfidence: 'unknown',
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await saveTask({
    id: 'app:1',
    campaignId: campaign.id,
    jobId: 'job:1',
    company: 'Acme',
    title: 'Product Intern',
    location: 'India',
    url: 'https://www.linkedin.com/jobs/view/1/',
    source: 'LinkedIn Jobs',
    ats: '',
    route: 'easy-apply',
    fit: 80,
    state: 'queued',
    note: 'Queued',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, from: 'queued', to: 'queued', reason: 'Added' }],
    dedupeKey: 'dup:1',
  });
  await recordEvent({
    campaignId: campaign.id,
    entityId: 'app:1',
    entityKind: 'application',
    type: 'queued',
    company: 'Acme',
    source: 'system',
    occurredAt: now,
    confidence: 'verified',
  });
  await saveThreads([
    {
      id: 'thread-1',
      gmailThreadId: 'thread-1',
      participants: ['hr@acme.com'],
      subject: 'Hi',
      lastMessageAt: now,
      labels: [],
      classificationState: 'unclassified',
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

async function expectAllStoresCleared(): Promise<void> {
  expect(savedApi.value).toBeNull();
  expect((await getNetwork()).profile).toBeNull();
  expect(await activeCampaign()).toBeUndefined();
  expect(await allJobs()).toEqual([]);
  expect(await allContacts()).toEqual([]);
  expect(await allFacts()).toEqual([]);
  expect(await allTasks()).toEqual([]);
  expect(await allEvents()).toEqual([]);
  expect(await allThreads()).toEqual([]);
  expect(await all('aiJobs')).toEqual([]);
  expect((await getProfile()).identity.fullName).toBeUndefined();
  expect(await get('meta', 'llm-api')).toBeUndefined();
  expect(await get('meta', 'cv-file')).toBeUndefined();
  expect(await get('meta', 'apply-profile')).toBeUndefined();
  expect(await get('meta', 'gmail-identity')).toBeUndefined();
  expect(await get('meta', 'default-surface')).toBeUndefined();
}

beforeEach(async () => {
  listeners.length = 0;
  savedApi.value = null;
  sendMessageMock = vi.fn().mockResolvedValue(undefined);
  setPanelBehaviorMock = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: {
      id: ID,
      sendMessage: sendMessageMock,
      onMessage: {
        addListener: (fn: Listener) => {
          listeners.push(fn);
        },
      },
    },
    tabs: { sendMessage: vi.fn().mockResolvedValue(undefined), query: vi.fn().mockResolvedValue([]) },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
    },
    sidePanel: { setPanelBehavior: setPanelBehaviorMock },
  });
  (await import('../src/background/network-messages')).registerNetworkMessages();
  (await import('../src/background/workspace')).registerWorkspaceMessages();
});

afterEach(async () => {
  await clearDatabase();
  await closeDatabase();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('side panel Delete everything clears all dashboard, profile, campaign, and meta stores and notifies open views', async () => {
  await seedAllStores();
  const res = await dispatch<{ ok: boolean; data: { profile: unknown } }>({ kind: 'network', action: 'clear', confirm: true });
  expect(res.ok).toBe(true);
  expect(res.data.profile).toBeNull();
  await expectAllStoresCleared();
  expect(sendMessageMock).toHaveBeenCalledWith({ kind: 'ui.cleared' });
  expect(setPanelBehaviorMock).toHaveBeenCalledWith({ openPanelOnActionClick: true });
});

it('dashboard workspace clear action clears all stores and returns an empty workspace view', async () => {
  await seedAllStores();
  const res = await dispatch<{
    ok: boolean;
    message?: string;
    view: {
      connections: { linkedin: boolean; ai: boolean; gmail: boolean; cv: boolean };
      surface: string;
      storage: { jobs: number; applications: number; contacts: number; events: number; facts: number };
    };
  }>({ kind: 'workspace', action: 'clear', confirm: true });
  expect(res.ok).toBe(true);
  expect(res.message).toBe('All local data deleted from this device.');
  expect(res.view.connections).toEqual({ linkedin: false, ai: false, gmail: false, cv: false });
  expect(res.view.surface).toBe('panel');
  expect(res.view.storage).toEqual({ jobs: 0, applications: 0, contacts: 0, events: 0, facts: 0 });
  await expectAllStoresCleared();
});

it('keeps side-panel outreach settings and dashboard campaign settings in sync', async () => {
  await seedAllStores();
  const res = await dispatch<{ ok: boolean }>({
    kind: 'network',
    action: 'save',
    target: 'APM Intern',
    location: 'Bengaluru',
    template: 'Hi {firstName}, let us connect!',
    settings: { ...defaultSettings, roles: ['APM Intern', 'Product Analyst Intern'], weeklyInvites: 45, outreachMode: 'automatic' },
  });
  expect(res.ok).toBe(true);
  const campaign = await activeCampaign();
  expect(campaign).toMatchObject({
    targetRoles: ['APM Intern', 'Product Analyst Intern'],
    location: 'Bengaluru',
    referral: { weeklyBudget: 45 },
  });
  const ws = await dispatch<{ ok: boolean; view: { outreachAutomatic: boolean } }>({ kind: 'workspace', action: 'view' });
  expect(ws.view.outreachAutomatic).toBe(true);
});

it('renders Delete everything in dashboard Settings and live connection/outreach status in Campaign rules', async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const fakeCtx = {
    view: {
      campaign: newCampaign({ name: 'PM Search', targetRoles: ['PM Intern'], location: 'India' }),
      counts: { total: 0, queued: 0, active: 0, needsYou: 0, uncertain: 0, submitted: 0, failed: 0 },
      inboxCounts: { total: 0, open: 0, high: 0 },
    },
    workspace: {
      profile: emptyProfile(),
      conflicts: [],
      facts: [],
      factSections: [],
      completeness: { complete: 0, total: 1, missing: [] },
      jobs: [],
      contacts: [],
      connections: { linkedin: true, ai: false, gmail: true, cv: true },
      surface: 'panel',
      cv: { hasText: true, imported: false },
      usageReporting: false,
      outreachAutomatic: true,
      storage: { jobs: 2, applications: 1, contacts: 3, events: 4, facts: 1 },
    },
    theme: 'system',
    setTheme: vi.fn(),
    run,
    runNetwork: vi.fn(),
    openExternal: vi.fn(),
    inform: vi.fn(),
    go: vi.fn(),
    openPanel: vi.fn(),
    redraw: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn(),
    busyAction: '',
  } as unknown as Ctx;

  const settingsEl = settings(fakeCtx);
  document.body.append(settingsEl);
  const deleteBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Delete everything');
  expect(deleteBtn).toBeTruthy();

  vi.stubGlobal('confirm', vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true));
  deleteBtn!.click();
  await new Promise(r => setTimeout(r, 10));
  expect(run).not.toHaveBeenCalled();

  deleteBtn!.click();
  await vi.waitFor(() => expect(run).toHaveBeenCalledWith({ kind: 'workspace', action: 'clear', confirm: true }));

  document.body.replaceChildren(setup(fakeCtx));
  const rulesText = document.body.textContent ?? '';
  expect(rulesText).toContain('Gmail outcome syncMatch replies to applications and contactsConnected');
  expect(rulesText).toContain('Automatic outreachUse the weekly budget and contact order without asking each timeOn');
});
