/**
 * Screen 06 — campaign setup and automation rules (specification 16.8).
 *
 * Short on purpose. Specification 5.4 and 24 both warn against a setup wall: a long form before the person has
 * seen a single job is the fastest way to lose them, and most of what a long form would ask can be learned when
 * the queue actually runs into it. So this screen asks for the goal and the rules, and nothing else.
 */

import { button, card, div, field, input, pill, select, text } from '../dom';
import type { Ctx } from '../shell';

export function setup(ctx: Ctx): HTMLElement {
  const c = ctx.view.campaign;
  const existing = !!c;

  const name = input(c?.name ?? '', { placeholder: 'Product internship search' });
  const roles = input(c?.targetRoles.join(', ') ?? '', { placeholder: 'Product Management Intern, Business Analyst' });
  const location = input(c?.location ?? '', { placeholder: 'India' });
  const employment = select(
    [
      { value: 'internship', label: 'Internship' },
      { value: 'full-time', label: 'Full-time' },
      { value: 'part-time', label: 'Part-time' },
      { value: 'contract', label: 'Contract' },
      { value: 'any', label: 'Any' },
    ],
    c?.employmentType ?? 'internship',
  );
  const minFit = input(String(c?.application.minFit ?? 60), { type: 'number', min: '0', max: '100' });
  const dailyTarget = input(String(c?.application.dailyTarget ?? 15), { type: 'number', min: '0', max: '100' });
  const weeklyBudget = input(String(c?.referral.weeklyBudget ?? 80), { type: 'number', min: '0', max: '500' });
  const maxPerCompany = input(String(c?.referral.maxPerCompany ?? 3), { type: 'number', min: '1', max: '5' });
  const submitPolicy = select(
    [
      { value: 'review', label: 'Fill it and leave Submit to me' },
      { value: 'auto', label: 'Submit when everything validates' },
    ],
    c?.application.submitPolicy ?? 'review',
  );
  const concurrency = select(
    [
      { value: '1', label: 'One application at a time' },
      { value: '2', label: 'Two at a time (after testing)' },
    ],
    String(c?.application.concurrency ?? 1),
  );

  const save = button(existing ? 'Save campaign' : 'Create campaign', 'btn btn-primary', async () => {
    const targetRoles = roles.value
      .split(',')
      .map(r => r.trim())
      .filter(Boolean);
    if (!targetRoles.length || !location.value.trim()) {
      ctx.fail('Give at least one target role and a location.');
      return;
    }
    if (!existing)
      await ctx.run({
        kind: 'campaign',
        action: 'create',
        name: name.value.trim() || `${targetRoles[0]} search`,
        targetRoles,
        location: location.value.trim(),
        employmentType: employment.value,
      });
    await ctx.run({
      kind: 'campaign',
      action: 'rules',
      minFit: Number(minFit.value),
      dailyTarget: Number(dailyTarget.value),
      weeklyBudget: Number(weeklyBudget.value),
      maxPerCompany: Number(maxPerCompany.value),
      submitPolicy: submitPolicy.value as 'review' | 'auto',
      concurrency: Number(concurrency.value) === 2 ? 2 : 1,
    });
    ctx.go('overview');
  });

  const form = card(existing ? 'Campaign' : 'Create campaign', {
    sub: 'A short setup controls both the application and referral pipelines.',
    body: [
      div('form-grid', [
        field('Campaign name', name),
        field('Location', location),
        field('Target roles', roles),
        field('Employment type', employment),
        field('Minimum fit to queue a job', minFit),
        field('Applications a day (pacing)', dailyTarget),
        field('Weekly invitation budget', weeklyBudget),
        field('Most contacts per company', maxPerCompany),
      ]),
      div('note note-violet', [
        text(
          'p',
          '',
          'Nothing here has to be final. The queue asks for anything it needs as it runs, and you can change these at any time.',
        ),
      ]),
    ],
  });

  const rules = card('Automation rules', {
    sub: 'Choose how much of the repetitive work the runner handles.',
    body: [
      div('', [field('When a form is complete', submitPolicy)]),
      div('', [field('How many at once', concurrency)]),
      div('rule-row', [
        div('', [
          text('div', 'rule-name', 'Keep the queue moving'),
          text('div', 'rule-note', 'Carry on with other jobs when one needs a fact from you'),
        ]),
        pill('Always on', 'green'),
      ]),
      div('rule-row', [
        div('', [
          text('div', 'rule-name', 'Never retry an uncertain submission'),
          text('div', 'rule-note', 'If Submit was pressed and nothing confirmed it, you decide what happened'),
        ]),
        pill('Always on', 'green'),
      ]),
      div('rule-row', [
        div('', [text('div', 'rule-name', 'Gmail outcome sync'), text('div', 'rule-note', 'Match replies to applications and contacts')]),
        pill('Not connected', 'grey'),
      ]),
      div('rule-row', [
        div('', [
          text('div', 'rule-name', 'Automatic outreach'),
          text('div', 'rule-note', 'Use the weekly budget and contact order without asking each time'),
        ]),
        pill('Off', 'grey'),
      ]),
      div('note note-amber', [
        text(
          'p',
          '',
          'Two applications at once is kept behind a test. Two page tabs are not two AI sessions: with one shared conversation the model calls queue up anyway, so a second worker adds contention rather than speed until that is measured.',
        ),
      ]),
      div('', [save]),
    ],
  });

  return div('grid split-wide', [form, rules]);
}

export const setupHeader = (): { title: string; sub: string } => ({
  title: 'Campaign setup & automation rules',
  sub: 'Set the target once; choose how much of the repetitive work the extension can handle.',
});
