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

import { ago, button, card, div, empty, icon, metric, pill, plural, text } from '../dom';
import type { Ctx } from '../shell';
import type { JobRow } from '../../../background/workspace';

type Filter = 'strong' | 'possible' | 'blocked' | 'shortlisted' | 'all';

let filter: Filter = 'strong';
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

function detail(job: JobRow, ctx: Ctx): HTMLElement {
  const blocked = job.tier === 'blocked';
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
      pill(`Fit ${job.fit}/100`, TIER_TONE[job.tier] ?? 'grey'),
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
      button('Add to application queue', 'btn', () =>
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
      button('Not for me', 'btn', () => ctx.run({ kind: 'workspace', action: 'judgeJob', id: job.id, judgement: 'rejected' })),
      button('Open posting', 'btn', () => {
        window.open(job.url, '_blank', 'noopener');
      }),
    ]),
  ]);
}

function row(job: JobRow, ctx: Ctx): HTMLElement {
  const met = job.evidence.filter(e => e.state === 'met').length;
  return div('row row-queue', [
    div('row-title', [
      text('div', 'row-company', job.company),
      text('div', 'cell-strong', job.title),
      text('div', 'cell-muted', `${job.location}${job.evidence.length ? ` · ${met} of ${job.evidence.length} requirements matched` : ''}`),
    ]),
    div('col-hide', [pill(job.source.replace(/ Jobs$/, ''), 'grey')]),
    div('', [pill(job.tier === 'blocked' ? 'Not eligible' : `Fit ${job.fit}`, TIER_TONE[job.tier] ?? 'grey')]),
    div('col-hide', [text('div', 'cell-muted', job.postedAt ? ago(job.postedAt) : 'date unknown')]),
    div('inline', [
      job.judgement === 'shortlisted' ? pill('Shortlisted', 'green') : null,
      button(openJob === job.id ? 'Hide' : 'Why?', 'btn btn-sm', () => {
        openJob = openJob === job.id ? null : job.id;
        ctx.redraw();
      }),
    ]),
  ]);
}

export function jobs(ctx: Ctx): HTMLElement {
  const all = ctx.workspace?.jobs ?? [];
  if (!all.length)
    return empty(
      'No jobs discovered yet',
      'Run a search from the side panel on LinkedIn, or paste a job link. Everything found arrives here with its match evidence, and you choose what goes into the application queue.',
      button('Open the side panel', 'btn btn-primary', () => ctx.openPanel()),
    );

  const counts = {
    strong: all.filter(MATCH.strong).length,
    possible: all.filter(MATCH.possible).length,
    blocked: all.filter(MATCH.blocked).length,
    shortlisted: all.filter(MATCH.shortlisted).length,
    all: all.length,
  };

  const page = div('stack');
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

  const shown = all.filter(MATCH[filter]);
  const selected = openJob ? all.find(j => j.id === openJob) : undefined;

  const list = card('Discovered jobs', {
    sub: 'Eligibility first, then how well your evidence matches. Effort only separates jobs that are otherwise equal.',
    link: button('Re-check against my profile', 'btn-link', () => ctx.run({ kind: 'workspace', action: 'requalify' })),
    body: [
      tabs,
      shown.length
        ? div(
            'rows',
            shown.map(j => row(j, ctx)),
          )
        : text('p', 'cell-muted', 'Nothing in this view.'),
    ],
  });

  const side = selected
    ? detail(selected, ctx)
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

  if (ctx.workspace && !ctx.workspace.profile.skills.length)
    page.append(
      div('banner banner-error', [
        icon('alert', 18),
        'No skills are saved in your profile yet, so nothing can be matched against. Add a few on the Profile screen and the shortlist becomes meaningful.',
      ]),
    );
  return page;
}

export const jobsHeader = (ctx: Ctx): { title: string; sub: string; actions: HTMLElement[] } => {
  const shortlisted = (ctx.workspace?.jobs ?? []).filter(j => j.judgement === 'shortlisted').length;
  return {
    title: 'Jobs',
    sub: 'Everything discovered, why it matches and what is missing.',
    actions: [
      shortlisted
        ? button(`Queue ${shortlisted} shortlisted`, 'btn btn-primary', async () => {
            await ctx.run({ kind: 'workspace', action: 'enqueueShortlisted' });
            ctx.go('applications');
          })
        : button('Open the queue', 'btn', () => ctx.go('applications')),
      button('Profile', 'btn', () => ctx.go('profile')),
    ],
  };
};

export const shortlistedCount = (rows: readonly JobRow[]): number => rows.filter(j => j.judgement === 'shortlisted').length;
export const describeTier = (tier: string): string =>
  tier === 'strong' ? 'Strong match' : tier === 'possible' ? 'Possible' : tier === 'blocked' ? 'Not eligible' : 'Weak match';
export const plurals = plural;
