/** First-run workspace: a guided setup, not a wall of settings. */
import { ago, button, card, div, el, field, icon, input, pill, setFieldError, text, withActionFeedback } from '../dom';
import { send, sendGmail, sendNetwork, sendWorkspace } from '../api';
import { defaultSettings } from '../../../shared/network';
import { uploadCvForWorkbench } from '../cv-upload';
import { guidedReviewWorkspace } from '../components/guided-review';
import type { Ctx } from '../shell';

const cvAccept = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function step(number: string, title: string, detail: string, complete: boolean): HTMLElement {
  return div(`setup-step${complete ? ' is-complete' : ''}`, [
    div('setup-step-number', [complete ? icon('check', 15) : number]),
    div('setup-step-copy', [text('div', 'setup-step-title', title), text('p', 'setup-step-detail', detail)]),
    pill(complete ? 'Done' : 'Not started', complete ? 'green' : 'grey'),
  ]);
}

export function welcome(ctx: Ctx): HTMLElement {
  const w = ctx.workspace;
  if (!w)
    return div('stack', [
      card('Your workspace is not ready', {
        body: [
          text('p', 'cell-muted', 'The background service did not respond yet. Try refreshing.'),
          button('Retry', 'btn btn-primary', () => ctx.refresh()),
        ],
      }),
    ]);

  const linkedInReady = w.connections.linkedin;
  const cvReady = w.cv.hasText;
  const target = input(ctx.view.campaign?.targetRoles.join(', ') ?? w.profile.preferences.targetRoleFamilies.join(', '), {
    placeholder: 'Product Management Intern',
  });
  const locations = input(ctx.view.campaign?.location ?? w.profile.preferences.locations[0] ?? '', {
    placeholder: 'India, Bengaluru, or Remote',
  });
  target.addEventListener('input', () => setFieldError(target));
  locations.addEventListener('input', () => setFieldError(locations));
  const savedEmployment =
    ctx.view.campaign?.employmentType ??
    (w.profile.preferences.employmentTypes.length === 1 ? w.profile.preferences.employmentTypes[0] : 'any');
  const employment = el('select', { class: 'input', 'aria-label': 'Employment type' });
  for (const [value, label] of [
    ['internship', 'Internship'],
    ['full-time', 'Full-time'],
    ['part-time', 'Part-time'],
    ['contract', 'Contract'],
    ['any', 'Any type'],
  ])
    employment.append(el('option', { value, selected: value === savedEmployment }, [label]));

  const steps = div('setup-steps', [
    step('1', 'Connect LinkedIn and read your profile', 'Use your existing LinkedIn session. You can do this now or later.', linkedInReady),
    step('2', 'Add your CV', 'After LinkedIn is read, add a CV or continue with the profile details you enter yourself.', cvReady),
    step('3', 'Set your search goal', 'Choose the roles, location and work type you want.', !!ctx.view.campaign),
  ]);

  const profileCard = card('1. Your LinkedIn profile', {
    sub: linkedInReady
      ? `${w.profile.identity.fullName || 'Your profile'} was captured ${w.linkedinProfileCapturedAt ? ago(w.linkedinProfileCapturedAt) : 'previously'}. Refresh it whenever your LinkedIn details change.`
      : 'Sign in to LinkedIn in this browser, then let Referral Scout read your own profile.',
    body: [
      div('inline', [
        pill(linkedInReady ? 'Profile read' : 'Not connected yet', linkedInReady ? 'green' : 'amber'),
        linkedInReady ? text('span', 'cell-muted', 'Read from your signed-in LinkedIn session') : null,
      ]),
      div(
        'inline',
        linkedInReady
          ? [
              button(
                ctx.busyAction === 'network:import' ? 'Reading profile…' : 'Refresh LinkedIn profile',
                'btn btn-primary',
                () => ctx.runNetwork({ kind: 'network', action: 'import' }),
                {
                  disabled: ctx.busyAction === 'network:import',
                  'aria-busy': ctx.busyAction === 'network:import',
                  'data-busy-label': 'Reading profile…',
                  'data-progress': 'Reading your LinkedIn profile…',
                },
              ),
              button('Open LinkedIn', 'btn', () => ctx.openExternal('https://www.linkedin.com/')),
            ]
          : [
              button('Open LinkedIn to sign in', 'btn btn-primary', () => ctx.openExternal('https://www.linkedin.com/login')),
              button(
                ctx.busyAction === 'network:import' ? 'Reading profile…' : "I've signed in — read profile",
                'btn btn-primary',
                () => ctx.runNetwork({ kind: 'network', action: 'import' }),
                {
                  disabled: ctx.busyAction === 'network:import',
                  'aria-busy': ctx.busyAction === 'network:import',
                  'data-busy-label': 'Reading profile…',
                  'data-progress': 'Reading your LinkedIn profile…',
                },
              ),
            ],
      ),
      text(
        'p',
        'field-help',
        linkedInReady
          ? 'Your profile is read from the LinkedIn session in this browser. Refresh it after you update LinkedIn.'
          : "First sign in on LinkedIn, then return here and choose “I've signed in — read profile”. Referral Scout never asks for or stores your password.",
      ),
      ctx.busyAction === 'network:import'
        ? text(
            'p',
            'field-help',
            'This can take a little while. Referral Scout is reading your own profile in a separate work tab; you can keep this dashboard open.',
          )
        : null,
    ],
  });
  profileCard.dataset.hudTarget = 'linkedin';

  const cvFile = el('input', { type: 'file', accept: cvAccept, class: 'setup-file', 'aria-label': 'Choose CV file' });
  cvFile.id = 'welcome-cv-file';
  cvFile.addEventListener('change', () => {
    const file = cvFile.files?.[0];
    if (!file) return;
    cvFile.disabled = true;
    void withActionFeedback(`Reading ${file.name} and saving it on this device…`, async () => {
      const message = await uploadCvForWorkbench(file);
      await ctx.refresh();
      ctx.inform(message);
    })
      .catch(error => ctx.fail(error instanceof Error ? error.message : 'The CV could not be read.'))
      .finally(() => {
        cvFile.disabled = false;
        cvFile.value = '';
      });
  });
  const cvCard = card('2. Your CV & AI Review', {
    sub: 'The file is stored in this browser and organized step-by-step before anything enters your profile.',
    body: [
      div('inline', [
        pill(cvReady ? 'CV saved' : 'Optional for now', cvReady ? 'green' : 'grey'),
        w.cvName ? text('span', 'cell-muted', w.cvName) : null,
      ]),
      linkedInReady
        ? div('inline', [
            el('label', { class: cvReady ? 'btn' : 'btn btn-primary', for: 'welcome-cv-file' }, [cvReady ? 'Replace CV' : 'Upload CV']),
            cvFile,
          ])
        : text(
            'p',
            'field-help',
            'Read your LinkedIn profile first to associate the CV with the right candidate. You can skip the CV and add it later.',
          ),
      linkedInReady
        ? guidedReviewWorkspace(ctx, {
            variant: 'welcome',
            cvInputId: 'welcome-cv-file',
            ...(ctx.cvLiveMessage ? { cvLiveMessage: ctx.cvLiveMessage } : {}),
            ...(ctx.aiError ? { aiError: ctx.aiError } : {}),
            ...(ctx.busyMessage ? { busyMessage: ctx.busyMessage } : {}),
            onApprovedNext: () => {
              target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
              target.focus();
            },
          })
        : null,
      text('p', 'field-help', 'Whenever your CV and LinkedIn differ, your CV wins by default. Nothing is saved until you confirm.'),
    ],
  });
  cvCard.dataset.hudTarget = 'cv-upload';
  cvFile.id = 'welcome-cv-file';

  const campaignCard = card('3. What are you looking for?', {
    sub: 'One clear target is enough to start. Add more role variations later from Campaign settings.',
    body: [
      div('form-grid', [field('Target role', target), field('Location', locations), field('Employment type', employment)]),
      div('inline', [
        button(ctx.view.campaign ? 'Update campaign' : 'Create my campaign', 'btn btn-primary btn-lg', async () => {
          const roles = target.value
            .split(/[\n;,]+/)
            .map(value => value.trim())
            .filter(Boolean);
          setFieldError(target);
          setFieldError(locations);
          if (!roles.length) {
            setFieldError(target, 'Enter at least one role, such as “Product Management Intern”.');
            target.focus();
            return ctx.fail('Enter at least one role, such as “Product Management Intern”.');
          }
          if (!locations.value.trim()) {
            setFieldError(locations, 'Add a location, or enter “Remote”.');
            locations.focus();
            return ctx.fail('Add a location, or enter “Remote” when that is what you want.');
          }
          const preferredEmployment =
            employment.value === 'any' ? ['internship', 'full-time', 'part-time', 'contract'] : [employment.value];
          const legacyEmployment = employment.value === 'internship' || employment.value === 'full-time' ? employment.value : 'any';
          try {
            await send({
              kind: 'campaign',
              action: ctx.view.campaign ? 'update' : 'create',
              name: ctx.view.campaign?.name ?? `${roles[0]} search`,
              targetRoles: roles,
              location: locations.value.trim(),
              employmentType: employment.value,
            });
            const warnings: string[] = [];
            try {
              await sendWorkspace({
                kind: 'workspace',
                action: 'preferences',
                targetRoleFamilies: roles,
                locations: [locations.value.trim()],
                employmentTypes: preferredEmployment,
              });
            } catch {
              warnings.push(
                'Candidate profile search preferences could not be synchronised. Review Candidate profile before using matching.',
              );
            }
            // Keep the established side-panel referral workflow aligned with the campaign created in the dashboard.
            // Preserve the user's existing outreach template and limits; only the role/location preferences are changed.
            try {
              const previous = await sendNetwork({ kind: 'network', action: 'status' });
              await sendNetwork({
                kind: 'network',
                action: 'save',
                target: roles[0]!,
                location: locations.value.trim(),
                template: previous.template,
                settings: { ...(previous.settings ?? defaultSettings), roles, employmentType: legacyEmployment },
              });
            } catch {
              warnings.push('Referral preferences could not be synchronised. Check Campaign settings before starting outreach.');
            }
            await ctx.refresh();
            ctx.go('overview');
            ctx.inform(
              warnings.length
                ? `Your campaign was created, with follow-up needed: ${warnings.join(' ')}`
                : 'Your campaign and profile preferences are saved.',
            );
          } catch (error) {
            ctx.fail(error instanceof Error ? error.message : 'Your campaign could not be saved. Please try again.');
          }
        }),
        text('span', 'field-help', 'You can edit or pause the campaign at any time.'),
      ]),
    ],
  });
  campaignCard.dataset.hudTarget = 'campaign-goal';

  const chatCard = card('Optional connections', {
    sub: 'Only connect the services you plan to use. You can skip both and come back later.',
    body: [
      div('rule-row', [
        div('', [
          text('div', 'rule-name', 'ChatGPT'),
          text('div', 'rule-note', 'Used for AI-assisted writing and application answers. Sign in with your own account in this browser.'),
        ]),
        div('inline', [button('Open ChatGPT', 'btn btn-sm', () => ctx.openExternal('https://chatgpt.com/'))]),
      ]),
      div('rule-row', [
        div('', [
          text('div', 'rule-name', 'Gmail'),
          text('div', 'rule-note', 'Optional. Connect to create drafts and track relevant replies.'),
        ]),
        div(
          'inline',
          [
            pill(w.connections.gmail ? 'Connected' : 'Optional', w.connections.gmail ? 'green' : 'grey'),
            w.connections.gmail
              ? null
              : button('Connect Gmail', 'btn btn-sm', async () => {
                  try {
                    await sendGmail({ kind: 'gmail', action: 'connect' });
                    await ctx.refresh();
                  } catch (error) {
                    ctx.fail(error instanceof Error ? error.message : 'Gmail could not be connected.');
                  }
                }),
          ].filter(Boolean) as HTMLElement[],
        ),
      ]),
      div('note note-violet', [
        text(
          'p',
          '',
          'If ChatGPT is not connected, Referral Scout can still use your saved templates and fill standard fields from your verified profile. Gmail is never required to search jobs.',
        ),
      ]),
    ],
  });

  const usageChoice = input('', { type: 'checkbox', ...(w.usageReporting ? { checked: true } : {}) });
  const privacyCard = card('Your data, your choice', {
    sub: 'Profile, CV, jobs, contacts, messages and application records are stored locally in this browser.',
    body: [
      div('note', [
        text(
          'p',
          '',
          'When you use AI features, the relevant profile/CV context is sent to your own signed-in ChatGPT account, or to OpenAI if you configure an API key. Usage counting is a separate, optional setting below.',
        ),
      ]),
      div('setup-privacy-choice', [
        usageChoice,
        text(
          'span',
          '',
          'Allow one-time usage counting: sends a random install ID, your display name and LinkedIn profile handle to the developer. No CV, jobs, contacts or messages are included.',
        ),
      ]),
      button('Save privacy choice', 'btn', async () => {
        await ctx.runNetwork({ kind: 'network', action: usageChoice.checked ? 'consent' : 'revokeConsent' });
      }),
    ],
  });

  const next = card('What happens after setup?', {
    sub: 'You stay in control of the decisions that matter.',
    body: [
      div('next-flow', [
        div('', [
          icon('search', 18),
          text('div', 'rule-name', 'Find relevant jobs'),
          text('p', 'rule-note', 'Search and rank roles against your profile.'),
        ]),
        div('', [
          icon('check', 18),
          text('div', 'rule-name', 'Choose opportunities'),
          text('p', 'rule-note', 'Shortlist the companies and applications worth pursuing.'),
        ]),
        div('', [
          icon('users', 18),
          text('div', 'rule-name', 'Prepare referrals'),
          text('p', 'rule-note', 'Review messages before any outreach is sent.'),
        ]),
      ]),
      text('p', 'field-help', 'No application is submitted and no message is sent without the approval required by your settings.'),
    ],
  });

  return div('stack onboarding-page', [
    div('onboarding-hero', [
      div('onboarding-kicker', ['YOUR JOB SEARCH WORKSPACE']),
      text('h2', 'onboarding-title', 'A more organised way to find your next role.'),
      text(
        'p',
        'onboarding-intro',
        'Follow three quick steps once. Referral Scout finds relevant jobs, prepares applications and lines up referrers for you.',
      ),
      steps,
    ]),
    div('grid split-wide onboarding-columns', [
      div('stack', [profileCard, cvCard, campaignCard]),
      div('stack', [
        next,
        (() => {
          const more = el('details', { class: 'advanced-settings card' });
          more.append(el('summary', {}, ['Optional: ChatGPT, Gmail & data preferences']), div('stack', [chatCard, privacyCard]));
          return more;
        })(),
      ]),
    ]),
  ]);
}

export const welcomeHeader = (): { title: string; sub: string } => ({
  title: 'Set up Referral Scout',
  sub: 'A short guided setup. You can skip optional connections and finish the rest whenever you are ready.',
});
