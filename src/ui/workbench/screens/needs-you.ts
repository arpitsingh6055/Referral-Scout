/**
 * Screen 03 — Needs you and the Answer Bank (specification 16.5).
 *
 * The rule the whole screen is built around: before a saved answer reaches several applications, the person sees
 * exactly which ones will get it. Bulk-applying a fact is the single most useful thing the product does and the
 * easiest place to put a wrong value onto a dozen real applications, so the preview is not optional and the
 * selection defaults to visible rather than implied.
 */

import { button, card, div, empty, input as makeInput, pill, plural, text } from '../dom';
import type { Ctx } from '../shell';
import type { InboxRow } from '../../../background/campaign';

const TONE: Record<string, 'violet' | 'green' | 'amber' | 'red' | 'grey' | 'blue'> = {
  'reusable-fact': 'violet',
  'job-choice': 'violet',
  'written-review': 'blue',
  auth: 'amber',
  security: 'amber',
  'page-failure': 'red',
  'submission-uncertain': 'red',
  'profile-gap': 'grey',
};

/** Which applications receive the value, shown and chosen before anything is saved. */
function preview(item: InboxRow): { node: HTMLElement; selected: () => string[] } {
  const boxes: HTMLInputElement[] = [];
  const list = div(
    '',
    item.affected.map(a => {
      const box = makeInput('', { type: 'checkbox', checked: true, style: 'min-width:auto' }) as HTMLInputElement;
      box.dataset.id = a.applicationId;
      boxes.push(box);
      return div('inline', [box, text('span', 'cell-muted', `${a.company} · ${a.title}`)]);
    }),
  );
  return { node: list, selected: () => boxes.filter(b => b.checked).map(b => b.dataset.id!) };
}

function itemCard(item: InboxRow, ctx: Ctx): HTMLElement {
  const urgent = item.kind === 'submission-uncertain';
  const body = div('', [text('div', 'inbox-q', item.prompt)]);
  const meta: string[] = [plural(item.affected.length, 'application') + ' waiting'];
  if (item.matchedAs) meta.push(`Matched to: ${item.matchedAs}`);
  body.append(text('div', 'inbox-meta', meta.join(' · ')));

  const action = div('inbox-answer');

  if (item.resolution === 'answer' || item.resolution === 'choose') {
    const box = makeInput(item.suggestedValue ?? '', { placeholder: 'Your answer', 'aria-label': item.prompt });
    const chooser = preview(item);
    const details = document.createElement('details');
    details.append(document.createElement('summary'));
    details.querySelector('summary')!.textContent = `Apply to ${plural(item.affected.length, 'application')}`;
    details.append(chooser.node);
    body.append(details);
    action.append(
      box,
      button('Save', 'btn btn-primary btn-sm', async () => {
        const value = box.value.trim();
        if (!value) return;
        await ctx.run({
          kind: 'campaign',
          action: 'resolve',
          exceptionId: item.id,
          value,
          applyTo: chooser.selected(),
          // A fact the person typed once is worth keeping; a per-job decision is not saved globally.
          saveToBank: item.resolution === 'answer',
          then: 'resume',
        });
      }),
    );
  } else if (item.resolution === 'confirm') {
    body.append(
      div('note note-amber', [
        text(
          'p',
          '',
          'Check the page or your email before answering. “It went through” records it as submitted and stops the queue touching it again; “It did not” puts it back in the queue to be filled from the start.',
        ),
      ]),
    );
    action.append(
      button('Open page', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'open', id: item.affected[0]!.applicationId })),
      button('It went through', 'btn btn-sm btn-primary', () =>
        ctx.run({ kind: 'campaign', action: 'confirm', id: item.affected[0]!.applicationId, outcome: 'submitted' }),
      ),
      button('It did not', 'btn btn-sm', () =>
        ctx.run({ kind: 'campaign', action: 'confirm', id: item.affected[0]!.applicationId, outcome: 'not-submitted' }),
      ),
    );
  } else if (item.resolution === 'open-tab') {
    action.append(
      button('Open tab', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'open', id: item.affected[0]!.applicationId })),
      button('Done — resume', 'btn btn-primary btn-sm', () =>
        ctx.run({ kind: 'campaign', action: 'resolve', exceptionId: item.id, saveToBank: false, then: 'resume' }),
      ),
    );
  } else if (item.resolution === 'review') {
    action.append(
      button('Open application', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'open', id: item.affected[0]!.applicationId })),
      button('Reviewed', 'btn btn-primary btn-sm', () =>
        ctx.run({ kind: 'campaign', action: 'resolve', exceptionId: item.id, saveToBank: false, then: 'resume' }),
      ),
    );
  } else {
    action.append(
      button('Retry', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'retry', id: item.affected[0]!.applicationId })),
      button('Skip', 'btn btn-sm', () => ctx.run({ kind: 'campaign', action: 'skip', id: item.affected[0]!.applicationId })),
    );
  }

  return div(urgent ? 'inbox-item urgent' : 'inbox-item', [div('', [pill(item.kindLabel, TONE[item.kind] ?? 'grey')]), body, action]);
}

export function needsYou(ctx: Ctx): HTMLElement {
  const { inbox, inboxCounts, factSections, completeness, campaign } = ctx.view;
  if (!campaign) return empty('No campaign yet', 'Questions from your applications collect here once a campaign is running.');

  const inboxCard = card('Needs you inbox', {
    sub: 'Exceptions are isolated; unrelated applications carry on.',
    link: inboxCounts.open ? pill(`${inboxCounts.open} open`, 'amber') : pill('All clear', 'green'),
    body: [
      inbox.length
        ? div(
            '',
            inbox.map(i => itemCard(i, ctx)),
          )
        : div('empty', [
            text('div', 'empty-title', 'Nothing is waiting on you'),
            text('p', '', 'The queue will bring anything it cannot decide for itself here.'),
          ]),
    ],
  });

  const bank = card('Candidate Answer Bank', {
    sub: 'One verified profile, reused across applications.',
    body: [
      div('bank-head', [
        div('', [
          text('div', 'bank-count', `${completeness.complete} / ${completeness.total}`),
          text('div', 'cell-muted', 'common facts complete'),
        ]),
        text(
          'div',
          'cell-muted',
          completeness.missing.length
            ? `${plural(completeness.missing.length, 'core fact')} still to confirm`
            : 'Every core fact is confirmed.',
        ),
      ]),
      ...factSections.map(s =>
        div('section-row', [
          div('', [text('div', 'rule-name', s.label), text('div', 'rule-note', `${s.filled} of ${s.total} saved`)]),
          div('', [
            pill(
              s.status === 'verified'
                ? 'Verified'
                : s.status === 'stale'
                  ? 'Needs refresh'
                  : s.status === 'empty'
                    ? 'Not started'
                    : 'Needs review',
              s.status === 'verified' ? 'green' : s.status === 'stale' ? 'red' : s.status === 'empty' ? 'grey' : 'amber',
            ),
          ]),
        ]),
      ),
      div('note', [
        text(
          'p',
          '',
          'Only questions that mean the same thing are filled from one answer. Current pay is never reused as expected pay, and a work-authorisation answer given for one country is asked again for another.',
        ),
      ]),
    ],
  });

  return div('grid split-wide', [inboxCard, bank]);
}

export const needsYouHeader = (ctx: Ctx): { title: string; sub: string; status?: HTMLElement } => ({
  title: 'Needs you & Answer Bank',
  sub: 'Answer a recurring fact once, resolve the affected applications and keep the queue moving.',
  ...(ctx.view.inboxCounts.blocked
    ? { status: pill(`${plural(ctx.view.inboxCounts.blocked, 'application')} paused for you`, 'amber') }
    : {}),
});
