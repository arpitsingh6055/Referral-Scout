/**
 * People — the contacts found across target companies (specification 12.3).
 *
 * The confidence column is the point. A name scraped from a company page is not the same as someone the person
 * is already connected to, and treating them alike is how outreach starts embarrassing itself. Suppression is on
 * this screen too, because "do not contact this person again" must be one click and must hold everywhere.
 */

import { canonicalCompany } from '../../../shared/domain/job';
import {
  button,
  card,
  confirmModal,
  copyLinkButton,
  div,
  emptyState,
  errorStateWithRetry,
  externalLink,
  metric,
  paginateControls,
  pill,
  plural,
  searchBar,
  text,
} from '../dom';
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

let viewMode: 'active' | 'conversations' | 'suppressed' = 'active';
let query = '';
let currentPage = 1;
const PAGE_SIZE = 50;

function row(contact: ContactRow, ctx: Ctx, pinnedSet: Set<string>): HTMLElement {
  const confident = contact.confidence >= 0.8;
  const companyPinned = !!contact.company && pinnedSet.has(canonicalCompany(contact.company));
  const roleLine = `${contact.role ?? 'Role unknown'} · ${RELATIONSHIP[contact.relationship] ?? contact.relationship}`;
  return div('row row-queue', [
    div('row-title', [
      div('inline', [text('span', 'row-company', contact.company ?? ''), companyPinned ? pill('Pinned', 'violet') : null]),
      externalLink(contact.name, contact.profileUrl, 'cell-strong cell-link'),
      Object.assign(text('div', 'cell-muted clamp', roleLine), { title: roleLine }),
    ]),
    div('col-hide', [pill(CATEGORY[contact.category] ?? contact.category, contact.category === 'unknown' ? 'grey' : 'violet')]),
    div('', [!confident ? pill('Identity unconfirmed', 'amber') : null]),
    div('col-hide', [
      contact.email
        ? pill(
            contact.emailConfidence === 'verified' ? 'Email verified' : 'Email to verify',
            contact.emailConfidence === 'verified' ? 'green' : 'amber',
          )
        : !contact.profileUrl
          ? pill('No route', 'red')
          : null,
    ]),
    div('inline', [
      contact.profileUrl ? button('Open profile ↗', 'btn btn-sm btn-primary', () => ctx.openExternal(contact.profileUrl!)) : null,
      contact.company && ctx.view.campaign
        ? button(companyPinned ? 'Pinned ★' : 'Pin', companyPinned ? 'btn btn-sm' : 'btn btn-sm btn-ghost', () =>
            ctx.run({ kind: 'campaign', action: 'pinCompany', company: contact.company!, pinned: !companyPinned }),
          )
        : null,
      copyLinkButton(contact.profileUrl || contact.email, 'Copy'),
      contact.suppressed
        ? pill('Suppressed', 'red')
        : button('Never contact', 'btn btn-sm btn-ghost', async () => {
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
    return errorStateWithRetry('Could not load contacts', 'Your local contacts database did not respond. Retry to refresh.', () =>
      ctx.refresh(),
    );
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
  const convs = ctx.view.conversations ?? [];
  if (viewMode === 'conversations' && !convs.length && active.length) viewMode = 'active';
  const shown = viewMode === 'suppressed' ? suppressed : active;

  const page = div('stack');
  page.append(
    div('grid metrics', [
      metric('people', 'Contacts', active.length, `across ${plural(new Set(active.map(c => c.company)).size, 'company', 'companies')}`),
      metric('check', 'Confirmed identity', active.filter(c => c.confidence >= 0.8).length, 'safe to approach'),
      metric('mail', 'Conversations', convs.length, `${convs.filter(c => c.status === 'needs-reply').length} needing reply`),
      metric('alert', 'Suppressed', suppressed.length, suppressed.length ? 'never contacted again' : 'none'),
    ]),
  );

  const tabs = div('tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Contact filters');
  for (const [mode, label] of [
    ['active', `Contacts ${active.length}`],
    ['conversations', `Conversations ${convs.length}`],
    ['suppressed', `Suppressed ${suppressed.length}`],
  ] as const) {
    const b = button(label, 'tab', () => {
      viewMode = mode;
      ctx.redraw();
    });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(viewMode === mode));
    tabs.append(b);
  }

  if (viewMode === 'conversations') {
    const jobs = ctx.workspace?.jobs ?? [];
    page.append(
      card('People & Conversations', {
        sub: 'LinkedIn invitations, messages, and Gmail threads attributed to exact opportunities.',
        link: button('Sync Gmail Replies', 'btn btn-sm btn-primary', () => ctx.run({ kind: 'campaign', action: 'gmailSync' })),
        body: [
          tabs,
          convs.length
            ? div(
                'stack',
                convs.map(c => {
                  const coKey = canonicalCompany(c.companyName ?? '');
                  const coJobs = jobs.filter(j => canonicalCompany(j.company) === coKey);
                  return div('conv-card', [
                    div('inline', [
                      text('strong', '', c.contactName),
                      c.companyName ? text('span', 'row-company', c.companyName) : null,
                      pill(c.channel === 'gmail' ? 'Gmail' : 'LinkedIn', 'blue'),
                      pill(
                        c.attributionState === 'confirmed' ? 'Matched to job' : 'Match to job',
                        c.attributionState === 'confirmed' ? 'green' : 'amber',
                      ),
                    ]),
                    c.subject ? text('div', 'cell-strong', c.subject) : null,
                    c.attributionEvidence ? text('div', 'cell-muted', c.attributionEvidence) : null,
                    c.attributionState !== 'confirmed' && coJobs.length
                      ? div(
                          'inline',
                          coJobs
                            .slice(0, 3)
                            .map(j =>
                              button(`Assign: ${j.title}`, 'btn btn-sm', () =>
                                ctx.run({ kind: 'campaign', action: 'confirmConversation', conversationId: c.id, opportunityId: j.id }),
                              ),
                            ),
                        )
                      : null,
                  ]);
                }),
              )
            : emptyState({
                icon: 'mail',
                title: ctx.view.replies ? `${plural(ctx.view.replies, 'LinkedIn reply')} recorded` : 'No email threads synced yet',
                description: ctx.view.replies
                  ? 'LinkedIn replies are tracked on your contacts. Click Sync Gmail Replies to also pull email threads.'
                  : 'Click Sync Gmail Replies or reach out on LinkedIn to track conversations here.',
              }),
        ],
      }),
    );
    return page;
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
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const paged = list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const pager = paginateControls(list.length, currentPage, PAGE_SIZE, next => {
      currentPage = next;
      drawRows();
    });
    rowsHost.replaceChildren(
      ...(paged.length
        ? [...paged.map(c => row(c, ctx, pinnedSet)), ...(pager ? [pager] : [])]
        : [text('p', 'cell-muted', viewMode === 'suppressed' ? 'Nobody is suppressed.' : 'No matching contacts.')]),
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
          div('note', [
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
