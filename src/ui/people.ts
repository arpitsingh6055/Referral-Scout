/** People screen: filters and the card for one person, with its draft, actions and outcome. */
import { outcomeLabels, outcomeRow } from './pipeline';
import { type NetworkContact, type NetworkState } from '../shared/network';
import { ui, node, initials, when, link, request, withProgress, button, act, kit, stateLabels, categoryLabels, flags } from './core';

/* ---------- people tab ---------- */
export function buildPeople(s: NetworkState, list: HTMLElement, redraw: () => void): void {
  list.replaceChildren();
  const filters: [string, string, (p: NetworkContact) => boolean][] = [
    ['all', 'All', p => p.state !== 'skipped' && p.state !== 'found'],
    ['review', 'To approve', p => p.state === 'review'],
    ['shortlisted', 'Queued', p => p.state === 'shortlisted'],
    ['pending', 'Invited', p => p.state === 'pending'],
    ['connected', 'Accepted', p => p.state === 'connected'],
    ['messaged', 'Introduced', p => p.state === 'messaged'],
    ['replied', 'Replied', p => !!p.outcome],
    ['referred', 'Will refer', p => p.outcome === 'referred'],
    ['attention', 'Needs you', p => p.state === 'attention'],
    ['skipped', 'Skipped', p => p.state === 'skipped'],
  ];
  const bar = node('div', '', 'filters');
  for (const [key, label, test] of filters) {
    const n = s.contacts.filter(test).length;
    if (key !== 'all' && key !== ui.filter && !n) continue;
    const b = node('button', n ? `${label} ${n}` : label, 'filter');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(ui.filter === key));
    b.addEventListener('click', () => {
      ui.filter = key;
      redraw();
    });
    bar.append(b);
  }
  list.append(bar);
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
          : 'Press Start. We search for recruiters, team leaders and founders and list them here, best matches first.',
      ),
    );
    list.append(e);
  }
  for (const p of people) list.append(personCard(s, p));
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
  else if (p.state === 'review' && p.approvalKind && s.active)
    actions.append(
      button(
        `Approve ${p.approvalKind === 'connect' ? 'invitation' : 'message'}`,
        async () => {
          await saveEdit?.();
          await act(
            { kind: 'network', action: 'approve', url: p.url },
            `Approved for ${p.name}. Sending shortly; you can keep approving others.`,
          );
        },
        'btn sm primary',
      ),
    );
  else if (p.state === 'review' && p.approvalKind) actions.append(node('span', 'Press Start outreach to approve and send.', 'field-help'));
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
  if (p.state === 'attention')
    actions.append(
      link('Open on LinkedIn ↗', p.url, 'btn sm'),
      button('Try again', () => act({ kind: 'network', action: 'retry', url: p.url }), 'btn sm primary'),
    );
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
        if (confirm(`Delete the saved record for ${p.name}? This does not undo anything on LinkedIn.`))
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
