/** Jobs and Saved screens: the company shortlist, one card per job, and remembered people and jobs. */
import { board } from './pipeline';
import { type NetworkState, dueReminders, staleRequests, jobStatuses, type JobStatus, type SavedItem } from '../shared/network';
import { referralPlan } from '../shared/referral';
import { type JobSearch } from '../shared/jobsearch';
import { node, link, button, act, kit, accordion, flags } from './core';
import { personCard } from './people';

/* People and jobs remembered with the button on LinkedIn pages: reminders, job progress and old requests. */
export const jobLabels: Record<JobStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
};
export const dayLabel = (t: number): string => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export function savedCard(item: SavedItem, due: boolean): HTMLElement {
  const card = node('article', '', due ? 'person due' : 'person'),
    info = node('div');
  info.append(link(item.title, item.url, 'person-name'), node('p', item.subtitle, 'muted small clamp'));
  card.append(info);
  const badges = node('div', '', 'meta');
  const relation: Record<string, string> = { pending: 'Request pending', connected: 'Connected', 'not-connected': 'Not connected' };
  if (item.type === 'job' && item.status && item.status !== 'saved')
    badges.append(
      node(
        'span',
        `${jobLabels[item.status]} ${dayLabel(item.statusAt ?? item.savedAt)}`,
        `badge ${item.status === 'rejected' ? '' : item.status === 'applied' ? 'review' : 'connected'}`,
      ),
    );
  if (item.acceptedAt) badges.append(node('span', `Accepted ${dayLabel(item.acceptedAt)}`, 'badge connected'));
  else if (item.type === 'person' && item.relation && relation[item.relation])
    badges.append(node('span', relation[item.relation]!, item.relation === 'pending' ? 'badge review' : 'badge'));
  if (item.remindAt)
    badges.append(node('span', due ? 'Reminder due' : `Reminder ${dayLabel(item.remindAt)}`, due ? 'badge attention' : 'chip'));
  badges.append(node('span', `Saved ${dayLabel(item.savedAt)}`, 'chip'));
  card.append(badges);
  if (item.note) card.append(node('p', item.note, 'reason'));
  const update = (patch: object, done: string) => act({ kind: 'network', action: 'updateSaved', url: item.url, ...patch }, done);
  const controls = node('div', '', 'saved-controls');
  const pick = (label: string, options: [string, string][], value: string, onPick: (v: string) => Promise<void>): void => {
    const wrap = node('label', '', 'mini'),
      select = node('select');
    wrap.append(node('span', label), select);
    for (const [v, text] of options) {
      const o = node('option', text);
      o.value = v;
      select.append(o);
    }
    select.value = value;
    select.addEventListener('change', () => {
      void onPick(select.value);
    });
    controls.append(wrap);
  };
  if (item.type === 'job')
    pick(
      'Progress',
      jobStatuses.map(st => [st, jobLabels[st]] as [string, string]),
      item.status ?? 'saved',
      v => update({ status: v }, `${item.title}: marked ${jobLabels[v as JobStatus].toLowerCase()}.`),
    );
  pick(
    'Remind me',
    [
      ['', item.remindAt ? `On ${dayLabel(item.remindAt)}` : 'No reminder'],
      ['1', 'Tomorrow'],
      ['3', 'In 3 days'],
      ['5', 'In 5 days'],
      ['7', 'In a week'],
      ['14', 'In 2 weeks'],
      ...(item.remindAt ? [['off', 'Turn off'] as [string, string]] : []),
    ],
    '',
    v =>
      v === ''
        ? Promise.resolve()
        : update({ remindDays: v === 'off' ? null : Number(v) }, v === 'off' ? 'Reminder turned off.' : `Reminder set for ${item.title}.`),
  );
  card.append(controls);
  const noteBox = node('details', '', 'inline'),
    noteEdit = node('textarea', '', 'draft');
  noteEdit.value = item.note;
  noteEdit.rows = 2;
  noteEdit.maxLength = 300;
  noteEdit.placeholder = 'Why are you keeping this? What do you want to do next?';
  noteEdit.addEventListener('input', () => {
    flags.dirty = true;
  });
  noteBox.append(
    node('summary', item.note ? 'Edit note' : 'Add a note'),
    noteEdit,
    button('Save note', () => update({ note: noteEdit.value }, 'Note saved.'), 'btn sm'),
  );
  const actions = node('div', '', 'person-actions');
  if (due) actions.append(button('Done', () => update({ remindDays: null }, 'Reminder cleared.'), 'btn sm primary'));
  actions.append(
    button(
      'Forget',
      async () => {
        if (confirm(`Remove ${item.title} from Saved?`))
          await act({ kind: 'network', action: 'forget', url: item.url }, `${item.title} removed from Saved.`);
      },
      'btn sm ghost danger',
    ),
  );
  card.append(noteBox, actions);
  return card;
}
export function buildSaved(s: NetworkState): HTMLElement {
  const panel = node('div'),
    items = s.saved ?? [],
    due = dueReminders(s),
    stale = staleRequests(s);
  const section = (title: string, help: string): void => {
    panel.append(node('h3', title, 'section-title'));
    if (help) panel.append(node('p', help, 'field-help section-help'));
  };
  if (due.length) {
    section(`Due now (${due.length})`, 'You asked to be reminded about these.');
    for (const item of due) panel.append(savedCard(item, true));
  }
  if (stale.length) {
    section(
      `Requests unanswered for over 3 weeks (${stale.length})`,
      'They are unlikely to be accepted now and count against LinkedIn’s limit on pending invitations. Withdraw them on LinkedIn’s own page.',
    );
    const box = node('article', '', 'person');
    for (const r of stale) {
      const row = node('p', '', 'stale-row');
      row.append(link(r.name, r.url, 'person-name'), node('span', `sent ${dayLabel(r.since)}`, 'muted small'));
      box.append(row);
    }
    box.append(link('Open my sent invitations on LinkedIn', 'https://www.linkedin.com/mynetwork/invitation-manager/sent/', 'btn sm'));
    panel.append(box);
  }
  if (!items.length) {
    const e = node('div', '', 'empty');
    e.append(
      node('b', 'Nothing remembered yet'),
      node(
        'span',
        'Open any LinkedIn profile or job and press "Remember" at the bottom left of the page. Add a note, set a reminder, and track jobs you applied to here.',
      ),
    );
    panel.append(e);
    return panel;
  }
  for (const [type, heading] of [
    ['job', 'Jobs'],
    ['person', 'People'],
  ] as const) {
    const group = items.filter(i => i.type === type && !due.includes(i));
    if (!group.length) continue;
    const counts =
      type === 'job'
        ? jobStatuses
            .map(st => [st, group.filter(i => (i.status ?? 'saved') === st).length] as const)
            .filter(([, n]) => n)
            .map(([st, n]) => `${n} ${jobLabels[st].toLowerCase()}`)
            .join(' · ')
        : '';
    section(`${heading} (${group.length})`, counts);
    for (const item of group) panel.append(savedCard(item, false));
  }
  return panel;
}
/* Referrals: one card per job, with the people who can help in order of how much their word counts. */
/* The shortlist: one job per company, best first, the top ones ticked. The person confirms; nothing is contacted before that. */
export const chosen = new Map<string, boolean>();
export let perCompanyChoice = 3;
export function jobChooser(search: JobSearch): HTMLElement {
  const card = node('section', '', 'card'),
    list = node('div', '', 'job-list');
  const isOn = (id: string, fallback: boolean): boolean => chosen.get(id) ?? fallback;
  const go = button(
    '',
    async () => {
      const ids = search.found
        .filter(j => isOn(j.id, j.picked))
        .map(j => j.id)
        .slice(0, 20);
      if (!ids.length) throw new Error('Tick at least one company.');
      await act(
        { kind: 'network', action: 'pickJobs', ids, perCompany: perCompanyChoice },
        `${ids.length} ${ids.length === 1 ? 'company' : 'companies'} chosen. Finding who can refer you.`,
      );
      chosen.clear();
    },
    'btn primary block',
  );
  const count = (): void => {
    const n = search.found.filter(j => isOn(j.id, j.picked)).length;
    go.textContent = n ? `Find referrers at ${n} ${n === 1 ? 'company' : 'companies'}` : 'Tick at least one company';
    go.disabled = !n || n > 20;
  };
  card.append(
    node('h2', 'Choose companies', 'card-title'),
    node(
      'p',
      'One job per company, best match first. Companies where you already have a way in are ranked higher. Untick any you do not want. Click a title to open the job on LinkedIn.',
      'card-sub',
    ),
  );
  for (const job of search.found) {
    const row = node('label', '', 'job-row'),
      box = node('input'),
      text = node('div');
    box.type = 'checkbox';
    box.checked = isOn(job.id, job.picked);
    box.addEventListener('change', () => {
      chosen.set(job.id, box.checked);
      flags.dirty = true;
      count();
    });
    text.append(link(job.title, job.url, 'job-title'), node('span', `${job.company} · ${job.location}`, 'muted small'));
    if (job.insight) text.append(node('span', job.insight, 'badge connected'));
    if (job.promoted) text.append(node('span', 'Promoted by the employer', 'badge'));
    row.append(box, text, link('View job ↗', job.url, 'job-open'));
    list.append(row);
  }
  const per = node('label', '', 'mini'),
    select = node('select');
  per.append(node('span', 'Invitations per company'), select);
  for (const n of [3, 4, 5]) {
    const o = node('option', `${n} people`);
    o.value = String(n);
    select.append(o);
  }
  select.value = String(perCompanyChoice);
  select.addEventListener('change', () => {
    perCompanyChoice = Number(select.value);
  });
  count();
  if (search.dropped?.length) {
    const d = node('details', '', 'inline');
    d.append(
      node(
        'summary',
        `ChatGPT removed ${search.dropped.length} ${search.dropped.length === 1 ? 'listing' : 'listings'} (adverts or poor matches)`,
      ),
    );
    for (const x of search.dropped) d.append(node('p', `${x.title} · ${x.company}: ${x.why}`, 'field-help'));
    card.append(d);
  }
  card.append(
    list,
    per,
    node(
      'p',
      'People you already know at a company are messaged on top of this number. LinkedIn allows roughly 100 invitations a week, so fewer, better-chosen people go further.',
      'field-help',
    ),
    go,
    button('Close this list', () => act({ kind: 'network', action: 'cancelJobSearch' }, 'List closed.'), 'btn sm ghost'),
  );
  return card;
}
export function buildReferrals(s: NetworkState): HTMLElement {
  const panel = node('div'),
    jobs = s.referralJobs ?? [],
    search = s.jobSearch;
  if (search?.status === 'finding')
    panel.append(
      node(
        'p',
        s.plan
          ? `Searching LinkedIn jobs: title ${Math.min(search.cursor + 1, s.plan.terms.length)} of ${s.plan.terms.length}. ${search.found.length} jobs read so far.`
          : 'Planning the search…',
        'callout',
      ),
    );
  if (search && search.status !== 'finding' && search.found.length) panel.append(jobChooser(search));
  const pipeline = board(s, kit);
  if (pipeline) panel.append(pipeline);
  if (s.plan) {
    const d = node('details', '', 'inline');
    d.append(
      node('summary', `Search plan (${s.plan.source === 'chatgpt' ? 'from ChatGPT' : 'built-in'})`),
      node('p', `Job titles searched: ${s.plan.terms.join(', ')}`, 'field-help'),
      node('p', `Large companies: ${s.plan.titles.large.join(', ')}`, 'field-help'),
      node('p', `Mid-size: ${s.plan.titles.mid.join(', ')}`, 'field-help'),
      node('p', `Small: ${s.plan.titles.small.join(', ')}`, 'field-help'),
    );
    panel.append(d);
  }
  if (!jobs.length && !search) {
    const e = node('div', '', 'empty');
    e.append(
      node('b', 'No jobs yet'),
      node(
        'span',
        'Press “Find jobs and referrals” on Home to search LinkedIn for your target roles. Or open any job on LinkedIn and use “Ask for referrals” or “My connections here” at the bottom left of the page.',
      ),
    );
    panel.append(e);
    return panel;
  }
  for (const job of jobs) {
    // One person is tied to one job; for a second job at the same company they are still shown, so nobody looks missing.
    const sameCompany = new Set(jobs.filter(j => j.company.toLowerCase() === job.company.toLowerCase()).map(j => j.url));
    const people = s.contacts
      .filter(p => !!p.referralJob && sameCompany.has(p.referralJob))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const { box, body } = accordion(
      `ref:${job.url}`,
      `${job.title} · ${job.company}`,
      job.finishedAt ? String(people.length) : 'searching…',
    );
    const meta = node('div', '', 'meta');
    meta.append(link('View job ↗', job.url, 'job-open'), node('span', job.mode === 'referral' ? 'Reaching out' : 'Listing only', 'chip'));
    const steps = referralPlan(job).length;
    if (!job.finishedAt)
      meta.append(
        node(
          'span',
          job.companyUrl && !job.companyId && !job.idTried
            ? 'Finding the company…'
            : `Searching: step ${Math.min(job.cursor + 1, steps)} of ${steps}`,
          'badge review',
        ),
      );
    const first = people.filter(p => p.degree === 1).length;
    if (people.length) meta.append(node('span', `${first} you know · ${people.length - first} to invite`, 'chip'));
    body.append(meta);
    if (job.sizeText)
      meta.append(
        node(
          'span',
          `${job.sizeText}${job.size ? ` · ${job.size === 'large' ? 'large: recruiters, HR, team leads' : job.size === 'small' ? 'small: founders, heads' : 'mid-size'}` : ''}`,
          'chip',
        ),
      );
    if (job.strategy) {
      const kind: Record<string, string> = {
        enterprise: 'Large company',
        mid: 'Mid-size company',
        scaleup: 'Scale-up',
        startup: 'Startup',
      };
      const plan = node('details', '', 'inline');
      plan.append(
        node('summary', `${kind[job.strategy.type]}: who to ask (${job.strategy.source === 'chatgpt' ? 'ChatGPT' : 'built-in'})`),
        node('p', job.strategy.why, 'field-help'),
        node('p', `Asking: recruiters and HR, ${job.strategy.titles.join(', ')}`, 'field-help'),
      );
      if (job.strategy.avoid.length) plan.append(node('p', `Not asking strangers who are: ${job.strategy.avoid.join(', ')}`, 'field-help'));
      body.append(plan);
    } else if (job.mode === 'referral' && !job.strategyTried && !job.finishedAt)
      body.append(node('p', 'Waiting for ChatGPT’s plan for this company…', 'field-help'));
    if (job.error)
      body.append(
        node(
          'p',
          `This company was closed early: LinkedIn pages could not be read (${job.error}). People found before that are listed.`,
          'callout',
        ),
      );
    if (job.waiting) {
      // The one question per company: people already known may be enough.
      const ask = node('div', '', 'callout');
      ask.append(
        node(
          'span',
          `You already know ${job.known ?? 'some'} ${job.known === 1 ? 'person' : 'people'} here. Ask only them, or also look for people whose referral carries more weight?`,
        ),
        button(
          'Ask only them',
          () =>
            act(
              { kind: 'network', action: 'referralDecision', url: job.url, widen: false },
              `${job.company}: messaging the people you know.`,
            ),
          'btn sm primary',
        ),
        button(
          'Also find stronger',
          () =>
            act(
              { kind: 'network', action: 'referralDecision', url: job.url, widen: true },
              `${job.company}: looking for stronger referrers too.`,
            ),
          'btn sm',
        ),
      );
      body.append(ask);
    }
    if (job.mode === 'connections' && job.finishedAt && people.some(p => p.state === 'found'))
      body.append(
        node(
          'p',
          'Nobody has been contacted. Press “Ask for a referral” on the people you want to approach; the strongest are at the top.',
          'field-help',
        ),
      );
    if (job.mode === 'referral' && job.finishedAt && people.length)
      body.append(
        node(
          'p',
          `People you already know here get a message. The strongest ${job.decision === 'known' ? 0 : (job.perCompany ?? 3)} others get an invitation. Sends are a few seconds apart and within your daily limits; everyone else is listed below with a button.`,
          'field-help',
        ),
      );
    if (job.mode === 'referral' && !s.active && people.some(p => ['shortlisted', 'connected'].includes(p.state)))
      body.append(node('p', 'Outreach is paused, so nothing is being sent. Press “Resume sending” on Home to continue.', 'field-help'));
    if (!people.length)
      body.append(
        node(
          'p',
          job.finishedAt
            ? job.mode === 'connections'
              ? 'You have no 1st-degree connections at this company. On the job page, press “Ask for referrals” to find its recruiters, the team and people you share connections with.'
              : 'Nobody suitable was found at this company.'
            : 'Results appear here as each search finishes.',
          'muted small',
        ),
      );
    for (const p of people) body.append(personCard(s, p));
    body.append(
      button(
        job.applied ? 'Applied ✓ (undo)' : 'I applied',
        () => act({ kind: 'network', action: 'jobApplied', url: job.url, applied: !job.applied }),
        job.applied ? 'btn sm' : 'btn sm primary',
      ),
    );
    body.append(
      button(
        'Remove this job',
        async () => {
          if (confirm(`Remove ${job.title} at ${job.company} from Referrals? People already contacted stay on the People list.`))
            await act({ kind: 'network', action: 'removeReferralJob', url: job.url }, 'Job removed from Referrals.');
        },
        'btn sm ghost danger',
      ),
    );
    panel.append(box);
  }
  return panel;
}
