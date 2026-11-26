/**
 * Jobs — the discovered pool, with the reasoning behind every verdict (specification 8.3).
 *
 * The card shows the evidence before the score. A number tells the person nothing they can argue with; a list of
 * requirements with what in their profile answers each one lets them see that the match is wrong, fix their
 * profile, and get a better shortlist. That is the loop this screen exists to close.
 *
 * One wording rule is load-bearing: a requirement with nothing to match it reads "not found in your profile",
 * never "you lack this". The product does not know the difference, and the person does.
 */

import { canonicalCompany } from '../../../shared/domain/job';
import { opportunityWorkspace } from '../components/opportunity-workspace';
import {
  ago,
  button,
  card,
  copyLinkButton,
  div,
  el,
  emptyState,
  externalLink,
  icon,
  metric,
  paginateControls,
  pill,
  plural,
  searchBar,
  text,
} from '../dom';
import type { Ctx } from '../shell';
import type { JobRow } from '../../../background/workspace';

type Filter = 'strong' | 'possible' | 'blocked' | 'shortlisted' | 'all';
type SortBy = 'fit' | 'newest' | 'company';

let filter: Filter = 'all';
let sortBy: SortBy = 'fit';
let currentPage = 1;
const PAGE_SIZE = 50;
let userSelectedFilter = false;
let query = '';
let openJob: string | null = null;

const TIER_TONE: Record<string, 'green' | 'violet' | 'grey' | 'red'> = {
  strong: 'green',
  possible: 'violet',
  weak: 'grey',
  blocked: 'red',
};

const MATCH: Record<Filter, (j: JobRow) => boolean> = {
  strong: j => j.tier === 'strong',
  possible: j => j.tier === 'possible' || j.tier === 'weak',
  blocked: j => j.tier === 'blocked',
  shortlisted: j => j.judgement === 'shortlisted',
  all: () => true,
};

function row(job: JobRow, ctx: Ctx, queuedRefs: Set<string>, pinnedSet: Set<string>): HTMLElement {
  const met = job.evidence.filter(e => e.state === 'met').length;
  const inQueue = queuedRefs.has(job.id) || queuedRefs.has(job.url);
  const companyPinned = pinnedSet.has(canonicalCompany(job.company));
  return div('row row-queue', [
    div('row-title', [
      div('inline', [text('span', 'row-company', job.company), companyPinned ? pill('Pinned', 'violet') : null]),
      externalLink(job.title, job.url, 'cell-strong cell-link'),
      text(
        'div',
        'cell-muted',
        `${job.location || 'Location unknown'}${job.applyType && job.applyType !== 'unknown' ? ` · ${job.applyType}` : ''}${job.evidence.length ? ` · ${met}/${job.evidence.length} matched` : ''}`,
      ),
      job.aiWhy ? text('div', 'cell-muted', `Why: ${job.aiWhy}`) : null,
    ]),
    div('col-hide', [pill(job.source.replace(/ Jobs$/, ''), 'grey')]),
    div('', [
      pill(
        job.tier === 'blocked' ? 'Not eligible' : !job.fitAssessed && job.fit === 0 ? 'Unscored' : `Fit ${job.fit}`,
        !job.fitAssessed && job.fit === 0 ? 'grey' : (TIER_TONE[job.tier] ?? 'grey'),
      ),
    ]),
    div('col-hide', [job.postedAt ? text('div', 'cell-muted', ago(job.postedAt)) : null]),
    div('inline', [
      inQueue
        ? pill('In queue', 'blue')
        : job.judgement === 'shortlisted'
          ? pill('Shortlisted', 'green')
          : job.judgement === 'rejected'
            ? pill('Dismissed', 'red')
            : null,
      !inQueue && job.tier !== 'blocked'
        ? button(
            job.judgement === 'shortlisted' ? 'Unshortlist' : 'Shortlist',
            job.judgement === 'shortlisted' ? 'btn btn-sm btn-ghost' : 'btn btn-sm',
            () =>
              ctx.run({
                kind: 'workspace',
                action: 'judgeJob',
                id: job.id,
                judgement: job.judgement === 'shortlisted' ? 'none' : 'shortlisted',
              }),
          )
        : null,
      copyLinkButton(job.url, 'Copy'),
      button(openJob === job.id ? 'Hide' : 'Why?', 'btn btn-sm', () => {
        openJob = openJob === job.id ? null : job.id;
        ctx.redraw();
      }),
    ]),
  ]);
}

function companyOverflowMenu(companyName: string, pinned: boolean, panelUrl: string, ctx: Ctx): HTMLElement {
  const summary = el('summary', { class: 'btn btn-sm btn-ghost', ariaLabel: `More actions for ${companyName}` }, ['•••']);
  const menu = el('details', { class: 'overflow-menu' }, [
    summary,
    div('overflow-popover', [
      button(pinned ? 'Unpin company' : 'Boost priority (Pin)', 'btn btn-sm btn-ghost', () => {
        menu.open = false;
        void ctx.run({ kind: 'campaign', action: 'pinCompany', company: companyName, pinned: !pinned });
      }),
      button('Open on LinkedIn + Panel', 'btn btn-sm btn-ghost', () => {
        menu.open = false;
        ctx.openPanel(panelUrl);
      }),
    ]),
  ]);
  return menu;
}

export function jobs(ctx: Ctx): HTMLElement {
  const all = ctx.workspace?.jobs ?? [];
  const contacts = ctx.workspace?.contacts ?? [];
  const queuedUrls = new Set(ctx.view.queue.flatMap(q => [q.jobId, q.url].filter((v): v is string => !!v)));
  const pinnedSet = new Set(ctx.view.campaign?.referral.pinnedCompanies ?? []);
  const contactsByCompany = new Map<string, number>();
  for (const c of contacts) {
    if (c.suppressed) continue;
    const key = canonicalCompany(c.company ?? '');
    if (key) contactsByCompany.set(key, (contactsByCompany.get(key) ?? 0) + 1);
  }
  if (!all.length) {
    userSelectedFilter = false;
    const page = div('stack');
    const search = ctx.workspace?.jobSearch;
    const linkedinConnected = !!ctx.workspace?.connections.linkedin;
    if (search?.status === 'finding') {
      page.append(
        div('banner banner-progress', [
          icon('search', 18),
          `Searching LinkedIn Jobs. ${search.found} jobs found; ${search.cursor} of ${search.totalTerms || 'several'} search titles checked. Referral Scout will then assess the results against your CV and LinkedIn background.`,
          button('Finish with current results', 'btn btn-sm', () => ctx.runNetwork({ kind: 'network', action: 'finishJobSearch' })),
        ]),
      );
    }
    page.append(
      emptyState({
        icon: linkedinConnected ? 'briefcase' : 'person',
        title:
          search?.status === 'choosing'
            ? 'No suitable jobs in this search'
            : linkedinConnected
              ? 'No jobs discovered yet'
              : 'Connect LinkedIn first',
        description:
          search?.status === 'choosing'
            ? 'The search finished without producing jobs to review. Try broadening the role or location in Campaign.'
            : linkedinConnected
              ? 'Start a LinkedIn Jobs search using the roles and location saved in Campaign. Referral Scout searches related titles, reads available descriptions and ranks them against your CV and LinkedIn background.'
              : 'Read your own LinkedIn profile in Candidate profile first so Referral Scout can verify your session before searching LinkedIn Jobs.',
        action: linkedinConnected
          ? button(
              search?.status === 'finding' ? 'Search is running' : 'Find jobs on LinkedIn',
              'btn btn-primary',
              () => ctx.runNetwork({ kind: 'network', action: 'findJobs' }),
              { disabled: search?.status === 'finding' },
            )
          : button('Open Candidate profile', 'btn btn-primary', () => ctx.go('profile')),
      }),
    );
    return page;
  }

  const counts = {
    strong: all.filter(MATCH.strong).length,
    possible: all.filter(MATCH.possible).length,
    blocked: all.filter(MATCH.blocked).length,
    shortlisted: all.filter(MATCH.shortlisted).length,
    all: all.length,
  };

  if (ctx.workspace?.jobSearch?.status === 'choosing' && counts.strong > 0 && !userSelectedFilter) {
    filter = 'strong';
  }

  const page = div('stack');
  if (ctx.workspace?.jobSearch?.status === 'finding') {
    const search = ctx.workspace.jobSearch;
    const ranking = search.ranking;
    page.append(
      div('banner banner-progress', [
        icon('search', 18),
        div('', [
          text(
            'div',
            'rule-name',
            ranking
              ? `Assessing your fit: ${ranking.done} of ${ranking.total} job descriptions reviewed`
              : `Searching LinkedIn Jobs: ${search.found} jobs found across ${search.cursor} of ${search.totalTerms || 'several'} search titles`,
          ),
          text(
            'div',
            'cell-muted',
            'Referral Scout is using your saved CV and LinkedIn profile. You can keep using the dashboard while the search runs.',
          ),
        ]),
        button('Finish with current results', 'btn btn-sm', () => ctx.runNetwork({ kind: 'network', action: 'finishJobSearch' })),
      ]),
    );
  } else if (ctx.workspace?.jobSearch?.status === 'choosing') {
    page.append(
      div('banner banner-note', [
        icon('check', 18),
        counts.shortlisted > 0
          ? `${counts.shortlisted} role${counts.shortlisted === 1 ? '' : 's'} shortlisted. Review any remaining matches below or click Queue ${counts.shortlisted} shortlisted above to move to Applications.`
          : `Search complete: ${ctx.workspace.jobSearch.found} roles found. Review the strong matches below and shortlist the ones you want.`,
      ]),
    );
  }
  page.append(
    div('grid metrics', [
      metric('briefcase', 'Discovered', counts.all, 'across your sources'),
      metric('star', 'Strong matches', counts.strong, counts.strong ? 'worth applying for' : 'none yet', counts.strong > 0),
      metric('check', 'Shortlisted', counts.shortlisted, 'ready to queue'),
      metric('alert', 'Not eligible', counts.blocked, counts.blocked ? 'with reasons' : 'none'),
    ]),
  );

  const tabs = div('tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Job filters');
  for (const [key, label] of [
    ['strong', `Strong ${counts.strong}`],
    ['possible', `Possible ${counts.possible}`],
    ['shortlisted', `Shortlisted ${counts.shortlisted}`],
    ['blocked', `Not eligible ${counts.blocked}`],
    ['all', `All ${counts.all}`],
  ] as [Filter, string][]) {
    const b = button(label, 'tab', () => {
      userSelectedFilter = true;
      filter = key;
      ctx.redraw();
    });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(filter === key));
    tabs.append(b);
  }

  const companyOrder = new Map<string, number>();
  const totalsByCompany = new Map<string, { topFit: number; shortlisted: number; roles: number }>();
  for (const j of all) {
    const key = canonicalCompany(j.company) || j.company.toLowerCase();
    const prev = totalsByCompany.get(key) ?? { topFit: 0, shortlisted: 0, roles: 0 };
    prev.roles += 1;
    prev.topFit = Math.max(prev.topFit, j.fit);
    if (j.judgement === 'shortlisted') prev.shortlisted += 1;
    totalsByCompany.set(key, prev);
  }
  [...totalsByCompany.entries()]
    .sort(
      ([ka, a], [kb, b]) =>
        Number(pinnedSet.has(kb)) - Number(pinnedSet.has(ka)) ||
        Number(b.shortlisted > 0) - Number(a.shortlisted > 0) ||
        b.topFit - a.topFit ||
        b.roles - a.roles,
    )
    .forEach(([key], idx) => companyOrder.set(key, idx + 1));

  const rowsHost = div('rows');
  const drawRows = (): void => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (j: JobRow): boolean => !q || `${j.title} ${j.company} ${j.location} ${j.source}`.toLowerCase().includes(q);
    const shown = all
      .filter(MATCH[filter])
      .filter(matchesQuery)
      .sort((a, b) => {
        if (sortBy === 'company') return a.company.localeCompare(b.company) || b.fit - a.fit;
        if (sortBy === 'newest') return (b.postedAt ?? 0) - (a.postedAt ?? 0) || b.fit - a.fit;
        return Number(pinnedSet.has(canonicalCompany(b.company))) - Number(pinnedSet.has(canonicalCompany(a.company))) || b.rank - a.rank;
      });
    if (!shown.length) {
      rowsHost.replaceChildren(text('p', 'cell-muted', 'No matching jobs in this view.'));
      return;
    }

    const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const paged = shown.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const groups = new Map<string, { key: string; name: string; items: JobRow[]; topFit: number }>();
    for (const j of paged) {
      const key = canonicalCompany(j.company) || j.company.toLowerCase();
      const prev = groups.get(key) ?? { key, name: j.company, items: [], topFit: 0 };
      prev.items.push(j);
      prev.topFit = Math.max(prev.topFit, j.fit);
      groups.set(key, prev);
    }

    const cards = [...groups.values()]
      .sort((a, b) => (companyOrder.get(a.key) ?? 999) - (companyOrder.get(b.key) ?? 999))
      .map(group => {
        const pinned = pinnedSet.has(group.key);
        const rankNum = companyOrder.get(group.key) ?? 1;
        const refs = contactsByCompany.get(group.key) ?? 0;
        const shortlistedCount = group.items.filter(j => j.judgement === 'shortlisted').length;
        const monogram = group.name.trim().charAt(0).toUpperCase() || 'C';
        const panelUrl = group.items[0]?.url || 'https://www.linkedin.com/jobs/';
        const hasScored = group.items.some(j => j.fitAssessed || j.fit > 0);
        const rationale = `Rank #${rankNum}: ${pinned ? 'Pinned priority, ' : ''}${shortlistedCount ? `${shortlistedCount} shortlisted, ` : ''}${hasScored ? `best fit ${group.topFit}/100` : 'unscored'} across ${plural(group.items.length, 'role')}`;
        const rankBadge = pill(
          hasScored ? `#${rankNum} · ${group.topFit}/100` : `#${rankNum} · Unscored`,
          !hasScored ? 'grey' : group.topFit >= 80 ? 'green' : 'violet',
        );
        rankBadge.title = rationale;

        const primaryCta =
          refs > 0
            ? button('Referrers →', 'btn btn-sm btn-primary', () => ctx.go('referrals'))
            : button('Side Panel →', 'btn btn-sm btn-primary', () => ctx.openPanel(panelUrl));

        return div('company-group', [
          div('company-group-head', [
            div('company-group-left', [
              div('company-monogram', [monogram]),
              div('row-title', [
                div('inline', [text('span', 'cell-strong', group.name), rankBadge, pinned ? pill('Pinned', 'violet') : null]),
                text(
                  'div',
                  'cell-muted',
                  `${plural(group.items.length, 'role')}${shortlistedCount ? ` · ${shortlistedCount} shortlisted` : ''} · ${refs ? plural(refs, 'referrer') : 'No referrers yet'}`,
                ),
              ]),
            ]),
            div('inline', [primaryCta, companyOverflowMenu(group.name, pinned, panelUrl, ctx)]),
          ]),
          div(
            'company-group-rows',
            group.items.map(j => row(j, ctx, queuedUrls, pinnedSet)),
          ),
        ]);
      });

    const pager = paginateControls(shown.length, currentPage, PAGE_SIZE, next => {
      currentPage = next;
      drawRows();
    });
    rowsHost.replaceChildren(...cards, ...(pager ? [pager] : []));
  };
  drawRows();
  const selected = openJob ? all.find(j => j.id === openJob) : undefined;

  const sortSelect = el('select', { class: 'btn btn-sm', 'aria-label': 'Sort jobs' }, [
    el('option', { value: 'fit', text: 'Sort: Best fit' }),
    el('option', { value: 'newest', text: 'Sort: Newest' }),
    el('option', { value: 'company', text: 'Sort: Company' }),
  ]) as HTMLSelectElement;
  sortSelect.value = sortBy;
  sortSelect.addEventListener('change', () => {
    sortBy = sortSelect.value as SortBy;
    currentPage = 1;
    drawRows();
  });

  const filterBar = div('filter-bar', [
    tabs,
    sortSelect,
    searchBar({
      placeholder: 'Filter by role, company, location…',
      value: query,
      ariaLabel: 'Filter discovered jobs',
      onInput: val => {
        query = val;
        currentPage = 1;
        drawRows();
      },
    }),
  ]);

  const exportCsv = (): void => {
    const header = ['Company', 'Title', 'Location', 'Fit', 'Status', 'URL'];
    const lines = [
      header.join(','),
      ...all.map(j =>
        [j.company, j.title, j.location, String(j.fit), j.judgement || 'discovered', j.url]
          .map(v => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `referral-scout-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    ctx.inform(`Exported ${all.length} jobs to CSV.`);
  };

  const list = card('Discovered jobs', {
    sub: 'Eligibility first, then how well your evidence matches. Click any title to open the posting.',
    link: div('inline', [
      button('Export CSV', 'btn-link', exportCsv),
      button('Re-check against my profile', 'btn-link', () => ctx.run({ kind: 'workspace', action: 'requalify' })),
    ]),
    body: [filterBar, rowsHost],
  });

  const side = selected
    ? opportunityWorkspace(selected, ctx, () => {
        openJob = null;
        ctx.redraw();
      })
    : card('Why a job is here', {
        body: [
          div('note note-violet', [
            text(
              'p',
              '',
              'Eligibility is a gate, not a low score. A role you cannot hold is never shown as a strong match, whatever the overlap looks like.',
            ),
          ]),
          div('note', [
            text(
              'p',
              '',
              'A requirement marked “not found” means it is not in your profile — not that you cannot do it. Adding it to your profile changes the shortlist.',
            ),
          ]),
          text('p', 'cell-muted', 'Pick “Why?” on any job to see its evidence.'),
        ],
      });

  page.append(div('grid split', [list, side]));

  if (
    ctx.workspace &&
    !ctx.workspace.connections.linkedin &&
    !ctx.workspace.cv.hasText &&
    !ctx.workspace.profile.skills.length &&
    !ctx.workspace.profile.employment.some(e => e.technologies.length) &&
    !ctx.workspace.profile.projects.some(p => p.skills.length)
  )
    page.append(
      div('banner banner-note', [
        icon('info', 18),
        'Your profile has limited structured skills evidence. Referral Scout will still use your LinkedIn/CV context for ChatGPT ranking when available; if ChatGPT cannot be reached, fit scores may remain unassessed rather than being invented.',
      ]),
    );
  return page;
}

export const jobsHeader = (ctx: Ctx): { title: string; sub: string; actions: HTMLElement[] } => {
  const shortlisted = (ctx.workspace?.jobs ?? []).filter(j => j.judgement === 'shortlisted').length;
  return {
    title: 'Jobs',
    sub: 'LinkedIn Jobs discovery, ranked against your CV and LinkedIn background. Each result shows why it matches and what is uncertain.',
    actions: [
      button(
        ctx.workspace?.jobSearch?.status === 'finding' ? 'Searching for jobs…' : 'Find jobs on LinkedIn',
        'btn btn-primary',
        () => ctx.runNetwork({ kind: 'network', action: 'findJobs' }),
        { disabled: ctx.workspace?.jobSearch?.status === 'finding' },
      ),
      shortlisted
        ? button(`Queue ${shortlisted} shortlisted`, 'btn', async () => {
            await ctx.run({ kind: 'workspace', action: 'enqueueShortlisted' });
            ctx.go('applications');
          })
        : button('Open application queue', 'btn', () => ctx.go('applications')),
      button('Profile', 'btn', () => ctx.go('profile')),
    ],
  };
};

export const shortlistedCount = (rows: readonly JobRow[]): number => rows.filter(j => j.judgement === 'shortlisted').length;
export const describeTier = (tier: string): string =>
  tier === 'strong' ? 'Strong match' : tier === 'possible' ? 'Possible' : tier === 'blocked' ? 'Not eligible' : 'Weak match';
export const plurals = plural;
