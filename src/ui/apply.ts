/**
 * Side panel: the "Fill this application" card on Home (shown when the active tab has one job or its application
 * open) and the "Application details" section in Settings.
 */
import { node, button, notify, flags, accordion, field, choice, rerender, request, ui } from './core';
import { errorText } from './render';
import { completeCvText } from './cv-text';
import type { ApplyRequest, Detect, ApplySession } from '../background/apply';
import { DAILY_SOFT_CAP, questionKey, type ApplyProfile } from '../shared/apply';

export async function applyRequest(data: ApplyRequest): Promise<Detect> {
  // Each tab has its own fill: every request says which tab it is about (the one this card shows).
  const tabId = 'tabId' in data && data.tabId !== undefined ? data.tabId : (last?.tabId ?? undefined);
  const reply = (await chrome.runtime.sendMessage({ ...data, ...(tabId !== undefined && tabId !== null ? { tabId } : {}) })) as {
    ok: boolean;
    data?: Detect;
    error?: string;
  };
  if (!reply?.ok || !reply.data) throw new Error(reply?.error || 'The extension did not respond. Reload it and retry.');
  return reply.data;
}
const toBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const MAX_FILE = 8 * 1024 * 1024;
/** Reads a CV on this device, keeps its text for ChatGPT and the file itself for application upload fields. */
export async function uploadCv(file: File): Promise<void> {
  if (file.size > 30_000_000) throw new Error('The CV is larger than 30 MB. Save a smaller PDF or DOCX first.');
  const buffer = await file.arrayBuffer();
  // Encode first: reading a PDF hands its bytes to a worker and empties this buffer.
  const data = file.size <= MAX_FILE ? toBase64(new Uint8Array(buffer)) : '';
  const extracted = await completeCvText(buffer.slice(0), file.name),
    pages = (extracted.match(/^\[Page \d+\]/gm) || []).length;
  const saved = await request({
    kind: 'network',
    action: 'saveCv',
    name: file.name,
    type: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream'),
    text: extracted,
    ...(pages ? { pages } : {}),
    ...(data ? { file: data } : {}),
  });
  rerender(saved);
  notify(
    data ? 'success' : 'error',
    data
      ? `CV saved: ${extracted.length.toLocaleString()} characters, and the file is kept on this device for application forms.`
      : 'CV text saved, but the file is over 8 MB so it cannot be attached to applications. Save a smaller PDF and upload it again.',
  );
  await refreshCard(true);
}
function cvPicker(label = 'Upload CV'): HTMLElement {
  const wrap = node('label', '', 'btn sm');
  const input = node('input');
  input.type = 'file';
  input.hidden = true;
  input.accept = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  wrap.append(document.createTextNode(label), input);
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f || flags.busy) return;
    flags.busy = true;
    notify('info', 'Reading your CV on this device…');
    void uploadCv(f)
      .catch(e => notify('error', `The CV could not be read: ${errorText(e)}`))
      .finally(() => {
        flags.busy = false;
        input.value = '';
      });
  });
  return wrap;
}

/* ---------- the Home card ---------- */
const card = node('section', '', 'card apply-card');
card.hidden = true;
/** Applications sent from the panel, with where each referral search stands. Kept next to the card on Home. */
const historyBox = node('div');
const homeBox = node('div');
homeBox.append(card, historyBox);
let last: Detect | null = null;
let signature = '';
let timer: ReturnType<typeof setTimeout> | undefined;
const BUSY: ApplySession['stage'][] = ['reading', 'opening', 'thinking', 'filling', 'moving'];
const host = (origin: string): string => {
  try {
    return new URL(origin).host.replace(/^www\./, '');
  } catch {
    return origin;
  }
};
async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}
export async function refreshCard(force = false): Promise<void> {
  clearTimeout(timer);
  try {
    const tabId = await activeTabId();
    const d = await applyRequest({ kind: 'apply', action: 'detect', ...(tabId !== undefined ? { tabId } : {}) });
    last = d;
    const sig = JSON.stringify(d);
    // Never redraw under the person's cursor while they type an answer.
    const typing = card.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
    if ((force || sig !== signature) && !typing) {
      signature = sig;
      draw(d);
    }
    timer = setTimeout(() => void refreshCard(), d.session && BUSY.includes(d.session.stage) ? 1200 : 4000);
  } catch {
    timer = setTimeout(() => void refreshCard(), 5000);
  }
}
chrome.tabs?.onActivated.addListener(() => void refreshCard(true));
chrome.tabs?.onUpdated.addListener((_id, info) => {
  if (info.url || info.status === 'complete') void refreshCard();
});
async function permit(origins: string[]): Promise<boolean> {
  const ok = await chrome.permissions.request({ origins: origins.map(o => `${o}/*`) });
  if (!ok) notify('error', 'Referral Scout needs access to this site to read and fill its form. Nothing was changed.');
  return ok;
}
async function startFill(d: Detect, again = false): Promise<void> {
  if (d.tabId === null) throw new Error('Open the job application in a tab first.');
  if (!d.permission && !(await permit([d.origin]))) return;
  draw(await applyRequest({ kind: 'apply', action: 'start', tabId: d.tabId, again }));
  flags.spoke = true;
  void refreshCard(true);
}
const SETUP_SKIP = 'rs-apply-setup-skipped';
const setupSkipped = (): boolean => {
  try {
    return localStorage.getItem(SETUP_SKIP) === '1';
  } catch {
    return false;
  }
};
/** The details most forms ask for, asked once before the first fill. Skippable; editable later in Settings. */
function setupBox(d: Detect): HTMLElement {
  const box = node('div', '', 'apply-ask');
  box.append(
    node('h4', 'Before your first application', 'group-title'),
    node('p', 'Most forms ask these. Answer once and they are filled for you every time (change them later in Settings).', 'fine'),
  );
  const det = d.profile.details;
  const f = {
    noticePeriod: field({ label: 'Notice period', value: det.noticePeriod ?? '', help: 'For example "Immediate" or "30 days".' }),
    expectedCtc: field({
      label: 'Expected salary / stipend',
      value: det.expectedCtc ?? '',
      help: 'As you would write it, for example "6 LPA" or "₹25,000/month".',
    }),
    workAuthorization: field({ label: 'Work authorization', value: det.workAuthorization ?? '', help: 'For example "Indian citizen".' }),
    city: field({ label: 'Current city', value: det.city ?? '' }),
  };
  for (const x of Object.values(f)) box.append(x.wrap);
  const row = node('div', '', 'row');
  row.append(
    button(
      'Save and fill this application',
      async () => {
        await applyRequest({
          kind: 'apply',
          action: 'saveProfile',
          details: { ...det, ...Object.fromEntries(Object.entries(f).map(([k, x]) => [k, x.input.value.trim()])) },
          eeo: d.profile.eeo,
        });
        flags.dirty = false;
        await startFill(d);
      },
      'btn primary',
      'Saved. Filling…',
    ),
    button(
      'Skip',
      async () => {
        try {
          localStorage.setItem(SETUP_SKIP, '1');
        } catch {
          /* storage unavailable: the box simply shows again next time */
        }
        flags.dirty = false;
        await startFill(d);
      },
      'btn sm ghost',
      'Filling…',
    ),
  );
  box.append(row);
  return box;
}
function stepsLine(s: ApplySession): HTMLElement {
  const box = node('div', '', 'apply-progress');
  box.append(node('span', '', 'spinner'), node('span', s.message || 'Working…'));
  if (s.stage === 'thinking' && s.stageSince) {
    // A live clock and what to expect, so a long wait does not look like a hang.
    const clock = node('span', '', 'fine apply-clock');
    clock.dataset.since = String(s.stageSince);
    clock.dataset.expect = /writing/i.test(s.message) ? 'written answers usually take 1–2 min' : 'usually under 30 s';
    box.append(clock);
  }
  return box;
}
const tickClocks = (): void => {
  for (const el of card.querySelectorAll<HTMLElement>('[data-since]')) {
    const secs = Math.max(0, Math.round((Date.now() - Number(el.dataset.since)) / 1000));
    el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · ${el.dataset.expect ?? ''}`;
  }
};
setInterval(tickClocks, 1000);
function drawHistory(d: Detect): void {
  historyBox.replaceChildren();
  if (!d.history.length) return;
  const jobs = flags.last?.referralJobs ?? [];
  const { box, body } = accordion('apply-history', 'Your applications', String(d.history.length));
  for (const h of d.history.slice(0, 10)) {
    const job = jobs.find(j => j.url === h.url);
    const people = flags.last?.contacts.filter(p => p.referralJob === h.url).length ?? 0;
    const row = node('div', '', 'apply-item done');
    row.append(
      node('span', `${h.company || 'Company not known'} · ${h.title || 'Role not known'}`, 'apply-label'),
      node(
        'span',
        `Applied ${new Date(h.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${
          !job
            ? 'no referral search yet'
            : job.finishedAt === undefined
              ? `finding people who can refer you${people ? ` (${people} so far)` : '…'}`
              : `${people} ${people === 1 ? 'person' : 'people'} found for a referral`
        }`,
        'fine',
      ),
    );
    if (!job && h.company && h.title)
      row.append(
        button(
          'Find people who can refer me',
          async () => {
            await applyRequest({ kind: 'apply', action: 'referral', url: h.url });
            void refreshCard(true);
          },
          'linkish',
          `Looking for people at ${h.company}…`,
        ),
      );
    else if (job) {
      const open = node('button', 'See them in Referrals', 'linkish');
      open.type = 'button';
      open.addEventListener('click', openReferrals);
      row.append(open);
    }
    body.append(row);
  }
  historyBox.append(box);
}
/** Warns before the next fill when ChatGPT's page failed last time, with a quick way to check it again. */
function aiHealthNote(d: Detect): HTMLElement | null {
  if (!d.aiHealth || Date.now() - d.aiHealth.at > 24 * 3600 * 1000) return null;
  const box = node('div', '', 'apply-health');
  box.append(
    node(
      'p',
      'ChatGPT’s page did not respond as expected last time. ChatGPT may have changed its page, or you may need to sign in again at chatgpt.com.',
      'fine warn',
    ),
    testAiButton(),
  );
  return box;
}
function testAiButton(): HTMLElement {
  return button(
    'Test ChatGPT',
    async () => {
      draw(await applyRequest({ kind: 'apply', action: 'testAi' }));
      notify('success', 'ChatGPT is working.');
    },
    'btn sm',
    'Asking ChatGPT a one-word question…',
  );
}
function draw(d: Detect): void {
  last = d;
  drawHistory(d);
  const s = d.session;
  const show = d.onboarded && (d.canFill || !!s) && d.kind !== 'unsupported';
  card.hidden = !show && d.kind !== 'linkedin-list';
  card.replaceChildren();
  if (card.hidden) return;
  if (d.kind === 'linkedin-list' && !s) {
    card.className = 'card apply-card quiet';
    card.append(node('p', 'Open one job (click it in the list) to fill its application here.', 'card-sub'));
    const first = nextJobRow(d, 'Open and fill the first Easy Apply job');
    if (first) card.append(first);
    return;
  }
  card.className = `card apply-card${d.kind === 'other' && !s ? ' quiet' : ''}`;
  const head = node('div', '', 'apply-head');
  head.append(node('span', 'Application', 'eyebrow'), node('h3', s?.summary || 'Fill this application', 'card-title'));
  card.append(head);
  const health = aiHealthNote(d);
  if (health) card.append(health);
  if (!d.cv) {
    card.append(
      node(
        'p',
        'Applications need your CV file. Upload it once: it stays on this device and is attached only to forms you fill.',
        'card-sub',
      ),
      cvPicker('Upload your CV'),
    );
    return;
  }
  if (!s) {
    card.append(
      node(
        'p',
        d.kind === 'linkedin-job'
          ? 'Fills every Easy Apply step and moves on by itself, using what LinkedIn already has, your saved answers and ChatGPT for the rest. It stops at the final review: you press Submit.'
          : d.kind === 'other'
            ? 'If this page is a job application, ChatGPT can fill it from your profile and CV. You review it and submit it yourself.'
            : 'Fills the form and moves through its steps by itself, from your profile, CV and saved answers, with ChatGPT for anything new. It stops at the final review: you press Submit.',
        'card-sub',
      ),
    );
    // First application: four answers almost every form asks, given once, so later applications rarely stop.
    const det = d.profile.details;
    const needsSetup = !det.noticePeriod && !det.expectedCtc && !det.workAuthorization && !setupSkipped();
    if (needsSetup) {
      card.append(setupBox(d));
      return;
    }
    const row = node('div', '', 'row');
    row.append(
      button(
        d.permission ? 'Fill this application' : `Allow on ${host(d.origin)} and fill`,
        () => startFill(d),
        d.kind === 'other' ? 'btn sm' : 'btn primary',
      ),
    );
    card.append(row);
    if (!d.permission)
      card.append(
        node(
          'p',
          'One-time permission for this site only. Referral Scout reads the form when you press the button, never in the background.',
          'fine',
        ),
      );
    return;
  }
  if (BUSY.includes(s.stage)) {
    card.append(stepsLine(s));
    if (s.stepCount > 1 || s.filled.length)
      card.append(
        node('p', `Step ${s.stepCount}${s.step ? ` · ${s.step}` : ''} · ${s.filled.length + s.files.length} filled so far`, 'fine'),
      );
    if (s.stage === 'thinking' && /writing/i.test(s.message))
      card.append(
        node(
          'p',
          'Written answers use ChatGPT\u2019s thinking mode and take a minute or two. Every other step moves on by itself.',
          'fine',
        ),
      );
    card.append(button('Stop', async () => draw(await applyRequest({ kind: 'apply', action: 'stop' })), 'btn sm ghost', 'Stopped.'));
    return;
  }
  if (s.stage === 'permission') {
    const origins = s.needOrigins ?? [d.origin];
    card.append(node('p', s.message, 'card-sub'));
    card.append(
      button(
        `Allow ${origins.map(host).join(', ')}`,
        async () => {
          if (await permit(origins)) await startFill({ ...d, permission: true });
        },
        'btn primary',
      ),
    );
    return;
  }
  if (s.stage === 'submitted') {
    card.append(sentBox(s, d));
    return;
  }
  if (s.step) card.append(node('p', `Step ${s.stepCount}${s.step ? ` · ${s.step}` : ''}`, 'fine'));
  card.append(node('p', s.message, s.stage === 'error' ? 'apply-msg bad' : 'apply-msg'));
  if (s.ask.length) card.append(askBox(s));
  const final = s.hasSubmit && !s.hasNext && s.stage === 'review';
  const tools = (id: string) => (s.editable.includes(id) ? { id, written: s.written.includes(id) } : undefined);
  // Written answers are what a recruiter reads first: shown in full, each with Edit / Rewrite / Shorter.
  const written = s.filled.filter(f => f.ok && (s.written.includes(f.id) || f.value.length > 120));
  const check = s.filled.filter(f => !written.includes(f) && (!f.ok || f.confidence === 'low' || f.note));
  const fine = s.filled.filter(f => !check.includes(f) && !written.includes(f));
  if (written.length) {
    const box = node('div', '', 'apply-list');
    box.append(node('h4', final ? 'Your written answers: read them before you submit' : 'Written answers', 'group-title'));
    for (const f of written) box.append(item(f.label, f.value, f.why, f.confidence === 'low' ? 'check' : 'done', tools(f.id), true));
    card.append(box);
  }
  if (check.length) {
    const box = node('div', '', 'apply-list');
    box.append(node('h4', 'Check these on the page', 'group-title'));
    for (const f of check)
      box.append(
        item(f.label, f.value, f.note || (f.ok ? f.why || 'ChatGPT was not sure' : 'Could not be typed here'), 'check', tools(f.id)),
      );
    card.append(box);
  }
  if (s.files.length || fine.length) {
    if (final) ui.open.add('apply-filled'); // the last step is the moment to see everything
    const { box, body } = accordion('apply-filled', `Filled (${fine.length + s.files.filter(f => f.ok).length})`);
    for (const f of s.files)
      body.append(
        item(
          f.label,
          f.file === 'cv' ? 'Your CV' : 'Your photo',
          f.ok ? 'Attached' : f.note || 'Attach it yourself',
          f.ok ? 'done' : 'check',
        ),
      );
    for (const f of fine) body.append(item(f.label, f.value, f.why, 'done', tools(f.id)));
    card.append(box);
  }
  if (s.leftForYou.length) {
    const box = node('div', '', 'apply-list');
    box.append(node('h4', 'Left for you', 'group-title'));
    for (const f of s.leftForYou) box.append(item(f.label, '', f.reason, 'you'));
    card.append(box);
  }
  // LinkedIn's final page can mark the job as a top choice (a few per month) with a short message to the hirer.
  if (s.topChoice && !s.topChoice.checked && s.topChoice.remaining !== 0 && s.hasSubmit && !s.hasNext && s.stage === 'review') {
    const box = node('div', '', 'apply-ask');
    box.append(
      node('h4', 'Mark this job as a top choice?', 'group-title'),
      node(
        'p',
        `LinkedIn says top-choice applicants are more likely to hear back.${s.topChoice.remaining !== undefined ? ` You have ${s.topChoice.remaining} left this month.` : ''} ChatGPT (thinking) writes the message from your CV, profile and this job, within LinkedIn\u2019s 400 characters.`,
        'fine',
      ),
      button(
        'Mark as top choice and write the message',
        async () => draw(await applyRequest({ kind: 'apply', action: 'topChoice' })),
        'btn sm',
        'Writing your message…',
      ),
    );
    card.append(box);
  }
  const actions = node('div', '', 'row apply-actions');
  if (s.hasNext && !s.ask.length && s.stage !== 'error' && s.stage !== 'done')
    actions.append(
      button(
        'Next step',
        async () => draw(await applyRequest({ kind: 'apply', action: 'next' })),
        'btn primary',
        'Moving to the next step…',
      ),
    );
  actions.append(
    button(
      s.stage === 'error' || s.stage === 'done' ? 'Fill again' : 'Refill this step',
      () => startFill(d, s.stage === 'review'),
      'btn sm',
    ),
  );
  if (s.filled.length || s.files.length)
    actions.append(
      button(
        'Undo this step',
        async () => draw(await applyRequest({ kind: 'apply', action: 'undo' })),
        'btn sm ghost',
        'Put back what was there.',
      ),
    );
  actions.append(button('Close', async () => draw(await applyRequest({ kind: 'apply', action: 'stop' })), 'btn sm ghost', 'Closed.'));
  card.append(actions);
  if (s.hasSubmit && !s.hasNext)
    card.append(
      node(
        'p',
        (d.profile.afterApply ?? 'referrals') === 'referrals'
          ? `Referral Scout never submits. Press Submit on the page when it looks right${s.job?.company ? `, and it then finds people at ${s.job.company} who can refer you` : ''}.`
          : 'Referral Scout never submits. When everything looks right, press Submit on the page yourself.',
        'fine',
      ),
    );
}
const openReferrals = (): void => {
  ui.tab = 'referrals';
  if (flags.last) rerender(flags.last);
  document.scrollingElement?.scrollTo({ top: 0 });
};
/** After the site confirms the application: what happened, and the referral step that follows. */
/** A LinkedIn results list (search or a collection) where the next job can be opened from the panel. */
const onJobList = (url: string): boolean => /^https:\/\/www\.linkedin\.com\/jobs\/(search|collections)/.test(url);
/** Assisted batch: one press opens the next Easy Apply job and fills it, still stopping before Submit. */
function nextJobRow(d: Detect, label = 'Fill the next Easy Apply job'): HTMLElement | null {
  if (!onJobList(d.url)) return null;
  const wrap = node('div', '', 'apply-next');
  if (d.today >= DAILY_SOFT_CAP)
    wrap.append(
      node(
        'p',
        `You have sent ${d.today} applications today. LinkedIn may limit accounts that apply in large bursts, so consider continuing tomorrow.`,
        'fine warn',
      ),
    );
  else if (d.today) wrap.append(node('p', `${d.today} sent today.`, 'fine'));
  wrap.append(button(label, async () => draw(await applyRequest({ kind: 'apply', action: 'nextJob' })), 'btn', 'Opening the next job…'));
  return wrap;
}
function sentBox(s: ApplySession, d: Detect): HTMLElement {
  const box = node('div', '', 'apply-sent');
  const company = s.job?.company || 'the company';
  box.append(node('p', `\u2713 ${s.message}`, 'apply-sent-title'));
  if (s.job?.title) box.append(node('p', `${s.job.title}${s.job.company ? ` \u00b7 ${s.job.company}` : ''}`, 'fine'));
  const ref = s.sent?.referral;
  if (ref === 'queued') {
    box.append(
      node(
        'p',
        `${s.sent!.message} Recruiters and the hiring team come first, then people you already know there. ${
          flags.last?.settings?.outreachMode === 'automatic'
            ? 'Invitations go out at your safe daily pace.'
            : 'Each invitation waits for your approval in Referrals.'
        }`,
        'card-sub',
      ),
    );
    if (s.sent?.resumed)
      box.append(
        node('p', 'Outreach was paused, so it has been switched on again for referrals only. General outreach stays off.', 'fine'),
        button(
          'Keep outreach paused',
          async () => {
            rerender(await request({ kind: 'network', action: 'pause' }));
          },
          'linkish',
          'Outreach paused. The referral search waits until you resume.',
        ),
      );
    const row = node('div', '', 'row');
    row.append(button('See who it finds', async () => openReferrals(), 'btn primary', 'Opening Referrals…'));
    row.append(button('Done', async () => draw(await applyRequest({ kind: 'apply', action: 'stop' })), 'btn sm ghost', 'Closed.'));
    box.append(row);
    const more = nextJobRow(d);
    if (more) box.append(more);
    return box;
  }
  // Not started: the person turned it off, or the company could not be read from the page.
  box.append(
    node(
      'p',
      ref === 'needs-company'
        ? 'A referral makes this application far more likely to be read. Check the company and role, and Referral Scout finds people there who can refer you.'
        : ref === 'failed'
          ? `The referral search could not start: ${s.sent?.message || 'try again'}.`
          : `Want a referral at ${company}? Referral Scout finds the recruiters and hiring team there and drafts each message for your approval.`,
      'card-sub',
    ),
  );
  const companyIn = field({ label: 'Company', value: s.job?.company ?? '' });
  const titleIn = field({ label: 'Role', value: s.job?.title ?? '' });
  if (ref === 'needs-company' || !s.job?.company || !s.job?.title) box.append(companyIn.wrap, titleIn.wrap);
  const row = node('div', '', 'row');
  row.append(
    button(
      `Find people at ${companyIn.input.value || company} who can refer me`,
      async () => {
        const company = companyIn.input.value.trim(),
          title = titleIn.input.value.trim();
        if (!company || title.length < 2) throw new Error('Type the company and the role first.');
        draw(await applyRequest({ kind: 'apply', action: 'referral', company, title }));
        flags.dirty = false;
      },
      'btn primary',
      'Looking for people who can refer you…',
    ),
    button('Done', async () => draw(await applyRequest({ kind: 'apply', action: 'stop' })), 'btn sm ghost', 'Closed.'),
  );
  box.append(row);
  const more = nextJobRow(d);
  if (more) box.append(more);
  return box;
}
function item(
  label: string,
  value: string,
  note: string,
  tone: 'done' | 'check' | 'you',
  tools?: { id: string; written: boolean },
  full = false,
): HTMLElement {
  const row = node('div', '', `apply-item ${tone}`);
  row.append(node('span', label, 'apply-label'));
  if (value) row.append(node('span', !full && value.length > 220 ? `${value.slice(0, 220)}…` : value, 'apply-value'));
  if (note) row.append(node('span', note, 'fine'));
  if (!tools) return row;
  // Change one answer without refilling the step: type it, or have ChatGPT redo it.
  const bar = node('div', '', 'row apply-tools');
  const edit = node('button', 'Edit', 'linkish');
  edit.type = 'button';
  edit.addEventListener('click', () => {
    if (row.querySelector('.apply-edit')) return;
    const box = node('div', '', 'apply-edit');
    const input = value.length > 60 || tools.written ? node('textarea', '', 'input') : node('input', '', 'input');
    if (input instanceof HTMLTextAreaElement) input.rows = 4;
    input.value = value;
    box.append(
      input,
      button(
        'Save to the form',
        async () => {
          draw(await applyRequest({ kind: 'apply', action: 'edit', id: tools.id, value: input.value }));
        },
        'btn sm',
        'Updated on the page.',
      ),
    );
    row.append(box);
    input.focus();
  });
  bar.append(edit);
  if (tools.written)
    for (const [style, text] of [
      ['rewrite', 'Rewrite'],
      ['shorter', 'Shorter'],
    ] as const)
      bar.append(
        button(
          text,
          async () => draw(await applyRequest({ kind: 'apply', action: 'rewrite', id: tools.id, style })),
          'linkish',
          style === 'shorter' ? 'Shortening…' : 'Rewriting…',
        ),
      );
  row.append(bar);
  return row;
}
function askBox(s: ApplySession): HTMLElement {
  const box = node('div', '', 'apply-ask');
  box.append(
    node('h4', s.ask.length === 1 ? 'One question only you can answer' : `${s.ask.length} questions only you can answer`, 'group-title'),
    node('p', 'Answer here and the rest of the application carries on by itself.', 'fine'),
  );
  // Each answer is read through a getter, so short choices can be buttons and long ones a list.
  const answers: { id: string; value: () => string }[] = [];
  const skip = new Set<string>();
  for (const q of s.ask) {
    const wrap = node('div', '', 'field');
    const id = `ask-${q.id}`;
    const question = node('label', q.question || q.label, 'field-label');
    question.htmlFor = id;
    wrap.append(question);
    // No honest answer here: leave it for the page instead of being stuck.
    const leave = node('button', 'I\u2019ll answer this on the page', 'linkish');
    leave.type = 'button';
    leave.addEventListener('click', () => {
      const on = !skip.has(q.id);
      if (on) skip.add(q.id);
      else skip.delete(q.id);
      wrap.classList.toggle('skipped', on);
      leave.textContent = on ? 'Answer it here instead' : 'I\u2019ll answer this on the page';
    });
    queueMicrotask(() => wrap.append(leave));
    if (q.options?.length && q.options.length <= 6 && q.options.every(o => o.length <= 40)) {
      // Yes / No and other short choices: one press each.
      const group = node('div', '', 'choice-pills');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', q.question || q.label);
      let chosen = '';
      for (const o of q.options) {
        const pill = node('button', o, 'pill-choice');
        pill.type = 'button';
        pill.setAttribute('role', 'radio');
        pill.setAttribute('aria-checked', 'false');
        pill.addEventListener('click', () => {
          chosen = o;
          for (const p of group.querySelectorAll('button')) p.setAttribute('aria-checked', String(p === pill));
        });
        group.append(pill);
      }
      wrap.append(group);
      answers.push({ id: q.id, value: () => chosen });
    } else {
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (q.options?.length) {
        input = node('select', '', 'input');
        const none = node('option', 'Choose an answer');
        none.value = '';
        input.append(none);
        for (const o of q.options) {
          const opt = node('option', o);
          opt.value = o;
          input.append(opt);
        }
      } else if (q.kind === 'textarea' || q.kind === 'richtext') {
        input = node('textarea', '', 'input');
        input.rows = 3;
      } else {
        input = node('input', '', 'input');
        input.type = q.kind === 'date' ? 'date' : q.kind === 'number' ? 'number' : 'text';
      }
      input.id = id;
      wrap.append(input);
      answers.push({ id: q.id, value: () => input.value });
    }
    box.append(wrap);
  }
  const remember = node('input');
  remember.type = 'checkbox';
  remember.checked = true;
  const rl = node('label', '', 'fine inline');
  rl.append(remember, document.createTextNode(' Remember these answers for future applications'));
  box.append(
    rl,
    button(
      'Use these answers and continue',
      async () => {
        const given = answers
          .filter(a => !skip.has(a.id))
          .map(a => ({ id: a.id, value: a.value().trim(), remember: remember.checked }))
          .filter(a => a.value);
        if (!given.length && !skip.size) throw new Error('Choose or type an answer first.');
        draw(await applyRequest({ kind: 'apply', action: 'answer', answers: given, skip: [...skip] }));
      },
      'btn primary',
      'Answers added. Continuing…',
    ),
  );
  return box;
}
/** The card is one element kept across redraws, so a half-typed answer survives the panel refreshing around it. */
export function applyHome(): HTMLElement {
  if (!last) void refreshCard(true);
  else drawHistory(last); // referral progress changes with every panel refresh
  return homeBox;
}

/* ---------- Settings: application details ---------- */
const DETAILS: [keyof ApplyProfile['details'], string, string][] = [
  ['phone', 'Phone', 'With country code, for example +91 98765 43210.'],
  ['email', 'Email for applications', ''],
  ['city', 'Current city', ''],
  ['currentCtc', 'Current salary / CTC', 'As you would write it on a form, for example "12 LPA" or "$95,000".'],
  ['expectedCtc', 'Expected salary / CTC', ''],
  ['noticePeriod', 'Notice period', 'For example "30 days" or "Immediate".'],
  ['startDate', 'Earliest start date', ''],
  ['workAuthorization', 'Work authorization', 'For example "Indian citizen; needs sponsorship for the US".'],
  ['relocate', 'Open to relocating?', ''],
  ['links', 'Portfolio, GitHub or website links', 'Separate with commas.'],
];
export function buildApplySettings(): HTMLElement {
  const { box, body } = accordion('apply-settings', 'Application details', '');
  body.append(
    node(
      'p',
      'Used when ChatGPT fills a job application for you. Leave anything blank to be asked on the form instead. Kept on this device only.',
      'card-sub',
    ),
  );
  const slot = node('div');
  body.append(slot);
  box.addEventListener('toggle', () => {
    if (box.open && !slot.childElementCount) void fill().catch(e => notify('error', errorText(e)));
  });
  if (box.open) queueMicrotask(() => void fill().catch(e => notify('error', errorText(e))));
  const fill = async (): Promise<void> => {
    const d = await applyRequest({ kind: 'apply', action: 'detect', withPhoto: true });
    slot.replaceChildren();
    const inputs = DETAILS.map(([key, label, help]) => {
      const f = field({ label, value: d.profile.details[key] ?? '', ...(help ? { help } : {}) });
      slot.append(f.wrap);
      return [key, f.input] as const;
    });
    const eeo = choice(
      'Diversity questions (gender, race, disability, veteran)',
      d.profile.eeo,
      [
        ['leave', 'Leave them for me'],
        ['decline', 'Choose "Prefer not to say" where offered'],
      ],
      'Referral Scout never answers these with real information.',
    );
    slot.append(eeo.wrap);
    const top = choice(
      'LinkedIn "Mark this job as a top choice"',
      d.profile.topChoice ?? 'auto',
      [
        ['auto', 'Mark every application while LinkedIn allows it'],
        ['ask', 'Only when I press the button'],
      ],
      'LinkedIn allows a few top choices a month. Each one comes with a short message ChatGPT writes for that job.',
    );
    slot.append(top.wrap);
    const after = choice(
      'After an application is sent',
      d.profile.afterApply ?? 'referrals',
      [
        ['referrals', 'Find people at that company who can refer me'],
        ['nothing', 'Do nothing'],
      ],
      'Uses the same referral search as "Ask for referrals". Invitations wait for your approval unless you chose automatic sending.',
    );
    slot.append(after.wrap);
    const check = node('div', '', 'field');
    check.append(
      node('span', 'ChatGPT connection', 'field-label'),
      node('p', 'Sends ChatGPT a one-word question to confirm the panel can still use it.', 'fine'),
      testAiButton(),
    );
    slot.append(check);
    // CV
    const cvRow = node('div', '', 'field');
    cvRow.append(
      node('span', 'CV file', 'field-label'),
      node('p', d.cv ? `${d.cv.name} · ${Math.round(d.cv.size / 1024)} KB` : 'Not uploaded yet. Applications need it.', 'fine'),
      cvPicker(d.cv ? 'Replace CV' : 'Upload CV'),
    );
    slot.append(cvRow);
    // Photo
    const photoRow = node('div', '', 'field');
    photoRow.append(node('span', 'Photo (for forms that ask for one)', 'field-label'));
    if (d.photo?.data) {
      const img = node('img', '', 'avatar apply-photo');
      img.src = `data:${d.photo.type};base64,${d.photo.data}`;
      img.alt = 'Your saved photo';
      photoRow.append(img);
    } else photoRow.append(node('p', d.photo ? d.photo.name : 'No photo saved.', 'fine'));
    const photoActions = node('div', '', 'row');
    if (d.linkedinPhoto)
      photoActions.append(
        button(
          'Use my LinkedIn photo',
          async () => {
            if (!(await chrome.permissions.request({ origins: ['https://media.licdn.com/*'] })))
              throw new Error('Allow LinkedIn image access to download your photo.');
            await applyRequest({ kind: 'apply', action: 'capturePhoto' });
            await fill();
          },
          'btn sm',
          'Your LinkedIn photo is saved on this device.',
        ),
      );
    const upload = node('label', 'Upload a photo', 'btn sm ghost');
    const fileInput = node('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png';
    fileInput.hidden = true;
    upload.append(fileInput);
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      void f
        .arrayBuffer()
        .then(b =>
          applyRequest({ kind: 'apply', action: 'savePhoto', file: { name: f.name, type: f.type, data: toBase64(new Uint8Array(b)) } }),
        )
        .then(() => fill())
        .then(() => notify('success', 'Photo saved on this device.'))
        .catch(e => notify('error', errorText(e)));
    });
    photoActions.append(upload);
    if (d.photo)
      photoActions.append(
        button(
          'Remove photo',
          async () => void (await applyRequest({ kind: 'apply', action: 'deletePhoto' }), await fill()),
          'btn sm ghost danger',
          'Photo removed.',
        ),
      );
    photoRow.append(photoActions);
    slot.append(photoRow);
    // Remembered answers
    const answers = Object.entries(d.profile.answers);
    const forget = new Set<string>();
    if (answers.length) {
      const list = node('div', '', 'field');
      list.append(node('span', `Remembered answers (${answers.length})`, 'field-label'));
      for (const [q, a] of answers) {
        const row = node('div', '', 'apply-item');
        const x = node('button', 'Forget', 'btn sm ghost');
        x.type = 'button';
        x.addEventListener('click', () => {
          forget.add(questionKey(q));
          row.remove();
          flags.dirty = true;
        });
        row.append(node('span', q, 'apply-label'), node('span', a.length > 120 ? `${a.slice(0, 120)}…` : a, 'apply-value'), x);
        list.append(row);
      }
      slot.append(list);
    }
    slot.append(
      button(
        'Save application details',
        async () => {
          await applyRequest({
            kind: 'apply',
            action: 'saveProfile',
            details: Object.fromEntries(inputs.map(([k, i]) => [k, i.value.trim()])),
            eeo: eeo.input.value as 'leave' | 'decline',
            topChoice: top.input.value as 'auto' | 'ask',
            afterApply: after.input.value as 'referrals' | 'nothing',
            forget: [...forget],
          });
          flags.dirty = false;
          await fill();
        },
        'btn primary',
        'Application details saved.',
      ),
    );
  };
  return box;
}
