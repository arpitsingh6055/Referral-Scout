/** Home status: what is running, how far it has got, and the live step-by-step tracker. */
import { DAY, defaultSettings, withinActiveHours, type NetworkState } from '../shared/network';
import { node, icon, pad } from './core';

/* ---------- derived status ---------- */
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
  if (s.paused)
    return {
      tone: 'idle',
      pill: 'Paused',
      title: 'Paused',
      sub: s.status || 'Nothing is running. Press Resume to continue where you stopped.',
    };
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
    pill: s.active ? 'Running' : 'Paused',
    title: 'Paused',
    sub: s.status,
  };
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
/* Where the person is on the way from a job search to a referral: 0 finding jobs, 1 choosing, 2 finding people, 3 reaching out. */
export function journey(s: NetworkState): number {
  const jobs = s.referralJobs ?? [];
  if (s.jobSearch?.status === 'finding') return 0;
  if (s.jobSearch?.status === 'choosing' && s.jobSearch.found.length) return 1;
  if (jobs.some(j => !j.finishedAt)) return 2;
  return jobs.length || s.contacts.some(p => p.referralJob) ? 3 : -1;
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
export type LiveStep = [state: 'done' | 'now' | 'later', text: string, detail?: string | undefined];
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
    title = 'Searching LinkedIn for jobs';
    since = search.startedAt;
    expect =
      'Usually 2 to 4 minutes. ChatGPT gets up to 2 minutes to suggest similar job titles, then each title takes about 15 seconds because every page is opened and read at a human pace.';
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
    expect =
      'About 1 to 2 minutes per company: the job page, the company page, then up to five people searches, spaced a few seconds apart.';
    if (open.some(j => j.mode === 'referral' && !j.strategy && !j.strategyTried))
      steps.push(['now', 'Ask ChatGPT who is worth approaching at each company', s.status]);
    for (const job of jobs.slice(0, 10)) {
      const found = s.contacts.filter(p => p.referralJob === job.url).length;
      if (job.finishedAt) steps.push(['done', job.company, `${found} ${found === 1 ? 'person' : 'people'} found`]);
      else if (job.waiting) steps.push(['now', job.company, 'Waiting for your answer under “Needs you”']);
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
    expect =
      'Messages go out one at a time with a pause between them, within your daily limit. Accepted invitations are checked every 2 hours and followed up automatically.';
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
  head.append(node('span', '', 'spinner'), node('h3', title, 'live-title'));
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
    body.append(node('b', text));
    if (detail) body.append(node('span', detail));
    li.append(mark, body);
    list.append(li);
  }
  ago.dataset.ago = String((s.log ?? []).at(-1)?.at ?? Date.now());
  foot.append(ago);
  card.append(head, list, node('p', expect, 'live-expect'), foot);
  return card;
}
