/** Setup and Settings screens: welcome, the target question, messages, limits, the API key and the CV. */
import { errorText } from './render';
import { defaultSettings, introduction, renderNote, type NetworkState, type OutreachSettings } from '../shared/network';
import { completeCvText } from './cv-text';
import {
  node,
  csv,
  optional,
  pad,
  request,
  notify,
  withProgress,
  button,
  act,
  field,
  choice,
  accordion,
  bubble,
  flags,
  rerender,
} from './core';

/* ---------- screens ---------- */
export function welcome(): HTMLElement {
  const hero = node('section', '', 'hero');
  const steps = node('ol', '', 'steps');
  for (const [i, title, text] of [
    ['1', 'Read your profile', 'Once, from your own LinkedIn page. It stays on this device.'],
    ['2', 'Pick the companies', 'We search LinkedIn jobs for your role and similar titles. You choose which companies to go after.'],
    ['3', 'Get referrals', 'At each company we find the people whose referral counts and reach out slowly, a few a day.'],
  ] as const) {
    const li = node('li', '', 'step'),
      body = node('div');
    body.append(node('strong', title), node('span', text));
    li.append(node('b', i, 'n'), body);
    steps.append(li);
  }
  hero.append(
    node('div', 'RS', 'mark'),
    node('p', 'Referral Scout', 'eyebrow'),
    node('h1', 'Find jobs. Get referred.'),
    node('p', 'The right people at the right companies, asked politely, at a pace LinkedIn is comfortable with.', 'lede'),
    steps,
    button(
      'Read my LinkedIn profile',
      async () => {
        await act({ kind: 'network', action: 'import' }, 'Profile saved. One more question: what are you looking for?');
      },
      'btn primary block',
    ),
    node(
      'p',
      'Sign in to LinkedIn first. LinkedIn restricts automated activity: defaults are deliberately slow and conservative, but you use this at your own risk.',
      'fine',
    ),
  );
  return hero;
}

/* Second step of setup: the person says what they want. Nothing is assumed for them. */
export function askTarget(s: NetworkState): HTMLElement {
  const hero = node('section', '', 'hero ask'),
    form = node('div', '', 'card');
  const roles = field({
    label: 'Role you want',
    value: '',
    multiline: true,
    rows: 2,
    help: 'One per line if you have more than one. Similar job titles are added for you.',
  });
  const place = field({ label: 'Where', value: '', help: 'A country or a city. Leave empty to search everywhere.' });
  roles.input.placeholder = 'For example: Product Management internship';
  place.input.placeholder = 'For example: India, or Bengaluru';
  for (const f of [roles, place])
    f.input.addEventListener('input', () => {
      flags.dirty = true;
    });
  form.append(roles.wrap, place.wrap);
  hero.append(
    node('div', 'RS', 'mark'),
    node('p', 'Step 2 of 2', 'eyebrow'),
    node('h1', `Hi ${s.profile!.name.split(/\s+/)[0] ?? ''}, what are you looking for?`),
    node('p', 'This is what LinkedIn jobs are searched for. You can change it any time from Home.', 'lede'),
    form,
    button(
      'Continue',
      async () => {
        const list = roles.input.value
          .split(/[\n;,]+/)
          .map(x => x.trim())
          .filter(Boolean);
        if (!list.length) {
          roles.input.focus();
          throw new Error('Type the role you are looking for, for example "Product Management internship".');
        }
        flags.dirty = false;
        await act(
          {
            kind: 'network',
            action: 'save',
            target: list[0]!,
            location: place.input.value.trim(),
            template: s.template,
            settings: { ...(s.settings ?? defaultSettings), roles: list },
          },
          'Saved. Press Find jobs and referrals when you are ready.',
        );
      },
      'btn primary block',
    ),
  );
  return hero;
}

/* ---------- setup tab ---------- */
export function buildSetup(
  s: NetworkState,
  settings: OutreachSettings,
): { panel: HTMLElement; save: () => Promise<void>; aiMode: HTMLSelectElement } {
  const panel = node('div');
  const roles = field({
    label: 'Roles you are looking for',
    value: settings.roles.join('\n'),
    multiline: true,
    rows: 2,
    help: 'One per line, for example "Product Management internship".',
  });
  const location = field({ label: 'Where', value: s.location, help: 'A country or city. Leave generic for the widest search.' });
  const noteTemplate = field({
    label: 'Invitation note',
    value: settings.noteTemplate,
    multiline: true,
    rows: 3,
    help: 'Placeholders: {firstName} {myFirstName} {target} {company} {ask}. {ask} is the closing line and changes with the person: openings for a recruiter, their team for a leader, what they are building for a founder. LinkedIn allows 200 characters. Write several versions separated by a line with --- and each person gets one.',
  });
  const template = field({
    label: 'Message after they accept',
    value: s.template,
    multiline: true,
    rows: 4,
    help: 'Sent once, only after LinkedIn confirms the connection. Same placeholders.',
  });
  const noteSlot = node('div'),
    followSlot = node('div');
  const me = s.profile!.name,
    sample = { name: 'Priya Sharma', companyName: 'Acme', category: 'recruiter' };
  const refresh = (): void => {
    const role = roles.input.value.split(/[\n;,]+/)[0]?.trim() || s.target;
    const note = renderNote({ noteTemplate: noteTemplate.input.value || settings.noteTemplate }, role, sample, me);
    noteSlot.replaceChildren(bubble('Preview for Priya, a recruiter at Acme', note, note.length > 200, `${note.length}/200`));
    followSlot.replaceChildren(
      bubble('Preview for Priya at Acme', introduction({ template: template.input.value || s.template, target: role }, sample, me)),
    );
  };
  for (const f of [roles, noteTemplate, template]) f.input.addEventListener('input', refresh);
  refresh();

  const who = node('section', '', 'card');
  who.append(
    node('h2', 'What you are looking for', 'card-title'),
    node('p', 'This drives the job search. Similar job titles are added for you.', 'card-sub'),
  );
  who.append(roles.wrap, location.wrap);
  const wordsAcc = accordion('words', 'Your messages', 'invitation and follow-up'),
    words = wordsAcc.body;
  words.append(
    node('p', 'What we send on your behalf. Review it once, then it is reused.', 'card-sub'),
    noteTemplate.wrap,
    noteSlot,
    template.wrap,
    followSlot,
  );

  /* pace and safety */
  const outreachMode = choice('Before sending an invitation', settings.outreachMode, [
    ['review', 'Ask me to approve each one'],
    ['automatic', 'Send automatically'],
  ]);
  const followupMode = choice('Before sending the follow-up', settings.followupMode, [
    ['review', 'Ask me to approve each one'],
    ['automatic', 'Send automatically after acceptance'],
  ]);
  const noteMode = choice('Connection note', settings.noteMode, [
    ['preferred', 'Add a note when LinkedIn allows'],
    ['require', 'Always add a note (skip if not possible)'],
    ['none', 'Never add a note'],
  ]);
  const hours = choice(
    'When to act',
    settings.activeHours ? 'on' : 'off',
    [
      ['off', 'Any time of day (default)'],
      ['on', `Only ${pad(settings.activeHours?.from ?? 8)}:00 to ${pad(settings.activeHours?.to ?? 22)}:00`],
    ],
    'With set hours, Home shows a “Run now anyway” button whenever work is waiting for them.',
  );
  const num = (label: string, value: number | null) => field({ label, value: value?.toString() ?? '', type: 'number', min: '1' });
  const pace = field({
    label: 'Seconds between sends',
    value: String(Math.round(settings.paceMinutes * 60)),
    type: 'number',
    min: '5',
    max: '86400',
  });
  const invites = num('Invitations per day', settings.dailyInvites),
    weekly = num('Invitations per week', settings.weeklyInvites),
    messages = num('Follow-ups per day', settings.dailyMessages),
    pendingCap = num('Max pending invitations', settings.maxPending);
  const allow = field({
    label: 'Prefer these companies',
    value: settings.companyAllowlist.join(', '),
    help: 'Comma separated. Leave empty for everyone.',
  });
  const exclude = field({ label: 'Never contact these companies', value: settings.companyExclusions.join(', '), help: 'Comma separated.' });
  const aiMode = choice(
    'How messages are written',
    settings.aiMode,
    [
      ['template', 'From my template (default)'],
      ['chatgpt', 'Let ChatGPT lightly adapt my template for each person'],
    ],
    'With ChatGPT, your template stays the model: it may only change a small detail to fit the person. No CV or API key is needed; stay signed in at chatgpt.com. If ChatGPT is signed out or fails, your template is used and you are told.',
  );
  const advanced = accordion('advanced', 'Pace, limits and safety', 'recommended defaults');
  const grid = node('div', '', 'grid2');
  grid.append(invites.wrap, weekly.wrap, messages.wrap, pendingCap.wrap, pace.wrap);
  const behaviour = node('div');
  behaviour.append(outreachMode.wrap, followupMode.wrap, noteMode.wrap, hours.wrap);
  advanced.body.append(
    behaviour,
    grid,
    node('p', 'Empty means no limit. LinkedIn restricts accounts that send too many invitations, so keep these low.', 'field-help'),
    node('div', '', 'gap'),
    allow.wrap,
    exclude.wrap,
    aiMode.wrap,
  );

  const chatGpt = buildChatGpt(s),
    api = buildApi(s);
  async function save(): Promise<void> {
    const nextRoles = roles.input.value
      .split(/[\n;,]+/)
      .map(x => x.trim())
      .filter(Boolean);
    if (!nextRoles.length) throw new Error('Enter at least one role you are looking for.');
    const next: OutreachSettings = {
      ...settings,
      roles: nextRoles,
      aiMode: aiMode.input.value as OutreachSettings['aiMode'],
      noteTemplate: noteTemplate.input.value.trim() || settings.noteTemplate,
      weeklyInvites: optional(weekly.input.value),
      activeHours: hours.input.value === 'on' ? (settings.activeHours ?? { from: 8, to: 22 }) : null,
      outreachMode: outreachMode.input.value as OutreachSettings['outreachMode'],
      noteMode: noteMode.input.value as OutreachSettings['noteMode'],
      followupMode: followupMode.input.value as OutreachSettings['followupMode'],
      paceMinutes: Math.min(86400, Math.max(5, Number(pace.input.value) || 30)) / 60,
      dailyInvites: optional(invites.input.value),
      dailyMessages: optional(messages.input.value),
      maxPending: optional(pendingCap.input.value),
      companyAllowlist: csv(allow.input.value),
      companyExclusions: csv(exclude.input.value),
    };
    await request({
      kind: 'network',
      action: 'save',
      target: nextRoles[0]!,
      location: location.input.value,
      template: template.input.value,
      settings: next,
    });
    flags.dirty = false;
  }
  const general = accordion('general', 'General networking outreach (optional)', s.active && s.scope !== 'referrals' ? 'running' : '');
  general.body.append(
    node(
      'p',
      'Not tied to a job: searches LinkedIn for recruiters, team leaders and founders matching your target roles and invites them, with your approval. Use it to grow your network between job searches.',
      'card-sub',
    ),
    button(
      s.active && s.scope !== 'referrals' ? 'Stop general outreach' : 'Start general outreach',
      async () => {
        if (s.active && s.scope !== 'referrals') {
          await act({ kind: 'network', action: 'pause' }, 'General outreach stopped.');
          return;
        }
        await save();
        await act({ kind: 'network', action: 'start' }, 'General outreach started.');
      },
      'btn block',
    ),
  );
  panel.append(who, wordsAcc.box, advanced.box, chatGpt, api, general.box);
  if (!s.active)
    panel.append(
      button(
        'Save changes',
        async () => {
          await save();
          await act({ kind: 'network', action: 'status' }, 'Changes saved.');
        },
        'btn primary block savebar',
      ),
    );
  else panel.append(node('p', 'Pause outreach to change settings.', 'fine'));
  for (const f of [
    roles,
    location,
    noteTemplate,
    template,
    outreachMode,
    followupMode,
    noteMode,
    hours,
    pace,
    invites,
    weekly,
    messages,
    pendingCap,
    allow,
    exclude,
    aiMode,
  ])
    f.input.disabled = s.active;
  return { panel, save, aiMode: aiMode.input };
}

/* Optional: an OpenAI API key instead of the ChatGPT website. The key itself is never sent back to this panel. */
export function buildApi(s: NetworkState): HTMLElement {
  const { box, body } = accordion('api', 'ChatGPT connection', s.api ? 'API key' : 'website (default)');
  body.append(
    node(
      'p',
      'By default the ChatGPT website is used in a background tab and there is nothing to set up. If you have an OpenAI API key, answers come straight from the API instead: faster, and no ChatGPT tab is opened. OpenAI bills API use to your account. The key stays on this device and is left out of exports.',
      'card-sub',
    ),
  );
  if (s.api) {
    body.append(
      node('p', `Using the API: model ${s.api.model}, key ending in ${s.api.ending}.`, 'field-label'),
      button(
        'Test the key',
        () => withProgress('Asking the OpenAI API for a one-word answer', () => act({ kind: 'network', action: 'testApi' })),
        'btn sm primary',
      ),
      button(
        'Remove the key',
        async () => {
          if (confirm('Remove the API key from this device and go back to the ChatGPT website?'))
            await act({ kind: 'network', action: 'clearApi' });
        },
        'btn sm ghost danger',
      ),
    );
    return box;
  }
  const key = field({ label: 'OpenAI API key', value: '', type: 'password', help: 'Created in your OpenAI account under API keys.' });
  const model = field({
    label: 'Model',
    value: '',
    help: 'The model name exactly as OpenAI lists it for your account. Model names change, so none is filled in for you.',
  });
  for (const f of [key, model])
    f.input.addEventListener('input', () => {
      flags.dirty = true;
    });
  (key.input as HTMLInputElement).autocomplete = 'off';
  body.append(
    key.wrap,
    model.wrap,
    button(
      'Save the key',
      async () => {
        if (key.input.value.trim().length < 20) throw new Error('Paste the whole API key.');
        if (model.input.value.trim().length < 2) throw new Error('Type the model name.');
        // Access to api.openai.com is asked for only now, when a key is actually saved.
        const permissions = (globalThis as { chrome?: typeof chrome }).chrome?.permissions;
        if (permissions?.request && !(await permissions.request({ origins: ['https://api.openai.com/*'] })))
          throw new Error('Access to api.openai.com was not allowed, so the key was not saved.');
        flags.dirty = false;
        await act({ kind: 'network', action: 'saveApi', key: key.input.value.trim(), model: model.input.value.trim() });
      },
      'btn sm primary',
    ),
  );
  return box;
}

/* optional ChatGPT personalisation: CV, dossier and recovery */
export function buildChatGpt(s: NetworkState): HTMLElement {
  const { box, body } = accordion('chatgpt', 'Your CV (optional)', s.cv ? 'added' : '');
  body.append(
    node(
      'p',
      'Outreach works without a CV. Add one only if you use “Rewrite with ChatGPT”: ChatGPT then knows your background and can mention one relevant thing in the message after someone accepts. There is nothing else to set up.',
      'card-sub',
    ),
  );
  const cv = node('input', '', 'input');
  cv.type = 'file';
  cv.disabled = s.active;
  cv.accept = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
  const cvField = node('div', '', 'field');
  cvField.append(
    node(
      'span',
      s.cv ? `CV: ${s.cv.name} · ${(s.cv.characterCount ?? 0).toLocaleString()} characters` : 'Your CV (PDF, DOCX or TXT)',
      'field-label',
    ),
    cv,
    node('p', 'Read inside the extension. Only text is used, no file is attached or uploaded.', 'field-help'),
  );
  cv.addEventListener('change', () => {
    if (flags.busy) return;
    const file = cv.files?.[0];
    if (!file) return;
    if (file.size > 30_000_000) {
      notify('error', 'The CV is larger than 30 MB. Convert it to a text-searchable PDF or DOCX first.');
      cv.value = '';
      return;
    }
    flags.busy = true;
    cv.disabled = true;
    flags.spoke = false;
    notify('info', 'Reading your CV on this device. No file is kept…');
    void file
      .arrayBuffer()
      .then(async buffer => {
        const extracted = await completeCvText(buffer, file.name),
          pages = (extracted.match(/^\[Page \d+\]/gm) || []).length;
        const saved = await request({
          kind: 'network',
          action: 'saveCv',
          name: file.name,
          type: file.type || 'text/plain',
          text: extracted,
          ...(pages ? { pages } : {}),
        });
        rerender(saved);
        notify(
          'success',
          `CV saved: ${extracted.length.toLocaleString()} characters. It is used the next time ChatGPT rewrites a message.`,
        );
      })
      .catch(e => notify('error', `The CV could not be read: ${errorText(e)}`))
      .finally(() => {
        flags.busy = false;
        cv.disabled = false;
      });
  });
  body.append(cvField);
  if (s.cv) {
    const preview = node('pre', '', 'source-preview');
    body.append(
      button(
        'View CV text',
        async () => {
          preview.textContent = (await request({ kind: 'network', action: 'ownerData' })).cv?.text || 'No CV text available.';
        },
        'btn sm',
      ),
      button(
        'Delete CV',
        async () => {
          if (confirm('Delete your CV text from this device?')) await act({ kind: 'network', action: 'deleteCv' }, 'CV deleted.');
        },
        'btn sm ghost danger',
      ),
      preview,
    );
  }
  return box;
}
