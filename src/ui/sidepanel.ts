import './network.css';
import { appRoot, element, errorText } from './render';
import { DAY, defaultSettings, introduction, renderNote, withinActiveHours, type ContactState, type NetworkContact, type NetworkRequest, type NetworkState, type OutreachSettings, dueReminders, staleRequests, jobStatuses, type JobStatus, type SavedItem } from '../shared/network';
import { completeCvText } from './cv-text';
import { createToaster, type ToastKind } from './toast';

type Tab = 'setup' | 'people' | 'saved' | 'activity';
const ui = { tab: 'setup' as Tab, filter: 'all', open: new Set<string>() };
const root = appRoot();
let busy = false, dirty = false, spoke = false, opened = false, last: NetworkState | null = null, signature = '', uid = 0;
const alertBox = element('div'); alertBox.hidden = true;
const page = element('div');
root.append(alertBox, page);
const toaster = createToaster(document.body);

/* ---------- small helpers ---------- */
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const result = element(tag, text); result.className = className; return result;
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

const stateLabels: Record<ContactState, string> = { shortlisted: 'Queued', requesting: 'Inviting', pending: 'Invited', connected: 'Accepted', messaging: 'Sending', messaged: 'Introduced', attention: 'Needs you', skipped: 'Skipped', review: 'Needs approval' };
const categoryLabels: Record<string, string> = { recruiter: 'Recruiter', leader: 'Team leader', founder: 'Founder' };

/* ---------- derived status ---------- */
function runStatus(s: NetworkState): { tone: 'ok' | 'warn' | 'idle'; pill: string; title: string; sub: string } {
  const settings = s.settings ?? defaultSettings;
  if (s.active && !withinActiveHours(settings)) return { tone: 'warn', pill: 'Waiting', title: 'Waiting for active hours', sub: `Outreach resumes at ${pad(settings.activeHours?.from ?? 8)}:00. Nothing is wrong.` };
  if (s.active) return { tone: 'ok', pill: 'Running', title: 'Outreach is running', sub: s.status || 'Starting up…' };
  if (!s.status) return { tone: 'idle', pill: 'Ready', title: 'Ready to start', sub: 'Check who we contact and your messages in Setup, then press Start.' };
  return { tone: s.contacts.some(p => p.state === 'attention') ? 'warn' : 'idle', pill: 'Paused', title: 'Paused', sub: s.status };
}
function usage(s: NetworkState): string[] {
  const settings = s.settings ?? defaultSettings, now = Date.now();
  const sent = (span: number) => s.actions.filter(a => a.kind === 'connect' && a.confirmed !== false && now - a.at < span).length;
  const chips = [`Today ${sent(DAY)}/${settings.dailyInvites ?? '∞'} invitations`, `This week ${sent(7 * DAY)}/${settings.weeklyInvites ?? '∞'}`];
  if (s.active && s.nextActionAt > now) { const wait = Math.round((s.nextActionAt - now) / 1000); chips.push(wait < 90 ? `Next send in ${Math.max(1, wait)} s` : `Next send in ${Math.round(wait / 60)} min`); }
  return chips;
}

/* ---------- screens ---------- */
function welcome(): HTMLElement {
  const hero = node('section', '', 'hero');
  const steps = node('ol', '', 'steps');
  for (const [i, title, text] of [['1', 'Read your profile', 'We read your own LinkedIn profile once. It stays on this device.'], ['2', 'Check who and what', 'See who we will contact and the messages we will send. Edit anything.'], ['3', 'Press Start', 'We find recruiters, team leaders and founders and reach out slowly, a few a day.']] as const) {
    const li = node('li', '', 'step'), body = node('div'); body.append(node('strong', title), node('span', text));
    li.append(node('b', i, 'n'), body); steps.append(li);
  }
  hero.append(node('div', 'cc', 'mark'), node('h1', 'Reach the right people on LinkedIn'),
    node('p', 'Find recruiters, hiring leaders and founders for the roles you want, and send a short, human introduction. Slow, safe and under your control.', 'lede'), steps,
    button('Read my LinkedIn profile', async () => { await act({ kind: 'network', action: 'import' }, 'Profile saved. Check who we will contact and your messages, then press Start.'); }, 'btn primary block'),
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
function render(s: NetworkState): void {
  announcedUpTo = Math.max(announcedUpTo, (s.log ?? []).at(-1)?.at ?? 0);
  last = s; signature = JSON.stringify(s); dirty = false; uid = 0;
  const scroll = document.scrollingElement?.scrollTop ?? 0;
  page.replaceChildren();
  const status = runStatus(s);
  // First screen: setup for a new user, the people list once there is something to look at.
  if (!opened && s.profile) { opened = true; ui.tab = s.active || s.contacts.length ? 'people' : 'setup'; }
  if (!s.profile) { page.append(welcome()); return; }
  const top = node('header', '', 'top'); top.append(node('div', 'cc', 'mark'), node('span', 'Cold Contact Pro', 'name'), node('span', status.pill, `pill ${status.tone}`));
  page.append(top);
  const settings = s.settings ?? defaultSettings;
  const count = (st: ContactState): number => s.contacts.filter(p => p.state === st).length;

  const profile = node('div', '', 'profile'), who = node('div');
  who.append(link(s.profile.name, s.profile.url, 'profile-name'), node('p', s.profile.headline, 'muted small clamp'));
  profile.append(node('div', initials(s.profile.name), 'avatar'), who); page.append(profile);

  /* the setup form exists in every tab so Start can always save it */
  const setup = buildSetup(s, settings);
  const panels: Record<Tab, HTMLElement> = { setup: setup.panel, people: node('div'), saved: buildSaved(s), activity: buildActivity(s) };
  const tabs = node('div', '', 'tabs'), tabButtons = new Map<Tab, HTMLButtonElement>();
  const setTab = (tab: Tab): void => {
    ui.tab = tab;
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== tab;
    for (const [name, b] of tabButtons) b.setAttribute('aria-selected', String(name === tab));
  };
  const peopleList = node('div'), refreshPeople = (): void => { buildPeople(s, peopleList, refreshPeople); };
  panels.people.append(peopleList);
  const toApprove = s.contacts.filter(p => p.state === 'review' && !p.approved).length, reviewCount = toApprove;
  for (const [tab, label, n] of [['setup', 'Setup', 0], ['people', 'People', s.contacts.filter(p => p.state !== 'skipped').length], ['saved', 'Saved', dueReminders(s).length || (s.saved ?? []).length], ['activity', 'Activity', 0]] as const) {
    const b = node('button', label, 'tab'); b.type = 'button'; b.setAttribute('role', 'tab');
    if (n) b.append(node('span', String(n), 'count'));
    b.addEventListener('click', () => setTab(tab)); tabButtons.set(tab, b); tabs.append(b);
  }
  const openPeople = (filter: string): void => { ui.filter = filter; refreshPeople(); setTab('people'); document.scrollingElement?.scrollTo({ top: 0 }); };

  /* run card */
  const run = node('section', '', 'card run');
  run.append(node('h2', status.title, 'run-title'), node('p', status.sub, 'run-sub'));
  run.append(button(s.active ? 'Pause outreach' : 'Start outreach', async () => {
    if (s.active) { await act({ kind: 'network', action: 'pause' }, 'Outreach paused. Your progress is kept.'); return; }
    await setup.save();
    await act({ kind: 'network', action: 'start' }, 'Outreach started. It works in its own window and pauses on anything uncertain.');
  }, s.active ? 'btn block' : 'btn primary block'));
  const meta = node('div', '', 'meta'); for (const text of usage(s)) meta.append(node('span', text, 'chip'));
  if (s.active && !withinActiveHours(settings)) meta.append(button('Run now anyway', async () => {
    await request({ kind: 'network', action: 'save', target: s.target, location: s.location, template: s.template, settings: { ...settings, activeHours: null } });
    await act({ kind: 'network', action: 'status' }, 'Quiet hours turned off. Outreach continues now.');
  }, 'btn sm ghost'));
  run.append(meta); page.append(run);

  const kpis = node('div', '', 'kpis');
  for (const [label, value] of [['Queued', count('shortlisted')], ['Approve', reviewCount], ['Invited', count('pending')], ['Accepted', s.contacts.filter(p => p.acceptedAt).length], ['Intro', count('messaged')]] as const) {
    const k = node('div', '', 'kpi'); k.append(node('b', String(value)), node('span', label)); kpis.append(k);
  }
  page.append(kpis);
  if (reviewCount) { const c = node('div', '', 'callout'); c.append(node('span', `${reviewCount} ${reviewCount === 1 ? 'message needs' : 'messages need'} your approval before anything is sent.`), button('Review', async () => openPeople('review'), 'btn sm primary'), ...(s.active && toApprove > 1 ? [button(`Approve all ${toApprove}`, () => act({ kind: 'network', action: 'approve', url: '*' }, `${toApprove} messages approved. They are sent one after another, a few seconds apart.`), 'btn sm primary')] : [])); page.append(c); }
  const dueCount = dueReminders(s).length, staleCount = staleRequests(s).length;
  if (dueCount) { const c = node('div', '', 'callout'); c.append(node('span', `${dueCount} ${dueCount === 1 ? 'reminder is' : 'reminders are'} due.`), button('Show', async () => { setTab('saved'); }, 'btn sm')); page.append(c); }
  if (staleCount) { const c = node('div', '', 'callout'); c.append(node('span', `${staleCount} connection ${staleCount === 1 ? 'request has' : 'requests have'} been unanswered for over 3 weeks.`), button('Show', async () => { setTab('saved'); }, 'btn sm')); page.append(c); }
  const attention = count('attention');
  if (attention) { const c = node('div', '', 'callout bad'); c.append(node('span', `${attention} ${attention === 1 ? 'person needs' : 'people need'} your attention.`), button('Show', async () => openPeople('attention'), 'btn sm')); page.append(c); }

  page.append(tabs, panels.setup, panels.people, panels.saved, panels.activity);
  refreshPeople(); setTab(ui.tab);
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

  const who = node('section', '', 'card'); who.append(node('h2', 'Who to contact', 'card-title'), node('p', 'We skip students, open-to-work profiles, former roles, assistants, and anyone you already know.', 'card-sub'));
  const types = node('div', '', 'types'); for (const [k, v] of Object.entries(categoryLabels)) types.append(node('span', v, `type ${k}`));
  who.append(types, roles.wrap, location.wrap);
  const words = node('section', '', 'card'); words.append(node('h2', 'Your messages', 'card-title'), node('p', 'What we send on your behalf. Review it once, then it is reused.', 'card-sub'), noteTemplate.wrap, noteSlot, template.wrap, followSlot);

  /* pace and safety */
  const outreachMode = choice('Before sending an invitation', settings.outreachMode, [['review', 'Ask me to approve each one'], ['automatic', 'Send automatically']]);
  const followupMode = choice('Before sending the follow-up', settings.followupMode, [['review', 'Ask me to approve each one'], ['automatic', 'Send automatically after acceptance']]);
  const noteMode = choice('Connection note', settings.noteMode, [['preferred', 'Add a note when LinkedIn allows'], ['require', 'Always add a note (skip if not possible)'], ['none', 'Never add a note']]);
  const hours = choice('When to act', settings.activeHours ? 'on' : 'off', [['on', `Only ${pad(settings.activeHours?.from ?? 8)}:00 to ${pad(settings.activeHours?.to ?? 22)}:00 (recommended)`], ['off', 'Any time of day']]);
  const num = (label: string, value: number | null) => field({ label, value: value?.toString() ?? '', type: 'number', min: '1' });
  const pace = field({ label: 'Seconds between sends', value: String(Math.round(settings.paceMinutes * 60)), type: 'number', min: '15', max: '86400' });
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
      followupMode: followupMode.input.value as OutreachSettings['followupMode'], paceMinutes: Number(pace.input.value) / 60, dailyInvites: optional(invites.input.value), dailyMessages: optional(messages.input.value),
      maxPending: optional(pendingCap.input.value), companyAllowlist: csv(allow.input.value), companyExclusions: csv(exclude.input.value) };
    await request({ kind: 'network', action: 'save', target: nextRoles[0]!, location: location.input.value, template: template.input.value, settings: next });
    dirty = false;
  }
  panel.append(who, words, advanced.box, chatGpt);
  if (!s.active) panel.append(button('Save changes', async () => { await save(); await act({ kind: 'network', action: 'status' }, 'Changes saved.'); }, 'btn block'));
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
    ['all', 'All', p => p.state !== 'skipped'], ['review', 'To approve', p => p.state === 'review'], ['shortlisted', 'Queued', p => p.state === 'shortlisted'],
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
    if (!p.direct) tools.append(
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
  if (p.state === 'shortlisted') actions.append(button('Draft with ChatGPT', () => withProgress(`ChatGPT is drafting for ${p.name}`, () => act({ kind: 'network', action: 'prepare', url: p.url }, `Draft ready for ${p.name}. Nothing was sent.`)), 'btn sm ghost'));
  if (!['messaged', 'skipped', 'requesting', 'messaging'].includes(p.state)) actions.append(button('Skip', () => act({ kind: 'network', action: 'skip', url: p.url }, `${p.name} skipped. Nothing more will be sent.`), 'btn sm ghost'));
  actions.append(button('Delete', async () => { if (confirm(`Delete the saved record for ${p.name}? This does not undo anything on LinkedIn.`)) await act({ kind: 'network', action: 'removeContact', url: p.url }, `Record for ${p.name} deleted.`); }, 'btn sm ghost danger'));
  card.append(actions);
  return card;
}

/* ---------- activity tab ---------- */
function buildActivity(s: NetworkState): HTMLElement {
  const panel = node('div'), feed = node('section', '', 'card');
  feed.append(node('h2', 'What happened', 'card-title'), node('p', 'Everything the extension did, newest first.', 'card-sub'));
  const log = [...(s.log ?? [])].reverse();
  if (!log.length) feed.append(node('p', 'Nothing yet. Press Start and each step will show up here.', 'muted'));
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
    const a = node('a'); a.href = url; a.download = 'cold-contact-pro-export.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'btn'), button('Delete everything', async () => {
    if (confirm('Delete your profile, CV, dossier, contacts and task history from this device? This does not undo anything on LinkedIn.')) await act({ kind: 'network', action: 'clear', confirm: true }, 'All local data deleted.');
  }, 'btn ghost danger'));
  panel.append(feed, tools, data);
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
const timer = setInterval(() => { void refresh().catch(showLoadError); }, 4000);
addEventListener('pagehide', () => clearInterval(timer), { once: true });
