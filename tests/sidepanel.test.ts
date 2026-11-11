import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, emptyNetwork, type NetworkContact } from '../src/shared/network';

const profile = { name: 'Arpit Singh', url: 'https://www.linkedin.com/in/arpit45/', headline: 'PGDM', location: 'India', about: '', rawText: '' };
const person = (slug: string, state: NetworkContact['state'], extra: Partial<NetworkContact> = {}): NetworkContact => ({ name: slug, url: `https://www.linkedin.com/in/${slug}/`, headline: 'Recruiter at Acme', location: 'India', about: '', state, reason: 'Recruiting / people team', addedAt: 1, checkedAt: 0, requestedAt: 0, messagedAt: 0, message: '', ...extra });
let state: ReturnType<typeof emptyNetwork>;
const sent: { action?: string }[] = [];
const $ = <T extends Element>(q: string) => document.querySelector<T>(q);
const byText = (q: string, text: string) => [...document.querySelectorAll<HTMLElement>(q)].find(e => e.textContent?.includes(text));

async function open(patch: Partial<typeof state> = {}) {
  state = { ...emptyNetwork(), profile, settings: { ...defaultSettings, roles: ['Product Management internship'], activeHours: null }, target: 'Product Management internship', ...patch };
  sent.length = 0;
  vi.resetModules(); document.body.innerHTML = '<main id="app"></main>';
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (req: { action?: string }) => { sent.push(req); if (req.action === 'import') state.profile = profile; if (req.action === 'start') state.active = true; if (req.action === 'pause') state.active = false; return { ok: true, data: structuredClone(state) }; }) } });
  await import('../src/ui/sidepanel');
  await vi.waitFor(() => expect($('.top, .hero')).not.toBeNull());
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

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
  await open({ active: true, settings: { ...defaultSettings, roles: ['x'], activeHours: { from: (hour + 2) % 24, to: (hour + 3) % 24 || 1 } } });
  expect($('.run-title')!.textContent).toBe('Waiting for active hours');
  expect($('.run-sub')!.textContent).toMatch(/Nothing is wrong/);
  expect(byText('button', 'Run now anyway')).toBeTruthy();
});

it('opens on the people list once there is something to see, and the review callout jumps to drafts that need approval', async () => {
  await open({ active: true, contacts: [person('a', 'shortlisted', { score: 90 }), person('b', 'review', { approvalKind: 'connect', invitationNote: 'Hi B', score: 50 })] });
  expect($<HTMLElement>('.tab[aria-selected=true]')!.textContent).toContain('People');
  expect(byText('.callout', '1 message needs your approval')).toBeTruthy();
  const names = [...document.querySelectorAll('.person-name')].map(e => e.textContent);
  expect(names[0]).toBe('b');                                  // what needs the user comes first
  expect(byText('button', 'Approve invitation')).toBeTruthy();
});

it('switches tabs without losing what the user typed', async () => {
  await open();
  const roles = $<HTMLTextAreaElement>('textarea')!; roles.value = 'Data Analytics internship'; roles.dispatchEvent(new Event('input', { bubbles: true }));
  byText('.tab', 'Activity')!.click();
  expect($<HTMLElement>('.tab[aria-selected=true]')!.textContent).toContain('Activity');
  byText('.tab', 'Setup')!.click();
  expect($<HTMLTextAreaElement>('textarea')!.value).toBe('Data Analytics internship');
});

it('shows a clear error banner and toast when an action fails', async () => {
  await open();
  (chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (req: { action?: string }) => req.action === 'findJobs' ? { ok: false, error: 'LinkedIn is not signed in.' } : { ok: true, data: structuredClone(state) });
  byText('button', 'Find jobs and referrals')!.click();
  await vi.waitFor(() => expect($('.alert')?.textContent).toContain('LinkedIn is not signed in.'));
  expect(byText('.toast.error', 'LinkedIn is not signed in.')).toBeTruthy();
});

it('shows the activity log newest first', async () => {
  await open({ log: [{ at: Date.now() - 600000, text: 'Searched founders.', kind: 'info' }, { at: Date.now() - 1000, text: 'Invitation confirmed Pending.', kind: 'ok' }] });
  byText('.tab', 'Activity')!.click();
  const items = [...document.querySelectorAll('.tl span')].map(e => e.textContent);
  expect(items).toEqual(['Invitation confirmed Pending.', 'Searched founders.']);
});
