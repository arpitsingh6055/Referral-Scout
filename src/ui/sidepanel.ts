import './network.css';
import { appRoot, element, errorText } from './render';
import { DAY, defaultSettings, introduction, renderNote, withinActiveHours, type ContactState, type NetworkContact, type NetworkRequest, type NetworkState, type OutreachSettings, dueReminders, staleRequests, jobStatuses, type JobStatus, type SavedItem } from '../shared/network';
import { completeCvText } from './cv-text';
import { createToaster, type ToastKind } from './toast';
import { referralPlan } from '../shared/referral';
import type { JobSearch } from '../shared/jobsearch';

type Tab = 'home' | 'referrals' | 'people' | 'saved' | 'activity' | 'setup';
const ui = { tab: 'home' as Tab, filter: 'all', open: new Set<string>() };
const root = appRoot();
let maintenance: HTMLElement[] = [];
let busy = false, dirty = false, spoke = false, last: NetworkState | null = null, signature = '', uid = 0;
const alertBox = element('div'); alertBox.hidden = true;
const page = element('div');
root.append(alertBox, page);
const toaster = createToaster(document.body);

/* ---------- small helpers ---------- */
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const result = element(tag, text); result.className = className; return result;
}
/* Line icons drawn here, so the panel loads nothing from outside. */
const ICONS = {
  home: 'M4 11l8-7 8 7M6 10v9h4v-5h4v5h4v-9', jobs: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 19c0-3 2.7-5 6-5s6 2 6 5M16 5.2a3 3 0 010 5.6M17.5 14.3c2 .6 3.5 2.3 3.5 4.7',
  saved: 'M7 4h10v16l-5-4-5 4z', activity: 'M3 12h4l3-7 4 14 3-7h4', settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4', check: 'M5 12l4 4 10-10',
};
function icon(name: keyof typeof ICONS): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('ico'); path.setAttribute('d', ICONS[name]); svg.append(path); return svg;
}
const csv = (v: string): string[] => v.split(',').map(x => x.trim()).filter(Boolean);
const optional = (v: string): number | null => v.trim() ? Number(v) : null;
const pad = (n: number): string => String(n).padStart(2, '0');
const initials = (name: string): string => name.split(/\s+/).map(n => n[0] ?? '').slice(0, 2).join('').toUpperCase();
const when = (t?: number): string => t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet';
function ago(t: number): string {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
function link(text: string, url: string, className = ''): HTMLAnchorElement {
  const a = node('a', text, className); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
async function request(data: NetworkRequest): Promise<NetworkState> {
  const reply = await chrome.runtime.sendMessage(data) as { ok: boolean; data?: NetworkState; error?: string };
  if (!reply?.ok || !reply.data) throw new Error(reply?.error || 'The extension did not respond. Reload it and retry.');
  return reply.data;
}

/* ---------- feedback: toasts for everything, a banner for errors ---------- */
function notify(kind: ToastKind, message: string): void {
  spoke = true; toaster.show(kind, message);
  if (kind === 'error') {
    const dismiss = node('button', 'Dismiss', 'btn sm ghost'); dismiss.type = 'button';
    dismiss.addEventListener('click', () => { alertBox.hidden = true; });
    alertBox.className = 'alert'; alertBox.setAttribute('role', 'alert'); alertBox.replaceChildren(node('span', message), dismiss); alertBox.hidden = false;
  } else alertBox.hidden = true;
}
const withHint = (m: string): string => /cannot be verified|uncertain|did not return the required|Recover reply/i.test(m) && !/Stuck\?/.test(m)
  ? `${m} Your reply may already be in ChatGPT: open Setup, then "Personalise with ChatGPT", then "Stuck? Recover a ChatGPT reply".` : m;
const aiSteps: [string, string][] = [['queued', 'Preparing the ChatGPT task'], ['tab_opened', 'ChatGPT tab opened, waiting for the page'], ['current_document_ready', 'ChatGPT page is ready'], ['composer_stable', 'Composer is ready'], ['prompt_inserted', 'Prompt pasted, checking it is complete'], ['insertion_verified', 'Prompt verified, sending it'], ['send_clicked', 'Sent, waiting for ChatGPT to accept it'], ['user_turn_verified', 'ChatGPT received it, waiting for the reply'], ['assistant_streaming', 'ChatGPT is writing the reply'], ['completion_verified', 'Reply finished, reading it'], ['response_extracted', 'Reply received, validating it']];
async function withProgress<T>(title: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now(), toast = toaster.show('progress', `${title}…`); spoke = true;
  const poll = setInterval(() => {
    void request({ kind: 'network', action: 'diagnostics' }).then(d => {
      const jobs = (d as NetworkState & { diagnostics?: { stage: string; updatedAt: number }[] }).diagnostics ?? [];
      const latest = jobs.filter(j => j.updatedAt >= started - 2000).sort((a, b) => b.updatedAt - a.updatedAt)[0]; if (!latest) return;
      const i = aiSteps.findIndex(([k]) => k === latest.stage);
      if (i >= 0) toast.update(`${title}: step ${i + 1} of ${aiSteps.length}. ${aiSteps[i]![1]}…`, 'progress');
    }).catch(() => undefined);
  }, 1500);
  try { return await run(); } finally { clearInterval(poll); toast.close(); }
}
function button(text: string, action: () => Promise<void>, className = 'btn', done?: string): HTMLButtonElement {
  const b = node('button', text, className); b.type = 'button';
  b.addEventListener('click', () => {
    if (busy) return; busy = true; b.disabled = true; alertBox.hidden = true; spoke = false;
    void action().then(() => { if (!spoke) notify('success', done ?? `${text}: done.`); })
      .catch(e => notify('error', withHint(errorText(e)))).finally(() => { busy = false; b.disabled = false; });
  });
  return b;
}
async function act(data: NetworkRequest, done?: string): Promise<void> {
  const state = await request(data); render(state); notify('success', done ?? (state.status || 'Done.'));
}

/* ---------- form building blocks ---------- */
interface FieldOptions { label: string; value: string; help?: string; multiline?: boolean; rows?: number; type?: string; min?: string; max?: string }
function field(o: FieldOptions): { wrap: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const id = `f${++uid}`, wrap = node('div', '', 'field'), label = node('label', o.label, 'field-label'); label.htmlFor = id;
  const input = o.multiline ? node('textarea', '', 'input') : node('input', '', 'input');
  input.id = id; input.value = o.value; input.autocomplete = 'off';
  if (input instanceof HTMLTextAreaElement) input.rows = o.rows ?? 3;
  if (input instanceof HTMLInputElement) { input.type = o.type ?? 'text'; if (o.min) input.min = o.min; if (o.max) input.max = o.max; }
  input.addEventListener('input', () => { dirty = true; });
  wrap.append(label, input); if (o.help) wrap.append(node('p', o.help, 'field-help'));
  return { wrap, input };
}
function choice(label: string, value: string, options: [string, string][], help?: string): { wrap: HTMLElement; input: HTMLSelectElement } {
  const id = `f${++uid}`, wrap = node('div', '', 'field'), l = node('label', label, 'field-label'); l.htmlFor = id;
  const input = node('select', '', 'input'); input.id = id;
  for (const [v, name] of options) { const opt = node('option', name); opt.value = v; input.append(opt); }
  input.value = value; input.addEventListener('change', () => { dirty = true; });
  wrap.append(l, input); if (help) wrap.append(node('p', help, 'field-help'));
  return { wrap, input };
}
function accordion(key: string, title: string, badge?: string): { box: HTMLDetailsElement; body: HTMLElement } {
  const box = node('details', '', 'acc'), summary = node('summary'), body = node('div', '', 'acc-body');
  summary.append(node('span', title)); if (badge) summary.append(node('span', badge, 'chip'));
  box.append(summary, body); box.open = ui.open.has(key);
  box.addEventListener('toggle', () => { if (box.open) ui.open.add(key); else ui.open.delete(key); });
  return { box, body };
}
const bubble = (label: string, text: string, over = false, counter = ''): HTMLElement => {
  const wrap = node('div', '', 'preview'), head = node('div', '', 'bubble-label'); head.append(node('span', label), node('span', counter, over ? 'over' : ''));
  wrap.append(head, node('div', text, 'bubble')); return wrap;
};

const stateLabels: Record<ContactState, string> = { found: 'Not contacted', shortlisted: 'Queued', requesting: 'Inviting', pending: 'Invited', connected: 'Accepted', messaging: 'Sending', messaged: 'Introduced', attention: 'Needs you', skipped: 'Skipped', review: 'Needs approval' };
const categoryLabels: Record<string, string> = { recruiter: 'Recruiter', leader: 'Team leader', founder: 'Founder', senior: 'Senior', peer: 'Same team', employee: 'Works there' };

/* ---------- derived status ---------- */
function runStatus(s: NetworkState): { tone: 'ok' | 'warn' | 'idle'; pill: string; title: string; sub: string } {
  const settings = s.settings ?? defaultSettings;
  if (s.paused) return { tone: 'idle', pill: 'Paused', title: 'Paused', sub: s.status || 'Nothing is running. Press Resume to continue where you stopped.' };
  if (s.active && !withinActiveHours(settings)) return { tone: 'warn', pill: 'Waiting', title: 'Waiting for active hours', sub: `Outreach resumes at ${pad(settings.activeHours?.from ?? 8)}:00. Nothing is wrong.` };
  if (s.active && s.scope === 'referrals') return { tone: 'ok', pill: 'Referrals', title: s.jobSearch?.status === 'finding' ? 'Searching for jobs' : 'Working on your referrals', sub: s.status || 'Starting up…' };
  if (s.active) return { tone: 'ok', pill: 'Running', title: 'Outreach is running', sub: s.status || 'Starting up…' };
  if (!s.status) return { tone: 'idle', pill: 'Ready', title: 'Ready to find jobs', sub: 'We search LinkedIn jobs for your role and similar titles. You choose the companies before anyone is contacted.' };
  if (s.jobSearch?.status === 'finding') return { tone: 'ok', pill: 'Searching', title: 'Searching for jobs', sub: s.status };
  return { tone: s.contacts.some(p => p.state === 'attention') ? 'warn' : 'idle', pill: s.active ? 'Running' : 'Paused', title: 'Paused', sub: s.status };
}
function usage(s: NetworkState): { today: number; week: number; next: string } {
  const now = Date.now(), sent = (span: number) => s.actions.filter(a => a.kind === 'connect' && a.confirmed !== false && now - a.at < span).length;
  let next = '';
  if (s.active && s.nextActionAt > now) { const wait = Math.round((s.nextActionAt - now) / 1000); next = wait < 90 ? `Next send in ${Math.max(1, wait)} s` : `Next send in ${Math.round(wait / 60)} min`; }
  return { today: sent(DAY), week: sent(7 * DAY), next };
}
/* Where the person is on the way from a job search to a referral: 0 finding jobs, 1 choosing, 2 finding people, 3 reaching out. */
function journey(s: NetworkState): number {
  const jobs = s.referralJobs ?? [];
  if (s.jobSearch?.status === 'finding') return 0;
  if (s.jobSearch?.status === 'choosing' && s.jobSearch.found.length) return 1;
  if (jobs.some(j => !j.finishedAt)) return 2;
  return jobs.length || s.contacts.some(p => p.referralJob) ? 3 : -1;
}
function meter(label: string, used: number, cap: number | null): HTMLElement {
  const m = node('div', '', 'meter'), head = node('div', '', 'meter-head'), bar = node('div', '', 'bar'), fill = node('i');
  head.append(node('span', label), node('b', cap ? `${used} / ${cap}` : String(used)));
  fill.style.width = `${cap ? Math.min(100, Math.round(used / cap * 100)) : 0}%`; bar.append(fill); m.append(head, bar); return m;
}

/* ---------- screens ---------- */
function welcome(): HTMLElement {
  const hero = node('section', '', 'hero');
  const steps = node('ol', '', 'steps');
  for (const [i, title, text] of [['1', 'Read your profile', 'Once, from your own LinkedIn page. It stays on this device.'], ['2', 'Pick the companies', 'We search LinkedIn jobs for your role and similar titles. You choose which companies to go after.'], ['3', 'Get referrals', 'At each company we find the people whose referral counts and reach out slowly, a few a day.']] as const) {
    const li = node('li', '', 'step'), body = node('div'); body.append(node('strong', title), node('span', text));
    li.append(node('b', i, 'n'), body); steps.append(li);
  }
  hero.append(node('div', 'RS', 'mark'), node('p', 'Referral Scout', 'eyebrow'), node('h1', 'Find jobs. Get referred.'),
    node('p', 'The right people at the right companies, asked politely, at a pace LinkedIn is comfortable with.', 'lede'), steps,
    button('Read my LinkedIn profile', async () => { await act({ kind: 'network', action: 'import' }, 'Profile saved. Check your target role, then press Find jobs and referrals.'); }, 'btn primary block'),
    node('p', 'Sign in to LinkedIn first. LinkedIn restricts automated activity: defaults are deliberately slow and conservative, but you use this at your own risk.', 'fine'));
  return hero;
}

/* People and jobs remembered with the button on LinkedIn pages: reminders, job progress and old requests. */
const jobLabels: Record<JobStatus, string> = { saved: 'Saved', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', rejected: 'Rejected' };
const dayLabel = (t: number): string => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function savedCard(item: SavedItem, due: boolean): HTMLElement {
  const card = node('article', '', due ? 'person due' : 'person'), info = node('div');
  info.append(link(item.title, item.url, 'person-name'), node('p', item.subtitle, 'muted small clamp'));
  card.append(info);
  const badges = node('div', '', 'meta');
  const relation: Record<string, string> = { pending: 'Request pending', connected: 'Connected', 'not-connected': 'Not connected' };
  if (item.type === 'job' && item.status && item.status !== 'saved') badges.append(node('span', `${jobLabels[item.status]} ${dayLabel(item.statusAt ?? item.savedAt)}`, `badge ${item.status === 'rejected' ? '' : item.status === 'applied' ? 'review' : 'connected'}`));
  if (item.acceptedAt) badges.append(node('span', `Accepted ${dayLabel(item.acceptedAt)}`, 'badge connected'));
  else if (item.type === 'person' && item.relation && relation[item.relation]) badges.append(node('span', relation[item.relation]!, item.relation === 'pending' ? 'badge review' : 'badge'));
  if (item.remindAt) badges.append(node('span', due ? 'Reminder due' : `Reminder ${dayLabel(item.remindAt)}`, due ? 'badge attention' : 'chip'));
  badges.append(node('span', `Saved ${dayLabel(item.savedAt)}`, 'chip'));
  card.append(badges);
  if (item.note) card.append(node('p', item.note, 'reason'));
  const update = (patch: object, done: string) => act({ kind: 'network', action: 'updateSaved', url: item.url, ...patch }, done);
  const controls = node('div', '', 'saved-controls');
  const pick = (label: string, options: [string, string][], value: string, onPick: (v: string) => Promise<void>): void => {
    const wrap = node('label', '', 'mini'), select = node('select'); wrap.append(node('span', label), select);
    for (const [v, text] of options) { const o = node('option', text); o.value = v; select.append(o); }
    select.value = value; select.addEventListener('change', () => { void onPick(select.value); }); controls.append(wrap);
  };
  if (item.type === 'job') pick('Progress', jobStatuses.map(st => [st, jobLabels[st]] as [string, string]), item.status ?? 'saved',
    v => update({ status: v }, `${item.title}: marked ${jobLabels[v as JobStatus].toLowerCase()}.`));
  pick('Remind me', [['', item.remindAt ? `On ${dayLabel(item.remindAt)}` : 'No reminder'], ['1', 'Tomorrow'], ['3', 'In 3 days'], ['5', 'In 5 days'], ['7', 'In a week'], ['14', 'In 2 weeks'], ...(item.remindAt ? [['off', 'Turn off'] as [string, string]] : [])], '',
    v => v === '' ? Promise.resolve() : update({ remindDays: v === 'off' ? null : Number(v) }, v === 'off' ? 'Reminder turned off.' : `Reminder set for ${item.title}.`));
  card.append(controls);
  const noteBox = node('details', '', 'inline'), noteEdit = node('textarea', '', 'draft'); noteEdit.value = item.note; noteEdit.rows = 2; noteEdit.maxLength = 300;
  noteEdit.placeholder = 'Why are you keeping this? What do you want to do next?'; noteEdit.addEventListener('input', () => { dirty = true; });
  noteBox.append(node('summary', item.note ? 'Edit note' : 'Add a note'), noteEdit, button('Save note', () => update({ note: noteEdit.value }, 'Note saved.'), 'btn sm'));
  const actions = node('div', '', 'person-actions');
  if (due) actions.append(button('Done', () => update({ remindDays: null }, 'Reminder cleared.'), 'btn sm primary'));
  actions.append(button('Forget', async () => { if (confirm(`Remove ${item.title} from Saved?`)) await act({ kind: 'network', action: 'forget', url: item.url }, `${item.title} removed from Saved.`); }, 'btn sm ghost danger'));
  card.append(noteBox, actions);
  return card;
}
function buildSaved(s: NetworkState): HTMLElement {
  const panel = node('div'), items = s.saved ?? [], due = dueReminders(s), stale = staleRequests(s);
  const section = (title: string, help: string): void => { panel.append(node('h3', title, 'section-title')); if (help) panel.append(node('p', help, 'field-help section-help')); };
  if (due.length) { section(`Due now (${due.length})`, 'You asked to be reminded about these.'); for (const item of due) panel.append(savedCard(item, true)); }
  if (stale.length) {
    section(`Requests unanswered for over 3 weeks (${stale.length})`, 'They are unlikely to be accepted now and count against LinkedIn’s limit on pending invitations. Withdraw them on LinkedIn’s own page.');
    const box = node('article', '', 'person');
    for (const r of stale) { const row = node('p', '', 'stale-row'); row.append(link(r.name, r.url, 'person-name'), node('span', `sent ${dayLabel(r.since)}`, 'muted small')); box.append(row); }
    box.append(link('Open my sent invitations on LinkedIn', 'https://www.linkedin.com/mynetwork/invitation-manager/sent/', 'btn sm'));
    panel.append(box);
  }
  if (!items.length) {
    const e = node('div', '', 'empty'); e.append(node('b', 'Nothing remembered yet'), node('span', 'Open any LinkedIn profile or job and press "Remember" at the bottom left of the page. Add a note, set a reminder, and track jobs you applied to here.'));
    panel.append(e); return panel;
  }
  for (const [type, heading] of [['job', 'Jobs'], ['person', 'People']] as const) {
    const group = items.filter(i => i.type === type && !due.includes(i)); if (!group.length) continue;
    const counts = type === 'job' ? jobStatuses.map(st => [st, group.filter(i => (i.status ?? 'saved') === st).length] as const).filter(([, n]) => n).map(([st, n]) => `${n} ${jobLabels[st].toLowerCase()}`).join(' · ') : '';
    section(`${heading} (${group.length})`, counts);
    for (const item of group) panel.append(savedCard(item, false));
  }
  return panel;
}
/* Referrals: one card per job, with the people who can help in order of how much their word counts. */
/* The shortlist: one job per company, best first, the top ones ticked. The person confirms; nothing is contacted before that. */
const chosen = new Map<string, boolean>(); let perCompanyChoice = 3;
function jobChooser(search: JobSearch): HTMLElement {
  const card = node('section', '', 'card'), list = node('div', '', 'job-list');
  const isOn = (id: string, fallback: boolean): boolean => chosen.get(id) ?? fallback;
  const go = button('', async () => {
    const ids = search.found.filter(j => isOn(j.id, j.picked)).map(j => j.id).slice(0, 20);
    if (!ids.length) throw new Error('Tick at least one company.');
    await act({ kind: 'network', action: 'pickJobs', ids, perCompany: perCompanyChoice }, `${ids.length} ${ids.length === 1 ? 'company' : 'companies'} chosen. Finding who can refer you.`);
    chosen.clear();
  }, 'btn primary block');
  const count = (): void => { const n = search.found.filter(j => isOn(j.id, j.picked)).length; go.textContent = n ? `Find referrers at ${n} ${n === 1 ? 'company' : 'companies'}` : 'Tick at least one company'; go.disabled = !n || n > 20; };
  card.append(node('h2', 'Choose companies', 'card-title'), node('p', 'One job per company, best match first. Companies where you already have a way in are ranked higher. Untick any you do not want. Click a title to open the job on LinkedIn.', 'card-sub'));
  for (const job of search.found) {
    const row = node('label', '', 'job-row'), box = node('input'), text = node('div');
    box.type = 'checkbox'; box.checked = isOn(job.id, job.picked);
    box.addEventListener('change', () => { chosen.set(job.id, box.checked); dirty = true; count(); });
    text.append(link(job.title, job.url, 'job-title'), node('span', `${job.company} · ${job.location}`, 'muted small'));
    if (job.insight) text.append(node('span', job.insight, 'badge connected'));
    if (job.promoted) text.append(node('span', 'Promoted by the employer', 'badge'));
    row.append(box, text, link('View job ↗', job.url, 'job-open')); list.append(row);
  }
  const per = node('label', '', 'mini'), select = node('select'); per.append(node('span', 'Invitations per company'), select);
  for (const n of [3, 4, 5]) { const o = node('option', `${n} people`); o.value = String(n); select.append(o); }
  select.value = String(perCompanyChoice); select.addEventListener('change', () => { perCompanyChoice = Number(select.value); });
  count();
  if (search.dropped?.length) {
    const d = node('details', '', 'inline'); d.append(node('summary', `ChatGPT removed ${search.dropped.length} ${search.dropped.length === 1 ? 'listing' : 'listings'} (adverts or poor matches)`));
    for (const x of search.dropped) d.append(node('p', `${x.title} · ${x.company}: ${x.why}`, 'field-help'));
    card.append(d);
  }
  card.append(list, per, node('p', 'People you already know at a company are messaged on top of this number. LinkedIn allows roughly 100 invitations a week, so fewer, better-chosen people go further.', 'field-help'), go,
    button('Close this list', () => act({ kind: 'network', action: 'cancelJobSearch' }, 'List closed.'), 'btn sm ghost'));
  return card;
}
function buildReferrals(s: NetworkState): HTMLElement {
  const panel = node('div'), jobs = s.referralJobs ?? [], search = s.jobSearch;
  if (search?.status === 'finding') panel.append(node('p', s.plan ? `Searching LinkedIn jobs: title ${Math.min(search.cursor + 1, s.plan.terms.length)} of ${s.plan.terms.length}. ${search.found.length} jobs read so far.` : 'Planning the search…', 'callout'));
  if (search && search.status !== 'finding' && search.found.length) panel.append(jobChooser(search));
  if (s.plan) {
    const d = node('details', '', 'inline'); d.append(node('summary', `Search plan (${s.plan.source === 'chatgpt' ? 'from ChatGPT' : 'built-in'})`),
      node('p', `Job titles searched: ${s.plan.terms.join(', ')}`, 'field-help'),
      node('p', `Large companies: ${s.plan.titles.large.join(', ')}`, 'field-help'), node('p', `Mid-size: ${s.plan.titles.mid.join(', ')}`, 'field-help'), node('p', `Small: ${s.plan.titles.small.join(', ')}`, 'field-help'));
    panel.append(d);
  }
  if (!jobs.length && !search) {
    const e = node('div', '', 'empty'); e.append(node('b', 'No jobs yet'),
      node('span', 'Press “Find jobs and referrals” on Home to search LinkedIn for your target roles. Or open any job on LinkedIn and use “Ask for referrals” or “My connections here” at the bottom left of the page.'));
    panel.append(e); return panel;
  }
  for (const job of jobs) {
    // One person is tied to one job; for a second job at the same company they are still shown, so nobody looks missing.
    const sameCompany = new Set(jobs.filter(j => j.company.toLowerCase() === job.company.toLowerCase()).map(j => j.url));
    const people = s.contacts.filter(p => !!p.referralJob && sameCompany.has(p.referralJob)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const { box, body } = accordion(`ref:${job.url}`, `${job.title} · ${job.company}`, job.finishedAt ? String(people.length) : 'searching…');
    const meta = node('div', '', 'meta');
    meta.append(link('View job ↗', job.url, 'job-open'), node('span', job.mode === 'referral' ? 'Reaching out' : 'Listing only', 'chip'));
    const steps = referralPlan(job).length;
    if (!job.finishedAt) meta.append(node('span', job.companyUrl && !job.companyId && !job.idTried ? 'Finding the company…' : `Searching: step ${Math.min(job.cursor + 1, steps)} of ${steps}`, 'badge review'));
    const first = people.filter(p => p.degree === 1).length;
    if (people.length) meta.append(node('span', `${first} you know · ${people.length - first} to invite`, 'chip'));
    body.append(meta);
    if (job.sizeText) meta.append(node('span', `${job.sizeText}${job.size ? ` · ${job.size === 'large' ? 'large: recruiters, HR, team leads' : job.size === 'small' ? 'small: founders, heads' : 'mid-size'}` : ''}`, 'chip'));
    if (job.strategy) {
      const kind: Record<string, string> = { enterprise: 'Large company', mid: 'Mid-size company', scaleup: 'Scale-up', startup: 'Startup' };
      const plan = node('details', '', 'inline'); plan.append(node('summary', `${kind[job.strategy.type]}: who to ask (${job.strategy.source === 'chatgpt' ? 'ChatGPT' : 'built-in'})`),
        node('p', job.strategy.why, 'field-help'), node('p', `Asking: recruiters and HR, ${job.strategy.titles.join(', ')}`, 'field-help'));
      if (job.strategy.avoid.length) plan.append(node('p', `Not asking strangers who are: ${job.strategy.avoid.join(', ')}`, 'field-help'));
      body.append(plan);
    } else if (job.mode === 'referral' && !job.strategyTried && !job.finishedAt) body.append(node('p', 'Waiting for ChatGPT’s plan for this company…', 'field-help'));
    if (job.error) body.append(node('p', `This company was closed early: LinkedIn pages could not be read (${job.error}). People found before that are listed.`, 'callout'));
    if (job.waiting) {
      // The one question per company: people already known may be enough.
      const ask = node('div', '', 'callout');
      ask.append(node('span', `You already know ${job.known ?? 'some'} ${job.known === 1 ? 'person' : 'people'} here. Ask only them, or also look for people whose referral carries more weight?`),
        button('Ask only them', () => act({ kind: 'network', action: 'referralDecision', url: job.url, widen: false }, `${job.company}: messaging the people you know.`), 'btn sm primary'),
        button('Also find stronger', () => act({ kind: 'network', action: 'referralDecision', url: job.url, widen: true }, `${job.company}: looking for stronger referrers too.`), 'btn sm'));
      body.append(ask);
    }
    if (job.mode === 'connections' && job.finishedAt && people.some(p => p.state === 'found')) body.append(node('p', 'Nobody has been contacted. Press “Ask for a referral” on the people you want to approach; the strongest are at the top.', 'field-help'));
    if (job.mode === 'referral' && job.finishedAt && people.length) body.append(node('p', `People you already know here get a message. The strongest ${job.decision === 'known' ? 0 : job.perCompany ?? 3} others get an invitation. Sends are a few seconds apart and within your daily limits; everyone else is listed below with a button.`, 'field-help'));
    if (job.mode === 'referral' && !s.active && people.some(p => ['shortlisted', 'connected'].includes(p.state))) body.append(node('p', 'Outreach is paused, so nothing is being sent. Press “Resume sending” on Home to continue.', 'field-help'));
    if (!people.length) body.append(node('p', job.finishedAt ? (job.mode === 'connections' ? 'You have no 1st-degree connections at this company. On the job page, press “Ask for referrals” to find its recruiters, the team and people you share connections with.' : 'Nobody suitable was found at this company.') : 'Results appear here as each search finishes.', 'muted small'));
    for (const p of people) body.append(personCard(s, p));
    body.append(button('Remove this job', async () => { if (confirm(`Remove ${job.title} at ${job.company} from Referrals? People already contacted stay on the People list.`)) await act({ kind: 'network', action: 'removeReferralJob', url: job.url }, 'Job removed from Referrals.'); }, 'btn sm ghost danger'));
    panel.append(box);
  }
  return panel;
}
/* The live tracker: what is being done right now, what is finished, what is left, and how long it has been.
   The clock and "last update" tick every second on their own, so the panel never looks frozen between updates. */
const clock = (ms: number): string => { const sec = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
function tick(): void {
  const now = Date.now();
  for (const el of document.querySelectorAll<HTMLElement>('[data-since]')) el.textContent = clock(now - Number(el.dataset.since));
  for (const el of document.querySelectorAll<HTMLElement>('[data-ago]')) {
    const sec = Math.floor((now - Number(el.dataset.ago)) / 1000);
    el.textContent = sec < 5 ? 'Last update just now' : sec < 90 ? `Last update ${sec} s ago` : `Last update ${Math.round(sec / 60)} min ago. Slow pages are retried automatically; nothing is lost.`;
  }
}
setInterval(tick, 1000);
type LiveStep = [state: 'done' | 'now' | 'later', text: string, detail?: string | undefined];
function live(s: NetworkState, stage: number): HTMLElement | null {
  const search = s.jobSearch, jobs = s.referralJobs ?? [], steps: LiveStep[] = [];
  if (s.paused) return null;
  let title = '', expect = '', since = 0;
  if (stage === 0 && search) {
    const terms = s.plan?.terms ?? [];
    title = 'Searching LinkedIn for jobs'; since = search.startedAt;
    expect = 'Usually 2 to 4 minutes. ChatGPT gets up to 2 minutes to suggest similar job titles, then each title takes about 15 seconds because every page is opened and read at a human pace.';
    steps.push([terms.length ? 'done' : 'now', 'Plan the search', terms.length ? `${terms.length} job titles (${s.plan!.source === 'chatgpt' ? 'suggested by ChatGPT' : 'built-in list'})` : s.status]);
    if (terms.length) terms.forEach((t, i) => steps.push([i < search.cursor ? 'done' : i === search.cursor ? 'now' : 'later', `Search “${t}”`, i === search.cursor ? 'Opening LinkedIn Jobs and reading the results' : undefined]));
    else steps.push(['later', 'Search LinkedIn Jobs for each title']);
    steps.push([terms.length && search.cursor >= terms.length ? 'now' : 'later', 'Keep the best job per company', `${search.found.length} jobs read so far`]);
  } else if (stage === 2) {
    const open = jobs.filter(j => !j.finishedAt), current = open.find(j => !j.waiting);
    title = 'Finding who can refer you'; since = Math.min(...open.map(j => j.addedAt));
    expect = 'About 1 to 2 minutes per company: the job page, the company page, then up to five people searches, spaced a few seconds apart.';
    if (open.some(j => j.mode === 'referral' && !j.strategy && !j.strategyTried)) steps.push(['now', 'Ask ChatGPT who is worth approaching at each company', s.status]);
    for (const job of jobs.slice(0, 10)) {
      const found = s.contacts.filter(p => p.referralJob === job.url).length;
      if (job.finishedAt) steps.push(['done', job.company, `${found} ${found === 1 ? 'person' : 'people'} found`]);
      else if (job.waiting) steps.push(['now', job.company, 'Waiting for your answer under “Needs you”']);
      else if (job === current && (job.strategy || job.strategyTried || job.mode !== 'referral')) steps.push(['now', job.company, s.status || 'Searching']);
      else steps.push(['later', job.company]);
    }
    if (jobs.length > 10) steps.push(['later', `${jobs.length - 10} more companies`]);
  } else if (stage === 3 && s.active) {
    const mine = s.contacts.filter(p => p.referralJob), queue = mine.filter(p => ['shortlisted', 'requesting', 'messaging'].includes(p.state) || (p.state === 'connected' && !p.messagedAt));
    if (!queue.length && !mine.some(p => p.state === 'pending')) return null;
    const sent = mine.filter(p => ['pending', 'messaged'].includes(p.state) || p.acceptedAt).length, next = queue[0], wait = usage(s).next;
    title = queue.length ? 'Reaching out' : 'Waiting for replies';
    expect = 'Messages go out one at a time with a pause between them, within your daily limit. Accepted invitations are checked every 2 hours and followed up automatically.';
    steps.push(['done', `${sent} sent so far`]);
    if (next) steps.push(['now', `Next: ${next.name}${next.companyName ? ` at ${next.companyName}` : ''}`, wait || s.status]);
    if (queue.length > 1) steps.push(['later', `${queue.length - 1} more in the queue`]);
    steps.push([queue.length ? 'later' : 'now', 'Watch for accepted invitations', `${mine.filter(p => p.state === 'pending').length} waiting to be accepted`]);
  } else return null;
  const card = node('section', '', 'card live'), head = node('div', '', 'live-head'), list = node('ol', '', 'live-steps'), foot = node('p', '', 'live-foot'), ago = node('span');
  head.append(node('span', '', 'spinner'), node('h3', title, 'live-title'));
  if (since) { const timer = node('span', clock(Date.now() - since), 'live-clock'); timer.dataset.since = String(since); timer.title = 'Time since this started'; head.append(timer); }
  for (const [state, text, detail] of steps) {
    const li = node('li', '', state), mark = node('i'), body = node('div');
    if (state === 'done') mark.append(icon('check'));
    body.append(node('b', text)); if (detail) body.append(node('span', detail)); li.append(mark, body); list.append(li);
  }
  ago.dataset.ago = String((s.log ?? []).at(-1)?.at ?? Date.now()); foot.append(ago);
  card.append(head, list, node('p', expect, 'live-expect'), foot);
  return card;
}

function render(s: NetworkState): void {
  announcedUpTo = Math.max(announcedUpTo, (s.log ?? []).at(-1)?.at ?? 0);
  last = s; signature = JSON.stringify(s); dirty = false; uid = 0;
  const scroll = document.scrollingElement?.scrollTop ?? 0;
  page.replaceChildren();
  if (!s.profile) { page.append(welcome()); return; }
  const status = runStatus(s), settings = s.settings ?? defaultSettings, search = s.jobSearch, jobs = s.referralJobs ?? [];
  const count = (st: ContactState): number => s.contacts.filter(p => p.state === st).length;

  /* Every screen is built on each render and only one is shown, so nothing typed in Settings is lost by moving around. */
  const setup = buildSetup(s, settings), activity = buildActivity(s), home = node('div'), people = node('div');
  setup.panel.append(node('h3', 'Help and your data', 'section-title'), ...maintenance);
  const panels: Record<Tab, HTMLElement> = { setup: setup.panel, home, referrals: buildReferrals(s), people, saved: buildSaved(s), activity };
  const peopleList = node('div'), refreshPeople = (): void => { buildPeople(s, peopleList, refreshPeople); };
  people.append(peopleList);
  for (const [tab, title, sub] of [['setup', 'Settings', 'What you are looking for, your messages and your limits.'], ['referrals', 'Jobs', 'The companies you chose and who can refer you at each.'],
    ['people', 'People', 'Everyone queued, invited or contacted.'], ['saved', 'Saved', 'Jobs and people you remembered on LinkedIn.'], ['activity', 'Activity', 'Everything the extension did for you.']] as const) {
    const head = node('div', '', 'view-head'); head.append(node('h1', title, 'view-title'), node('p', sub, 'view-sub')); panels[tab].prepend(head);
  }

  /* navigation: five places at the bottom, settings behind the icon at the top */
  const tabs = node('nav', '', 'tabs'), tabButtons = new Map<Tab, HTMLElement>(); tabs.setAttribute('role', 'tablist');
  const setTab = (tab: Tab, top = false): void => {
    ui.tab = tab;
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== tab;
    for (const [name, b] of tabButtons) b.setAttribute('aria-selected', String(name === tab));
    if (top) document.scrollingElement?.scrollTo({ top: 0 });
  };
  const toApprove = s.contacts.filter(p => p.state === 'review' && !p.approved).length, attention = count('attention');
  const waiting = jobs.filter(j => j.waiting), choosing = search?.status === 'choosing' && search.found.length > 0;
  // A badge means "something here needs you", never a plain total.
  for (const [tab, label, glyph, n] of [['home', 'Home', 'home', 0], ['referrals', 'Jobs', 'jobs', waiting.length + (choosing ? 1 : 0)], ['people', 'People', 'people', toApprove + attention],
    ['saved', 'Saved', 'saved', dueReminders(s).length], ['activity', 'Activity', 'activity', 0]] as const) {
    const b = node('button', '', 'tab'), wrap = node('span', '', 'tab-ico'); b.type = 'button'; b.setAttribute('role', 'tab');
    wrap.append(icon(glyph)); if (n) wrap.append(node('span', String(n), 'count'));
    b.append(wrap, node('span', label, 'tab-label')); b.addEventListener('click', () => setTab(tab, true)); tabButtons.set(tab, b); tabs.append(b);
  }
  const gear = node('button', '', 'icon-btn'); gear.type = 'button'; gear.title = 'Settings'; gear.setAttribute('aria-label', 'Settings'); gear.append(icon('settings'));
  gear.addEventListener('click', () => setTab(ui.tab === 'setup' ? 'home' : 'setup', true)); tabButtons.set('setup', gear);
  const top = node('header', '', 'top'); top.append(node('div', 'RS', 'mark'), node('span', 'Referral Scout', 'name'), node('span', status.pill, `pill ${status.tone}`), gear);
  const openPeople = (filter: string): void => { ui.filter = filter; refreshPeople(); setTab('people', true); };

  /* ----- home ----- */
  // What is being searched for is the most important setting, so it is shown large, with its own Edit button.
  const hello = node('div', '', 'view-head'), target = node('div', '', 'target'), targetText = node('div'), change = node('button', 'Edit', 'btn sm'); change.type = 'button';
  change.addEventListener('click', () => setTab('setup', true));
  targetText.append(node('span', 'You are looking for', 'target-label'), node('b', `${settings.roles[0] ?? s.target}${settings.roles.length > 1 ? ` +${settings.roles.length - 1} more` : ''}`, 'target-role'));
  if (s.location) targetText.append(node('span', `in ${s.location}`, 'target-place'));
  target.append(targetText, change);
  hello.append(node('h1', `Hi ${s.profile.name.split(/\s+/)[0] ?? ''}`, 'view-title'), target);

  const run = node('section', '', `card run ${status.tone}`), stage = journey(s), stepper = node('ol', '', 'journey');
  ['Find jobs', 'Choose', 'Find people', 'Reach out'].forEach((label, i) => {
    const li = node('li', '', i < stage ? 'done' : i === stage ? 'now' : ''), dot = node('i');
    if (i < stage) dot.append(icon('check')); else dot.textContent = String(i + 1);
    li.append(dot, node('span', label)); stepper.append(li);
  });
  run.append(stepper, node('h2', status.title, 'run-title'), node('p', status.sub, 'run-sub'));
  // One main action at a time. General networking outreach lives in Settings.
  // Pause stops searches as well as sending; Resume picks everything up where it stopped.
  const main = s.paused ? 'btn block' : 'btn primary block';
  if (s.paused) run.append(button('Resume', () => act({ kind: 'network', action: 'resume' }, 'Resumed where you stopped.'), 'btn primary block'));
  if (search?.status === 'finding') {
    run.append(node('p', 'You can keep using your browser. Results appear under Jobs.', 'field-help'),
      button('Stop this search', () => act({ kind: 'network', action: 'cancelJobSearch' }, 'Job search stopped.'), 'btn block'));
  } else if (choosing) {
    run.append(button(`Choose companies (${search!.found.length} found)`, async () => { setTab('referrals', true); }, main));
  } else {
    run.append(button(jobs.length ? 'Find more jobs' : 'Find jobs and referrals', async () => {
      await setup.save();
      await act({ kind: 'network', action: 'findJobs' }, 'Job search started. First the search is planned, then LinkedIn jobs are read.');
    }, main));
  }
  const working = s.active || search?.status === 'finding' || jobs.some(j => !j.finishedAt && !j.waiting);
  if (s.paused) { /* Resume is already the main button */ }
  else if (working) run.append(button('Pause everything', () => act({ kind: 'network', action: 'pause' }, 'Paused. Searches and sending have stopped; your progress is kept.'), 'btn block'));
  else if (s.contacts.some(p => p.referralJob && ['shortlisted', 'connected', 'review'].includes(p.state))) run.append(
    button('Resume sending', () => act({ kind: 'network', action: 'resume' }, 'Sending resumed.'), 'btn block'));
  const used = usage(s), meters = node('div', '', 'meters');
  meters.append(meter('Invitations today', used.today, settings.dailyInvites), meter('This week', used.week, settings.weeklyInvites)); run.append(meters);
  const foot = node('div', '', 'meta'); if (used.next) foot.append(node('span', used.next, 'chip'));
  if (s.active && !withinActiveHours(settings)) foot.append(button('Run now anyway', async () => {
    await request({ kind: 'network', action: 'save', target: s.target, location: s.location, template: s.template, settings: { ...settings, activeHours: null } });
    await act({ kind: 'network', action: 'status' }, 'Quiet hours turned off. Outreach continues now.');
  }, 'btn sm'));
  if (foot.childNodes.length) run.append(foot);

  /* what needs the person, in one list, with the action on the row */
  const todos = node('section', '', 'todos');
  const todo = (tone: 'warn' | 'bad' | 'info', text: string, ...actions: HTMLElement[]): void => {
    const row = node('div', '', `todo ${tone}`), buttons = node('div', '', 'todo-actions'); buttons.append(...actions); row.append(node('span', text), buttons); todos.append(row);
  };
  for (const job of waiting.slice(0, 4)) todo('info', `You already know ${job.known ?? 'some'} ${job.known === 1 ? 'person' : 'people'} at ${job.company}. Ask only them, or also look for stronger referrers?`,
    button('Only them', () => act({ kind: 'network', action: 'referralDecision', url: job.url, widen: false }, `${job.company}: messaging the people you know.`), 'btn sm primary'),
    button('Look wider', () => act({ kind: 'network', action: 'referralDecision', url: job.url, widen: true }, `${job.company}: looking for stronger referrers too.`), 'btn sm'));
  if (toApprove) todo('warn', `${toApprove} ${toApprove === 1 ? 'message needs' : 'messages need'} your approval before anything is sent.`, button('Review', async () => openPeople('review'), 'btn sm primary'),
    ...(s.active && toApprove > 1 ? [button(`Approve all ${toApprove}`, () => act({ kind: 'network', action: 'approve', url: '*' }, `${toApprove} messages approved. They are sent one after another, a few seconds apart.`), 'btn sm')] : []));
  if (attention) todo('bad', `${attention} ${attention === 1 ? 'person needs' : 'people need'} your attention.`, button('Show', async () => openPeople('attention'), 'btn sm'));
  const dueCount = dueReminders(s).length, staleCount = staleRequests(s).length;
  if (dueCount) todo('warn', `${dueCount} ${dueCount === 1 ? 'reminder is' : 'reminders are'} due.`, button('Show', async () => { setTab('saved', true); }, 'btn sm'));
  if (staleCount) todo('info', `${staleCount} connection ${staleCount === 1 ? 'request has' : 'requests have'} been unanswered for over 3 weeks.`, button('Show', async () => { setTab('saved', true); }, 'btn sm'));
  const needs = todos.childElementCount;
  todos.prepend(node('h3', needs ? `Needs you (${needs})` : 'Needs you', 'section-title'));
  if (!needs) todos.append(node('p', s.active ? 'Nothing right now. You can close this panel; work continues in the background.' : 'Nothing right now.', 'all-clear'));

  const kpis = node('div', '', 'kpis');
  for (const [label, value, go] of [['Companies', jobs.length, () => setTab('referrals', true)], ['Invited', count('pending'), () => openPeople('pending')],
    ['Accepted', s.contacts.filter(p => p.acceptedAt).length, () => openPeople('connected')], ['Asked', count('messaged'), () => openPeople('messaged')]] as const) {
    const k = node('button', '', 'kpi'); k.type = 'button'; k.append(node('b', String(value)), node('span', label)); k.addEventListener('click', go); kpis.append(k);
  }
  home.append(hello, run);
  const tracker = live(s, stage); if (tracker) home.append(tracker);
  if (needs || s.active || jobs.length || s.contacts.length) home.append(todos, node('h3', 'Your pipeline', 'section-title'), kpis);
  const log = [...(s.log ?? [])].reverse().slice(0, 3);
  if (log.length) {
    const recent = node('section', '', 'card recent'), headRow = node('div', '', 'row between'), all = node('button', 'See all', 'linkish'); all.type = 'button';
    all.addEventListener('click', () => setTab('activity', true)); headRow.append(node('h3', 'Latest', 'card-title'), all); recent.append(headRow);
    for (const e of log) { const row = node('p', '', `recent-row ${e.kind}`); row.append(node('span', e.text), node('time', ago(e.at))); recent.append(row); }
    home.append(recent);
  } else if (stage < 0) {
    const how = node('section', '', 'card how'); how.append(node('h3', 'How it works', 'card-title'));
    for (const [n, text] of [['1', 'We search LinkedIn jobs for your role and similar titles.'], ['2', 'You tick the companies worth going after.'], ['3', 'At each one we find who can refer you and reach out, a few people a day.']] as const) {
      const row = node('p', '', 'how-row'); row.append(node('b', n), node('span', text)); how.append(row);
    }
    home.append(how);
  }

  page.append(top, panels.setup, panels.home, panels.referrals, panels.people, panels.saved, panels.activity, tabs);
  refreshPeople(); setTab(ui.tab); tick();
  document.scrollingElement?.scrollTo({ top: scroll });
}

/* ---------- setup tab ---------- */
function buildSetup(s: NetworkState, settings: OutreachSettings): { panel: HTMLElement; save: () => Promise<void>; aiMode: HTMLSelectElement } {
  const panel = node('div');
  const roles = field({ label: 'Roles you are looking for', value: settings.roles.join('\n'), multiline: true, rows: 2, help: 'One per line, for example "Product Management internship".' });
  const location = field({ label: 'Where', value: s.location, help: 'A country or city. Leave generic for the widest search.' });
  const noteTemplate = field({ label: 'Invitation note', value: settings.noteTemplate, multiline: true, rows: 3, help: 'Placeholders: {firstName} {myFirstName} {target} {company} {ask}. {ask} is the closing line and changes with the person: openings for a recruiter, their team for a leader, what they are building for a founder. LinkedIn allows 200 characters. Write several versions separated by a line with --- and each person gets one.' });
  const template = field({ label: 'Message after they accept', value: s.template, multiline: true, rows: 4, help: 'Sent once, only after LinkedIn confirms the connection. Same placeholders.' });
  const noteSlot = node('div'), followSlot = node('div');
  const me = s.profile!.name, sample = { name: 'Priya Sharma', companyName: 'Acme', category: 'recruiter' };
  const refresh = (): void => {
    const role = roles.input.value.split(/[\n;,]+/)[0]?.trim() || s.target;
    const note = renderNote({ noteTemplate: noteTemplate.input.value || settings.noteTemplate }, role, sample, me);
    noteSlot.replaceChildren(bubble('Preview for Priya, a recruiter at Acme', note, note.length > 200, `${note.length}/200`));
    followSlot.replaceChildren(bubble('Preview for Priya at Acme', introduction({ template: template.input.value || s.template, target: role }, sample, me)));
  };
  for (const f of [roles, noteTemplate, template]) f.input.addEventListener('input', refresh);
  refresh();

  const who = node('section', '', 'card'); who.append(node('h2', 'What you are looking for', 'card-title'), node('p', 'This drives the job search. Similar job titles are added for you.', 'card-sub'));
  who.append(roles.wrap, location.wrap);
  const wordsAcc = accordion('words', 'Your messages', 'invitation and follow-up'), words = wordsAcc.body; words.append(node('p', 'What we send on your behalf. Review it once, then it is reused.', 'card-sub'), noteTemplate.wrap, noteSlot, template.wrap, followSlot);

  /* pace and safety */
  const outreachMode = choice('Before sending an invitation', settings.outreachMode, [['review', 'Ask me to approve each one'], ['automatic', 'Send automatically']]);
  const followupMode = choice('Before sending the follow-up', settings.followupMode, [['review', 'Ask me to approve each one'], ['automatic', 'Send automatically after acceptance']]);
  const noteMode = choice('Connection note', settings.noteMode, [['preferred', 'Add a note when LinkedIn allows'], ['require', 'Always add a note (skip if not possible)'], ['none', 'Never add a note']]);
  const hours = choice('When to act', settings.activeHours ? 'on' : 'off', [['off', 'Any time of day (default)'], ['on', `Only ${pad(settings.activeHours?.from ?? 8)}:00 to ${pad(settings.activeHours?.to ?? 22)}:00`]], 'With set hours, Home shows a “Run now anyway” button whenever work is waiting for them.');
  const num = (label: string, value: number | null) => field({ label, value: value?.toString() ?? '', type: 'number', min: '1' });
  const pace = field({ label: 'Seconds between sends', value: String(Math.round(settings.paceMinutes * 60)), type: 'number', min: '5', max: '86400' });
  const invites = num('Invitations per day', settings.dailyInvites), weekly = num('Invitations per week', settings.weeklyInvites), messages = num('Follow-ups per day', settings.dailyMessages), pendingCap = num('Max pending invitations', settings.maxPending);
  const allow = field({ label: 'Prefer these companies', value: settings.companyAllowlist.join(', '), help: 'Comma separated. Leave empty for everyone.' });
  const exclude = field({ label: 'Never contact these companies', value: settings.companyExclusions.join(', '), help: 'Comma separated.' });
  const aiMode = choice('How messages are written', settings.aiMode, [['template', 'From my template (default)'], ['chatgpt', 'Let ChatGPT lightly adapt my template for each person']], 'With ChatGPT, your template stays the model: it may only change a small detail to fit the person. No CV or API key is needed; stay signed in at chatgpt.com. If ChatGPT is signed out or fails, your template is used and you are told.');
  const advanced = accordion('advanced', 'Pace, limits and safety', 'recommended defaults');
  const grid = node('div', '', 'grid2'); grid.append(invites.wrap, weekly.wrap, messages.wrap, pendingCap.wrap, pace.wrap);
  const behaviour = node('div'); behaviour.append(outreachMode.wrap, followupMode.wrap, noteMode.wrap, hours.wrap);
  advanced.body.append(behaviour, grid, node('p', 'Empty means no limit. LinkedIn restricts accounts that send too many invitations, so keep these low.', 'field-help'), node('div', '', 'gap'), allow.wrap, exclude.wrap, aiMode.wrap);

  const chatGpt = buildChatGpt(s);
  async function save(): Promise<void> {
    const nextRoles = roles.input.value.split(/[\n;,]+/).map(x => x.trim()).filter(Boolean);
    if (!nextRoles.length) throw new Error('Enter at least one role you are looking for.');
    const next: OutreachSettings = { ...settings, roles: nextRoles, aiMode: aiMode.input.value as OutreachSettings['aiMode'], noteTemplate: noteTemplate.input.value.trim() || settings.noteTemplate,
      weeklyInvites: optional(weekly.input.value), activeHours: hours.input.value === 'on' ? (settings.activeHours ?? { from: 8, to: 22 }) : null,
      outreachMode: outreachMode.input.value as OutreachSettings['outreachMode'], noteMode: noteMode.input.value as OutreachSettings['noteMode'],
      followupMode: followupMode.input.value as OutreachSettings['followupMode'], paceMinutes: Math.min(86400, Math.max(5, Number(pace.input.value) || 30)) / 60, dailyInvites: optional(invites.input.value), dailyMessages: optional(messages.input.value),
      maxPending: optional(pendingCap.input.value), companyAllowlist: csv(allow.input.value), companyExclusions: csv(exclude.input.value) };
    await request({ kind: 'network', action: 'save', target: nextRoles[0]!, location: location.input.value, template: template.input.value, settings: next });
    dirty = false;
  }
  const general = accordion('general', 'General networking outreach (optional)', s.active && s.scope !== 'referrals' ? 'running' : '');
  general.body.append(node('p', 'Not tied to a job: searches LinkedIn for recruiters, team leaders and founders matching your target roles and invites them, with your approval. Use it to grow your network between job searches.', 'card-sub'),
    button(s.active && s.scope !== 'referrals' ? 'Stop general outreach' : 'Start general outreach', async () => {
      if (s.active && s.scope !== 'referrals') { await act({ kind: 'network', action: 'pause' }, 'General outreach stopped.'); return; }
      await save(); await act({ kind: 'network', action: 'start' }, 'General outreach started.');
    }, 'btn block'));
  panel.append(who, wordsAcc.box, advanced.box, chatGpt, general.box);
  if (!s.active) panel.append(button('Save changes', async () => { await save(); await act({ kind: 'network', action: 'status' }, 'Changes saved.'); }, 'btn primary block savebar'));
  else panel.append(node('p', 'Pause outreach to change settings.', 'fine'));
  for (const f of [roles, location, noteTemplate, template, outreachMode, followupMode, noteMode, hours, pace, invites, weekly, messages, pendingCap, allow, exclude, aiMode]) f.input.disabled = s.active;
  return { panel, save, aiMode: aiMode.input };
}

/* optional ChatGPT personalisation: CV, dossier and recovery */
function buildChatGpt(s: NetworkState): HTMLElement {
  const { box, body } = accordion('chatgpt', 'Your CV (optional)', s.cv ? 'added' : '');
  body.append(node('p', 'Outreach works without a CV. Add one only if you use “Rewrite with ChatGPT”: ChatGPT then knows your background and can mention one relevant thing in the message after someone accepts. There is nothing else to set up.', 'card-sub'));
  const cv = node('input', '', 'input'); cv.type = 'file'; cv.disabled = s.active;
  cv.accept = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
  const cvField = node('div', '', 'field'); cvField.append(node('span', s.cv ? `CV: ${s.cv.name} · ${(s.cv.characterCount ?? 0).toLocaleString()} characters` : 'Your CV (PDF, DOCX or TXT)', 'field-label'), cv, node('p', 'Read inside the extension. Only text is used, no file is attached or uploaded.', 'field-help'));
  cv.addEventListener('change', () => {
    if (busy) return; const file = cv.files?.[0]; if (!file) return;
    if (file.size > 30_000_000) { notify('error', 'The CV is larger than 30 MB. Convert it to a text-searchable PDF or DOCX first.'); cv.value = ''; return; }
    busy = true; cv.disabled = true; spoke = false; notify('info', 'Reading your CV on this device. No file is kept…');
    void file.arrayBuffer().then(async buffer => {
      const extracted = await completeCvText(buffer, file.name), pages = (extracted.match(/^\[Page \d+\]/gm) || []).length;
      const saved = await request({ kind: 'network', action: 'saveCv', name: file.name, type: file.type || 'text/plain', text: extracted, ...(pages ? { pages } : {}) });
      render(saved); notify('success', `CV saved: ${extracted.length.toLocaleString()} characters. It is used the next time ChatGPT rewrites a message.`);
    }).catch(e => notify('error', `The CV could not be read: ${errorText(e)}`)).finally(() => { busy = false; cv.disabled = false; });
  });
  body.append(cvField);
  if (s.cv) {
    const preview = node('pre', '', 'source-preview');
    body.append(button('View CV text', async () => { preview.textContent = (await request({ kind: 'network', action: 'ownerData' })).cv?.text || 'No CV text available.'; }, 'btn sm'),
      button('Delete CV', async () => { if (confirm('Delete your CV text from this device?')) await act({ kind: 'network', action: 'deleteCv' }, 'CV deleted.'); }, 'btn sm ghost danger'), preview);
  }
  return box;
}

/* ---------- people tab ---------- */
function buildPeople(s: NetworkState, list: HTMLElement, redraw: () => void): void {
  list.replaceChildren();
  const filters: [string, string, (p: NetworkContact) => boolean][] = [
    ['all', 'All', p => p.state !== 'skipped' && p.state !== 'found'], ['review', 'To approve', p => p.state === 'review'], ['shortlisted', 'Queued', p => p.state === 'shortlisted'],
    ['pending', 'Invited', p => p.state === 'pending'], ['connected', 'Accepted', p => p.state === 'connected'], ['messaged', 'Introduced', p => p.state === 'messaged'],
    ['attention', 'Needs you', p => p.state === 'attention'], ['skipped', 'Skipped', p => p.state === 'skipped']];
  const bar = node('div', '', 'filters');
  for (const [key, label, test] of filters) {
    const n = s.contacts.filter(test).length; if (key !== 'all' && key !== ui.filter && !n) continue;
    const b = node('button', n ? `${label} ${n}` : label, 'filter'); b.type = 'button'; b.setAttribute('aria-pressed', String(ui.filter === key));
    b.addEventListener('click', () => { ui.filter = key; redraw(); }); bar.append(b);
  }
  list.append(bar);
  const test = filters.find(f => f[0] === ui.filter)?.[2] ?? filters[0]![2];
  const urgency = (p: NetworkContact): number => p.state === 'review' ? 0 : p.state === 'attention' ? 1 : 2; // what needs you comes first
  const people = s.contacts.filter(test).sort((a, b) => urgency(a) - urgency(b) || (b.score ?? 0) - (a.score ?? 0));
  if (!people.length) {
    const e = node('div', '', 'empty'); e.append(node('b', s.contacts.length ? 'Nobody in this view' : 'No people yet'), node('span', s.contacts.length ? 'Try another filter.' : 'Press Start. We search for recruiters, team leaders and founders and list them here, best matches first.'));
    list.append(e);
  }
  for (const p of people) list.append(personCard(s, p));
}
function personCard(s: NetworkState, p: NetworkContact): HTMLElement {
  const card = node('article', '', 'person'), head = node('div', '', 'person-head'), info = node('div');
  info.append(link(p.name, p.url, 'person-name'), node('p', p.headline, 'muted small clamp'));
  head.append(node('div', initials(p.name), `avatar ${p.category ?? ''}`), info); card.append(head);
  const badges = node('div', '', 'badges');
  if (p.degree) badges.append(node('span', p.degree === 1 ? '1st · message' : p.degree === 2 ? '2nd · invite' : '3rd · invite', 'chip'));
  if (p.category && categoryLabels[p.category]) badges.append(node('span', categoryLabels[p.category]!, `type ${p.category}`));
  badges.append(node('span', p.state === 'review' && p.approved ? 'Sending soon' : stateLabels[p.state], `badge ${p.state === 'review' && p.approved ? 'connected' : p.state}`)); card.append(badges);
  const line = p.state === 'pending' ? `Invited ${when(p.requestedAt)} · acceptance is checked every 2 hours`
    : p.acceptedAt ? `Accepted ${when(p.acceptedAt)}${p.messagedAt ? ` · introduced ${when(p.messagedAt)}` : ''}` : p.reason;
  card.append(node('p', line, 'reason'));
  let saveEdit: (() => Promise<unknown>) | null = null; // an unsaved rewording is saved before Approve sends anything
  for (const [text, label] of [[p.invitationNote, 'Invitation note'], [p.message, p.messagedAt ? 'Message sent' : 'Message prepared']] as const) {
    if (!text) continue; const d = node('details', '', 'inline'); d.append(node('summary', label));
    const isDraft = p.state === 'review' && !p.approved && (label === 'Invitation note' ? p.approvalKind === 'connect' : p.approvalKind === 'message');
    if (!isDraft) { d.append(node('div', text, 'bubble')); card.append(d); continue; }
    // A draft waiting for approval can be reworded right here before it is sent.
    d.open = true;
    const limit = p.approvalKind === 'connect' ? 200 : 2000, edit = node('textarea', '', 'draft'), counter = node('span', '', 'field-help');
    edit.value = text; edit.rows = p.approvalKind === 'connect' ? 4 : 6; edit.maxLength = 2000; edit.setAttribute('aria-label', `${label} for ${p.name}`);
    const save = button('Save changes', () => act({ kind: 'network', action: 'editDraft', url: p.url, text: edit.value }, `Your wording for ${p.name} is saved.`), 'btn sm');
    const count = (): void => { const n = edit.value.trim().length; counter.textContent = `${n}/${limit}`; counter.classList.toggle('over', n > limit); save.hidden = edit.value.trim() === text.trim(); save.disabled = n > limit || n === 0; };
    edit.addEventListener('input', () => { dirty = true; count(); }); count();
    saveEdit = async () => { if (edit.value.trim() !== text.trim()) await request({ kind: 'network', action: 'editDraft', url: p.url, text: edit.value }); };
    const tools = node('div', '', 'draft-tools');
    tools.append(counter, save);
    if (!p.direct && !p.referralJob) tools.append(
      button('Rewrite with ChatGPT', () => withProgress(`ChatGPT is rewriting the note for ${p.name}`, () => act({ kind: 'network', action: 'prepare', url: p.url }, `ChatGPT rewrote the note for ${p.name}. Read it before approving.`)), 'btn sm ghost'),
      button('Use my template', () => act({ kind: 'network', action: 'templateDraft', url: p.url }, `Back to your template for ${p.name}.`), 'btn sm ghost'));
    d.append(edit, tools); card.append(d);
  }
  const actions = node('div', '', 'person-actions');
  // Approve returns at once: the message joins the send queue, and can be taken back until it actually goes out.
  if (p.state === 'review' && p.approved) actions.append(button('Cancel sending', () => act({ kind: 'network', action: 'unapprove', url: p.url }, `Sending to ${p.name} cancelled.`), 'btn sm'));
  else if (p.state === 'review' && p.approvalKind && s.active) actions.append(button(`Approve ${p.approvalKind === 'connect' ? 'invitation' : 'message'}`, async () => {
    await saveEdit?.();
    await act({ kind: 'network', action: 'approve', url: p.url }, `Approved for ${p.name}. Sending shortly; you can keep approving others.`);
  }, 'btn sm primary'));
  else if (p.state === 'review' && p.approvalKind) actions.append(node('span', 'Press Start outreach to approve and send.', 'field-help'));
  if (p.state === 'found') actions.append(button(p.direct ? 'Ask for a referral' : 'Invite and ask', () => act({ kind: 'network', action: 'askReferral', url: p.url }, `${p.name} queued for a referral request.`), 'btn sm primary'));
  if (p.state === 'shortlisted' && !p.referralJob) actions.append(button('Draft with ChatGPT', () => withProgress(`ChatGPT is drafting for ${p.name}`, () => act({ kind: 'network', action: 'prepare', url: p.url }, `Draft ready for ${p.name}. Nothing was sent.`)), 'btn sm ghost'));
  if (!['messaged', 'skipped', 'requesting', 'messaging'].includes(p.state)) actions.append(button('Skip', () => act({ kind: 'network', action: 'skip', url: p.url }, `${p.name} skipped. Nothing more will be sent.`), 'btn sm ghost'));
  actions.append(button('Delete', async () => { if (confirm(`Delete the saved record for ${p.name}? This does not undo anything on LinkedIn.`)) await act({ kind: 'network', action: 'removeContact', url: p.url }, `Record for ${p.name} deleted.`); }, 'btn sm ghost danger'));
  card.append(actions);
  return card;
}

/* ---------- activity tab ---------- */
function buildActivity(s: NetworkState): HTMLElement {
  const panel = node('div'), feed = node('section', '', 'card');
  feed.append(node('h2', 'What happened', 'card-title'), node('p', 'Newest first.', 'card-sub'));
  const log = [...(s.log ?? [])].reverse();
  if (!log.length) feed.append(node('p', 'Nothing yet. Each step shows up here once a job search starts.', 'muted'));
  else { const ul = node('ul', '', 'timeline'); for (const e of log.slice(0, 30)) { const li = node('li', '', `tl ${e.kind}`), t = node('div'); t.append(node('span', e.text), node('time', ago(e.at))); li.append(node('i'), t); ul.append(li); } feed.append(ul); }
  const tools = node('section', '', 'card'); tools.append(node('h2', 'Tools', 'card-title'), node('p', 'If something stops working after LinkedIn changes its layout, start here.', 'card-sub'));
  tools.append(button('Check this LinkedIn page', async () => {
    const r = (await request({ kind: 'network', action: 'selfTest' }) as NetworkState & { selfTest?: { page: string; found?: number; problems: string[] } }).selfTest;
    if (!r) throw new Error('No result from the page.');
    if (r.problems.length) notify('error', `${r.page}: ${r.problems.join(' ')}`); else notify('success', `${r.page} page reads correctly${r.found !== undefined ? ` (${r.found} found)` : ''}.`);
  }, 'btn'), node('p', 'Open a LinkedIn people search or a profile in a tab, then press this. It only reads the page.', 'field-help'));
  const diag = node('pre', '', 'source-preview'), d = node('details', '', 'inline'); d.append(node('summary', 'Technical details'),
    button('Refresh ChatGPT task details', async () => { diag.textContent = JSON.stringify((await request({ kind: 'network', action: 'diagnostics' }) as NetworkState & { diagnostics?: unknown[] }).diagnostics ?? [], null, 2); }, 'btn sm'), diag);
  tools.append(d);
  const data = node('section', '', 'card'); data.append(node('h2', 'Your data', 'card-title'), node('p', 'Everything stays on this device.', 'card-sub'));
  data.append(button('Export saved data', async () => {
    const out = await request({ kind: 'network', action: 'export' }), url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    const a = node('a'); a.href = url; a.download = 'referral-scout-export.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'btn'), button('Delete everything', async () => {
    if (confirm('Delete your profile, CV, dossier, contacts and task history from this device? This does not undo anything on LinkedIn.')) await act({ kind: 'network', action: 'clear', confirm: true }, 'All local data deleted.');
  }, 'btn ghost danger'));
  panel.append(feed); maintenance = [tools, data];
  return panel;
}

/* ---------- refresh ---------- */
async function refresh(): Promise<void> {
  const typing = page.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
  if (busy || dirty || typing) return; // never throw away what the user is typing
  const current = await request({ kind: 'network', action: 'status' });
  announce(current);
  if (JSON.stringify(current) !== signature) render(current);
}
/* Work done in the background (a search, a draft, a send, a ChatGPT fallback) is announced as a notification too,
   not only written to the Activity tab. Actions the user just pressed already notify on their own. */
let announcedUpTo = -1;
function announce(s: NetworkState): void {
  const log = s.log ?? [], newest = log.at(-1)?.at ?? 0;
  if (announcedUpTo >= 0) for (const entry of log.filter(e => e.at > announcedUpTo).slice(-3)) toaster.show(entry.kind === 'ok' ? 'success' : entry.kind === 'warn' ? 'error' : 'info', entry.text);
  announcedUpTo = Math.max(announcedUpTo, newest);
}
const showLoadError = (e: unknown): void => { if (!last) notify('error', errorText(e)); };
void refresh().catch(showLoadError);
const timer = setInterval(() => { void refresh().catch(showLoadError); }, 2500);
addEventListener('pagehide', () => clearInterval(timer), { once: true });
