/** People screen: filters and the card for one person, with its draft, actions and outcome. */
import { outcomeLabels, outcomeRow } from './pipeline';
import { type NetworkContact, type NetworkState } from '../shared/network';
import {
  ui,
  node,
  initials,
  when,
  link,
  request,
  withProgress,
  button,
  act,
  kit,
  stateLabels,
  categoryLabels,
  flags,
  confirmPanelAction,
} from './core';

/* ---------- people tab ---------- */
export function buildPeople(s: NetworkState, list: HTMLElement, redraw: () => void): void {
  list.replaceChildren();
  // Four views cover real use; the card itself shows the exact state. The finer views (reached from the numbers on
  // Home) appear as a chip only while selected.
  const IN_PROGRESS = ['shortlisted', 'requesting', 'pending', 'connected', 'messaging'];
  const filters: [string, string, (p: NetworkContact) => boolean, boolean][] = [
    ['all', 'All', p => p.state !== 'skipped' && p.state !== 'found', true],
    ['needs', 'Needs you', p => p.state === 'review' || p.state === 'attention', true],
    ['progress', 'In progress', p => IN_PROGRESS.includes(p.state) && !p.outcome, true],
    ['done', 'Messaged', p => p.state === 'messaged' || !!p.outcome, true],
    ['skipped', 'Skipped', p => p.state === 'skipped', true],
    ['review', 'To approve', p => p.state === 'review', false],
    ['attention', 'Needs attention', p => p.state === 'attention', false],
    ['connected', 'Accepted', p => p.state === 'connected', false],
    ['replied', 'Replied', p => !!p.outcome, false],
    ['referred', 'Will refer', p => p.outcome === 'referred', false],
  ];
  const bar = node('div', '', 'filters');
  for (const [key, label, test, primary] of filters) {
    const n = s.contacts.filter(test).length;
    if (!primary && key !== ui.filter) continue;
    if (key !== 'all' && key !== ui.filter && !n) continue;
    const b = node('button', n ? `${label} ${n}` : label, 'filter');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(ui.filter === key));
    b.addEventListener('click', () => {
      ui.filter = key;
      ui.filterChosen = true;
      redraw();
    });
    bar.append(b);
  }
  list.append(bar);
  const searchBox = node('input', '', 'people-search') as HTMLInputElement;
  searchBox.type = 'search';
  searchBox.placeholder = 'Search by name, role, or company';
  searchBox.value = ui.search;
  searchBox.setAttribute('aria-label', 'Search people');
  const applySearch = (): void => {
    const q = ui.search.trim().toLowerCase();
    for (const c of list.querySelectorAll<HTMLElement>('.person')) c.hidden = q !== '' && !(c.dataset.search ?? '').includes(q);
  };
  searchBox.addEventListener('input', () => {
    ui.search = searchBox.value;
    applySearch();
  });
  list.append(searchBox);
  const test = filters.find(f => f[0] === ui.filter)?.[2] ?? filters[0]![2];
  const urgency = (p: NetworkContact): number => (p.state === 'review' ? 0 : p.state === 'attention' ? 1 : 2); // what needs you comes first
  const people = s.contacts.filter(test).sort((a, b) => urgency(a) - urgency(b) || (b.score ?? 0) - (a.score ?? 0));
  if (!people.length) {
    const e = node('div', '', 'empty');
    e.append(
      node('b', s.contacts.length ? 'Nobody in this view' : 'No people yet'),
      node(
        'span',
        s.contacts.length
          ? 'Try another filter.'
          : 'Press \u201cFind jobs and referrals\u201d on Home. The people who can refer you are listed here, best matches first.',
      ),
    );
    list.append(e);
  }
  for (const p of people) list.append(personCard(s, p));
  applySearch();
}
export function personCard(s: NetworkState, p: NetworkContact): HTMLElement {
  const card = node('article', '', 'person'),
    head = node('div', '', 'person-head'),
    info = node('div');
  info.append(link(p.name, p.url, 'person-name'), node('p', p.headline, 'muted small clamp'));
  head.append(node('div', initials(p.name), `avatar ${p.category ?? ''}`), info);
  card.append(head);
  const badges = node('div', '', 'badges');
  if (p.degree) badges.append(node('span', p.degree === 1 ? '1st · message' : p.degree === 2 ? '2nd · invite' : '3rd · invite', 'chip'));
  if (p.category && categoryLabels[p.category]) badges.append(node('span', categoryLabels[p.category]!, `type ${p.category}`));
  badges.append(
    node(
      'span',
      p.state === 'review' && p.approved ? 'Sending soon' : stateLabels[p.state],
      `badge ${p.state === 'review' && p.approved ? 'connected' : p.state}`,
    ),
  );
  if (p.outcome) badges.append(node('span', outcomeLabels[p.outcome], `badge ${p.outcome === 'declined' ? '' : 'connected'}`));
  card.append(badges);
  const line =
    p.state === 'pending'
      ? `Invited ${when(p.requestedAt)} · acceptance is checked every 2 hours`
      : p.acceptedAt
        ? `Accepted ${when(p.acceptedAt)}${p.messagedAt ? ` · introduced ${when(p.messagedAt)}` : ''}`
        : p.reason;
  card.append(node('p', line, 'reason'));
  const refJob = p.referralJob ? s.referralJobs?.find(j => j.url === p.referralJob) : undefined;
  if (refJob) card.append(node('p', `Referral for: ${refJob.title} · ${refJob.company}`, 'muted small'));
  card.dataset.search = `${p.name} ${p.headline} ${p.companyName ?? ''} ${refJob ? `${refJob.title} ${refJob.company}` : ''}`.toLowerCase();
  let saveEdit: (() => Promise<unknown>) | null = null; // an unsaved rewording is saved before Approve sends anything
  for (const [text, label] of [
    [p.invitationNote, 'Invitation note'],
    [p.message, p.messagedAt ? 'Message sent' : 'Message prepared'],
  ] as const) {
    if (!text) continue;
    const d = node('details', '', 'inline');
    d.append(node('summary', label));
    const isDraft =
      p.state === 'review' && !p.approved && (label === 'Invitation note' ? p.approvalKind === 'connect' : p.approvalKind === 'message');
    if (!isDraft) {
      d.append(node('div', text, 'bubble'));
      card.append(d);
      continue;
    }
    // A draft waiting for approval can be reworded right here before it is sent.
    d.open = true;
    const limit = p.approvalKind === 'connect' ? 200 : 2000,
      edit = node('textarea', '', 'draft'),
      counter = node('span', '', 'field-help');
    edit.value = text;
    edit.rows = p.approvalKind === 'connect' ? 4 : 6;
    edit.maxLength = 2000;
    edit.setAttribute('aria-label', `${label} for ${p.name}`);
    const save = button(
      'Save changes',
      () => act({ kind: 'network', action: 'editDraft', url: p.url, text: edit.value }, `Your wording for ${p.name} is saved.`),
      'btn sm',
    );
    const count = (): void => {
      const n = edit.value.trim().length;
      counter.textContent = `${n}/${limit}`;
      counter.classList.toggle('over', n > limit);
      save.hidden = edit.value.trim() === text.trim();
      save.disabled = n > limit || n === 0;
    };
    edit.addEventListener('input', () => {
      flags.dirty = true;
      count();
    });
    count();
    saveEdit = async () => {
      if (edit.value.trim() !== text.trim()) await request({ kind: 'network', action: 'editDraft', url: p.url, text: edit.value });
    };
    const tools = node('div', '', 'draft-tools');
    tools.append(counter, save);
    if (!p.direct && !p.referralJob)
      tools.append(
        button(
          'Rewrite with ChatGPT',
          () =>
            withProgress(`ChatGPT is rewriting the note for ${p.name}`, () =>
              act({ kind: 'network', action: 'prepare', url: p.url }, `ChatGPT rewrote the note for ${p.name}. Read it before approving.`),
            ),
          'btn sm ghost',
        ),
        button(
          'Use my template',
          () => act({ kind: 'network', action: 'templateDraft', url: p.url }, `Back to your template for ${p.name}.`),
          'btn sm ghost',
        ),
      );
    d.append(edit, tools);
    card.append(d);
  }
  const actions = node('div', '', 'person-actions');
  // Approve returns at once: the message joins the send queue, and can be taken back until it actually goes out.
  if (p.state === 'review' && p.approved)
    actions.append(
      button(
        'Cancel sending',
        () => act({ kind: 'network', action: 'unapprove', url: p.url }, `Sending to ${p.name} cancelled.`),
        'btn sm',
      ),
    );
  else if (p.state === 'review' && p.approvalKind) {
    actions.append(
      button(
        `Approve ${p.approvalKind === 'connect' ? 'invitation' : 'message'}`,
        async () => {
          await saveEdit?.();
          await act(
            { kind: 'network', action: 'approve', url: p.url },
            s.active
              ? `Approved for ${p.name}. Sending shortly; you can keep approving others.`
              : `Approved for ${p.name}. Outreach will resume and send it shortly.`,
          );
        },
        'btn sm primary',
      ),
    );
    if (!s.active) actions.append(node('span', 'Outreach is paused — approving resumes it and sends this.', 'field-help'));
  }
  if (p.state === 'found')
    actions.append(
      button(
        p.direct ? 'Ask for a referral' : 'Invite and ask',
        () => act({ kind: 'network', action: 'askReferral', url: p.url }, `${p.name} queued for a referral request.`),
        'btn sm primary',
      ),
    );
  if (p.state === 'shortlisted' && !p.referralJob)
    actions.append(
      button(
        'Draft with ChatGPT',
        () =>
          withProgress(`ChatGPT is drafting for ${p.name}`, () =>
            act({ kind: 'network', action: 'prepare', url: p.url }, `Draft ready for ${p.name}. Nothing was sent.`),
          ),
        'btn sm ghost',
      ),
    );
  // Their profile is one press away on every card, whatever the stage.
  actions.append(link('Open profile ↗', p.url, 'btn sm'));
  if (p.state === 'attention') {
    if (p.followOnly) actions.append(button('Follow', () => act({ kind: 'network', action: 'followNow', url: p.url }), 'btn sm primary'));
    // A follow-only reading can be wrong (a page that painted slowly), so it can be re-checked.
    if (!p.emailRequired)
      actions.append(button('Try again', () => act({ kind: 'network', action: 'retry', url: p.url }), 'btn sm primary'));
    // emailRequired: only Open on LinkedIn + Skip, because retrying can never clear LinkedIn's email prompt.
  }
  if (!['messaged', 'skipped', 'requesting', 'messaging'].includes(p.state))
    actions.append(
      button(
        'Skip',
        () => act({ kind: 'network', action: 'skip', url: p.url }, `${p.name} skipped. Nothing more will be sent.`),
        'btn sm ghost',
      ),
    );
  actions.append(
    button(
      'Delete',
      async () => {
        if (
          await confirmPanelAction({
            title: `Delete record for ${p.name}?`,
            description: 'This removes their record from your browser. It does not undo anything already sent on LinkedIn.',
            confirmLabel: 'Delete',
            tone: 'danger',
          })
        )
          await act({ kind: 'network', action: 'removeContact', url: p.url }, `Record for ${p.name} deleted.`);
      },
      'btn sm ghost danger',
    ),
  );
  card.append(actions);
  const outcome = outcomeRow(p, kit);
  if (outcome) card.append(outcome);
  return card;
}
