/**
 * Screen 05 — outcomes and learning (specification 16.7).
 *
 * Every row says where the event came from and how sure the product is. That is the difference between a
 * pipeline the person can act on and one they have to double-check: an interview read out of an email is a
 * suggestion until they confirm it, and the screen says so rather than quietly moving the stage.
 */

import { ago, button, card, div, emptyState, metric, pill, plural, text } from '../dom';
import type { Ctx } from '../shell';
import type { OutcomeEvent } from '../../../shared/persistence/campaign-store';

const LABELS: Record<string, string> = {
  queued: 'Queued',
  filling: 'Filling',
  submitted: 'Application submitted',
  'submission-uncertain': 'Submission uncertain',
  assessment: 'Assessment invite',
  interview: 'Interview invite',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  'contact-selected': 'Contact selected',
  'invitation-sent': 'Invitation sent',
  'invitation-accepted': 'Connection accepted',
  reply: 'Reply received',
  'referral-offered': 'Referral offered',
  'referral-submitted': 'Referral submitted',
  bounce: 'Email bounced',
};

const TONE: Record<string, 'violet' | 'green' | 'amber' | 'red' | 'grey' | 'blue'> = {
  submitted: 'green',
  'referral-submitted': 'green',
  'invitation-accepted': 'green',
  interview: 'green',
  offer: 'green',
  assessment: 'blue',
  reply: 'blue',
  rejected: 'red',
  'submission-uncertain': 'red',
  bounce: 'red',
};

const confidencePill = (e: OutcomeEvent): HTMLElement =>
  e.confidence === 'verified'
    ? pill(`${e.source} · verified`, 'grey')
    : e.confidence === 'suggested'
      ? pill(`${e.source} · suggested`, 'amber')
      : pill(`${e.source} · confirm this`, 'red');

export function activity(ctx: Ctx): HTMLElement {
  const { events, counts, campaign, replies, peopleIdentified } = ctx.view;
  if (!campaign)
    return emptyState({
      icon: 'activity',
      title: 'No campaign yet',
      description: 'Application and conversation events collect here once a campaign is running.',
      action: button('Create a campaign', 'btn btn-primary', () => ctx.go('setup')),
    });

  const page = div('stack');
  const interviews = events.filter(e => e.type === 'interview').length;
  const referred = events.filter(e => e.type === 'referral-submitted' || e.type === 'referral-offered').length;
  const analytics = ctx.view.analytics;

  if (analytics) {
    page.append(
      div('note note-violet', [
        text(
          'p',
          '',
          `This week: ${plural(analytics.weeklyProgressedOpportunities, 'opportunity')} moved forward${analytics.activated ? '' : ' · Shortlist or apply to 1 role to get started.'}`,
        ),
      ]),
    );
  }

  page.append(
    div('grid metrics', [
      metric(
        'list',
        'Applications',
        counts.submitted,
        counts.uncertain ? `${counts.uncertain} need confirming` : 'confirmed submitted',
        counts.submitted > 0,
      ),
      metric('mail', 'Conversations', replies, `${plural(peopleIdentified, 'person', 'people')} approached`),
      metric('star', 'Referrals', referred, referred ? 'offered or submitted' : 'none yet'),
      metric('clock', 'Interviews', interviews, interviews ? 'from this campaign' : 'none yet'),
    ]),
  );

  const timeline = card('Opportunity outcomes', {
    sub: 'Every event carries its source, its time and how confident the product is.',
    body: [
      events.length
        ? div(
            'rows',
            events.map(e =>
              div('row row-queue', [
                div('row-title', [
                  text('div', 'row-company', e.company),
                  text('div', 'cell-strong', e.title ?? LABELS[e.type] ?? e.type),
                  e.note ? text('div', 'cell-muted', e.note) : null,
                ]),
                div('col-hide', [confidencePill(e)]),
                div('', [pill(LABELS[e.type] ?? e.type, TONE[e.type] ?? 'grey')]),
                div('col-hide', [text('div', 'cell-muted', ago(e.occurredAt))]),
                div(''),
              ]),
            ),
          )
        : emptyState({
            icon: 'activity',
            title: 'No events yet',
            description: 'Submitted applications, replies and employer responses appear here as they are confirmed.',
          }),
    ],
  });

  // Source performance needs a denominator before it can mean anything; until then it says so rather than
  // drawing a bar chart built on three data points.
  const bySource = new Map<string, { submitted: number; interviews: number }>();
  for (const e of events) {
    const key = e.source;
    const row = bySource.get(key) ?? { submitted: 0, interviews: 0 };
    if (e.type === 'submitted') row.submitted++;
    if (e.type === 'interview') row.interviews++;
    bySource.set(key, row);
  }

  const side = div('stack', [
    card('Source performance', {
      body: [
        counts.submitted >= 10
          ? div(
              '',
              [...bySource.entries()].map(([source, row]) =>
                div('rule-row', [
                  div('', [
                    text('div', 'rule-name', source),
                    text('div', 'rule-note', `${row.submitted} submitted · ${row.interviews} interviews`),
                  ]),
                ]),
              ),
            )
          : div('note note-violet', [
              text(
                'p',
                '',
                `Not enough applications yet to compare sources honestly. ${plural(counts.submitted, 'application')} confirmed so far; a rate drawn from this few would be noise.`,
              ),
            ]),
      ],
    }),
    card('What this will answer', {
      body: [
        ...[
          'Which sources produce interviews?',
          'Which role families get responses?',
          'Which contact types lead to referrals?',
          'How many applications need a correction?',
        ].map(q => div('rule-row', [text('div', 'rule-name', q)])),
      ],
    }),
  ]);

  page.append(div('grid split', [timeline, side]));
  return page;
}

export const activityHeader = (ctx: Ctx): { title: string; sub: string; actions: HTMLElement[] } => ({
  title: 'Outcomes & learning',
  sub: 'Connect applications, replies and interviews so the product can learn what is working.',
  actions: [button('Refresh', 'btn', () => ctx.refresh())],
});
