/**
 * Screen 01 — campaign command centre (specification 16.3).
 *
 * It answers one question: is my search progressing, and what needs me? The two pipelines are drawn as separate
 * progress, never as one combined bar, because an application queue that is three-quarters done says nothing
 * about outreach and a single bar would imply one is waiting for the other.
 */

import { ago, button, card, div, emptyState, icon, metric, pill, plural, progress, text } from '../dom';
import type { Ctx } from '../shell';

const statusPill = (status: string, needsYou: number): HTMLElement =>
  needsYou > 0 && status === 'running'
    ? pill('Active · needs you', 'amber')
    : status === 'running'
      ? pill('Active', 'green')
      : status === 'stopping'
        ? pill('Finishing current work', 'amber')
        : status === 'paused'
          ? pill('Paused', 'grey')
          : status === 'completed'
            ? pill('Completed', 'green')
            : pill('Ready to start', 'violet');

export function overview(ctx: Ctx): HTMLElement {
  const { campaign, counts, inbox, inboxCounts, queue, stages, events, peopleIdentified } = ctx.view;
  if (!campaign)
    return emptyState({
      icon: 'target',
      title: 'Set your target role once',
      description: 'Referral Scout will find the jobs, prepare your applications and line up the people who can refer you.',
      action: button('Create a campaign', 'btn btn-primary btn-lg', () => ctx.go('setup')),
    });

  const page = div('stack');
  const discovery = ctx.workspace?.jobSearch;
  const discoveredJobs = ctx.workspace?.jobs ?? [];

  if (discovery?.status === 'finding') {
    const pct = discovery.ranking
      ? `${discovery.ranking.done} of ${discovery.ranking.total} descriptions scored`
      : `Found ${discovery.found} matching roles (${discovery.cursor} of ${discovery.totalTerms || 'several'} searches done)`;
    page.append(
      div('handoff-bridge', [
        div('card-head', [
          div('', [
            text('div', 'card-title', 'Searching LinkedIn in another tab'),
            text('p', 'card-sub', `${pct}. Keep using this dashboard—we’ll surface top matches here automatically.`),
          ]),
          pill('Live on LinkedIn', 'violet'),
        ]),
        div('handoff-rail', [
          div('launchpad-step is-done', [
            div('launchpad-step-head', [div('launchpad-dot', [icon('check', 13)]), pill('Done', 'green')]),
            text('div', 'rule-name', 'Search started'),
            text('p', 'rule-note', `${campaign.targetRoles[0]} in ${campaign.location}`),
          ]),
          div('launchpad-step is-active', [
            div('launchpad-step-head', [div('launchpad-dot', ['2']), pill('Running', 'violet')]),
            text('div', 'rule-name', 'Scoring against your CV'),
            text('p', 'rule-note', discovery.ranking ? 'Comparing requirements with your experience' : 'Reading LinkedIn search results'),
          ]),
          div('launchpad-step', [
            div('launchpad-step-head', [div('launchpad-dot', ['3']), pill('Next', 'grey')]),
            text('div', 'rule-name', 'Review & shortlist'),
            text('p', 'rule-note', 'Pick your favorite roles to apply & ask for referrals'),
          ]),
        ]),
        div('inline', [
          button('View Live Results →', 'btn btn-primary', () => ctx.go('jobs')),
          button('Open LinkedIn Tab', 'btn', () => ctx.openExternal('https://www.linkedin.com/jobs/')),
        ]),
      ]),
    );
  } else if (discovery?.status === 'choosing') {
    page.append(
      card('Your jobs are ready to review', {
        sub: `${discovery.found} results are scored and ready. Pick the roles worth applying to.`,
        link: pill('Action needed', 'amber'),
        body: [button('Review Discovered Jobs →', 'btn btn-primary btn-lg', () => ctx.go('jobs'))],
      }),
    );
  } else if (counts.total === 0 && discoveredJobs.length === 0 && peopleIdentified === 0 && inbox.length === 0 && events.length === 0) {
    /* Replace cold empty wall of zeros with a guided 3-step Post-Setup Launchpad */
    const linkedinConnected = !!ctx.workspace?.connections.linkedin;
    page.append(
      div('launchpad-hero', [
        div('', [
          text('h2', 'launchpad-title', 'You’re all set to find your first roles.'),
          text(
            'p',
            'launchpad-sub',
            `Your search goal (${campaign.targetRoles.join(', ')} · ${campaign.location}) is ready. Kick off a LinkedIn search now—we’ll read listings and score them against your profile automatically.`,
          ),
        ]),
        div('launchpad-steps', [
          div('launchpad-step is-done', [
            div('launchpad-step-head', [div('launchpad-dot', [icon('check', 13)]), pill('Done', 'green')]),
            text('div', 'rule-name', '1. Search goal saved'),
            text('p', 'rule-note', `${campaign.employmentType} · ${campaign.location}`),
          ]),
          div('launchpad-step is-active', [
            div('launchpad-step-head', [div('launchpad-dot', ['2']), pill('Next step', 'violet')]),
            text('div', 'rule-name', '2. Find matching jobs on LinkedIn'),
            text('p', 'rule-note', 'Opens LinkedIn quietly, checks descriptions, and ranks fits against your profile.'),
          ]),
          div('launchpad-step', [
            div('launchpad-step-head', [div('launchpad-dot', ['3']), pill('Up next', 'grey')]),
            text('div', 'rule-name', '3. Apply & request referrals'),
            text('p', 'rule-note', 'Approve top matches, autofill forms, and line up referrers at each company.'),
          ]),
        ]),
        div('inline', [
          linkedinConnected
            ? button('Find Jobs on LinkedIn →', 'btn btn-primary btn-lg', () => ctx.runNetwork({ kind: 'network', action: 'findJobs' }), {
                'data-busy-label': 'Starting LinkedIn Search…',
                'data-progress': 'Opening LinkedIn Jobs search…',
              })
            : button('Connect LinkedIn First →', 'btn btn-primary btn-lg', () => ctx.go('profile')),
          button('Edit Search Goal', 'btn btn-ghost', () => ctx.go('setup')),
        ]),
      ]),
    );
    return page;
  }

  page.append(
    div('grid metrics', [
      metric('briefcase', 'Qualified jobs', counts.total, counts.queued ? `${counts.queued} waiting in the queue` : undefined),
      metric(
        'list',
        'Applications',
        counts.submitted,
        counts.submitted ? `${counts.submitted} confirmed submitted` : 'none submitted yet',
        counts.submitted > 0,
      ),
      metric('people', 'People identified', peopleIdentified, peopleIdentified ? 'across this campaign' : 'none yet'),
      metric(
        'alert',
        'Needs you',
        inboxCounts.open,
        inboxCounts.blocked ? `${plural(inboxCounts.blocked, 'application')} waiting` : 'nothing waiting',
      ),
    ]),
  );

  // Stage progress strip
  const strip = div('stages');
  stages.forEach((s, i) => {
    if (i) strip.append(div(s.done ? 'stage-join done' : 'stage-join'));
    strip.append(
      div('stage', [
        div(s.done ? 'stage-dot done' : 'stage-dot', [
          icon(s.done ? 'check' : ['discover', 'qualify', 'apply', 'referral', 'outcomes'][i] === 'apply' ? 'list' : 'target', 17),
        ]),
        div('', [text('div', 'stage-name', s.label), text('div', 'stage-detail', s.detail)]),
      ]),
    );
  });
  page.append(
    card('Campaign progress', {
      sub: 'Applications and referral outreach move ahead side-by-side so neither holds up the other.',
      body: [strip],
    }),
  );

  const nextUp = queue.filter(q => q.state !== 'submitted' && q.state !== 'skipped').slice(0, 3);
  const interactiveRow = (rowEl: HTMLElement, target: 'applications' | 'needs-you'): HTMLElement => {
    rowEl.tabIndex = 0;
    rowEl.setAttribute('role', 'button');
    rowEl.addEventListener('click', () => ctx.go(target));
    rowEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ctx.go(target);
      }
    });
    return rowEl;
  };
  const queueCard = card('Application queue', {
    sub: 'Jobs are processed automatically; exceptions move to Needs you.',
    link: button(`View all ${counts.total}`, 'btn-link', () => ctx.go('applications')),
    body: [
      nextUp.length
        ? div(
            'rows',
            nextUp.map(row =>
              interactiveRow(
                div('row row-compact row-clickable', [
                  div('row-title', [
                    text('div', 'row-company', row.company),
                    Object.assign(text('div', 'cell-strong', row.title), { title: row.title }),
                    Object.assign(text('div', 'cell-muted', `${row.stateLabel}${row.note ? ` · ${row.note}` : ''}`), {
                      title: `${row.stateLabel}${row.note ? ` · ${row.note}` : ''}`,
                    }),
                  ]),
                  progress(
                    row.percent,
                    row.progressLabel,
                    row.state === 'submitted' ? 'green' : row.state === 'needs-you' ? 'amber' : 'violet',
                  ),
                ]),
                'applications',
              ),
            ),
          )
        : text(
            'p',
            'cell-muted',
            'No applications are queued yet. Find jobs, review the matches and shortlist the roles you want to pursue.',
          ),
    ],
  });

  const needsCard = card('Needs you', {
    sub: inboxCounts.open ? 'Answer once; every waiting application carries on.' : undefined,
    link: inboxCounts.open ? button('Review', 'btn-link', () => ctx.go('needs-you')) : undefined,
    body: [
      inbox.length
        ? div(
            'rows',
            inbox
              .slice(0, 4)
              .map(item =>
                interactiveRow(
                  div('row row-compact row-clickable', [
                    div('row-title', [
                      Object.assign(text('div', 'cell-strong clamp', item.prompt), { title: item.prompt }),
                      text('div', 'cell-muted', `${item.kindLabel} · ${plural(item.affected.length, 'application')}`),
                    ]),
                    pill(item.kindLabel, item.kind === 'submission-uncertain' ? 'red' : item.kind === 'written-review' ? 'blue' : 'amber'),
                  ]),
                  'needs-you',
                ),
              ),
          )
        : text('p', 'cell-muted', 'Nothing is waiting on you.'),
    ],
  });

  const referralCard = card('Referral pipeline', {
    sub: 'One weekly budget, spent on the strongest contacts anywhere in the campaign.',
    link: button('View all', 'btn-link', () => ctx.go('referrals')),
    body: [
      peopleIdentified
        ? text(
            'p',
            'cell-muted',
            `${plural(peopleIdentified, 'person', 'people')} identified. ${plural(ctx.view.replies, 'reply', 'replies')} so far.`,
          )
        : text('p', 'cell-muted', 'No contacts identified yet.'),
    ],
  });

  page.append(div('grid thirds', [queueCard, referralCard, needsCard]));

  const confirmed = events.filter(e => e.confidence === 'verified').slice(0, 6);
  page.append(
    card('Latest confirmed outcomes', {
      sub: 'Only events with evidence behind them. Anything uncertain waits in Needs you.',
      link: button('Open activity', 'btn-link', () => ctx.go('activity')),
      body: [
        confirmed.length
          ? div(
              'rows',
              confirmed.map(e =>
                div('row row-compact', [
                  div('', [
                    text('div', 'cell-strong', `${e.company}${e.title ? ` · ${e.title}` : ''}`),
                    text('div', 'cell-muted', `${e.type.replace(/-/g, ' ')} · ${ago(e.occurredAt)}`),
                  ]),
                  pill(e.source, 'grey'),
                ]),
              ),
            )
          : text('p', 'cell-muted', 'Nothing confirmed yet.'),
      ],
    }),
  );

  return page;
}

export const overviewHeader = (ctx: Ctx): { title: string; sub: string; status?: HTMLElement; actions: HTMLElement[] } => {
  const c = ctx.view.campaign;
  if (!c) return { title: 'Referral Scout', sub: 'Set your target once and let the queues build themselves.', actions: [] };
  const running = c.status === 'running' || c.status === 'stopping';
  const discovered = ctx.workspace?.jobs ?? [];
  const shortlisted = discovered.filter(j => j.judgement === 'shortlisted').length;
  return {
    title: c.name,
    sub: `${c.targetRoles.join(' · ')} — ${c.location}`,
    status: statusPill(c.status, ctx.view.inboxCounts.open),
    actions: [
      running
        ? button('Pause application queue', 'btn', () => ctx.run({ kind: 'campaign', action: 'control', control: 'pause' }))
        : ctx.workspace?.jobSearch?.status === 'finding'
          ? button('Searching for jobs…', 'btn btn-primary', () => ctx.go('jobs'), { disabled: true })
          : ctx.workspace?.jobSearch?.status === 'choosing'
            ? button('Review discovered jobs', 'btn btn-primary', () => ctx.go('jobs'))
            : ctx.view.counts.queued === 0 && shortlisted > 0
              ? button(`Queue ${shortlisted} shortlisted`, 'btn btn-primary', async () => {
                  await ctx.run({ kind: 'workspace', action: 'enqueueShortlisted' });
                  ctx.go('applications');
                })
              : ctx.view.counts.queued === 0 && discovered.length > 0
                ? button(`Review ${discovered.length} jobs`, 'btn btn-primary', () => ctx.go('jobs'))
                : ctx.view.counts.queued === 0
                  ? button('Find jobs on LinkedIn', 'btn btn-primary', () => ctx.runNetwork({ kind: 'network', action: 'findJobs' }))
                  : button('Start application queue', 'btn btn-primary', () =>
                      ctx.run({ kind: 'campaign', action: 'control', control: c.status === 'paused' ? 'resume' : 'start' }),
                    ),
    ],
  };
};
