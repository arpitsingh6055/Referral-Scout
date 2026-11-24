/**
 * Screen 02 — the application queue (specification 16.4).
 *
 * The runner panel and the policy card exist so the person can tell, without reading documentation, what the
 * queue will and will not do on its own: that unrelated jobs keep moving when one needs them, and that an
 * uncertain submission is never retried. Those two promises are the ones that earn the right to run unattended.
 */

import { ago, button, card, div, empty, metric, pill, plural, progress, text } from '../dom';
import type { Ctx } from '../shell';
import type { QueueRow } from '../../../background/campaign';

type Filter = 'all' | 'ready' | 'running' | 'needs-you' | 'submitted' | 'failed' | 'uncertain' | 'skipped';

const MATCH: Record<Filter, (r: QueueRow) => boolean> = {
  all: () => true,
  ready: r => r.state === 'queued' || r.state === 'ready',
  running: r => r.state === 'opening' || r.state === 'filling',
  'needs-you': r => r.state === 'needs-you',
  submitted: r => r.state === 'submitted',
  failed: r => r.state === 'failed',
  uncertain: r => r.state === 'uncertain',
  skipped: r => r.state === 'skipped' || r.state === 'duplicate',
};

const TONE: Record<string, 'violet' | 'green' | 'amber' | 'red' | 'grey' | 'blue'> = {
  queued: 'grey',
  opening: 'violet',
  filling: 'violet',
  'needs-you': 'amber',
  ready: 'blue',
  submitted: 'green',
  uncertain: 'red',
  failed: 'red',
  skipped: 'grey',
  duplicate: 'grey',
  closed: 'grey',
};

let filter: Filter = 'all';

function rowFor(row: QueueRow, ctx: Ctx): HTMLElement {
  const actions = div('inline', []);
  if (row.state === 'uncertain') {
    // Never a Retry here. The decision itself lives in Needs you, where both answers are spelled out and the
    // consequence of each is written next to it; a bare pair of buttons in a table row invites a misclick.
    actions.append(button('Open page', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'open', id: row.id })));
    actions.append(button('Confirm', 'btn btn-sm btn-primary', () => ctx.go('needs-you')));
  } else if (row.state === 'needs-you') {
    actions.append(button('Review', 'btn btn-sm btn-primary', () => ctx.go('needs-you')));
    actions.append(button('Open', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'open', id: row.id })));
  } else if (row.state === 'failed') {
    if (row.canRetry) actions.append(button('Retry', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'retry', id: row.id })));
    actions.append(button('Skip', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'skip', id: row.id })));
  } else if (row.state === 'submitted' || row.state === 'skipped') {
    actions.append(button('Open', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'open', id: row.id })));
  } else {
    actions.append(button('Open', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'open', id: row.id })));
    actions.append(button('Skip', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'skip', id: row.id })));
  }

  return div('row row-queue', [
    div('row-title', [
      text('div', 'row-company', row.company),
      text('div', 'cell-strong', row.title),
      text('div', 'cell-muted', row.note || row.stateLabel),
    ]),
    div('col-hide', [pill(row.ats || row.source || 'direct', 'grey')]),
    div('', [pill(row.stateLabel, TONE[row.state] ?? 'grey')]),
    div('col-hide', [
      progress(row.percent, row.progressLabel, row.state === 'submitted' ? 'green' : row.state === 'needs-you' ? 'amber' : 'violet'),
      text('div', 'cell-muted', ago(row.updatedAt)),
    ]),
    actions,
  ]);
}

export function applications(ctx: Ctx): HTMLElement {
  const { counts, queue, campaign, workers } = ctx.view;
  if (!campaign)
    return empty(
      'No campaign yet',
      'Create a campaign and shortlist some jobs; they arrive here as application tasks.',
      button('Create a campaign', 'btn btn-primary', () => ctx.go('setup')),
    );
  if (!queue.length)
    return empty(
      'The queue is empty',
      'Shortlist jobs from the Jobs screen, or paste a job link. Each one becomes a durable task that survives a browser restart.',
      button('Find jobs on LinkedIn', 'btn btn-primary', () => ctx.runNetwork({ kind: 'network', action: 'findJobs' })),
    );

  const page = div('stack');
  page.append(
    div('grid metrics', [
      metric('list', 'Ready to process', counts.queued, 'in the next batch'),
      metric('refresh', 'In progress', counts.running, `${plural(workers.limit, 'worker slot')} configured`),
      metric('alert', 'Needs you', counts.needsYou, counts.needsYou ? 'exceptions waiting' : 'nothing waiting'),
      metric(
        'check',
        'Submitted',
        counts.submitted,
        counts.uncertain ? `${counts.uncertain} uncertain` : 'all confirmed',
        counts.submitted > 0 && !counts.uncertain,
      ),
    ]),
  );

  const tabs = div('tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Queue filters');
  const labels: [Filter, string][] = [
    ['all', `All ${counts.total}`],
    ['ready', `Ready ${counts.queued}`],
    ['running', `Running ${counts.running}`],
    ['needs-you', `Needs you ${counts.needsYou}`],
    ['submitted', `Submitted ${counts.submitted}`],
    ['uncertain', `Uncertain ${counts.uncertain}`],
    ['failed', `Failed ${counts.failed}`],
    ['skipped', `Skipped ${counts.skipped}`],
  ];
  for (const [key, label] of labels) {
    const b = button(label, 'tab', () => {
      filter = key;
      ctx.redraw();
    });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(filter === key));
    tabs.append(b);
  }

  const rows = queue.filter(MATCH[filter]);
  const queueCard = card('Queue', {
    sub: 'Ordered by fit, freshness and how much work the form takes.',
    body: [
      tabs,
      rows.length
        ? div(
            'rows',
            rows.map(r => rowFor(r, ctx)),
          )
        : text('p', 'cell-muted', 'Nothing in this view.'),
    ],
  });

  const running = campaign.status === 'running' || campaign.status === 'stopping';
  const side = div('stack', [
    card('Runner', {
      body: [
        div('spread', [
          text('div', 'rule-name', 'Active workers'),
          pill(`${workers.active} of ${workers.limit}`, workers.active ? 'green' : 'grey'),
        ]),
        div('', [text('div', 'cell-muted', campaign.statusNote || (running ? 'Claiming eligible jobs.' : 'Not claiming new jobs.'))]),
        div('inline', [
          running
            ? button('Pause queue', 'btn', () => ctx.run({ kind: 'campaign', action: 'control', control: 'pause' }))
            : button('Start application queue', 'btn btn-primary', () =>
                ctx.run({ kind: 'campaign', action: 'control', control: campaign.status === 'paused' ? 'resume' : 'start' }),
              ),
          running ? button('Stop after current', 'btn', () => ctx.run({ kind: 'campaign', action: 'control', control: 'drain' })) : null,
          counts.needsYou ? button('Review exceptions', 'btn btn-primary', () => ctx.go('needs-you')) : null,
        ]),
      ],
    }),
    card('What the queue will do', {
      body: [
        div('note note-violet', [
          text(
            'p',
            '',
            'When one application needs you, the others carry on. Pausing stops new jobs being claimed; work already on a form stops at its next safe point.',
          ),
        ]),
        div('note note-amber', [
          text(
            'p',
            '',
            'If Submit was pressed and the page showed no confirmation, the application is marked uncertain and is never retried on its own — a second application is worse than a missing one.',
          ),
        ]),
      ],
    }),
  ]);

  page.append(div('grid split', [queueCard, side]));
  return page;
}

export const applicationsHeader = (): { title: string; sub: string } => ({
  title: 'Application queue',
  sub: 'A durable queue turns each shortlisted job into a managed application task.',
});
