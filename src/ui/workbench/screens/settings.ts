/** Settings — connections, launch behaviour, privacy and recoverable data controls. */
import { exportData, sendGmail, testChatGpt } from '../api';
import { ago, button, card, confirmModal, div, errorStateWithRetry, field, input, metric, pill, setFieldError, text } from '../dom';
import type { Ctx } from '../shell';
import { type AiTier, TIERS } from '../../../shared/ai-budget';

/** Produces a non-PII diagnostics snapshot suitable for pasting into a bug report. */
export function buildDiagnosticsSummary(ctx: Ctx): string {
  const manifestVersion = (globalThis as { chrome?: typeof chrome }).chrome?.runtime?.getManifest?.().version ?? 'unknown';
  const w = ctx.workspace;
  const counts = ctx.view.counts;
  return JSON.stringify(
    {
      version: manifestVersion,
      theme: ctx.theme,
      connections: w
        ? {
            linkedin: w.connections.linkedin,
            gmail: w.connections.gmail,
            customApiKey: w.connections.ai,
            cvUploaded: w.connections.cv || w.cv.hasText,
          }
        : null,
      counts: {
        jobs: w?.jobs.length ?? 0,
        contacts: w?.contacts.length ?? 0,
        events: ctx.view.events?.length ?? 0,
        queueTotal: counts.total,
        queueSubmitted: counts.submitted,
        queueNeedsYou: counts.needsYou,
        queueFailed: counts.failed,
      },
      campaignStatus: ctx.view.campaign?.status ?? 'none',
    },
    null,
    2,
  );
}

function connection(
  name: string,
  status: string,
  tone: 'green' | 'amber' | 'grey',
  note: string,
  actions: HTMLElement[] = [],
): HTMLElement {
  return div('rule-row', [
    div('', [text('div', 'rule-name', name), text('div', 'rule-note', note)]),
    div('inline', [pill(status, tone), ...actions]),
  ]);
}

export function settings(ctx: Ctx): HTMLElement {
  const w = ctx.workspace;
  // A view saved before the plan selector existed, or one from an older build, still has to render.
  const aiTier: AiTier = w && TIERS[w.aiTier] ? w.aiTier : 'free';
  if (!w)
    return errorStateWithRetry('Could not load settings', 'Your local settings store did not respond. Retry to refresh.', () =>
      ctx.refresh(),
    );

  const page = div('stack');
  const privacyChoice = input('', {
    type: 'checkbox',
    'aria-label': 'Send anonymous usage counts',
    ...(w.usageReporting ? { checked: true } : {}),
  });

  /* Sign-in and profile actions live here, even though authentication itself happens on each provider's website. */
  const linkedinActions = w.connections.linkedin
    ? [
        button(
          ctx.busyAction === 'network:import' ? 'Reading…' : 'Refresh profile',
          'btn btn-sm btn-primary',
          () => ctx.runNetwork({ kind: 'network', action: 'import' }),
          { disabled: ctx.busyAction === 'network:import', 'aria-busy': ctx.busyAction === 'network:import' },
        ),
        button('Open LinkedIn', 'btn btn-sm', () => ctx.openExternal('https://www.linkedin.com/')),
      ]
    : [
        button('Open LinkedIn to sign in', 'btn btn-sm btn-primary', () => ctx.openExternal('https://www.linkedin.com/login')),
        button(
          ctx.busyAction === 'network:import' ? 'Reading…' : "I've signed in — read profile",
          'btn btn-sm btn-primary',
          () => ctx.runNetwork({ kind: 'network', action: 'import' }),
          { disabled: ctx.busyAction === 'network:import', 'aria-busy': ctx.busyAction === 'network:import' },
        ),
      ];

  const apiKey = input('', { type: 'password', placeholder: 'Paste an OpenAI API key', autocomplete: 'off' });
  const apiModel = input('', { placeholder: 'Model name exactly as shown in your OpenAI account' });
  apiKey.addEventListener('input', () => setFieldError(apiKey));
  apiModel.addEventListener('input', () => setFieldError(apiModel));
  const apiControls = w.connections.ai
    ? div('stack', [
        text('p', 'field-help', 'A custom OpenAI API key is saved on this device. The key itself is never shown or included in exports.'),
        div('inline', [
          button('Test API key', 'btn btn-sm', () => ctx.runNetwork({ kind: 'network', action: 'testApi' })),
          button('Remove API key', 'btn btn-sm btn-danger', async () => {
            if (
              await confirmModal({
                title: 'Remove OpenAI API key?',
                description: 'Referral Scout will switch back to using your signed-in ChatGPT website session.',
                confirmLabel: 'Remove API key',
                tone: 'danger',
              })
            )
              await ctx.runNetwork({ kind: 'network', action: 'clearApi' });
          }),
        ]),
      ])
    : div('stack', [
        text(
          'p',
          'field-help',
          'Optional. By default, AI-assisted tasks use your own signed-in ChatGPT website session; no API key is needed.',
        ),
        div('form-grid', [field('OpenAI API key', apiKey), field('Model', apiModel)]),
        button('Save API key', 'btn btn-sm btn-primary', async () => {
          setFieldError(apiKey);
          setFieldError(apiModel);
          if (apiKey.value.trim().length < 20) {
            setFieldError(apiKey, 'Paste the complete OpenAI API key.');
            apiKey.focus();
            return ctx.fail('Paste the complete OpenAI API key.');
          }
          if (apiModel.value.trim().length < 2) {
            setFieldError(apiModel, 'Enter the model name as listed in your OpenAI account.');
            apiModel.focus();
            return ctx.fail('Enter the model name exactly as listed in your OpenAI account.');
          }
          const permissions = chrome.permissions;
          if (permissions?.request && !(await permissions.request({ origins: ['https://api.openai.com/*'] })))
            return ctx.fail('Access to api.openai.com was not allowed, so the key was not saved.');
          await ctx.runNetwork({ kind: 'network', action: 'saveApi', key: apiKey.value.trim(), model: apiModel.value.trim() });
        }),
      ]);

  page.append(
    div('grid split', [
      card('Accounts and connections', {
        sub: 'Sign in on the service itself. Referral Scout uses the session already open in this browser; it does not collect your passwords.',
        body: [
          /*
           * Which plan the person is on decides how much Referral Scout may ask of ChatGPT before it starts
           * waiting, so it is asked for plainly rather than guessed. The consequence of each choice is written
           * next to it, because "Free" means nothing on its own.
           */
          div('rule-row', [
            div('', [
              text('div', 'rule-name', 'Your ChatGPT plan'),
              text('div', 'rule-note', `${TIERS[aiTier].blurb} ${w.aiBudgetLine ?? ''}`.trim()),
            ]),
            div('inline', [
              (() => {
                const sel = document.createElement('select');
                sel.className = 'input';
                sel.setAttribute('aria-label', 'Your ChatGPT plan');
                for (const tier of ['free', 'go', 'plus', 'api'] as const) {
                  const opt = document.createElement('option');
                  opt.value = tier;
                  opt.textContent = `${TIERS[tier].label} · about ${TIERS[tier].perWindow} questions per 3 hours`;
                  opt.selected = aiTier === tier;
                  sel.append(opt);
                }
                sel.addEventListener('change', () => {
                  const tier = sel.value as 'free' | 'go' | 'plus' | 'api';
                  void ctx.run({ kind: 'workspace', action: 'setAiTier', tier });
                });
                return sel;
              })(),
            ]),
          ]),
          ...(w.perContactAllowed
            ? [
                div('rule-row', [
                  div('', [
                    text('div', 'rule-name', 'Rewrite every message for its recipient'),
                    text(
                      'div',
                      'rule-note',
                      'Off by default. Your search already has wording written once for these roles, and filling in a name costs nothing. Turning this on spends one ChatGPT question per person you reach out to.',
                    ),
                  ]),
                  div('inline', [
                    (() => {
                      const box = input('', {
                        type: 'checkbox',
                        'aria-label': 'Rewrite every message for its recipient',
                        ...(w.perContactOn ? { checked: true } : {}),
                      });
                      box.addEventListener('change', () => {
                        void ctx.run({ kind: 'workspace', action: 'setPerContactAi', on: box.checked });
                      });
                      return box;
                    })(),
                  ]),
                ]),
              ]
            : []),
          connection(
            'LinkedIn',
            w.connections.linkedin ? 'Profile read' : 'Action needed',
            w.connections.linkedin ? 'green' : 'amber',
            w.connections.linkedin
              ? `Your own LinkedIn profile was captured ${w.linkedinProfileCapturedAt ? ago(w.linkedinProfileCapturedAt) : 'previously'}. This is a saved profile record, not a live sign-in check; refresh it when you need current details.`
              : 'Open LinkedIn, sign in, then choose Read profile. Profile reading does not require usage-reporting consent.',
            linkedinActions,
          ),
          connection(
            'ChatGPT website',
            (w.chatgptMode ?? 'incognito') === 'incognito' ? 'Incognito (Temporary)' : 'Normal chat',
            'green',
            'Used for AI-assisted job search, ranking, and writing through your signed-in ChatGPT session. Incognito (Temporary chat) keeps automated searches out of your ChatGPT history.',
            [
              (() => {
                const sel = document.createElement('select');
                sel.className = 'input';
                sel.setAttribute('aria-label', 'ChatGPT mode');
                for (const [val, label] of [
                  ['incognito', 'Incognito (Temporary chat · default)'],
                  ['normal', 'Normal chat history'],
                ] as const) {
                  const opt = document.createElement('option');
                  opt.value = val;
                  opt.textContent = label;
                  opt.selected = (w.chatgptMode ?? 'incognito') === val;
                  sel.append(opt);
                }
                sel.addEventListener('change', () => {
                  const mode = sel.value === 'normal' ? 'normal' : 'incognito';
                  void ctx.run({ kind: 'workspace', action: 'setChatGptMode', mode });
                });
                return sel;
              })(),
              button('Open ChatGPT', 'btn btn-sm', () =>
                ctx.openExternal(
                  (w.chatgptMode ?? 'incognito') === 'incognito' ? 'https://chatgpt.com/?temporary-chat=true' : 'https://chatgpt.com/',
                ),
              ),
              button(
                'Test ChatGPT',
                'btn btn-sm',
                async () => {
                  try {
                    await testChatGpt();
                    ctx.inform('ChatGPT is working in this browser session.');
                  } catch (error) {
                    ctx.fail(error instanceof Error ? error.message : 'ChatGPT could not be reached.');
                  }
                },
                { 'data-busy-label': 'Testing…', 'data-progress': 'Sending a quick test prompt to your ChatGPT session…' },
              ),
            ],
          ),
          div('rule-row', [
            div('', [
              text('div', 'rule-name', 'OpenAI API key (optional)'),
              text(
                'div',
                'rule-note',
                'An alternative to the ChatGPT website. OpenAI bills API use to your account; the key is stored locally and excluded from backups.',
              ),
            ]),
            div('inline', [pill(w.connections.ai ? 'Saved' : 'Not configured', w.connections.ai ? 'green' : 'grey')]),
          ]),
          (() => {
            const advanced = document.createElement('details');
            advanced.className = 'advanced-settings';
            const summary = document.createElement('summary');
            summary.textContent = w.connections.ai
              ? 'Advanced: API connection settings'
              : 'Advanced: use your own OpenAI API key (not required)';
            advanced.append(summary, apiControls);
            return advanced;
          })(),
          connection(
            'Gmail',
            w.connections.gmail ? 'Available' : 'Optional',
            w.connections.gmail ? 'green' : 'grey',
            'Uses your signed-in Gmail tab to create drafts and look for relevant replies. Gmail is not needed for job search.',
            [
              button(
                w.connections.gmail ? 'Re-check Gmail' : 'Connect Gmail',
                'btn btn-sm',
                async () => {
                  try {
                    await sendGmail({ kind: 'gmail', action: 'connect' });
                    await ctx.refresh();
                    ctx.inform('Gmail was opened. Sign in there if needed, then return here.');
                  } catch (error) {
                    ctx.fail(error instanceof Error ? error.message : 'Gmail could not be reached. Open Gmail in a tab and try again.');
                  }
                },
                { 'data-busy-label': 'Checking Gmail…', 'data-progress': 'Checking your Gmail tab connection…' },
              ),
            ],
          ),
          w.connections.gmail
            ? div('inline', [
                button(
                  'Sync relevant replies',
                  'btn',
                  async () => {
                    try {
                      const report = await sendGmail<{ scanned: number; matched: number; events: number }>({
                        kind: 'gmail',
                        action: 'sync',
                      });
                      ctx.inform(`Read ${report.scanned} conversations, matched ${report.matched}, recorded ${report.events}.`);
                      await ctx.refresh();
                    } catch (error) {
                      ctx.fail(error instanceof Error ? error.message : 'Gmail could not be read.');
                    }
                  },
                  { 'data-busy-label': 'Syncing replies…', 'data-progress': 'Scanning Gmail conversations for relevant replies…' },
                ),
              ])
            : null,
          connection(
            'CV document',
            w.connections.cv ? 'Saved' : 'Not added',
            w.connections.cv ? 'green' : 'grey',
            w.cvName
              ? `${w.cvName} is saved in this browser.`
              : 'Add a PDF or DOCX in your Candidate profile. This is optional for browsing jobs.',
            [button('Manage CV', 'btn btn-sm', () => ctx.go('profile'))],
          ),
        ],
      }),
      card('Where Referral Scout opens', {
        sub: 'The toolbar icon opens your chosen default. The other surface remains available from the icon menu.',
        body: [
          div('rule-row', [
            div('', [
              text('div', 'rule-name', 'Side panel'),
              text('div', 'rule-note', 'Quick entry point beside LinkedIn. This is the first-run default.'),
            ]),
            w.surface === 'panel'
              ? pill('Default', 'green')
              : button('Make default', 'btn btn-sm', () => ctx.run({ kind: 'workspace', action: 'surface', surface: 'panel' })),
          ]),
          div('rule-row', [
            div('', [
              text('div', 'rule-name', 'Full dashboard in a tab'),
              text('div', 'rule-note', 'Best for reviewing profiles, queues, applications and detailed records.'),
            ]),
            w.surface === 'tab'
              ? pill('Default', 'green')
              : button('Make default', 'btn btn-sm', () => ctx.run({ kind: 'workspace', action: 'surface', surface: 'tab' })),
          ]),
          div('inline', [button('Open side panel now', 'btn', () => ctx.openPanel())]),
        ],
      }),
    ]),
  );

  page.append(
    card('Privacy and usage reporting', {
      sub: 'Core features do not depend on usage reporting. Your choice can be changed at any time.',
      body: [
        div('note note-violet', [
          text(
            'p',
            '',
            'Your profile, CV, jobs, contacts, messages and application records are stored locally in this browser. When you use AI features, the relevant context is sent to your own signed-in ChatGPT account, or to OpenAI if you configure an API key.',
          ),
        ]),
        div('setup-privacy-choice', [
          privacyChoice,
          text(
            'span',
            '',
            'Allow one-time usage counting. If enabled, Referral Scout sends a random install ID, your display name and LinkedIn profile handle to the developer. It does not include your CV, jobs, contacts or messages.',
          ),
        ]),
        button('Save privacy choice', 'btn', () =>
          ctx.runNetwork({ kind: 'network', action: privacyChoice.checked ? 'consent' : 'revokeConsent' }),
        ),
      ],
    }),
  );

  /* sources */
  const manualBoards = document.createElement('details');
  manualBoards.className = 'advanced-settings';
  const manualSummary = document.createElement('summary');
  manualSummary.textContent = 'Other job boards (manual paste only — Internshala, Naukri, Instahyre, Wellfound)';
  manualBoards.append(
    manualSummary,
    div(
      'stack',
      ['Internshala', 'Naukri', 'Instahyre', 'Wellfound'].map(name =>
        div('rule-row', [
          div('', [
            text('div', 'rule-name', name),
            text('div', 'rule-note', 'Open a job from this site and fill it with Referral Scout; automatic discovery is not connected.'),
          ]),
          pill('Manual paste', 'grey'),
        ]),
      ),
    ),
  );
  page.append(
    card('Job sources', {
      sub: 'A source that fails is reported and skipped; it never stops the others.',
      body: [
        div('rule-row', [
          div('', [
            text('div', 'rule-name', 'LinkedIn Jobs'),
            text('div', 'rule-note', 'Search and Easy Apply, through your own signed-in session.'),
          ]),
          pill('Available', 'green'),
        ]),
        div('rule-row', [
          div('', [
            text('div', 'rule-name', 'A job you paste in'),
            text('div', 'rule-note', 'Reads only the page you chose, and records that you chose it.'),
          ]),
          pill('Available', 'green'),
        ]),
        manualBoards,
      ],
    }),
  );

  /* data */
  const counts = w.storage;
  page.append(
    card('Your data', {
      sub: 'Local-first storage with an export you can keep as a backup.',
      body: [
        div('grid metrics', [
          metric('briefcase', 'Jobs', counts.jobs),
          metric('list', 'Applications', counts.applications),
          metric('people', 'Contacts', counts.contacts),
          metric('activity', 'Events', counts.events),
        ]),
        div('inline', [
          button('Copy diagnostics (no personal data)', 'btn', async () => {
            const report = buildDiagnosticsSummary(ctx);
            await navigator.clipboard?.writeText(report);
            ctx.inform('Diagnostics copied (no personal data included).');
          }),
          button(
            'Export a backup',
            'btn',
            async () => {
              try {
                const json = await exportData();
                const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `referral-scout-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
                ctx.inform('Backup downloaded.');
              } catch (error) {
                ctx.fail(error instanceof Error ? error.message : 'The backup could not be written.');
              }
            },
            { 'data-busy-label': 'Exporting…', 'data-progress': 'Preparing your JSON backup file…' },
          ),
          button(
            ctx.busyAction === 'workspace:clear' ? 'Deleting…' : 'Delete everything',
            'btn btn-danger-solid',
            async () => {
              if (
                await confirmModal({
                  title: 'Delete everything from this device?',
                  description:
                    'This permanently removes your profile, CV, campaigns, jobs, contacts, Answer Bank, API key and activity history from local storage. Actions already taken on LinkedIn or Gmail are unaffected.',
                  confirmLabel: 'Delete everything',
                  tone: 'danger',
                })
              ) {
                await ctx.run({ kind: 'workspace', action: 'clear', confirm: true });
              }
            },
            { disabled: ctx.busyAction === 'workspace:clear', 'aria-busy': ctx.busyAction === 'workspace:clear' },
          ),
        ]),
        div('note note-violet', [
          text('p', '', 'The backup records which version of Referral Scout wrote it. Your OpenAI API key is deliberately left out.'),
        ]),
        div('note note-amber', [
          text(
            'p',
            '',
            'Messages already sent, and anything held by LinkedIn or Google, remain with those services and cannot be withdrawn by this extension.',
          ),
        ]),
      ],
    }),
  );

  page.append(
    card('What this product will not do', {
      sub: 'The user remains responsible for review and approval at consequential steps.',
      body: [
        ...[
          ['Never answers a security check', 'A CAPTCHA or verification step pauses that application and waits for you.'],
          ['Never types a password or a one-time code', 'Sign-in is always yours.'],
          ['Never retries an uncertain submission', 'If Submit was pressed and nothing confirmed it, you decide what happened.'],
          ['Never invents a fact about you', 'Declarations and anything it cannot source become a question instead.'],
          ['Never emails a guessed address', 'A pattern guess is drafted and held until you confirm it.'],
        ].map(([name, note]) =>
          div('rule-row', [div('', [text('div', 'rule-name', name!), text('div', 'rule-note', note!)]), pill('Control', 'green')]),
        ),
      ],
    }),
  );

  return page;
}

export const settingsHeader = (): { title: string; sub: string } => ({
  title: 'Settings',
  sub: 'Accounts, privacy, launch behaviour, sources and your data.',
});
