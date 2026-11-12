import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, emptyNetwork, type NetworkContact } from '../src/shared/network';

const profile = {
  name: 'Arpit Singh',
  url: 'https://www.linkedin.com/in/arpit45/',
  headline: 'PGDM',
  location: 'India',
  about: '',
  rawText: '',
};
const person = (slug: string, state: NetworkContact['state'], extra: Partial<NetworkContact> = {}): NetworkContact => ({
  name: slug,
  url: `https://www.linkedin.com/in/${slug}/`,
  headline: 'Recruiter at Acme',
  location: 'India',
  about: '',
  state,
  reason: 'Recruiting / people team',
  addedAt: 1,
  checkedAt: 0,
  requestedAt: 0,
  messagedAt: 0,
  message: '',
  ...extra,
});
let state: ReturnType<typeof emptyNetwork>;
const sent: { action?: string }[] = [];
const $ = <T extends Element>(q: string) => document.querySelector<T>(q);
const byText = (q: string, text: string) => [...document.querySelectorAll<HTMLElement>(q)].find(e => e.textContent?.includes(text));

async function open(patch: Partial<typeof state> = {}) {
  state = {
    ...emptyNetwork(),
    targetSet: true,
    profile,
    settings: { ...defaultSettings, roles: ['Product Management internship'], activeHours: null },
    target: 'Product Management internship',
    ...patch,
  };
  sent.length = 0;
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (req: { action?: string }) => {
        sent.push(req);
        if (req.action === 'import') state.profile = profile;
        if (req.action === 'start') state.active = true;
        if (req.action === 'pause') state.active = false;
        return { ok: true, data: structuredClone(state) };
      }),
    },
  });
  await import('../src/ui/sidepanel');
  await vi.waitFor(() => expect($('.top, .hero')).not.toBeNull());
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('shows the three-step welcome screen before a profile is read, and reads it on one click', async () => {
  await open({ profile: null as never });
  expect(document.querySelectorAll('.step')).toHaveLength(3);
  byText('button', 'Read my LinkedIn profile')!.click();
  await vi.waitFor(() => expect($('.tabs')).not.toBeNull());
  expect(sent.map(r => r.action)).toContain('import');
});

it('starts a job search in one click: saves the settings first, then starts, then shows a success notification', async () => {
  await open();
  byText('button', 'Find jobs and referrals')!.click();
  await vi.waitFor(() => expect(sent.map(r => r.action)).toEqual(expect.arrayContaining(['save', 'findJobs'])));
  expect(sent.map(r => r.action).indexOf('save')).toBeLessThan(sent.map(r => r.action).indexOf('findJobs'));
  await vi.waitFor(() => expect(byText('.toast', 'Job search started')).toBeTruthy());
});

it('keeps general networking outreach available in Setup, off the home screen', async () => {
  await open();
  expect(byText('button', 'Start outreach')).toBeFalsy();
  expect(byText('button', 'Start general outreach')).toBeTruthy();
});

it('tells the user what is happening instead of looking dead outside active hours', async () => {
  const hour = new Date().getHours();
  await open({
    active: true,
    settings: { ...defaultSettings, roles: ['x'], activeHours: { from: (hour + 2) % 24, to: (hour + 3) % 24 || 1 } },
  });
  expect($('.run-title')!.textContent).toBe('Waiting for active hours');
  expect($('.run-sub')!.textContent).toMatch(/Nothing is wrong/);
  expect(byText('button', 'Run now anyway')).toBeTruthy();
});

it('opens on Home, lists what needs the person there, and Review jumps to the drafts that need approval', async () => {
  await open({
    active: true,
    contacts: [
      person('a', 'shortlisted', { score: 90 }),
      person('b', 'review', { approvalKind: 'connect', invitationNote: 'Hi B', score: 50 }),
    ],
  });
  expect($<HTMLElement>('.tab[aria-selected=true]')!.textContent).toContain('Home');
  expect(byText('.todo', '1 message needs your approval')).toBeTruthy();
  expect(byText('.tab', 'People')!.querySelector('.count')!.textContent).toBe('1'); // a badge only where something needs the person
  byText('.todo button', 'Review')!.click();
  expect($<HTMLElement>('.tab[aria-selected=true]')!.textContent).toContain('People');
  const names = [...document.querySelectorAll('.person-name')].map(e => e.textContent);
  expect(names[0]).toBe('b'); // what needs the user comes first
  expect(byText('button', 'Approve invitation')).toBeTruthy();
});

it('shows where the person is on the way to a referral, and answers the per-company question from Home', async () => {
  await open({
    scope: 'referrals',
    active: true,
    referralJobs: [
      {
        url: 'https://www.linkedin.com/jobs/view/1/',
        title: 'Ops Intern',
        company: 'Stripe',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 2,
        found: 1,
        waiting: true,
        known: 2,
      },
    ],
  });
  expect([...document.querySelectorAll('.journey li')].map(li => li.className)).toEqual(['done', 'done', 'now', '']);
  byText('.todo button', 'Only them')!.click();
  await vi.waitFor(() => expect(sent.find(r => r.action === 'referralDecision')).toMatchObject({ widen: false }));
});

it('switches tabs without losing what the user typed', async () => {
  await open();
  const roles = $<HTMLTextAreaElement>('textarea')!;
  roles.value = 'Data Analytics internship';
  roles.dispatchEvent(new Event('input', { bubbles: true }));
  byText('.tab', 'Activity')!.click();
  expect($<HTMLElement>('.tab[aria-selected=true]')!.textContent).toContain('Activity');
  $<HTMLElement>('[aria-label="Settings"]')!.click();
  expect($<HTMLTextAreaElement>('textarea')!.value).toBe('Data Analytics internship');
});

it('shows a clear error banner and toast when an action fails', async () => {
  await open();
  (chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (req: { action?: string }) =>
    req.action === 'findJobs' ? { ok: false, error: 'LinkedIn is not signed in.' } : { ok: true, data: structuredClone(state) },
  );
  byText('button', 'Find jobs and referrals')!.click();
  await vi.waitFor(() => expect($('.alert')?.textContent).toContain('LinkedIn is not signed in.'));
  expect(byText('.toast.error', 'LinkedIn is not signed in.')).toBeTruthy();
});

it('shows the activity log newest first', async () => {
  await open({
    log: [
      { at: Date.now() - 600000, text: 'Searched founders.', kind: 'info' },
      { at: Date.now() - 1000, text: 'Invitation confirmed Pending.', kind: 'ok' },
    ],
  });
  byText('.tab', 'Activity')!.click();
  const items = [...document.querySelectorAll('.tl span')].map(e => e.textContent);
  expect(items).toEqual(['Invitation confirmed Pending.', 'Searched founders.']);
});

it('shows a live tracker while jobs are searched: the plan done, the title being searched, the titles left and a running clock', async () => {
  await open({
    status: 'Searching LinkedIn jobs…',
    plan: {
      forRoles: 'Product Management internship',
      terms: ['pm intern', 'apm intern', 'product analyst intern'],
      titles: { large: [], mid: [], small: [] },
      source: 'rules',
      at: 1,
    },
    jobSearch: { status: 'finding', cursor: 1, found: [], startedAt: Date.now() - 65_000 },
  });
  expect([...document.querySelectorAll('.live-steps li')].map(li => li.className)).toEqual(['done', 'done', 'now', 'later', 'later']);
  expect($('.live-clock')!.textContent).toMatch(/^1:0\d$/);
  expect($('.live-expect')!.textContent).toMatch(/Usually 2 to 4 minutes/);
});

it('when paused, Resume is the main action and the live tracker is hidden; while a search runs, Pause is offered even if sending is off', async () => {
  await open({
    paused: true,
    status: 'Paused. Your saved people and progress are kept.',
    jobSearch: { status: 'finding', cursor: 0, found: [], startedAt: Date.now() },
  });
  expect($('.run-title')!.textContent).toBe('Paused');
  expect(byText('button.primary', 'Resume')).toBeTruthy();
  expect($('.live')).toBeNull();
  await open({ active: false, jobSearch: { status: 'finding', cursor: 0, found: [], startedAt: Date.now() } });
  expect(byText('button', 'Pause everything')).toBeTruthy();
  expect($('.live')).not.toBeNull();
});

it('asks what the person is looking for during setup instead of assuming a role, and saves the answer', async () => {
  await open({ targetSet: false });
  expect($('.tabs')).toBeNull();
  expect($<HTMLTextAreaElement>('textarea')!.value).toBe('');
  byText('button', 'Continue')!.click();
  await vi.waitFor(() => expect(byText('.toast.error', 'Type the role you are looking for')).toBeTruthy());
  const role = $<HTMLTextAreaElement>('textarea')!,
    place = $<HTMLInputElement>('input')!;
  role.value = 'Operations intern';
  place.value = 'Bengaluru';
  byText('button', 'Continue')!.click();
  await vi.waitFor(() =>
    expect(sent.find(r => r.action === 'save')).toMatchObject({
      target: 'Operations intern',
      location: 'Bengaluru',
      settings: { roles: ['Operations intern'] },
    }),
  );
});

it('tracks outcomes: a pipeline row per company, one-press marks on a person, and "I applied" on the job', async () => {
  const jobUrl = 'https://www.linkedin.com/jobs/view/1/';
  await open({
    referralJobs: [
      {
        url: jobUrl,
        title: 'Ops Intern',
        company: 'Stripe',
        location: '',
        mode: 'referral',
        addedAt: 1,
        cursor: 4,
        found: 2,
        finishedAt: 1,
      },
    ],
    contacts: [
      person('a', 'messaged', { referralJob: jobUrl, messagedAt: 5, acceptedAt: 4, outcome: 'referred' }),
      person('b', 'pending', { referralJob: jobUrl, requestedAt: 3 }),
    ],
  });
  expect([...document.querySelectorAll('.kpi')].map(k => k.textContent)).toEqual([
    '1Companies',
    '2Asked',
    '1Accepted',
    '1Replied',
    '1Referred',
    '0Applied',
  ]);
  byText('.tab', 'Jobs')!.click();
  expect([...document.querySelectorAll('.board-cell')].map(c => c.textContent)).toEqual(['2', '1', '1', '1', '·']);
  byText('button', 'I applied')!.click();
  await vi.waitFor(() => expect(sent.find(r => r.action === 'jobApplied')).toMatchObject({ url: jobUrl, applied: true }));
  await new Promise(r => setTimeout(r, 30)); // the first press finishes before the next
  byText('.outcome button', 'They replied')!.click();
  await vi.waitFor(() => expect(sent.find(r => r.action === 'outcome')).toMatchObject({ outcome: 'replied' }));
});

it('offers an API key as an option in Settings, shows only its last characters once saved, and never the key', async () => {
  await open();
  expect(byText('details.acc summary', 'ChatGPT connection')!.textContent).toContain('website (default)');
  await open({ api: { model: 'some-model', ending: 'WXYZ' } });
  expect(byText('details.acc', 'ChatGPT connection')!.textContent).toContain('model some-model, key ending in WXYZ');
  expect(document.querySelector('input[type=password]')).toBeNull();
  expect(byText('button', 'Remove the key')).toBeTruthy();
});

it('ends setup on Home, not Settings, and suggests the CV and a message check there', async () => {
  await open();
  $<HTMLElement>('[aria-label="Settings"]')!.click(); // the panel was last on Settings, as after "Delete everything"
  state = { ...state, targetSet: false };
  byText('button', 'Save changes')!.click();
  await vi.waitFor(() => expect(byText('button', 'Continue')).toBeTruthy());
  $<HTMLTextAreaElement>('textarea')!.value = 'Sales intern';
  state = { ...state, targetSet: true };
  byText('button', 'Continue')!.click();
  await vi.waitFor(() => expect($<HTMLElement>('.tab[aria-selected=true]')?.textContent).toContain('Home'));
  expect(byText('.tip', 'Add your CV')).toBeTruthy();
  expect(byText('.tip', 'Use your OpenAI API key')).toBeTruthy();
  byText('.tip button', 'Add CV')!.click();
  expect($<HTMLElement>('[aria-label="Settings"]')!.getAttribute('aria-selected')).toBe('true');
  expect((byText('details.acc', 'Your CV') as HTMLDetailsElement).open).toBe(true);
});

it('goes back to Home after Save changes in Settings', async () => {
  await open();
  $<HTMLElement>('[aria-label="Settings"]')!.click();
  byText('button', 'Save changes')!.click();
  await vi.waitFor(() => expect(byText('.toast', 'Changes saved.')).toBeTruthy());
  expect($<HTMLElement>('.tab[aria-selected=true]')!.textContent).toContain('Home');
  expect(sent.map(r => r.action)).toContain('save');
});
