/** Side-panel launcher and legacy outreach controls; profile, CV and provider connections are managed in the dashboard. */
import { introduction, renderNote, type NetworkState, type OutreachSettings, SAFE, riskNotes, defaultSettings } from '../shared/network';
import { buildApplySettings } from './apply';
import { qualificationPicker } from './qualifications';
import { node, csv, optional, pad, request, button, act, field, choice, accordion, bubble, flags, ui, openDashboard } from './core';

/* ---------- screens ---------- */
export function welcome(s?: NetworkState): HTMLElement {
  const hero = node('section', '', 'hero onboard-launch');
  const hasProfile = !!s?.profile;
  const hasTarget = !!s?.targetSet;
  const steps = node('ol', '', 'steps');
  for (const [i, title, detail, done] of [
    ['1', 'Read your LinkedIn profile', 'Use your existing LinkedIn sign-in. Referral Scout never asks for your password.', hasProfile],
    ['2', 'Add your CV and review it', 'Optional, but helpful for matching and application forms.', false],
    ['3', 'Choose your target role', 'Set the role, location and work type in the dashboard.', hasTarget],
  ] as const) {
    const li = node('li', '', `step${done ? ' is-done' : ''}`);
    const body = node('div');
    body.append(node('strong', title), node('span', detail));
    li.append(node('b', done ? '✓' : i, 'n'), body);
    steps.append(li);
  }
  hero.append(
    node('div', 'RS', 'mark'),
    node('p', 'Referral Scout', 'eyebrow'),
    node(
      'h1',
      hasProfile && hasTarget
        ? 'Your workspace is ready.'
        : hasProfile || hasTarget
          ? 'Finish setting up your workspace.'
          : 'Start with your profile.',
    ),
    node(
      'p',
      hasProfile && hasTarget
        ? 'Your profile and search goal are in place. Open the dashboard to review matches and manage your applications.'
        : hasProfile
          ? 'Your LinkedIn profile has been read. Open the dashboard to add your CV if useful, choose your target and manage everything in one place.'
          : hasTarget
            ? 'Your search goal is saved. Read your LinkedIn profile in the dashboard to personalise matching and prepare applications.'
            : 'The side panel is your quick-launch space. The full dashboard guides you through LinkedIn, your CV, preferences and the job search.',
      'lede',
    ),
    steps,
    button('Open setup dashboard', async () => openDashboard('welcome'), 'btn primary block'),
    button(
      'Open LinkedIn sign-in',
      async () => {
        await chrome.tabs.create({ url: 'https://www.linkedin.com/login', active: true });
      },
      'btn block',
    ),
    node(
      'p',
      'Profile and CV data stay in this browser. Optional usage counting is off unless you choose to enable it in the dashboard.',
      'fine',
    ),
  );
  return hero;
}

/* Legacy entry point retained for callers from older builds; setup now lives in the full dashboard. */
export function askTarget(s: NetworkState): HTMLElement {
  return welcome(s);
}

/* ---------- setup tab ---------- */
export function buildSetup(
  s: NetworkState,
  settings: OutreachSettings,
): { panel: HTMLElement; save: () => Promise<void>; aiMode: HTMLSelectElement } {
  const panel = node('div');
  const quals = qualificationPicker(s, false);
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
    const role = settings.roles[0] || s.target;
    const note = renderNote({ noteTemplate: noteTemplate.input.value || settings.noteTemplate }, role, sample, me);
    noteSlot.replaceChildren(bubble('Preview for Priya, a recruiter at Acme', note, note.length > 200, `${note.length}/200`));
    followSlot.replaceChildren(
      bubble('Preview for Priya at Acme', introduction({ template: template.input.value || s.template, target: role }, sample, me)),
    );
  };
  for (const f of [noteTemplate, template]) f.input.addEventListener('input', refresh);
  refresh();

  const who = node('section', '', 'card');
  who.append(
    node('h2', 'Campaign targeting', 'card-title'),
    node(
      'p',
      'Target roles and location are managed in the dashboard Campaign screen so job search and referrals stay aligned.',
      'card-sub',
    ),
    node('div', `${settings.roles.join(', ') || s.target || 'No target role saved'} · ${s.location || 'No location saved'}`, 'cell-strong'),
    button('Edit campaign in dashboard', () => openDashboard('setup'), 'btn sm primary'),
    quals.wrap,
  );
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
  // The standing caution, and a live warning the moment a value leaves the safe range.
  const caution = node(
      'p',
      `Keep these low. LinkedIn does not allow automated activity, and it restricts or flags accounts that send many invitations in a short time. Up to ${SAFE.daily} invitations a day and ${SAFE.weekly} a week rarely draws attention. Above that the chance of a warning or a restricted account rises quickly, and that risk is yours. An empty box means no limit, which is not recommended.`,
      'field-help',
    ),
    risk = node('p', '', 'callout bad');
  const weigh = (): void => {
    const notes = riskNotes(optional(invites.input.value), optional(weekly.input.value), Number(pace.input.value) || 0);
    risk.hidden = !notes.length;
    risk.textContent = notes.length
      ? `Riskier than recommended: ${notes.join('; ')}. LinkedIn may warn or restrict your account. Lower these unless you accept that.`
      : '';
  };
  for (const f of [invites, weekly, pace]) f.input.addEventListener('input', weigh);
  weigh();
  const behaviour = node('div');
  behaviour.append(outreachMode.wrap, followupMode.wrap, noteMode.wrap, hours.wrap);
  advanced.body.append(behaviour, grid, caution, risk, node('div', '', 'gap'), allow.wrap, exclude.wrap, aiMode.wrap);

  const chatGpt = buildChatGpt(s),
    api = buildApi(s);
  async function save(): Promise<void> {
    const next: OutreachSettings = {
      ...settings,
      roles: [...settings.roles],
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
      specializations: quals.values(),
      specializationsChosen: quals.confirmed(),
    };
    await request({
      kind: 'network',
      action: 'save',
      target: settings.roles[0] || s.target,
      location: s.location,
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
  panel.append(who, wordsAcc.box, advanced.box, chatGpt, buildApplySettings(), api, general.box);
  panel.append(
    button(
      'Save changes',
      async () => {
        await save();
        ui.tab = 'home'; // saved: back to Home, where the result of the change shows
        await act({ kind: 'network', action: 'status' }, 'Changes saved.');
        document.scrollingElement?.scrollTo({ top: 0 });
      },
      'btn primary block savebar',
    ),
  );
  return { panel, save, aiMode: aiMode.input };
}

/* AI account configuration is centralised in the dashboard Settings. */
export function buildApi(s: NetworkState): HTMLElement {
  const mode = s.settings?.chatgptMode ?? 'incognito';
  const { box, body } = accordion(
    'api',
    'AI connection',
    s.api ? `API key · ${s.api.model}` : `ChatGPT website (default) · ${mode === 'incognito' ? 'Incognito' : 'Normal'}`,
  );
  const modeChoice = choice(
    'ChatGPT mode for searches & drafts',
    mode,
    [
      ['incognito', 'Incognito / Temporary chat (default)'],
      ['normal', 'Normal chat history'],
    ],
    'Incognito runs searches and ranking in ChatGPT Temporary chat so your conversation sidebar stays clean.',
  );
  modeChoice.input.addEventListener('change', () => {
    const nextMode = modeChoice.input.value === 'normal' ? 'normal' : 'incognito';
    void chrome.runtime
      ?.sendMessage?.({ kind: 'workspace', action: 'setChatGptMode', mode: nextMode })
      ?.then(() =>
        act(
          {
            kind: 'network',
            action: 'save',
            target: s.target,
            location: s.location,
            template: s.template,
            settings: { ...(s.settings ?? defaultSettings), chatgptMode: nextMode },
          },
          `ChatGPT mode set to ${nextMode === 'incognito' ? 'Incognito (Temporary chat)' : 'Normal chat'}.`,
        ),
      )
      ?.catch(() => undefined);
  });
  body.append(
    modeChoice.wrap,
    node(
      'p',
      'The ChatGPT website is the default and only needs you to sign in at chatgpt.com. An optional OpenAI API key can be managed in dashboard Settings.',
      'card-sub',
    ),
    button('Manage AI connection in dashboard', () => openDashboard('settings'), 'btn sm primary'),
  );
  return box;
}

/* CV management is centralised in Candidate profile in the full dashboard. */
export function buildChatGpt(s: NetworkState): HTMLElement {
  const { box, body } = accordion('chatgpt', 'Your CV', s.cv ? 'saved' : 'not added');
  body.append(
    node(
      'p',
      s.cv
        ? `Your CV (${s.cv.name}) is saved on this device. Open Candidate profile to replace it, review extracted details or delete it.`
        : 'Add and manage your CV in Candidate profile. It is optional for browsing jobs, and useful for matching and application forms.',
      'card-sub',
    ),
    button('Manage CV in dashboard', () => openDashboard('profile'), 'btn sm primary'),
  );
  return box;
}
