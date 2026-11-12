/** Referral Scout side panel: draws the current screen and keeps it up to date. */
import './network.css';
import { referralPeople, stageCounts, STAGES } from './pipeline';
import { errorText } from './render';
import {
  unfinished,
  defaultSettings,
  withinActiveHours,
  type ContactState,
  type NetworkState,
  dueReminders,
  staleRequests,
} from '../shared/network';
import { type Tab, ui, page, toaster, node, icon, ago, request, notify, button, act, flags, onRedraw } from './core';
import { runStatus, usage, journey, meter, tick, live } from './live';
import { welcome, askTarget, buildSetup } from './setup';
import { buildSaved, buildReferrals } from './jobs';
import { buildPeople } from './people';
import { buildActivity } from './activity';

/** The running build, so it is easy to tell whether the extension was reloaded after an update. */
const version = (globalThis as { chrome?: typeof chrome }).chrome?.runtime?.getManifest?.().version ?? '';
function render(s: NetworkState): void {
  announcedUpTo = Math.max(announcedUpTo, (s.log ?? []).at(-1)?.at ?? 0);
  flags.last = s;
  flags.signature = JSON.stringify(s);
  flags.dirty = false;
  flags.uid = 0;
  const scroll = document.scrollingElement?.scrollTop ?? 0;
  page.replaceChildren();
  if (!s.profile) {
    ui.tab = 'home';
    page.append(welcome());
    return;
  }
  if (!s.targetSet && !s.contacts.length && !(s.referralJobs ?? []).length && !s.jobSearch) {
    page.append(askTarget(s));
    return;
  }
  const status = runStatus(s),
    settings = s.settings ?? defaultSettings,
    search = s.jobSearch,
    jobs = s.referralJobs ?? [];
  const count = (st: ContactState): number => s.contacts.filter(p => p.state === st).length;

  /* Every screen is built on each render and only one is shown, so nothing typed in Settings is lost by moving around. */
  const setup = buildSetup(s, settings),
    activity = buildActivity(s),
    home = node('div'),
    people = node('div');
  setup.panel.append(node('h3', 'Help and your data', 'section-title'), ...flags.maintenance);
  const panels: Record<Tab, HTMLElement> = {
    setup: setup.panel,
    home,
    referrals: buildReferrals(s),
    people,
    saved: buildSaved(s),
    activity,
  };
  const peopleList = node('div'),
    refreshPeople = (): void => {
      buildPeople(s, peopleList, refreshPeople);
    };
  people.append(peopleList);
  for (const [tab, title, sub] of [
    ['setup', 'Settings', `What you are looking for, your messages and your limits.${version ? ` Version ${version}.` : ''}`],
    ['referrals', 'Jobs', 'The companies you chose and who can refer you at each.'],
    ['people', 'People', 'Everyone queued, invited or contacted.'],
    ['saved', 'Saved', 'Jobs and people you remembered on LinkedIn.'],
    ['activity', 'Activity', 'Everything the extension did for you.'],
  ] as const) {
    const head = node('div', '', 'view-head');
    head.append(node('h1', title, 'view-title'), node('p', sub, 'view-sub'));
    panels[tab].prepend(head);
  }

  /* navigation: five places at the bottom, settings behind the icon at the top */
  const tabs = node('nav', '', 'tabs'),
    tabButtons = new Map<Tab, HTMLElement>();
  tabs.setAttribute('role', 'tablist');
  const setTab = (tab: Tab, top = false): void => {
    ui.tab = tab;
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== tab;
    for (const [name, b] of tabButtons) b.setAttribute('aria-selected', String(name === tab));
    if (top) document.scrollingElement?.scrollTo({ top: 0 });
  };
  const toApprove = s.contacts.filter(p => p.state === 'review' && !p.approved).length,
    attention = count('attention');
  const waiting = jobs.filter(j => j.waiting && j.finishedAt === undefined),
    choosing = search?.status === 'choosing' && search.found.length > 0;
  // A badge means "something here needs you", never a plain total.
  for (const [tab, label, glyph, n] of [
    ['home', 'Home', 'home', 0],
    ['referrals', 'Jobs', 'jobs', waiting.length + (choosing ? 1 : 0)],
    ['people', 'People', 'people', toApprove + attention],
    ['saved', 'Saved', 'saved', dueReminders(s).length],
    ['activity', 'Activity', 'activity', 0],
  ] as const) {
    const b = node('button', '', 'tab'),
      wrap = node('span', '', 'tab-ico');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    wrap.append(icon(glyph));
    if (n) wrap.append(node('span', String(n), 'count'));
    b.append(wrap, node('span', label, 'tab-label'));
    b.addEventListener('click', () => setTab(tab, true));
    tabButtons.set(tab, b);
    tabs.append(b);
  }
  const gear = node('button', '', 'icon-btn');
  gear.type = 'button';
  gear.title = 'Settings';
  gear.setAttribute('aria-label', 'Settings');
  gear.append(icon('settings'));
  gear.addEventListener('click', () => setTab(ui.tab === 'setup' ? 'home' : 'setup', true));
  tabButtons.set('setup', gear);
  const top = node('header', '', 'top');
  top.append(node('div', 'RS', 'mark'), node('span', 'Referral Scout', 'name'), node('span', status.pill, `pill ${status.tone}`), gear);
  const openPeople = (filter: string): void => {
    ui.filter = filter;
    refreshPeople();
    setTab('people', true);
  };

  /* ----- home ----- */
  // What is being searched for is the most important setting, so it is shown large, with its own Edit button.
  const hello = node('div', '', 'view-head'),
    target = node('div', '', 'target'),
    targetText = node('div'),
    change = node('button', 'Edit', 'btn sm');
  change.type = 'button';
  change.addEventListener('click', () => setTab('setup', true));
  targetText.append(
    node('span', 'You are looking for', 'target-label'),
    node('b', `${settings.roles[0] ?? s.target}${settings.roles.length > 1 ? ` +${settings.roles.length - 1} more` : ''}`, 'target-role'),
  );
  if (s.location) targetText.append(node('span', `in ${s.location}`, 'target-place'));
  target.append(targetText, change);
  hello.append(node('h1', `Hi ${s.profile.name.split(/\s+/)[0] ?? ''}`, 'view-title'), target);

  const run = node('section', '', `card run ${status.tone}`),
    stage = journey(s),
    stepper = node('ol', '', 'journey');
  ['Find jobs', 'Choose', 'Find people', 'Reach out'].forEach((label, i) => {
    const li = node('li', '', i < stage ? 'done' : i === stage ? 'now' : ''),
      dot = node('i');
    if (i < stage) dot.append(icon('check'));
    else dot.textContent = String(i + 1);
    li.append(dot, node('span', label));
    stepper.append(li);
  });
  run.append(stepper, node('h2', status.title, 'run-title'), node('p', status.sub, 'run-sub'));
  // One main action at a time. General networking outreach lives in Settings.
  // Pause stops searches as well as sending; Resume picks everything up where it stopped.
  const main = s.paused ? 'btn block' : 'btn primary block';
  if (s.paused) {
    const left = unfinished(s);
    run.append(
      node('p', left.length ? `Resume continues: ${left.join('; ')}.` : 'Nothing was left unfinished.', 'field-help'),
      button('Resume', () => act({ kind: 'network', action: 'resume' }), 'btn primary block'),
    );
  }
  if (search?.status === 'finding') {
    run.append(
      node('p', 'You can keep using your browser. Results appear under Jobs.', 'field-help'),
      ...(search.found.length
        ? [
            button(
              `Stop here and choose from ${search.found.length} jobs found`,
              () => act({ kind: 'network', action: 'finishJobSearch' }),
              'btn block',
            ),
          ]
        : []),
      button(
        'Cancel this search',
        () => act({ kind: 'network', action: 'cancelJobSearch' }, 'Job search cancelled. Companies you already chose are kept.'),
        'btn block',
      ),
    );
  } else if (choosing) {
    run.append(
      button(
        `Choose companies (${search!.found.length} found)`,
        async () => {
          setTab('referrals', true);
        },
        main,
      ),
    );
  } else {
    run.append(
      button(
        jobs.length ? 'Find more jobs' : 'Find jobs and referrals',
        async () => {
          await setup.save();
          await act(
            { kind: 'network', action: 'findJobs' },
            'Job search started. First the search is planned, then LinkedIn jobs are read.',
          );
        },
        main,
      ),
    );
  }
  // You are never locked into a stage: stop looking for more people and go with those already found.
  if (!s.paused && jobs.some(j => j.finishedAt === undefined) && s.contacts.some(p => p.referralJob))
    run.append(button('Stop searching, reach out to who was found', () => act({ kind: 'network', action: 'finishScans' }), 'btn block'));
  const working = s.active || search?.status === 'finding' || jobs.some(j => !j.finishedAt && !j.waiting);
  if (s.paused) {
    /* Resume is already the main button */
  } else if (working)
    run.append(
      button(
        'Pause everything',
        () => act({ kind: 'network', action: 'pause' }, 'Paused. Searches and sending have stopped; your progress is kept.'),
        'btn block',
      ),
    );
  const used = usage(s),
    meters = node('div', '', 'meters');
  meters.append(meter('Invitations today', used.today, settings.dailyInvites), meter('This week', used.week, settings.weeklyInvites));
  run.append(meters);
  const foot = node('div', '', 'meta');
  if (used.next) foot.append(node('span', used.next, 'chip'));
  if (s.active && !withinActiveHours(settings))
    foot.append(
      button(
        'Run now anyway',
        async () => {
          await request({
            kind: 'network',
            action: 'save',
            target: s.target,
            location: s.location,
            template: s.template,
            settings: { ...settings, activeHours: null },
          });
          await act({ kind: 'network', action: 'status' }, 'Quiet hours turned off. Outreach continues now.');
        },
        'btn sm',
      ),
    );
  if (foot.childNodes.length) run.append(foot);

  /* what needs the person, in one list, with the action on the row */
  const todos = node('section', '', 'todos');
  const todo = (tone: 'warn' | 'bad' | 'info', text: string, ...actions: HTMLElement[]): void => {
    const row = node('div', '', `todo ${tone}`),
      buttons = node('div', '', 'todo-actions');
    buttons.append(...actions);
    row.append(node('span', text), buttons);
    todos.append(row);
  };
  for (const job of waiting.slice(0, 4))
    todo(
      'info',
      `You already know ${job.known ?? 'some'} ${job.known === 1 ? 'person' : 'people'} at ${job.company}. Ask only them, or also look for stronger referrers?`,
      button(
        'Only them',
        () =>
          act(
            { kind: 'network', action: 'referralDecision', url: job.url, widen: false },
            `${job.company}: messaging the people you know.`,
          ),
        'btn sm primary',
      ),
      button(
        'Look wider',
        () =>
          act(
            { kind: 'network', action: 'referralDecision', url: job.url, widen: true },
            `${job.company}: looking for stronger referrers too.`,
          ),
        'btn sm',
      ),
    );
  if (toApprove)
    todo(
      'warn',
      `${toApprove} ${toApprove === 1 ? 'message needs' : 'messages need'} your approval before anything is sent.`,
      button('Review', async () => openPeople('review'), 'btn sm primary'),
      ...(s.active && toApprove > 1
        ? [
            button(
              `Approve all ${toApprove}`,
              () =>
                act(
                  { kind: 'network', action: 'approve', url: '*' },
                  `${toApprove} messages approved. They are sent one after another, a few seconds apart.`,
                ),
              'btn sm',
            ),
          ]
        : []),
    );
  if (attention)
    todo(
      'bad',
      `${attention} ${attention === 1 ? 'person needs' : 'people need'} your attention.`,
      button('Show', async () => openPeople('attention'), 'btn sm'),
      button(
        attention === 1 ? 'Skip them' : `Skip all ${attention}`,
        () => act({ kind: 'network', action: 'skipAttention' }),
        'btn sm ghost',
      ),
    );
  const dueCount = dueReminders(s).length,
    staleCount = staleRequests(s).length;
  if (dueCount)
    todo(
      'warn',
      `${dueCount} ${dueCount === 1 ? 'reminder is' : 'reminders are'} due.`,
      button(
        'Show',
        async () => {
          setTab('saved', true);
        },
        'btn sm',
      ),
    );
  if (staleCount)
    todo(
      'info',
      `${staleCount} connection ${staleCount === 1 ? 'request has' : 'requests have'} been unanswered for over 3 weeks. Withdraw them on LinkedIn; they drop off here at the next check.`,
      button(
        'Show',
        async () => {
          setTab('saved', true);
        },
        'btn sm',
      ),
    );
  const needs = todos.childElementCount;
  todos.prepend(node('h3', needs ? `Needs you (${needs})` : 'Needs you', 'section-title'));
  if (!needs)
    todos.append(
      node(
        'p',
        s.active ? 'Nothing right now. You can close this panel; work continues in the background.' : 'Nothing right now.',
        'all-clear',
      ),
    );

  // The whole way to a referral in six numbers: each opens the list behind it.
  const kpis = node('div', '', 'kpis'),
    counts = stageCounts(referralPeople(s), jobs);
  const opens = [
    () => openPeople('all'),
    () => openPeople('connected'),
    () => openPeople('replied'),
    () => openPeople('referred'),
    () => setTab('referrals', true),
  ];
  for (const [label, value, go] of [
    ['Companies', jobs.length, () => setTab('referrals', true)],
    ...STAGES.map((label, i) => [label, counts[i]!, opens[i]!] as const),
  ] as const) {
    const k = node('button', '', `kpi${value && (label === 'Referred' || label === 'Applied') ? ' win' : ''}`);
    k.type = 'button';
    k.append(node('b', String(value)), node('span', label));
    k.addEventListener('click', go);
    kpis.append(k);
  }
  home.append(hello, run);
  const tracker = live(s, stage);
  if (tracker) home.append(tracker);
  // Suggestions that make the results better, shown on Home instead of sending a new user into Settings.
  const openSetting = (key: string, title: string): void => {
    ui.open.add(key);
    ui.tab = 'setup';
    render(s);
    [...document.querySelectorAll<HTMLElement>('details.acc')]
      .find(d => d.querySelector('summary')?.textContent?.startsWith(title))
      ?.scrollIntoView?.({ block: 'start' });
  };
  const tips: [string, string, string, () => void][] = [];
  if (!s.cv)
    tips.push([
      'Add your CV',
      'ChatGPT can then mention your real background when it writes to people. It stays on this device.',
      'Add CV',
      () => openSetting('chatgpt', 'Your CV'),
    ]);
  if (stage < 0)
    tips.push([
      'Check your messages',
      'The connection note and the follow-up sent in your name. Read them once before anything goes out.',
      'Review',
      () => openSetting('words', 'Your messages'),
    ]);
  if (!s.api)
    tips.push([
      'Use your OpenAI API key',
      'Optional. If you have one, answers come straight from the API: faster, and no ChatGPT tab is opened. Without it the ChatGPT website is used.',
      'Set up',
      () => openSetting('api', 'ChatGPT connection'),
    ]);
  if (tips.length) {
    const card = node('section', '', 'card tips');
    card.append(node('h3', stage < 0 ? 'Before you start (optional)' : 'Make your messages stronger', 'card-title'));
    for (const [title, text, label, go] of tips) {
      const row = node('div', '', 'tip'),
        words = node('div'),
        open = node('button', label, 'btn sm');
      open.type = 'button';
      open.addEventListener('click', go);
      words.append(node('b', title), node('span', text));
      row.append(words, open);
      card.append(row);
    }
    home.append(card);
  }
  if (needs || s.active || jobs.length || s.contacts.length) {
    // Reaching out has its own switch, separate from searching: the queue, whether sending is on, and one button.
    const scope = s.scope === 'referrals' ? s.contacts.filter(p => p.referralJob) : s.contacts,
      queue = scope.filter(
        p =>
          ['shortlisted', 'requesting', 'messaging'].includes(p.state) ||
          (p.state === 'review' && p.approved) ||
          (p.state === 'connected' && !p.messagedAt),
      ),
      first = queue[0];
    if (!s.paused && (queue.length || s.active)) {
      const card = node('section', '', 'card sending'),
        words = node('div');
      words.append(
        node(
          'b',
          queue.length ? `${queue.length} ${queue.length === 1 ? 'person' : 'people'} in the queue` : 'Nobody is waiting to be contacted',
          'sending-title',
        ),
        node(
          'span',
          s.active
            ? first
              ? `Reaching out is on. Next: ${first.name}${first.companyName ? ` at ${first.companyName}` : ''}${used.next ? ` · ${used.next.toLowerCase()}` : ''}.`
              : 'Reaching out is on. New people are contacted as they are found.'
            : 'Reaching out is off, so nobody is being contacted.',
        ),
      );
      card.append(
        words,
        s.active
          ? button('Stop reaching out', () => act({ kind: 'network', action: 'stopSending' }), 'btn sm')
          : button(
              `Reach out to ${queue.length === 1 ? 'this person' : `these ${queue.length} people`}`,
              () => act({ kind: 'network', action: 'resume' }),
              'btn sm primary',
            ),
      );
      home.append(card);
    }
    home.append(todos, node('h3', 'Your pipeline', 'section-title'), kpis);
    // Acceptances and replies: always one clear button, with when it was last done.
    if (s.contacts.length) {
      const check = node('section', '', 'card sending'),
        words = node('div');
      words.append(
        node('b', 'Who accepted? Who replied?', 'sending-title'),
        node(
          'span',
          `Your LinkedIn connections and messages are checked every 2 hours while reaching out is on${s.repliesCheckedAt ? `. Last checked ${ago(s.repliesCheckedAt)}` : ''}.`,
        ),
      );
      check.append(
        words,
        button('Check LinkedIn now', () => act({ kind: 'network', action: 'checkNow' }), 'btn sm primary'),
      );
      home.append(check);
    }
  }
  const log = [...(s.log ?? [])].reverse().slice(0, 3);
  if (log.length) {
    const recent = node('section', '', 'card recent'),
      headRow = node('div', '', 'row between'),
      all = node('button', 'See all', 'linkish');
    all.type = 'button';
    all.addEventListener('click', () => setTab('activity', true));
    headRow.append(node('h3', 'Latest', 'card-title'), all);
    recent.append(headRow);
    for (const e of log) {
      const row = node('p', '', `recent-row ${e.kind}`);
      row.append(node('span', e.text), node('time', ago(e.at)));
      recent.append(row);
    }
    home.append(recent);
  } else if (stage < 0) {
    const how = node('section', '', 'card how');
    how.append(node('h3', 'How it works', 'card-title'));
    for (const [n, text] of [
      ['1', 'We search LinkedIn jobs for your role and similar titles.'],
      ['2', 'You tick the companies worth going after.'],
      ['3', 'At each one we find who can refer you and reach out, a few people a day.'],
    ] as const) {
      const row = node('p', '', 'how-row');
      row.append(node('b', n), node('span', text));
      how.append(row);
    }
    home.append(how);
  }

  page.append(top, panels.setup, panels.home, panels.referrals, panels.people, panels.saved, panels.activity, tabs);
  refreshPeople();
  setTab(ui.tab);
  tick();
  document.scrollingElement?.scrollTo({ top: scroll });
}

/* ---------- refresh ---------- */
async function refresh(): Promise<void> {
  const typing = page.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
  if (flags.busy || flags.dirty || typing) return; // never throw away what the user is typing
  const current = await request({ kind: 'network', action: 'status' });
  announce(current);
  const before = flags.last;
  if (before?.jobSearch?.status === 'finding' && current.jobSearch?.status === 'choosing' && current.jobSearch.found.length) {
    ui.tab = 'referrals'; // the list is ready and it is the person's turn: show it
    document.scrollingElement?.scrollTo({ top: 0 });
  }
  if (JSON.stringify(current) !== flags.signature) render(current);
}
/* Work done in the background (a search, a draft, a send, a ChatGPT fallback) is announced as a notification too,
   not only written to the Activity tab. Actions the user just pressed already notify on their own. */
let announcedUpTo = -1;
function announce(s: NetworkState): void {
  const log = s.log ?? [],
    newest = log.at(-1)?.at ?? 0;
  if (announcedUpTo >= 0)
    for (const entry of log.filter(e => e.at > announcedUpTo).slice(-3))
      toaster.show(entry.kind === 'ok' ? 'success' : entry.kind === 'warn' ? 'error' : 'info', entry.text);
  announcedUpTo = Math.max(announcedUpTo, newest);
}
const showLoadError = (e: unknown): void => {
  if (!flags.last) notify('error', errorText(e));
};
void refresh().catch(showLoadError);
const timer = setInterval(() => {
  void refresh().catch(showLoadError);
}, 2500);
addEventListener('pagehide', () => clearInterval(timer), { once: true });

onRedraw(render);
