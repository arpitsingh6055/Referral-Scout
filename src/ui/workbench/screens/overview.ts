/**
 * Screen 01 — campaign command centre (specification 16.3).
 *
 * It answers one question: is my search progressing, and what needs me? The two pipelines are drawn as separate
 * progress, never as one combined bar, because an application queue that is three-quarters done says nothing
 * about outreach and a single bar would imply one is waiting for the other.
 */

import { ago, button, card, div, empty, icon, metric, pill, plural, progress, text } from '../dom';
import type { Ctx } from '../shell';

const statusPill = (status: string, needsYou: number): HTMLElement =>
  needsYou > 0 && status === 'running'
    ? pill('Running · needs you', 'amber')
    : status === 'running'
      ? pill('Running', 'green')
      : status === 'stopping'
        ? pill('Finishing current work', 'amber')
        : status === 'paused'
          ? pill('Paused', 'grey')
          : status === 'completed'
            ? pill('Completed', 'green')
            : pill('Draft', 'grey');

export function overview(ctx: Ctx): HTMLElement {
  const { campaign, counts, inbox, inboxCounts, queue, stages, events, peopleIdentified } = ctx.view;
  if (!campaign)
    return empty(
      'Set your target role once',
      'Referral Scout will find the jobs, work through the applications and line up the people who can refer you.',
      button('Create a campaign', 'btn btn-primary', () => ctx.go('setup')),
    );

  const page = div('stack');

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

  // Stage progress. Each stage reports its own count; nothing here implies one pipeline gates the other.
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
  page.append(card('Campaign progress', { sub: 'The two engines run independently; neither waits for the other.', body: [strip] }));

  const nextUp = queue.filter(q => q.state !== 'submitted' && q.state !== 'skipped').slice(0, 3);
  const queueCard = card('Application queue', {
    sub: 'Jobs are processed automatically; exceptions move to Needs you.',
    link: button(`View all ${counts.total}`, 'btn-link', () => ctx.go('applications')),
    body: [
      nextUp.length
        ? div(
            'rows',
            nextUp.map(row =>
              div('row row-compact', [
                div('row-title', [
                  text('div', 'row-company', row.company),
                  text('div', 'cell-strong', row.title),
                  text('div', 'cell-muted', `${row.stateLabel}${row.note ? ` · ${row.note}` : ''}`),
                ]),
                progress(
                  row.percent,
                  row.progressLabel,
                  row.state === 'submitted' ? 'green' : row.state === 'needs-you' ? 'amber' : 'violet',
                ),
              ]),
            ),
          )
        : text('p', 'cell-muted', 'Nothing in the queue yet. Shortlist a few jobs and press Start.'),
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
                div('row row-compact', [
                  div('row-title', [
                    text('div', 'cell-strong clamp', item.prompt),
                    text('div', 'cell-muted', `${item.kindLabel} · ${plural(item.affected.length, 'application')}`),
                  ]),
                  pill(item.kindLabel, item.kind === 'submission-uncertain' ? 'red' : item.kind === 'written-review' ? 'blue' : 'amber'),
                ]),
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
  return {
    title: c.name,
    sub: `${c.targetRoles.join(' · ')} — ${c.location}`,
    status: statusPill(c.status, ctx.view.inboxCounts.open),
    actions: [
      running
        ? button('Pause', 'btn', () => ctx.run({ kind: 'campaign', action: 'control', control: 'pause' }))
        : button('Start', 'btn btn-primary', () =>
            ctx.run({ kind: 'campaign', action: 'control', control: c.status === 'paused' ? 'resume' : 'start' }),
          ),
    ],
  };
};
