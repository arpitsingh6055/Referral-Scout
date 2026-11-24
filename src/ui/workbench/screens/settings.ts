/**
 * Settings — connections, where the product opens, and the data controls (specification 21).
 *
 * The data section is not a footnote. Everything this product knows sits on one machine, and the person is
 * entitled to see how much of it there is, take a copy, and get rid of it. An export that cannot be re-imported
 * is a gesture rather than a control, so the file carries its schema version.
 */

import { exportData, sendGmail } from '../api';
import { button, card, div, empty, icon, metric, pill, text } from '../dom';
import type { Ctx } from '../shell';

function connection(name: string, connected: boolean, note: string, action?: HTMLElement): HTMLElement {
  return div('rule-row', [
    div('', [text('div', 'rule-name', name), text('div', 'rule-note', note)]),
    div('inline', [pill(connected ? 'Connected' : 'Not connected', connected ? 'green' : 'grey'), action].filter(Boolean) as HTMLElement[]),
  ]);
}

export function settings(ctx: Ctx): HTMLElement {
  const w = ctx.workspace;
  if (!w) return empty('Settings could not be loaded', 'The message above says why. Reload the extension, then reopen this page.');

  const page = div('stack');

  page.append(
    div('grid split', [
      card('Connections', {
        sub: 'Each one is independent. A missing connection narrows what the product can do; it never stops the rest.',
        body: [
          connection('LinkedIn', w.connections.linkedin, 'Your own signed-in session, used for job search and outreach.'),
          connection(
            'AI provider',
            w.connections.ai,
            'Used for written answers and ambiguous field mapping. Deterministic filling works without it.',
          ),
          connection(
            'Gmail',
            w.connections.gmail,
            'Driven through your signed-in Gmail tab, not the Gmail API — so no Google review process and nothing leaves your machine.',
            button(w.connections.gmail ? 'Re-check' : 'Connect', 'btn btn-sm', async () => {
              try {
                await sendGmail({ kind: 'gmail', action: 'connect' });
                await ctx.refresh();
              } catch (e) {
                ctx.fail(e instanceof Error ? e.message : 'Gmail could not be reached. Open Gmail in a tab and try again.');
              }
            }),
          ),
          connection(
            'CV',
            w.connections.cv,
            w.cvName ? `${w.cvName} is attached to applications.` : 'Upload one in the side panel; applications need the file itself.',
          ),
          w.connections.gmail
            ? div('inline', [
                button('Sync replies now', 'btn', async () => {
                  try {
                    const report = await sendGmail<{ scanned: number; matched: number; events: number }>({ kind: 'gmail', action: 'sync' });
                    ctx.fail(`Read ${report.scanned} conversations, matched ${report.matched}, recorded ${report.events}.`);
                    await ctx.refresh();
                  } catch (e) {
                    ctx.fail(e instanceof Error ? e.message : 'Gmail could not be read.');
                  }
                }),
              ])
            : null,
        ],
      }),

      card('Where Referral Scout opens', {
        sub: 'Clicking the toolbar icon opens whichever you choose; the other stays on the icon’s right-click menu.',
        body: [
          div('rule-row', [
            div('', [
              text('div', 'rule-name', 'Full dashboard in a tab'),
              text('div', 'rule-note', 'More room for the queue, the evidence and the inbox at once.'),
            ]),
            w.surface === 'tab'
              ? pill('Default', 'green')
              : button('Make default', 'btn btn-sm', () => ctx.run({ kind: 'workspace', action: 'surface', surface: 'tab' })),
          ]),
          div('rule-row', [
            div('', [text('div', 'rule-name', 'Side panel'), text('div', 'rule-note', 'Quick control while you are reading LinkedIn.')]),
            w.surface === 'panel'
              ? pill('Default', 'green')
              : button('Make default', 'btn btn-sm', () => ctx.run({ kind: 'workspace', action: 'surface', surface: 'panel' })),
          ]),
          div('inline', [button('Open the side panel now', 'btn', () => ctx.openPanel())]),
        ],
      }),
    ]),
  );

  /* sources */
  page.append(
    card('Job sources', {
      sub: 'A source that fails is reported and skipped; it never stops the others.',
      body: [
        div('rule-row', [
          div('', [
            text('div', 'rule-name', 'LinkedIn Jobs'),
            text('div', 'rule-note', 'Search and Easy Apply, through your own session.'),
          ]),
          pill('Searching', 'green'),
        ]),
        ...['Internshala', 'Naukri', 'Instahyre', 'Wellfound'].map(name =>
          div('rule-row', [
            div('', [
              text('div', 'rule-name', name),
              text('div', 'rule-note', 'Jobs you open from here can still be filled and queued; automatic discovery is not connected yet.'),
            ]),
            pill('Discovery not connected', 'grey'),
          ]),
        ),
        div('rule-row', [
          div('', [
            text('div', 'rule-name', 'A job you paste in'),
            text('div', 'rule-note', 'Reads only the page you chose, and records that you chose it.'),
          ]),
          pill('Ready', 'green'),
        ]),
      ],
    }),
  );

  /* data */
  const counts = w.storage;
  page.append(
    card('Your data', {
      sub: 'Everything is stored on this computer. Nothing is uploaded for analytics.',
      body: [
        div('grid metrics', [
          metric('briefcase', 'Jobs', counts.jobs),
          metric('list', 'Applications', counts.applications),
          metric('people', 'Contacts', counts.contacts),
          metric('activity', 'Events', counts.events),
        ]),
        div('inline', [
          button('Export a backup', 'btn', async () => {
            try {
              const json = await exportData();
              const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `referral-scout-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              // Revoking immediately can cancel the download in some builds; a short delay is safer.
              setTimeout(() => URL.revokeObjectURL(url), 10_000);
            } catch (e) {
              ctx.fail(e instanceof Error ? e.message : 'The backup could not be written.');
            }
          }),
          button('Delete everything', 'btn btn-danger', () => {
            ctx.fail(
              'Deleting everything is done from the side panel, under Settings, where the confirmation explains exactly what goes and what cannot be taken back.',
            );
          }),
        ]),
        div('note note-violet', [text('p', '', 'The backup carries its schema version, so a later build can read a copy taken today.')]),
        div('note note-amber', [
          text(
            'p',
            '',
            'Deleting here removes the local records. Messages already sent, and anything held by LinkedIn or Google, are theirs and cannot be withdrawn by this extension.',
          ),
        ]),
      ],
    }),
  );

  /* what it will not do */
  page.append(
    card('What this product will not do', {
      sub: 'Worth knowing before you leave it running.',
      body: [
        ...[
          ['Never answers a security check', 'A CAPTCHA or verification step pauses that one application and waits for you.'],
          ['Never types a password or a one-time code', 'Sign-in is always yours.'],
          ['Never retries an uncertain submission', 'If Submit was pressed and nothing confirmed it, you decide what happened.'],
          ['Never invents a fact about you', 'Declarations and anything it cannot source become a question instead.'],
          ['Never emails a guessed address', 'A pattern guess is drafted and held until you confirm it.'],
        ].map(([name, note]) =>
          div('rule-row', [div('', [text('div', 'rule-name', name!), text('div', 'rule-note', note!)]), icon('check', 16)]),
        ),
      ],
    }),
  );

  return page;
}

export const settingsHeader = (): { title: string; sub: string } => ({
  title: 'Settings',
  sub: 'Connections, where the product opens, your sources and your data.',
});
