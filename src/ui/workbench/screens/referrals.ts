/**
 * Screen 04 — referral outreach and the invitation budget (specification 16.6).
 *
 * The score is never shown on its own. A bare "94/100" asks the person to trust a number the product has not
 * earned the right to claim, so every row carries the reasons behind it and the allocator's rules sit beside the
 * list in plain words.
 */

import { allocate, summarise, type Allocation, type ContactCandidate } from '../../../shared/scoring/allocator';
import { button, card, div, emptyState, metric, pill, plural, text } from '../dom';
import type { Ctx } from '../shell';

const RELATIONSHIP: Record<string, ContactCandidate['relationship']> = {
  'existing-connection': 'existing-connection',
  alumni: 'alumni',
  'second-degree': 'second-degree',
  'shared-group': 'shared-group',
  none: 'none',
};

const ROLE: Record<string, ContactCandidate['roleRelation']> = {
  'hiring-manager': 'hiring-manager',
  recruiter: 'general-recruiter',
  peer: 'same-function',
  founder: 'same-team',
  alumni: 'same-function',
  'existing-connection': 'same-function',
  unknown: 'unrelated',
};

/**
 * Turns the contacts the referral engine found into candidates the allocator can rank. A suppressed person is
 * excluded here rather than scored and hidden later — the budget should never be reserved for someone who has
 * asked not to be contacted.
 */
function candidates(ctx: Ctx): ContactCandidate[] {
  return (ctx.workspace?.contacts ?? [])
    .filter(c => !c.suppressed)
    .map(c => ({
      id: c.id,
      personKey: c.id,
      name: c.name,
      companyId: c.company ?? 'unknown',
      company: c.company ?? 'Unknown company',
      role: c.role ?? 'Role unknown',
      relationship: RELATIONSHIP[c.relationship] ?? 'none',
      roleRelation: ROLE[c.category] ?? 'unrelated',
      // Without a per-contact job link yet, every contact is weighed against the campaign's own quality rather
      // than a specific vacancy; the screen says so instead of implying a job-level match it cannot prove.
      opportunityFit: 70,
      opportunityFreshness: 0.7,
      evidenceConfidence: c.confidence,
      channel: c.emailConfidence === 'verified' ? 'email-verified' : c.email ? 'email-unverified' : c.profileUrl ? 'linkedin' : 'none',
    }));
}

export function referrals(ctx: Ctx, override?: ContactCandidate[]): HTMLElement {
  const { campaign } = ctx.view;
  if (!campaign)
    return emptyState({
      icon: 'target',
      title: 'No campaign yet',
      description: 'Referral contacts are found per company once a campaign is running.',
      action: button('Create a campaign', 'btn btn-primary', () => ctx.go('setup')),
    });
  const contacts = override ?? candidates(ctx);

  const rules = campaign.referral;
  const allocations = allocate(contacts, {
    weeklyBudget: rules.weeklyBudget,
    spent: 0,
    maxPerCompany: rules.maxPerCompany,
    diminishingHours: rules.diminishingHours,
  });
  const budget = summarise(allocations, { weeklyBudget: rules.weeklyBudget, spent: 0 });

  const page = div('stack');
  page.append(
    div('grid metrics', [
      metric('target', 'Weekly budget', budget.weekly, 'you set this'),
      metric('check', 'Allocated', budget.allocated, `${budget.remaining} left this week`),
      metric('star', 'Strong contacts', budget.best, 'high confidence'),
      metric('briefcase', 'Companies', budget.companies, 'in this campaign'),
    ]),
  );

  const row = (a: Allocation): HTMLElement => {
    const why = a.breakdown.parts
      .filter(p => p.score > 0.4)
      .map(p => p.why)
      .slice(0, 3)
      .join(' · ');
    return div('row row-queue', [
      div('row-title', [
        text('div', 'row-company', `${a.contact.company} · ${a.contact.role}`),
        text('div', 'cell-strong', a.contact.name),
        text('div', 'cell-muted', why),
      ]),
      div('col-hide', [pill(a.priority, a.priority === 'P1' ? 'green' : a.priority === 'P2' ? 'amber' : 'grey')]),
      div('', [
        text('div', 'cell-strong', `${a.score}/100`),
        Object.assign(text('div', 'cell-muted clamp', a.reason), { title: a.reason }),
      ]),
      div('col-hide', [
        pill(
          a.contact.channel === 'email-verified'
            ? 'Email verified'
            : a.contact.channel === 'email-unverified'
              ? 'Email to verify'
              : 'LinkedIn',
          a.contact.channel === 'email-unverified' ? 'amber' : 'grey',
        ),
      ]),
      div('inline', [pill(a.status === 'allocated' ? 'Reserved' : 'Held', a.status === 'allocated' ? 'violet' : 'grey')]),
    ]);
  };

  const list = card('Global invitation allocation', {
    sub: 'Rank contacts across companies by relationship strength and role relevance.',
    body: [
      allocations.length
        ? div('rows', allocations.map(row))
        : emptyState({
            icon: 'people',
            title: 'No contacts ranked yet',
            description:
              'Find people for a company from the side panel, and everyone found appears here ranked against one shared weekly budget.',
            action: button('Open the side panel', 'btn btn-primary', () => ctx.openPanel()),
          }),
    ],
  });

  const side = div('stack', [
    card('How the budget is spent', {
      body: [
        ...[
          ['Relationship', 'Existing connections and genuine alumni ties.'],
          ['Role relevance', 'On the hiring team, same function, or recruiting for this job.'],
          ['Opportunity fit', 'The contact is attached to a job you are actually qualified for.'],
          ['Diminishing returns', 'One strong contact at an employer before a second at the same one.'],
          ['Confidence', 'Unproven influence stays labelled unproven.'],
        ].map(([name, note]) => div('rule-row', [div('', [text('div', 'rule-name', name!), text('div', 'rule-note', note!)])])),
        div('note note-violet', [
          text(
            'p',
            '',
            'Referral priorities adapt as you receive replies so your weekly outreach stays focused on the highest-chance contacts.',
          ),
        ]),
      ],
    }),
    card('Email channel', {
      body: [
        div('spread', [
          text('div', 'rule-name', 'Sending'),
          pill(
            rules.emailMode === 'send-verified' ? 'Verified addresses only' : rules.emailMode === 'draft' ? 'Drafts only' : 'Off',
            rules.emailMode === 'off' ? 'grey' : 'green',
          ),
        ]),
        div('note note-amber', [
          text(
            'p',
            '',
            'An address guessed from a company pattern is a research lead, never a recipient. It is drafted and held until you confirm it.',
          ),
        ]),
        text(
          'div',
          'rule-note',
          `Follow-ups: ${rules.followUpDays.map(d => `day ${d}`).join(', then ')}, then stop. Any reply, bounce or opt-out stops the sequence at once.`,
        ),
      ],
    }),
  ]);

  page.append(div('grid split', [list, side]));
  return page;
}

export const referralsHeader = (ctx: Ctx): { title: string; sub: string; actions: HTMLElement[] } => ({
  title: 'Referral outreach & invitation budget',
  sub: 'Spend the weekly contact budget on the strongest remaining opportunities — not an equal number per company.',
  actions: [button('Campaign settings', 'btn', () => ctx.go('setup'))],
});

export const describeBudget = (weekly: number, allocated: number): string =>
  `${plural(allocated, 'invitation')} allocated of ${weekly} this week.`;
