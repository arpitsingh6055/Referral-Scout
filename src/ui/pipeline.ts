/**
 * Outcome tracking: how far each company has got on the way to a referral.
 * Asked -> Accepted -> Replied -> Referred -> Applied. The first two are known from LinkedIn; the last three are
 * marked by the person with one press, because only they know what was said.
 */
import type { NetworkContact, NetworkRequest, NetworkState } from '../shared/network';
import type { ReferralJob } from '../shared/referral';

export interface Kit {
  node: <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => HTMLElementTagNameMap[K];
  button: (text: string, action: () => Promise<void>, className?: string) => HTMLButtonElement;
  act: (data: NetworkRequest, done?: string) => Promise<void>;
}
export const STAGES = ['Asked', 'Accepted', 'Replied', 'Referred', 'Applied'] as const;

export const wasAsked = (p: NetworkContact): boolean => p.requestedAt > 0 || p.messagedAt > 0 || !!p.acceptedAt || ['pending', 'messaged'].includes(p.state);
/** Someone already connected counts as accepted from the moment they are asked. */
export const hasAccepted = (p: NetworkContact): boolean => !!p.acceptedAt || (!!p.direct && p.messagedAt > 0);

/** Counts for one set of people and jobs, in the order of STAGES. */
export function stageCounts(people: NetworkContact[], jobs: ReferralJob[]): number[] {
  return [people.filter(wasAsked).length, people.filter(hasAccepted).length, people.filter(p => p.outcome).length,
    people.filter(p => p.outcome === 'referred').length, jobs.filter(j => j.applied).length];
}
export const referralPeople = (s: NetworkState): NetworkContact[] => s.contacts.filter(p => p.referralJob);

/** One row per company: how many people are at each stage, and whether the job has been applied for. */
export function board(s: NetworkState, kit: Kit): HTMLElement | null {
  const jobs = s.referralJobs ?? []; if (!jobs.length) return null;
  const { node } = kit, card = node('section', '', 'card board'), grid = node('div', '', 'board-grid');
  card.append(node('h2', 'Pipeline', 'card-title'), node('p', 'How far each company has got. Mark replies and referrals on the person, and “I applied” on the job.', 'card-sub'));
  grid.append(node('span', 'Company', 'board-head'), ...STAGES.map(label => node('span', label, 'board-head')));
  const seen = new Set<string>();
  for (const job of jobs) {
    const key = job.company.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    const same = jobs.filter(j => j.company.toLowerCase() === key), urls = new Set(same.map(j => j.url));
    const counts = stageCounts(s.contacts.filter(p => !!p.referralJob && urls.has(p.referralJob)), same);
    const name = node('span', job.company, 'board-company'); name.title = same.map(j => j.title).join(', ');
    grid.append(name, ...counts.map((n, i) => node('span', i === 4 ? (n ? '✓' : '·') : n ? String(n) : '·', `board-cell${n ? ' on' : ''}${i >= 3 && n ? ' win' : ''}`)));
  }
  card.append(grid);
  return card;
}

/** "What happened?" on a person who has been asked: one press to mark it, the same press again to clear it. */
export function outcomeRow(p: NetworkContact, kit: Kit): HTMLElement | null {
  if (!wasAsked(p)) return null;
  const { node, button, act } = kit, row = node('div', '', 'outcome');
  row.append(node('span', 'What happened?', 'field-help'));
  for (const [value, label] of [['replied', 'They replied'], ['referred', 'Will refer me'], ['declined', 'Can’t help']] as const) {
    const on = p.outcome === value, b = button(label, () => act({ kind: 'network', action: 'outcome', url: p.url, outcome: on ? null : value }), `btn sm choice${on ? ' on' : ''}`);
    b.setAttribute('aria-pressed', String(on)); row.append(b);
  }
  return row;
}
export const outcomeLabels: Record<NonNullable<NetworkContact['outcome']>, string> = { replied: 'Replied', referred: 'Will refer you', declined: 'Can’t help' };
