/**
 * People — the contacts found across target companies (specification 12.3).
 *
 * The confidence column is the point. A name scraped from a company page is not the same as someone the person
 * is already connected to, and treating them alike is how outreach starts embarrassing itself. Suppression is on
 * this screen too, because "do not contact this person again" must be one click and must hold everywhere.
 */

import { canonicalCompany } from '../../../shared/domain/job';
import { button, card, confirmModal, div, emptyState, metric, pill, plural, searchBar, text } from '../dom';
import type { Ctx } from '../shell';
import type { ContactRow } from '../../../background/workspace';

const RELATIONSHIP: Record<string, string> = {
  'existing-connection': 'Already connected',
  alumni: 'Same college',
  'second-degree': 'Second degree',
  'shared-group': 'Shared group',
  none: 'No direct tie',
};

const CATEGORY: Record<string, string> = {
  'existing-connection': 'Connection',
  alumni: 'Alumni',
  'hiring-manager': 'Hiring manager',
  recruiter: 'Recruiter',
  peer: 'Peer',
  founder: 'Founder',
  unknown: 'Unclassified',
};

let showSuppressed = false;
let query = '';

function row(contact: ContactRow, ctx: Ctx, pinnedSet: Set<string>): HTMLElement {
  const confident = contact.confidence >= 0.8;
  const companyPinned = !!contact.company && pinnedSet.has(canonicalCompany(contact.company));
  return div('row row-queue', [
    div('row-title', [
      div('inline', [text('span', 'row-company', contact.company ?? ''), companyPinned ? pill('Pinned', 'violet') : null]),
      text('div', 'cell-strong', contact.name),
      text('div', 'cell-muted', `${contact.role ?? 'Role unknown'} · ${RELATIONSHIP[contact.relationship] ?? contact.relationship}`),
    ]),
    div('col-hide', [pill(CATEGORY[contact.category] ?? contact.category, contact.category === 'unknown' ? 'grey' : 'violet')]),
    div('', [pill(confident ? 'Identity confirmed' : 'Identity unconfirmed', confident ? 'green' : 'amber')]),
    div('col-hide', [
      contact.email
        ? pill(
            contact.emailConfidence === 'verified' ? 'Email verified' : 'Email to verify',
            contact.emailConfidence === 'verified' ? 'green' : 'amber',
          )
        : pill(contact.profileUrl ? 'LinkedIn only' : 'No route', contact.profileUrl ? 'grey' : 'red'),
    ]),
    div('inline', [
      contact.company && ctx.view.campaign
        ? button(companyPinned ? 'Pinned ★' : 'Pin', companyPinned ? 'btn btn-sm btn-primary' : 'btn btn-sm', () =>
            ctx.run({ kind: 'campaign', action: 'pinCompany', company: contact.company!, pinned: !companyPinned }),
          )
        : null,
      contact.profileUrl
        ? button('Open profile', 'btn btn-sm', () => {
            window.open(contact.profileUrl!, '_blank', 'noopener');
          })
        : null,
      contact.suppressed
        ? pill('Suppressed', 'red')
        : button('Never contact', 'btn btn-sm btn-danger', async () => {
            if (
              await confirmModal({
                title: `Never contact ${contact.name}?`,
                description: 'Suppressing this contact holds permanently across every campaign and channel.',
                confirmLabel: 'Never contact',
                tone: 'danger',
              })
            )
              await ctx.run({ kind: 'workspace', action: 'suppressContact', id: contact.id });
          }),
    ]),
  ]);
}

export function people(ctx: Ctx): HTMLElement {
  const w = ctx.workspace;
  if (!w)
    return emptyState({
      icon: 'alert',
      title: 'Your contacts could not be loaded',
      description: 'The message above says why. Reload the extension, then reopen this page.',
    });
  const all = w.contacts;

  if (!all.length)
    return emptyState({
      icon: 'people',
      title: 'No contacts yet',
      description:
        'Once a campaign resolves its target companies, the people who could refer you appear here with the evidence behind each one.',
      action: button('Open referrals', 'btn btn-primary', () => ctx.go('referrals')),
    });

  const active = all.filter(c => !c.suppressed);
  const suppressed = all.filter(c => c.suppressed);
  const shown = showSuppressed ? suppressed : active;

  const page = div('stack');
  page.append(
    div('grid metrics', [
      metric('people', 'Contacts', active.length, `across ${plural(new Set(active.map(c => c.company)).size, 'company', 'companies')}`),
      metric('check', 'Confirmed identity', active.filter(c => c.confidence >= 0.8).length, 'safe to approach'),
      metric(
        'mail',
        'With an address',
        active.filter(c => c.email).length,
        `${active.filter(c => c.emailConfidence === 'verified').length} verified`,
      ),
      metric('alert', 'Suppressed', suppressed.length, suppressed.length ? 'never contacted again' : 'none'),
    ]),
  );

  const tabs = div('tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Contact filters');
  for (const [key, label] of [
    [false, `Contacts ${active.length}`],
    [true, `Suppressed ${suppressed.length}`],
  ] as [boolean, string][]) {
    const b = button(label, 'tab', () => {
      showSuppressed = key;
      ctx.redraw();
    });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(showSuppressed === key));
    tabs.append(b);
  }

  const pinnedSet = new Set(ctx.view.campaign?.referral.pinnedCompanies ?? []);
  const rowsHost = div('rows');
  const drawRows = (): void => {
    const q = query.trim().toLowerCase();
    const list = shown
      .filter(c => !q || `${c.name} ${c.company ?? ''} ${c.role ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(pinnedSet.has(canonicalCompany(b.company ?? ''))) - Number(pinnedSet.has(canonicalCompany(a.company ?? ''))) ||
          b.confidence - a.confidence,
      );
    rowsHost.replaceChildren(
      ...(list.length
        ? list.map(c => row(c, ctx, pinnedSet))
        : [text('p', 'cell-muted', showSuppressed ? 'Nobody is suppressed.' : 'No matching contacts.')]),
    );
  };
  drawRows();

  page.append(
    div('grid split', [
      card('People who could refer you', {
        sub: 'One record per person, however many companies or jobs they turn up against.',
        body: [
          div('filter-bar', [
            tabs,
            searchBar({
              placeholder: 'Search name, company, role…',
              value: query,
              ariaLabel: 'Search people',
              onInput: val => {
                query = val;
                drawRows();
              },
            }),
          ]),
          rowsHost,
        ],
      }),
      card('How contacts are treated', {
        body: [
          div('note note-violet', [
            text(
              'p',
              '',
              'The same person found at two companies is one record, so they are never approached twice as though they were strangers.',
            ),
          ]),
          div('note note-amber', [
            text(
              'p',
              '',
              'An address worked out from a company pattern is a lead to verify, never a recipient. It can be drafted to and held, not sent.',
            ),
          ]),
          div('note', [
            text(
              'p',
              '',
              'Suppressing someone holds across every campaign and every channel, for good. Replies, bounces and opt-outs stop their sequence the moment they arrive.',
            ),
          ]),
        ],
      }),
    ]),
  );
  return page;
}

export const peopleHeader = (ctx: Ctx): { title: string; sub: string; actions: HTMLElement[] } => ({
  title: 'People',
  sub: 'Who could refer you, how strong the connection is and how reliable the evidence is.',
  actions: [button('Allocation', 'btn', () => ctx.go('referrals'))],
});
