/**
 * Answer Bank — every reusable fact, what it is for and where it came from (specification 5.2, 5.4).
 *
 * Each row says its scope out loud. "Global" and "asked again per country" are the difference between an answer
 * that saves the person typing and one that puts a false declaration on an application, and the only way they can
 * check that judgement is if the screen shows it.
 */

import { button, card, div, empty, field, input, metric, pill, text } from '../dom';
import type { Ctx } from '../shell';
import type { FactRow } from '../../../background/workspace';

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'grey' }> = {
  verified: { label: 'Verified', tone: 'green' },
  'needs-review': { label: 'Needs review', tone: 'amber' },
  stale: { label: 'Confirm again', tone: 'red' },
  empty: { label: 'Not saved', tone: 'grey' },
};

const SCOPE_NOTE: Record<string, string> = {
  global: 'Reused everywhere',
  campaign: 'Per campaign',
  company: 'Per company',
  job: 'Asked per job',
  country: 'Asked again in another country',
};

let section: string = 'identity';

function row(fact: FactRow, ctx: Ctx): HTMLElement {
  const box = input(fact.value, { placeholder: fact.selfDeclared ? 'Yours to declare' : 'Not saved yet', 'aria-label': fact.label });
  const status = STATUS[fact.status] ?? STATUS.empty!;
  const saveValue = (): Promise<void> | void => {
    const value = box.value.trim();
    if (!value) {
      ctx.fail('Enter a value before saving, or choose Clear to remove it.');
      return;
    }
    return ctx.run({ kind: 'workspace', action: 'saveFact', key: fact.key, value });
  };
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveValue();
    }
  });
  return div('row row-queue', [
    div('', [text('div', 'cell-strong', fact.label), text('div', 'cell-muted', SCOPE_NOTE[fact.scope] ?? fact.scope)]),
    div('', [box]),
    div('col-hide', [pill(status.label, status.tone)]),
    div('col-hide', [
      fact.provenance ? text('div', 'cell-muted', fact.provenance) : text('div', 'cell-muted', fact.source ? `From: ${fact.source}` : ''),
    ]),
    div(''),
    div('inline', [
      button('Save', 'btn btn-sm', saveValue),
      fact.value ? button('Clear', 'btn btn-sm', () => ctx.run({ kind: 'workspace', action: 'clearFact', key: fact.key })) : null,
    ]),
  ]);
}

export function answers(ctx: Ctx): HTMLElement {
  const w = ctx.workspace;
  if (!w) return empty('Your answers could not be loaded', 'The message above says why. Reload the extension, then reopen this page.');

  const page = div('stack');
  const verified = w.facts.filter(f => f.status === 'verified').length;
  const stale = w.facts.filter(f => f.status === 'stale').length;

  page.append(
    div('grid metrics', [
      metric(
        'check',
        'Core answers',
        `${w.completeness.complete}/${w.completeness.total}`,
        'unlock the most forms',
        w.completeness.complete === w.completeness.total,
      ),
      metric('list', 'Saved in total', verified, `of ${w.facts.length} the product knows about`),
      metric('clock', 'Need confirming', stale, stale ? 'these change over time' : 'nothing out of date'),
      metric(
        'alert',
        'Still missing',
        w.completeness.missing.length,
        w.completeness.missing.length ? 'asked when a form needs them' : 'none',
      ),
    ]),
  );

  const tabs = div('tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Answer sections');
  for (const s of w.factSections) {
    const b = button(`${s.label} ${s.filled}/${s.total}`, 'tab', () => {
      section = s.section;
      ctx.redraw();
    });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(section === s.section));
    tabs.append(b);
  }

  const shown = w.facts.filter(f => f.section === section);
  const current = w.factSections.find(s => s.section === section);

  page.append(
    card(current?.label ?? 'Answers', {
      sub: 'Saved once, reused only where it is safe to.',
      body: [
        tabs,
        div(
          'rows',
          shown.map(f => row(f, ctx)),
        ),
      ],
    }),
  );

  page.append(
    div('grid split', [
      card('How reuse is decided', {
        body: [
          div('note', [
            text(
              'p',
              '',
              'Two questions share one answer only when they mean the same thing. “PIN code”, “postal code” and “ZIP code” are one question. Current pay and expected pay never are.',
            ),
          ]),
          div('note note-amber', [
            text(
              'p',
              '',
              'Anything scoped to a country is asked again when the job is somewhere else. A work-authorisation answer given for India says nothing about a role in the United States.',
            ),
          ]),
          div('note note-violet', [
            text(
              'p',
              '',
              'Diversity, disability, veteran status and legal declarations are never taken from your CV or suggested by a model. They are yours to enter.',
            ),
          ]),
        ],
      }),
      card('Facts that go out of date', {
        sub: 'Pay, notice period, address and availability are re-confirmed rather than reused forever.',
        body: [
          stale
            ? div(
                'rows',
                w.facts
                  .filter(f => f.status === 'stale')
                  .map(f =>
                    div('row row-compact', [
                      div('', [text('div', 'cell-strong', f.label), text('div', 'cell-muted', f.value)]),
                      pill('Confirm again', 'red'),
                    ]),
                  ),
              )
            : text('p', 'cell-muted', 'Nothing needs re-confirming right now.'),
        ],
      }),
    ]),
  );

  return page;
}

export const answersHeader = (ctx: Ctx): { title: string; sub: string; actions: HTMLElement[] } => ({
  title: 'Answer Bank',
  sub: 'Answer once, reuse safely, and see exactly where each answer is allowed to go.',
  actions: [button('Profile', 'btn', () => ctx.go('profile')), button('Needs you', 'btn', () => ctx.go('needs-you'))],
});

export const emptyField = field;
