/**
 * First run (specification 4.2).
 *
 * Four steps, and every one can be skipped. The spec is explicit that a long setup before the person has seen a
 * single job is the fastest way to lose them, and most of what a long form would ask can be learned later, when
 * the queue actually runs into it. So this asks for the goal, offers to read the CV, and gets out of the way.
 *
 * It also states plainly what the product will not do. Someone is about to let software act on their behalf in
 * their own LinkedIn and Gmail; the limits are the most useful thing to tell them first.
 */

import { button, card, div, field, icon, input, pill, text } from '../dom';
import type { Ctx } from '../shell';

export function welcome(ctx: Ctx): HTMLElement {
  const w = ctx.workspace;
  const role = input('', { placeholder: 'Product Management Intern' });
  const location = input(w?.profile.preferences.locations[0] ?? '', { placeholder: 'India' });
  const employment = input('Internship', { placeholder: 'Internship or full-time' });

  const steps = div('stack', [
    card('1 · What are you looking for?', {
      sub: 'The only thing needed to start. Everything else can wait until it matters.',
      body: [
        div('form-grid', [field('Target role', role), field('Location', location), field('Employment type', employment)]),
        div('inline', [
          button('Create my campaign', 'btn btn-primary', async () => {
            const target = role.value.trim();
            if (!target) return ctx.fail('Give the role you are looking for — one line is enough.');
            await ctx.run({
              kind: 'campaign',
              action: 'create',
              name: `${target} search`,
              targetRoles: [target],
              location: location.value.trim() || 'India',
              employmentType: /full/i.test(employment.value) ? 'full-time' : 'internship',
            });
            ctx.go('overview');
          }),
        ]),
      ],
    }),

    card('2 · Your profile', {
      sub: 'What every application is filled from. It can be read out of your CV.',
      body: [
        w?.cv.hasText
          ? div('inline', [
              pill('CV found', 'green'),
              button('Read it into my profile', 'btn', () => ctx.run({ kind: 'workspace', action: 'importCv' })),
            ])
          : div('note note-amber', [
              text(
                'p',
                '',
                'No CV saved yet. Upload one in the side panel — applications need the file itself, and the text is what fills the forms.',
              ),
            ]),
        div('inline', [button('Open my profile', 'btn', () => ctx.go('profile'))]),
      ],
    }),

    card('3 · Connections', {
      sub: 'Each is independent. A missing one narrows what the product can do; it never stops the rest.',
      body: [
        ...[
          ['LinkedIn', w?.connections.linkedin, 'Your own signed-in session, for job search and outreach.'],
          ['AI provider', w?.connections.ai, 'For written answers. Standard fields are filled without it.'],
          ['Gmail', w?.connections.gmail, 'Optional. Drafts and reply tracking through your own Gmail tab.'],
        ].map(([name, ok, note]) =>
          div('rule-row', [
            div('', [text('div', 'rule-name', String(name)), text('div', 'rule-note', String(note))]),
            pill(ok ? 'Connected' : 'Not connected', ok ? 'green' : 'grey'),
          ]),
        ),
        div('inline', [button('Open settings', 'btn', () => ctx.go('settings'))]),
      ],
    }),
  ]);

  const limits = div('stack', [
    card('What it will never do', {
      sub: 'Worth knowing before you let it run while you are away.',
      body: [
        ...[
          ['Answer a security check', 'A CAPTCHA pauses that one application and waits for you.'],
          ['Type a password or a code', 'Signing in is always yours.'],
          ['Retry an uncertain submission', 'If Submit was pressed and nothing confirmed it, you decide what happened.'],
          ['Invent a fact about you', 'Anything it cannot source becomes a question instead.'],
          ['Email a guessed address', 'A pattern guess is drafted and held until you confirm it.'],
        ].map(([name, note]) =>
          div('rule-row', [div('', [text('div', 'rule-name', name!), text('div', 'rule-note', note!)]), icon('check', 16)]),
        ),
      ],
    }),
    card('How it works', {
      body: [
        div('note note-violet', [
          text(
            'p',
            '',
            'One campaign, two engines. Applications run through a durable queue; referral outreach runs beside it. Neither waits for the other.',
          ),
        ]),
        div('note', [
          text(
            'p',
            '',
            'When one application needs a fact from you, it is the only one that stops. You answer once, and every application waiting on that same question carries on.',
          ),
        ]),
        div('note note-amber', [text('p', '', 'Everything stays on this computer. There is no account and no server.')]),
      ],
    }),
  ]);

  return div('grid split-wide', [steps, limits]);
}

export const welcomeHeader = (): { title: string; sub: string } => ({
  title: 'Welcome to Referral Scout',
  sub: 'Set your target once. The queues build themselves, and you handle only what genuinely needs you.',
});
