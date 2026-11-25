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
import { ago, button, card, div, el, emptyState, icon, metric, pill, plural, searchBar, text } from '../dom';
import type { Ctx } from '../shell';
import type { JobRow } from '../../../background/workspace';

type Filter = 'strong' | 'possible' | 'blocked' | 'shortlisted' | 'all';

let filter: Filter = 'all';
let query = '';
let openJob: string | null = null;

const TIER_TONE: Record<string, 'green' | 'violet' | 'grey' | 'red'> = {
  strong: 'green',
  possible: 'violet',
  weak: 'grey',
  blocked: 'red',
};
const ELIGIBILITY_TONE: Record<string, 'green' | 'amber' | 'red'> = { eligible: 'green', unknown: 'amber', ineligible: 'red' };

const MATCH: Record<Filter, (j: JobRow) => boolean> = {
  strong: j => j.tier === 'strong',
  possible: j => j.tier === 'possible' || j.tier === 'weak',
  blocked: j => j.tier === 'blocked',
  shortlisted: j => j.judgement === 'shortlisted',
  all: () => true,
};

function evidenceList(job: JobRow): HTMLElement {
  if (!job.evidence.length)
    return text('p', 'cell-muted', 'This posting did not list its requirements separately, so there is nothing to match against yet.');
  return div(
    '',
    job.evidence.map(e =>
      div('rule-row', [
        div('', [
          text('div', 'rule-name', e.requirement),
          text(
            'div',
            'rule-note',
            e.state === 'met'
              ? `Matched with ${e.matchedWith ?? 'your profile'}`
              : e.state === 'missing'
                ? 'Not found in your profile'
                : 'Could not be read from the posting',
          ),
        ]),
        pill(
          e.state === 'met' ? 'Met' : e.state === 'missing' ? 'Not found' : 'Unclear',
          e.state === 'met' ? 'green' : e.state === 'missing' ? 'amber' : 'grey',
        ),
      ]),
    ),
  );
}

function detail(job: JobRow, ctx: Ctx, queuedRefs: Set<string>, pinnedSet: Set<string>): HTMLElement {
  const blocked = job.tier === 'blocked';
  const alreadyQueued = queuedRefs.has(job.id) || queuedRefs.has(job.url);
  const companyPinned = pinnedSet.has(canonicalCompany(job.company));
  return div('card', [
    div('card-head', [
      div('', [
        text('div', 'card-title', `${job.title} — ${job.company}`),
        text('div', 'card-sub', `${job.location} · ${job.source} · ${job.applyType}`),
      ]),
      div('card-link', [
        button('Close', 'btn-link', () => {
          openJob = null;
          ctx.redraw();
        }),
      ]),
    ]),

    div('inline', [
      pill(job.fitAssessed ? `Fit ${job.fit}/100` : 'Fit not assessed', TIER_TONE[job.tier] ?? 'grey'),
      pill(
        job.eligibility === 'eligible' ? 'Eligible' : job.eligibility === 'ineligible' ? 'Not eligible' : 'Eligibility unknown',
        ELIGIBILITY_TONE[job.eligibility] ?? 'grey',
      ),
      pill(
        job.freshness === 'fresh'
          ? 'Posted recently'
          : job.freshness === 'stale'
            ? 'Old or closed'
            : job.freshness === 'recent'
              ? 'Still recent'
              : 'Age unknown',
        job.freshness === 'stale' ? 'red' : 'grey',
      ),
      companyPinned ? pill('Company pinned', 'violet') : null,
    ]),

    blocked ? div('note note-amber', [text('p', '', `Not eligible: ${job.rejectionReasons.join(' ')}`)]) : null,

    text('h3', 'card-title', 'Can you hold this job?'),
    div(
      '',
      job.checks.map(c =>
        div('rule-row', [
          div('', [text('div', 'rule-name', c.label), text('div', 'rule-note', c.reason)]),
          pill(c.state === 'eligible' ? 'Yes' : c.state === 'ineligible' ? 'No' : 'Unknown', ELIGIBILITY_TONE[c.state] ?? 'grey'),
        ]),
      ),
    ),

    text('h3', 'card-title', 'How well does it match?'),
    job.aiWhy
      ? div('note note-violet', [text('p', '', `${job.fitSource === 'chatgpt' ? 'ChatGPT assessment' : 'Profile evidence'}: ${job.aiWhy}`)])
      : null,
    evidenceList(job),

    job.preferenceNotes.length
      ? div('note note-violet', [text('p', '', `Against what you asked for: ${job.preferenceNotes.join(' ')}`)])
      : null,

    div('inline', [
      job.judgement === 'shortlisted'
        ? button('Remove from shortlist', 'btn', () => ctx.run({ kind: 'workspace', action: 'judgeJob', id: job.id, judgement: 'none' }))
        : button('Shortlist', 'btn btn-primary', () =>
            ctx.run({ kind: 'workspace', action: 'judgeJob', id: job.id, judgement: 'shortlisted' }),
          ),
      alreadyQueued
        ? button('View in queue', 'btn', () => ctx.go('applications'))
        : button('Add to application queue', 'btn', () =>
            ctx.run({
              kind: 'campaign',
              action: 'enqueue',
              jobs: [
                {
                  jobId: job.id,
                  url: job.url,
                  company: job.company,
                  title: job.title,
                  location: job.location,
                  fit: job.fit,
                  route: job.applyType === 'easy-apply' ? 'easy-apply' : job.applyType === 'ats' ? 'external' : 'unknown',
                  source: job.source,
                  ...(job.postedAt ? { postedAt: job.postedAt } : {}),
                },
              ],
            }),
          ),
      job.judgement === 'rejected'
        ? button('Restore job', 'btn', () => ctx.run({ kind: 'workspace', action: 'judgeJob', id: job.id, judgement: 'none' }))
        : button('Not for me', 'btn', () => ctx.run({ kind: 'workspace', action: 'judgeJob', id: job.id, judgement: 'rejected' })),
      ctx.view.campaign
        ? button(companyPinned ? 'Pinned ★' : 'Pin company', companyPinned ? 'btn btn-primary' : 'btn', () =>
            ctx.run({ kind: 'campaign', action: 'pinCompany', company: job.company, pinned: !companyPinned }),
          )
        : null,
      button('Open posting', 'btn', () => {
        window.open(job.url, '_blank', 'noopener');
      }),
    ]),
  ]);
}

function row(job: JobRow, ctx: Ctx, queuedRefs: Set<string>, pinnedSet: Set<string>): HTMLElement {
  const met = job.evidence.filter(e => e.state === 'met').length;
  const inQueue = queuedRefs.has(job.id) || queuedRefs.has(job.url);
  const companyPinned = pinnedSet.has(canonicalCompany(job.company));
  return div('row row-queue', [
    div('row-title', [
      div('inline', [text('span', 'row-company', job.company), companyPinned ? pill('Pinned', 'violet') : null]),
      Object.assign(text('div', 'cell-strong', job.title), { title: job.title }),
      text('div', 'cell-muted', `${job.location}${job.evidence.length ? ` · ${met} of ${job.evidence.length} requirements matched` : ''}`),
    ]),
    div('col-hide', [pill(job.source.replace(/ Jobs$/, ''), 'grey')]),
    div('', [pill(job.tier === 'blocked' ? 'Not eligible' : `Fit ${job.fit}`, TIER_TONE[job.tier] ?? 'grey')]),
    div('col-hide', [text('div', 'cell-muted', job.postedAt ? ago(job.postedAt) : 'date unknown')]),
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
        `Search complete: ${ctx.workspace.jobSearch.found} jobs are ready for review. Open each job's reasoning and shortlist only the roles you want.`,
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
      .sort(
        (a, b) =>
          Number(pinnedSet.has(canonicalCompany(b.company))) - Number(pinnedSet.has(canonicalCompany(a.company))) || b.rank - a.rank,
      );
    if (!shown.length) {
      rowsHost.replaceChildren(text('p', 'cell-muted', 'No matching jobs in this view.'));
      return;
    }

    const groups = new Map<string, { key: string; name: string; items: JobRow[]; topFit: number }>();
    for (const j of shown) {
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
        const unqueuedShortlisted = group.items.filter(
          j => j.judgement === 'shortlisted' && !queuedUrls.has(j.id) && !queuedUrls.has(j.url),
        ).length;
        const monogram = group.name.trim().charAt(0).toUpperCase() || 'C';
        const panelUrl = group.items[0]?.url || 'https://www.linkedin.com/jobs/';
        const rationale = `Rank #${rankNum}: ${pinned ? 'Pinned priority, ' : ''}${shortlistedCount ? `${shortlistedCount} shortlisted, ` : ''}best fit ${group.topFit}/100 across ${plural(group.items.length, 'role')}`;
        const rankBadge = pill(`#${rankNum} · ${group.topFit}/100`, group.topFit >= 80 ? 'green' : 'violet');
        rankBadge.title = rationale;

        const primaryCta =
          unqueuedShortlisted > 0
            ? button('Queue shortlisted', 'btn btn-sm btn-primary', () => ctx.run({ kind: 'workspace', action: 'enqueueShortlisted' }))
            : refs > 0
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

    rowsHost.replaceChildren(...cards);
  };
  drawRows();
  const selected = openJob ? all.find(j => j.id === openJob) : undefined;

  const filterBar = div('filter-bar', [
    tabs,
    searchBar({
      placeholder: 'Filter by role, company, location…',
      value: query,
      ariaLabel: 'Filter discovered jobs',
      onInput: val => {
        query = val;
        drawRows();
      },
    }),
  ]);

  const list = card('Discovered jobs', {
    sub: 'Eligibility first, then how well your evidence matches. Effort only separates jobs that are otherwise equal.',
    link: button('Re-check against my profile', 'btn-link', () => ctx.run({ kind: 'workspace', action: 'requalify' })),
    body: [filterBar, rowsHost],
  });

  const side = selected
    ? detail(selected, ctx, queuedUrls, pinnedSet)
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
