import { expect, it, describe } from 'vitest';
import { matchSpecializations, SPECIALIZATIONS } from '../src/shared/specializations';

const ALL = SPECIALIZATIONS.map(s => s.id);

describe('matchSpecializations', () => {
  it('returns nothing when no qualification is selected', () => {
    expect(matchSpecializations('Preferred: MBA or PGDM in Marketing', [])).toEqual([]);
  });

  it('flags MBA / PGDM from the description', () => {
    expect(matchSpecializations('Preferred qualification: MBA or PGDM in Marketing', ['mba'])).toEqual(['MBA/PGDM']);
    expect(matchSpecializations('An M.B.A. is a plus', ['mba'])).toEqual(['MBA/PGDM']);
  });

  it('flags B.Tech CS/IT from branch names, and only the groups selected', () => {
    expect(matchSpecializations('B.Tech in Computer Science or Information Technology', ['btech-cs'])).toEqual(['B.Tech CS/IT']);
    // A plain B.Tech also satisfies the "any branch" group, so selecting both returns both, in list order.
    expect(matchSpecializations('B.Tech in Computer Science', ['btech-cs', 'btech-other'])).toEqual(['B.Tech CS/IT', 'B.Tech/B.E.']);
  });

  it('does not treat the ordinary word "be" as a B.E. degree', () => {
    expect(matchSpecializations('You will be responsible for the roadmap.', ['btech-other'])).toEqual([]);
    expect(matchSpecializations('B.E. in Mechanical Engineering required', ['btech-other'])).toEqual(['B.Tech/B.E.']);
  });

  it('does not treat the ordinary word "me" as an M.E. / M.Tech degree', () => {
    expect(matchSpecializations('Please contact me for more details', ['mtech'])).toEqual([]);
    expect(matchSpecializations('M.Tech in VLSI preferred', ['mtech'])).toEqual(['M.Tech/M.E.']);
  });

  it('flags commerce qualifications by full name regardless of cue', () => {
    expect(matchSpecializations('Qualified Chartered Accountant (CA) required', ['commerce'])).toEqual(['CA/CS/CMA']);
    expect(matchSpecializations('B.Com or M.Com graduates welcome', ['commerce'])).toEqual(['CA/CS/CMA']);
  });

  it('only accepts the ambiguous "CA" abbreviation inside a qualification context', () => {
    // "CA" as a place, no qualification wording -> not a match
    expect(matchSpecializations('Our office is in CA. Great team culture.', ['commerce'])).toEqual([]);
    // "CA" with qualification wording -> a match
    expect(matchSpecializations('Pursuing CA Inter, final year', ['commerce'])).toEqual(['CA/CS/CMA']);
  });

  it('only accepts "CPA" for finance when it reads like a qualification, not the marketing metric', () => {
    expect(matchSpecializations('Optimise CPA and ROAS across paid channels', ['finance-cert'])).toEqual([]);
    expect(matchSpecializations('CPA or CFA qualification preferred', ['finance-cert'])).toEqual(['CFA/FRM/CPA']);
  });

  it('returns matches in a stable order across groups', () => {
    const text = 'MBA preferred; CFA a plus; B.Tech Computer Science background welcome';
    expect(matchSpecializations(text, ALL)).toEqual(['MBA/PGDM', 'B.Tech CS/IT', 'B.Tech/B.E.', 'CFA/FRM/CPA']);
  });
});
