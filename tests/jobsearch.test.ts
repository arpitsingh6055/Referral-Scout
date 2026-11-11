import { beforeEach, describe, expect, it } from 'vitest';
import { fallbackTerms, fallbackTitles, fill, jobsSearchUrl, planFromReply, scoreJob, shortlist, sizeOf, type FoundJob } from '../src/shared/jobsearch';
import { jobRows } from '../src/parsers/network';
import { rankReferral, referralPlan } from '../src/shared/referral';

beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get(this: HTMLElement) { return this.textContent ?? ''; } }); });

describe('reading the LinkedIn job list (structure checked live, November 2026)', () => {
  const row = (id: string, title: string, company: string, place: string, hint: string) => `<div><div role="button"><div componentkey="job-card-component-ref-${id}"><p>${title} ${title}</p><p>${company}</p><p>${place}</p>${hint ? `<p>${hint}</p>` : ''}<p>Posted 1 month ago</p></div></div><button aria-label="Dismiss ${title} job">x</button></div>`;
  it('reads id, title, company, location and LinkedIn’s "way in" hint from rows that are not links', () => {
    const doc = new DOMParser().parseFromString(`<main>${row('4461594137', 'Operations Associate, Apprenticeship', 'Stripe', 'Bengaluru (On-site)', '256 company alumni work here')}${row('4478433477', 'Intern - Operations', 'OnGrid', 'Gurugram (On-site)', '2 school alumni work here')}${row('4478433477', 'Intern - Operations', 'OnGrid', 'Gurugram', '')}</main>`, 'text/html');
    expect(jobRows(doc)).toEqual([
      { id: '4461594137', title: 'Operations Associate, Apprenticeship', company: 'Stripe', location: 'Bengaluru (On-site)', insight: '256 company alumni work here' },
      { id: '4478433477', title: 'Intern - Operations', company: 'OnGrid', location: 'Gurugram (On-site)', insight: '2 school alumni work here' }]);
  });
});

describe('planning the search', () => {
  it('searches parallel titles, not only the exact target, and keeps the level', () => {
    expect(fallbackTerms(['Operations intern'])).toEqual(['Operations intern', 'supply chain intern', 'logistics intern', 'procurement intern', 'business operations intern', 'program management intern']);
    expect(fallbackTerms(['Product Manager'])).toEqual(expect.arrayContaining(['Product Manager', 'associate product manager', 'product analyst']));
  });
  it('uses LinkedIn’s location filter in the job search address', () => {
    const url = new URL(jobsSearchUrl('supply chain intern', 'India'));
    expect([url.pathname, url.searchParams.get('keywords'), url.searchParams.get('geoId')]).toEqual(['/jobs/search-results/', 'supply chain intern', '102713980']);
    expect(new URL(jobsSearchUrl('ops intern', 'Pune')).searchParams.get('keywords')).toBe('ops intern Pune');
  });
  it('classes companies by size from LinkedIn’s own wording', () => {
    expect([sizeOf('1K-5K employees'), sizeOf('10K+ employees'), sizeOf('51-200 employees'), sizeOf('201-500 employees'), sizeOf('2-10 employees'), sizeOf('')]).toEqual(['large', 'large', 'small', 'mid', 'small', 'mid']);
  });
  it('never targets founders or directors at a large company, and does at a small one', () => {
    const titles = fallbackTitles(['Operations intern']);
    expect(titles.large.join(' ')).not.toMatch(/founder|ceo|director/i);
    expect(titles.large).toEqual(expect.arrayContaining(['recruiter', 'HRBP', 'team lead', 'senior consultant', 'senior associate']));
    expect(titles.small).toEqual(expect.arrayContaining(['founder', 'co-founder']));
  });
  it('takes ChatGPT’s plan but refuses unsafe wording and unknown placeholders', () => {
    const plan = planFromReply({ searchTerms: ['supply chain intern', 'Operations Intern'], referralTitles: { large: ['Founder', 'Recruiter'], mid: [], small: ['Founder'] },
      note: 'Hi {firstName}, see https://evil.example', ask: 'Hi {firstName}, I’m applying for {title} at {company}: {jobUrl} Could you refer me?', followUp: 'Hi {name}, thanks {company} {firstName}' }, ['Operations intern'], 5);
    expect(plan.terms).toEqual(['Operations intern', 'supply chain intern']);
    expect(plan.titles.large).toEqual(['Recruiter']);
    expect(plan.titles.mid.length).toBeGreaterThan(0); // empty list from the model: built-in rule
    expect(plan.note).toBeUndefined(); expect(plan.followUp).toBeUndefined();
    expect(fill(plan.ask!, { firstName: 'Asha', myFirstName: 'Arpit', title: 'Ops Intern', company: 'Stripe', jobUrl: 'https://www.linkedin.com/jobs/view/1/' })).toBe('Hi Asha, I’m applying for Ops Intern at Stripe: https://www.linkedin.com/jobs/view/1/ Could you refer me?');
  });
});

describe('choosing companies', () => {
  const job = (id: string, title: string, company: string, insight = ''): FoundJob => ({ id, url: `https://www.linkedin.com/jobs/view/${id}/`, title, company, location: '', insight, term: 'operations intern', score: 0, picked: false });
  it('ranks an internship that matches and has a way in above a senior role, and offers one job per company', () => {
    const roles = ['Operations intern'], terms = ['operations intern', 'supply chain intern'];
    const scored = [job('1', 'Operations Intern', 'Stripe', '3 connections work here'), job('2', 'Supply Chain Intern', 'Stripe'), job('3', 'Senior Operations Manager', 'Acme'), job('4', 'Operations Intern', 'Lane'), job('5', 'Operations Intern', 'Old Co')]
      .map(j => ({ ...j, score: scoreJob(j, roles, terms) }));
    const list = shortlist(scored, ['Old Co Pvt Ltd']);
    expect(list.map(j => [j.company, j.id, j.picked])).toEqual([['Stripe', '1', true], ['Lane', '4', true], ['Acme', '3', false]]);
  });
});

describe('who to ask depends on the size of the company', () => {
  const big = { url: 'https://www.linkedin.com/jobs/view/1/', title: 'Operations Intern', company: 'Infosys', mode: 'referral' as const, companyId: '1', size: 'large' as const };
  it('at a large company drops strangers who are founders, directors or VPs, and keeps planned titles such as a senior associate', () => {
    const titles = ['recruiter', 'team lead', 'senior associate'];
    expect(rankReferral({ headline: 'Vice President, Operations', degree: 2 }, big, true, titles)).toBeNull();
    expect(rankReferral({ headline: 'Director of Engineering', degree: 3 }, big, true, titles)).toBeNull();
    expect(rankReferral({ headline: 'Senior Associate - Delivery', degree: 3 }, big, true, titles)).not.toBeNull();
    expect(rankReferral({ headline: 'Director - Talent Acquisition', degree: 2 }, big, true, titles)).toMatchObject({ kind: 'recruiter' }); // people who hire are always worth asking
    expect(rankReferral({ headline: 'Vice President, Operations', degree: 1 }, big, true, titles)).not.toBeNull(); // someone already known is different
  });
  it('searches the planned titles with the company filter, in short queries', () => {
    const plan = referralPlan(big, ['recruiter', 'talent acquisition', 'HR', 'HRBP', 'campus recruiter', 'team lead', 'senior consultant']);
    expect(plan.map(s => s.network.join())).toEqual(['F', 'F', 'S,O', 'S,O']);
    expect(plan[2]!.keywords).toBe('(recruiter OR "talent acquisition" OR HR OR HRBP OR "campus recruiter")');
    expect(plan[3]!.keywords).toBe('("team lead" OR "senior consultant")');
  });
});
