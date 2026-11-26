/** Home status: what is running, how far it has got, and the live step-by-step tracker. */
import { DAY, defaultSettings, withinActiveHours, type NetworkRequest, type NetworkState } from '../shared/network';
import type { RunSummary } from '../shared/run-summary';
import { node, icon, pad, button, link, act, openDashboard } from './core';

/* ---------- derived status ---------- */
/**
 * A status line written for the panel rather than for a log: no nested brackets, no repetition of the state the
 * pill beside it already names, and short enough to read at a glance in a 300px column.
 */
function tidyStatus(raw: string | undefined): string {
  const flat = (raw ?? '')
    .replace(/\s*\([^()]*\)/g, '')
    .replace(/^\s*(paused|stopped|idle)[.:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  return flat.length > 120 ? `${flat.slice(0, 117).trimEnd()}…` : flat;
}

export function runStatus(s: NetworkState): { tone: 'ok' | 'warn' | 'idle'; pill: string; title: string; sub: string } {
  const settings = s.settings ?? defaultSettings,
    openJobs = (s.referralJobs ?? []).filter(j => j.finishedAt === undefined);
  if (!s.paused && s.jobSearch?.status === 'choosing' && s.jobSearch.found.length)
    return {
      tone: 'warn',
      pill: 'Your turn',
      title: 'Choose your companies',
      sub: `${s.jobSearch.found.length} companies found. Tick the ones worth going after. Nobody is contacted before you confirm.`,
    };
  if (!s.paused && openJobs.length && openJobs.every(j => j.waiting))
    return {
      tone: 'warn',
      pill: 'Your turn',
      title: 'One question before we continue',
      sub: 'Answer under “Needs you” below, then the search carries on.',
    };
  if (s.paused) {
    // A card headed "Paused" under a pill reading "Paused" repeats itself. The heading says why it stopped, and
    // a stop that followed a failure is not dressed in the brand colour as though it had gone well.
    const why = tidyStatus(s.status);
    const trouble = /could not|failed|error|too long|blocked|refused|unable/i.test(why);
    return {
      tone: trouble ? 'warn' : 'idle',
      pill: 'Paused',
      title: trouble ? 'Stopped early' : why ? 'Paused by you' : 'Nothing running',
      sub: why || 'Press Resume to carry on where you stopped.',
    };
  }
  if (s.active && !withinActiveHours(settings))
    return {
      tone: 'warn',
      pill: 'Waiting',
      title: 'Waiting for active hours',
      sub: `Outreach resumes at ${pad(settings.activeHours?.from ?? 8)}:00. Nothing is wrong.`,
    };
  if (s.active && s.scope === 'referrals')
    return {
      tone: 'ok',
      pill: 'Referrals',
      title: s.jobSearch?.status === 'finding' ? 'Searching for jobs' : 'Working on your referrals',
      sub: s.status || 'Starting up…',
    };
  if (s.active) return { tone: 'ok', pill: 'Running', title: 'Outreach is running', sub: s.status || 'Starting up…' };
  // Not running and not paused: say what the person can do next, never "Paused" when they paused nothing.
  const waiting = s.jobSearch?.status === 'finding' ? 0 : readyToContact(s);
  if (waiting)
    return {
      tone: 'warn',
      pill: 'Your turn',
      title: 'Ready to reach out',
      sub: `${waiting} ${waiting === 1 ? 'person is' : 'people are'} lined up to be asked for a referral. Nobody is contacted until you press Reach out.`,
    };
  if (!s.status)
    return {
      tone: 'idle',
      pill: 'Ready',
      title: 'Ready to find jobs',
      sub: 'We search LinkedIn jobs for your role and similar titles. You choose the companies before anyone is contacted.',
    };
  if (s.jobSearch?.status === 'finding') return { tone: 'ok', pill: 'Searching', title: 'Searching for jobs', sub: s.status };
  return {
    tone: s.contacts.some(p => p.state === 'attention') ? 'warn' : 'idle',
    pill: 'Ready',
    title: 'All caught up',
    sub: 'Nothing is running. Find more jobs, or check who accepted and replied.',
  };
}
/** People found for your jobs who are waiting to be contacted while reaching out is off. */
export function readyToContact(s: NetworkState): number {
  if (s.active) return 0;
  return s.contacts.filter(
    p =>
      !!p.referralJob && (p.state === 'shortlisted' || (p.state === 'review' && p.approved) || (p.state === 'connected' && !p.messagedAt)),
  ).length;
}
export function usage(s: NetworkState): { today: number; week: number; next: string } {
  const now = Date.now(),
    sent = (span: number) => s.actions.filter(a => a.kind === 'connect' && a.confirmed !== false && now - a.at < span).length;
  let next = '';
  if (s.active && s.nextActionAt > now) {
    const wait = Math.round((s.nextActionAt - now) / 1000);
    next = wait < 90 ? `Next send in ${Math.max(1, wait)} s` : `Next send in ${Math.round(wait / 60)} min`;
  }
  return { today: sent(DAY), week: sent(7 * DAY), next };
}
/* Where the person is on the 5-step arc: 0 Discover, 1 Shortlist, 2 Referrers, 3 Reach out, 4 Apply. */
export function journey(s: NetworkState): number {
  const jobs = s.referralJobs ?? [];
  if (s.jobSearch?.status === 'finding') return 0;
  if (s.jobSearch?.status === 'choosing' && s.jobSearch.found.length) return 1;
  if (jobs.some(j => !j.finishedAt)) return 2;
  if (readyToContact(s) > 0 || (s.active && s.contacts.some(p => p.referralJob))) return 3;
  return jobs.length || s.contacts.some(p => p.referralJob) ? 4 : -1;
}
export function meter(label: string, used: number, cap: number | null): HTMLElement {
  const m = node('div', '', 'meter'),
    head = node('div', '', 'meter-head'),
    bar = node('div', '', 'bar'),
    fill = node('i');
  head.append(node('span', label), node('b', cap ? `${used} / ${cap}` : String(used)));
  fill.style.width = `${cap ? Math.min(100, Math.round((used / cap) * 100)) : 0}%`;
  bar.append(fill);
  m.append(head, bar);
  return m;
}

/* The live tracker: what is being done right now, what is finished, what is left, and how long it has been.
   The clock and "last update" tick every second on their own, so the panel never looks frozen between updates. */
export const clock = (ms: number): string => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
};
export function tick(): void {
  const now = Date.now();
  for (const el of document.querySelectorAll<HTMLElement>('[data-since]')) el.textContent = clock(now - Number(el.dataset.since));
  for (const el of document.querySelectorAll<HTMLElement>('[data-ago]')) {
    const sec = Math.floor((now - Number(el.dataset.ago)) / 1000);
    el.textContent =
      sec < 5
        ? 'Last update just now'
        : sec < 90
          ? `Last update ${sec} s ago`
          : `Last update ${Math.round(sec / 60)} min ago. Slow pages are retried automatically; nothing is lost.`;
  }
}
setInterval(tick, 1000);
export type LiveStep = [state: 'done' | 'now' | 'later' | 'you', text: string, detail?: string | undefined];
export function live(s: NetworkState, stage: number): HTMLElement | null {
  const search = s.jobSearch,
    jobs = s.referralJobs ?? [],
    steps: LiveStep[] = [];
  if (s.paused) return null;
  let title = '',
    expect = '',
    since = 0;
  if (stage === 0 && search) {
    const terms = s.plan?.terms ?? [];
    title = 'Discovering matching jobs';
    since = search.startedAt;
    expect = 'Reading LinkedIn job results in the background. You can close this panel anytime.';
    steps.push([
      terms.length ? 'done' : 'now',
      'Plan the search',
      terms.length ? `${terms.length} job titles (${s.plan!.source === 'chatgpt' ? 'suggested by ChatGPT' : 'built-in list'})` : s.status,
    ]);
    if (terms.length)
      terms.forEach((t, i) =>
        steps.push([
          i < search.cursor ? 'done' : i === search.cursor ? 'now' : 'later',
          `Search “${t}”`,
          i === search.cursor ? 'Opening LinkedIn Jobs and reading the results' : undefined,
        ]),
      );
    else steps.push(['later', 'Search LinkedIn Jobs for each title']);
    steps.push([
      terms.length && search.cursor >= terms.length ? 'now' : 'later',
      'Keep the best job per company',
      `${search.found.length} jobs read so far`,
    ]);
  } else if (stage === 2) {
    const open = jobs.filter(j => !j.finishedAt),
      current = open.find(j => !j.waiting);
    title = 'Finding who can refer you';
    since = Math.min(...open.map(j => j.addedAt));
    expect = 'Scanning companies at a safe pace.';
    if (open.some(j => j.mode === 'referral' && !j.strategy && !j.strategyTried))
      steps.push(['now', 'Ask ChatGPT who is worth approaching at each company', s.status]);
    for (const job of jobs.slice(0, 10)) {
      const found = s.contacts.filter(p => p.referralJob === job.url).length;
      if (job.finishedAt) steps.push(['done', job.company, `${found} ${found === 1 ? 'person' : 'people'} found`]);
      else if (job.waiting)
        steps.push(['you', job.company, 'Your turn — tap to choose: ask who you know, or also find stronger referrers']);
      else if (job === current && (job.strategy || job.strategyTried || job.mode !== 'referral'))
        steps.push(['now', job.company, s.status || 'Searching']);
      else steps.push(['later', job.company]);
    }
    if (jobs.length > 10) steps.push(['later', `${jobs.length - 10} more companies`]);
  } else if (stage === 3 && s.active) {
    const mine = s.contacts.filter(p => p.referralJob),
      queue = mine.filter(p => ['shortlisted', 'requesting', 'messaging'].includes(p.state) || (p.state === 'connected' && !p.messagedAt));
    if (!queue.length && !mine.some(p => p.state === 'pending')) return null;
    const sent = mine.filter(p => ['pending', 'messaged'].includes(p.state) || p.acceptedAt).length,
      next = queue[0],
      wait = usage(s).next;
    title = queue.length ? 'Reaching out' : 'Waiting for replies';
    expect = 'Paced within daily limits; acceptances checked every 2h.';
    steps.push(['done', `${sent} sent so far`]);
    if (next) steps.push(['now', `Next: ${next.name}${next.companyName ? ` at ${next.companyName}` : ''}`, wait || s.status]);
    if (queue.length > 1) steps.push(['later', `${queue.length - 1} more in the queue`]);
    steps.push([
      queue.length ? 'later' : 'now',
      'Watch for accepted invitations',
      `${mine.filter(p => p.state === 'pending').length} waiting to be accepted`,
    ]);
  } else return null;
  const card = node('section', '', 'card live'),
    head = node('div', '', 'live-head'),
    list = node('ol', '', 'live-steps'),
    foot = node('p', '', 'live-foot'),
    ago = node('span');
  card.setAttribute('aria-live', 'polite');
  const blockedOnly = steps.some(st => st[0] === 'you') && !steps.some(st => st[0] === 'now');
  head.append(
    node('span', '', blockedOnly ? 'spinner waiting' : 'spinner'),
    node('h3', blockedOnly ? 'Waiting for your answer' : title, 'live-title'),
  );
  if (since) {
    const timer = node('span', clock(Date.now() - since), 'live-clock');
    timer.dataset.since = String(since);
    timer.title = 'Time since this started';
    head.append(timer);
  }
  for (const [state, text, detail] of steps) {
    const li = node('li', '', state),
      mark = node('i'),
      body = node('div');
    if (state === 'done') mark.append(icon('check'));
    else if (state === 'you') mark.textContent = '!';
    body.append(node('b', text));
    if (detail) body.append(node('span', detail));
    li.append(mark, body);
    if (state === 'you') {
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      const jump = (): void => document.querySelector('.todos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      li.onclick = jump;
      li.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          jump();
        }
      };
    }
    list.append(li);
  }
  ago.dataset.ago = String((s.log ?? []).at(-1)?.at ?? Date.now());
  foot.append(ago);
  card.append(head, list, node('p', expect, 'live-expect'), foot);
  return card;
}

/**
 * Persistent Run Summary card: survives panel close and service-worker restarts.
 * Shows "What happened · What needs you · What is next" with 1 primary action + at most 2 secondary actions.
 */
export function runSummaryCard(
  s: NetworkState,
  actions: {
    onOpenJobs: () => void;
    onApplyTop: (job: { url: string; title: string; company: string }) => Promise<void>;
  },
): HTMLElement | null {
  const run: RunSummary | undefined = s.lastRun;
  if (!run || s.jobSearch?.status === 'finding') return null;

  // Dismissed summaries collapse into a compact persistent re-entry chip so nothing is ever lost.
  if (run.dismissedAt) {
    const chip = node('section', '', 'card run-chip');
    const summaryText =
      run.outcome === 'empty'
        ? 'Last run: no matching jobs found'
        : `Last run: ${run.jobsRead} jobs · ${run.companiesFound} companies · ${run.referrersFound} referrers`;
    const row = node('div', '', 'run-chip-row');
    row.append(
      node('span', summaryText, 'muted small'),
      button('View jobs', async () => actions.onOpenJobs(), 'btn sm ghost'),
    );
    chip.append(row);
    return chip;
  }

  const card = node('section', '', `card done run-summary ${run.outcome}`);
  card.setAttribute('aria-live', 'polite');

  let headline = 'Run complete';
  let sub = '';
  if (run.outcome === 'empty') {
    headline = 'No matching jobs found this time';
    sub = 'Nothing was sent. Try one of these quick adjustments and run again:';
  } else if (run.outcome === 'paused') {
    headline = 'Run paused — progress saved';
    sub = `${run.jobsRead} jobs read · ${run.companiesFound} companies · ${run.referrersFound} referrers lined up.`;
  } else if (run.outcome === 'error') {
    headline = 'Search stopped early';
    sub = run.error || 'A LinkedIn page did not respond. Your progress so far is saved.';
  } else if (run.phase === 'shortlist') {
    headline = `We read ${run.jobsRead} jobs across ${run.companiesFound} ${run.companiesFound === 1 ? 'company' : 'companies'}`;
    sub = run.strongMatches
      ? `${run.strongMatches} strong ${run.strongMatches === 1 ? 'match' : 'matches'} ranked at the top. Review your shortlist below.`
      : 'Review your shortlist below, then pick where to find referrers or apply.';
  } else {
    headline = run.referrersFound
      ? `${run.referrersFound} ${run.referrersFound === 1 ? 'referrer' : 'referrers'} ready across ${run.companiesFound} ${run.companiesFound === 1 ? 'company' : 'companies'}`
      : `Finished scanning ${run.companiesFound} ${run.companiesFound === 1 ? 'company' : 'companies'}`;
    sub = run.referrersFound
      ? s.active
        ? 'Outreach is running at a safe pace. You can also apply to your top matches right from Jobs.'
        : 'Nobody is contacted until you press Reach out, or you can apply directly first.'
      : 'No new referrers were found here, but you can still apply directly to your shortlisted jobs.';
  }

  card.append(node('p', 'Run summary', 'eyebrow'), node('h3', headline, 'card-title'), node('p', sub, 'card-sub'));

  // Key metrics strip
  if (run.outcome !== 'empty') {
    const stats = node('div', '', 'run-stats');
    for (const [val, label] of [
      [run.jobsRead, 'Jobs read'],
      [run.companiesFound, 'Companies'],
      [run.strongMatches, 'Strong matches'],
      [run.referrersFound, 'Referrers'],
    ] as const) {
      const cell = node('div', '', 'run-stat');
      cell.append(node('b', String(val)), node('span', label));
      stats.append(cell);
    }
    card.append(stats);
  }

  // Top matches with "Why this job"
  if (run.topMatches?.length && run.outcome !== 'empty') {
    const list = node('div', '', 'run-highlights');
    for (const m of run.topMatches.slice(0, 2)) {
      const item = node('div', '', 'run-highlight');
      const headLine = node('div', '', 'run-highlight-head');
      headLine.append(link(`${m.title} · ${m.company}`, m.url, 'job-title'));
      if (m.fit !== undefined) headLine.append(node('span', `${m.fit}% fit`, 'badge review'));
      item.append(headLine);
      if (m.why) item.append(node('p', `Why: ${m.why}`, 'muted small'));
      list.append(item);
    }
    card.append(list);
  }

  // Concrete suggestions when empty or error
  if (run.suggestions?.length) {
    const ul = node('ul', '', 'run-tips');
    for (const tip of run.suggestions) ul.append(node('li', tip));
    card.append(ul);
  }

  // One primary action + at most two secondary actions
  const actionBar = node('div', '', 'todo-actions');
  if (run.outcome === 'empty' || run.outcome === 'error') {
    actionBar.append(
      button('Edit campaign', () => openDashboard('setup'), 'btn sm primary'),
      button('Search again', () => act({ kind: 'network', action: 'findJobs' } as NetworkRequest, 'Job search started.'), 'btn sm'),
    );
  } else if (run.phase === 'shortlist') {
    const scrollShortlist = async (): Promise<void> => {
      document.querySelector('.home-turn')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    };
    actionBar.append(button('Review shortlist', scrollShortlist, 'btn sm primary'));
    if (run.topMatches?.[0]) {
      const top = run.topMatches[0];
      actionBar.append(button('Apply to top match', () => actions.onApplyTop(top), 'btn sm'));
    }
  } else {
    const ready = readyToContact(s);
    if (ready && !s.active) {
      actionBar.append(
        button(
          'Start reaching out',
          () => act({ kind: 'network', action: 'resume' } as NetworkRequest, 'Reaching out at a safe pace.'),
          'btn sm primary',
        ),
        button('Review & apply in Jobs', async () => actions.onOpenJobs(), 'btn sm'),
      );
    } else {
      actionBar.append(button('Open Jobs & Apply', async () => actions.onOpenJobs(), 'btn sm primary'));
    }
  }

  actionBar.append(button('Dismiss', () => act({ kind: 'network', action: 'dismissRunSummary' } as NetworkRequest), 'btn sm ghost'));
  card.append(actionBar);
  return card;
}
