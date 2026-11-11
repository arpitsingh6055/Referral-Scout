import { describe, expect, it } from 'vitest';
import { classify, companyMatches, companyOf, functionWords, locationFits, normalizeCompany, planSearch, searchCombos, MAX_SEARCH_PAGES, suggestTarget } from '../src/shared/targeting';
import { DAY, defaultNoteTemplate, defaultSettings, emptyNetwork, fitNote, nextContact, renderNote, withinActiveHours, type NetworkContact } from '../src/shared/network';

const product = { roles: ['Product Management internship'], location: 'India' };
const cat = (headline: string, extra: { degree?: number; location?: string } = {}, ctx = product) => classify({ headline, ...extra }, ctx)?.category ?? null;

describe('who is worth contacting', () => {
  it.each([
    ['Talent Acquisition Specialist at Razorpay', 'recruiter'],
    ['Senior Talent Partner @ Swiggy', 'recruiter'],
    ['Technical Recruiter | Hiring for Product and Engineering', 'recruiter'],
    ['Campus Recruiter at Google', 'recruiter'],
    ['University Relations Manager, Microsoft', 'recruiter'],
    ['HR Business Partner at TCS', 'recruiter'],
    ['HR at a growing startup', 'recruiter'],
    ['People & Culture Lead at Acme', 'recruiter'],
    ['Head of Talent | Fintech', 'recruiter'],
    ['Recruiter | MBA', 'recruiter'],
    ['Co-Founder & CEO at Acme', 'founder'],
    ['Cofounder, Acme Labs', 'founder'],
    ['Founder | ex-Google', 'founder'],
    ['Managing Director at Acme Pvt Ltd', 'founder'],
    ['Head of Product at Zomato', 'leader'],
    ['Director, Product Management | Flipkart', 'leader'],
    ['Group Product Manager at Atlassian', 'leader'],
  ])('accepts %s as %s', (headline, expected) => expect(cat(headline)).toBe(expected));

  it.each([
    'MBA (HR) student at IMT Ghaziabad',
    'PGDM | HR aspirant',
    'Aspiring HR professional | Open to work',
    'Open to work | Recruiter',
    'Seeking product internships',
    'Former CEO at Acme',
    'Ex-Recruiter at Google',
    'Executive Assistant to the CEO',
    "Founder's Office at Acme",
    'Chief of Staff to the CEO',
    'Product Owner at Acme',
    'Lead Generation Specialist',
    'Leadership Coach',
    'Software Engineer at Google',
    'Account Manager at Acme',
    'Product intern at Acme',
    'PGDM (Core) @ IMTG 26-28',
  ])('rejects %s', headline => expect(cat(headline)).toBeNull());

  it('never targets someone who is already a 1st-degree connection', () => expect(cat('Talent Acquisition at Acme', { degree: 1 })).toBeNull());

  it('ranks recruiters above leaders above founders, and 2nd degree above 3rd', () => {
    const score = (h: string, degree?: number) => classify({ headline: h, ...(degree ? { degree } : {}) }, product)!.score;
    expect(score('Talent Acquisition at A')).toBeGreaterThan(score('Head of Product at B'));
    expect(score('Head of Product at B')).toBeGreaterThan(score('Founder at C'));
    expect(score('Founder at C', 2)).toBeGreaterThan(score('Founder at C', 3));
    expect(score('Campus Recruiter at A')).toBeGreaterThan(score('Recruiter at A'));
  });

  it('boosts people at the job company and penalises a different location', () => {
    const base = classify({ headline: 'Recruiter at Razorpay' }, product)!.score;
    expect(classify({ headline: 'Recruiter at Razorpay' }, { ...product, company: 'Razorpay Software Pvt Ltd' })!.score).toBeGreaterThan(base);
    expect(classify({ headline: 'Recruiter at X', location: 'London, United Kingdom' }, product)!.score).toBeLessThan(classify({ headline: 'Recruiter at X', location: 'Pune, Maharashtra, India' }, product)!.score);
  });

  it('only calls someone a team leader when their function matches the target', () => {
    expect(cat('Head of Engineering at Acme')).toBeNull();
    expect(cat('Head of Engineering at Acme', {}, { roles: ['Software Engineering internship'], location: 'India' })).toBe('leader');
  });
});

describe('companies and places', () => {
  it('matches company names across legal suffixes and punctuation', () => {
    expect(companyMatches('Talent Acquisition at Razorpay', 'Razorpay Software Private Limited')).toBe(true);
    expect(companyMatches('Recruiter at Tata Consultancy Services', 'Tata Consultancy Services Ltd.')).toBe(true);
    expect(companyMatches('Recruiter at Google', 'Goo')).toBe(false);
    expect(companyMatches('Recruiter at Acme', 'Beta Labs')).toBe(false);
    expect(normalizeCompany('Acme Technologies Pvt. Ltd.')).toBe('acme');
    expect(companyOf('Senior Recruiter at Acme | MBA')).toBe('Acme');
  });
  it('treats an unknown or generic location as neutral', () => {
    expect(locationFits('Pune, Maharashtra, India', 'India')).toBe(true);
    expect(locationFits('London, UK', 'India')).toBe(false);
    expect(locationFits('', 'India')).toBeNull();
    expect(locationFits('London', 'Remote')).toBeNull();
  });
});

describe('search planning', () => {
  it('derives function words and synonyms from the target roles', () => {
    expect(functionWords(['Product Management internship'])).toEqual(expect.arrayContaining(['product', 'pm']));
    expect(functionWords(['Software Engineering internship'])).toEqual(expect.arrayContaining(['software', 'engineer', 'developer']));
    expect(functionWords(['Product Management internship'])).not.toContain('internship');
  });
  it('covers every role with every kind of person, with no pairing gaps (3 roles used to pair with 3 kinds only)', () => {
    const roles = ['Product Management internship', 'Data Analytics internship', 'Marketing internship'];
    const combos = searchCombos(roles, 'India');
    const seen = new Set(combos.map(c => `${c.role}|${c.kind}`));
    for (const role of roles) for (const kind of ['recruiter', 'campus', 'leader', 'founder']) expect(seen.has(`${role}|${kind}`)).toBe(true);
    const visited = new Set<string>();
    for (let cursor = 0; cursor < combos.length; cursor++) { const plan = planSearch(roles, 'India', cursor)!; visited.add(`${plan.combo.role}|${plan.combo.kind}`); expect(plan.page).toBe(1); }
    expect(visited.size).toBe(combos.length);
  });
  it('pages deeper only after every combination was tried, and stops instead of searching forever', () => {
    const n = searchCombos(['Product'], 'India').length;
    expect(planSearch(['Product'], 'India', n)!.page).toBe(2);
    expect(planSearch(['Product'], 'India', n * MAX_SEARCH_PAGES)).toBeNull();
  });
  it('uses boolean queries that name the kind of person and the function', () => {
    const [recruiter] = searchCombos(['Product Management internship'], 'India');
    expect(recruiter!.keywords).toContain('recruiter OR "talent acquisition"');
    expect(recruiter!.keywords).toContain('product');
    expect(recruiter!.keywords).toContain('India');
  });
});

describe('suggested target', () => {
  it('reads the function from the headline, and tags students as internships', () => {
    expect(suggestTarget('Product Manager at Acme')).toBe('Product Management');
    expect(suggestTarget('PGDM (Core) @ IMTG 26-28', 'Associate Consultant Oracle Backend Engineering')).toBe('Software Engineering internship');
    expect(suggestTarget('PGDM (Core) @ IMTG 26-28')).toBe('Summer internship');
  });
});

describe('notes and pacing rules', () => {
  const settings = { noteTemplate: defaultSettings.noteTemplate };
  it('fills the invitation template and never exceeds LinkedIn’s 200 characters', () => {
    const note = renderNote(settings, 'Product Management internship', { name: 'Priya Sharma', companyName: 'Acme' }, 'Arpit Singh');
    expect(note).toContain('Hi Priya'); expect(note).toContain('Arpit'); expect(note).toContain('at Acme'); expect(note.length).toBeLessThanOrEqual(200);
    expect(renderNote(settings, 'x'.repeat(400), { name: 'Priya', companyName: 'Acme' }, 'A').length).toBeLessThanOrEqual(200);
  });
  it('drops "at {company}" when the company is unknown instead of printing a hole', () => {
    const note = renderNote(settings, 'Product', { name: 'Priya Sharma' }, 'Arpit');
    expect(note).not.toMatch(/\{|\bat\s*\.|\bat$/);
  });
  it('shortens at a sentence or word boundary, never mid-word', () => {
    const cut = fitNote('First sentence is here. ' + 'word '.repeat(60));
    expect(cut.length).toBeLessThanOrEqual(200); expect(cut.endsWith('…') || cut.endsWith('.')).toBe(true);
  });
  it('only acts in the user’s local active hours, including overnight windows', () => {
    const at = (h: number) => new Date(2026, 10, 9, h).getTime();
    expect(withinActiveHours({ activeHours: { from: 8, to: 22 } }, at(11))).toBe(true);
    expect(withinActiveHours({ activeHours: { from: 8, to: 22 } }, at(3))).toBe(false);
    expect(withinActiveHours({ activeHours: { from: 22, to: 6 } }, at(23))).toBe(true);
    expect(withinActiveHours({ activeHours: null }, at(3))).toBe(true);
  });
});

describe('who goes next', () => {
  const person = (n: number, patch: Partial<NetworkContact> = {}): NetworkContact => ({ name: `P${n}`, url: `https://www.linkedin.com/in/p${n}/`, headline: 'Recruiter', location: 'India', about: '', state: 'shortlisted', reason: '', addedAt: n, checkedAt: 0, requestedAt: 0, messagedAt: 0, message: '', ...patch });
  const base = (contacts: NetworkContact[], actions: { at: number; kind: 'connect' | 'message'; url: string; confirmed?: boolean }[] = []) => ({ ...emptyNetwork(), active: true, contacts, actions });
  const now = 10 * DAY;
  it('picks the best-ranked shortlisted person, not just the oldest', () => {
    expect(nextContact(base([person(1, { score: 70 }), person(2, { score: 110 }), person(3, { score: 90 })]), now)?.name).toBe('P2');
  });
  it('stops drafting once five drafts wait for review, but still checks pending invitations', () => {
    const waiting = Array.from({ length: 5 }, (_, i) => person(10 + i, { state: 'review' }));
    expect(nextContact(base([...waiting, person(1)]), now)).toBeUndefined();
    const due = person(99, { state: 'pending', requestedAt: 1, nextCheckAt: 1 });
    expect(nextContact(base([...waiting, due]), now)?.name).toBe('P99');
  });
  it('enforces the weekly invitation limit as well as the daily one', () => {
    const sent = Array.from({ length: 80 }, (_, i) => ({ at: now - (1 + (i % 6)) * DAY, kind: 'connect' as const, url: `https://www.linkedin.com/in/s${i}/`, confirmed: true }));
    expect(nextContact(base([person(1)], sent), now)).toBeUndefined();
    expect(nextContact(base([person(1)], sent.slice(0, 10)), now)?.name).toBe('P1');
  });
  it('ships safe defaults that protect a public user’s LinkedIn account', () => {
    expect(defaultSettings).toMatchObject({ dailyInvites: 15, weeklyInvites: 80, maxPending: 100, aiMode: 'template', outreachMode: 'review', followupMode: 'review', activeHours: { from: 8, to: 22 } });
    expect(defaultSettings.paceMinutes).toBe(0.5); // 30 seconds, varied 22 to 43 s; the daily and weekly caps are what bound volume
  });
});

describe('message variants', () => {
  const variants = 'Hi {firstName}, version one for {target}.\n---\nHello {firstName}, version two about {target}.\n---\n{firstName}, version three on {target}.';
  it('gives different people different versions, and the same person the same one every time', async () => {
    const { renderNote, pickVariant } = await import('../src/shared/network');
    const names = ['Priya Sharma', 'Rahul Verma', 'Ananya Iyer', 'Karan Mehta', 'Sneha Rao', 'Vikram Shah'];
    const notes = names.map(n => renderNote({ noteTemplate: variants }, 'product', { name: n }, 'Arpit'));
    expect(new Set(notes.map(n => n.match(/version \w+/)![0])).size).toBeGreaterThan(1);
    expect(pickVariant(variants, 'Priya Sharma')).toBe(pickVariant(variants, 'Priya Sharma'));
    notes.forEach(n => expect(n).not.toContain('---'));
  });
});

describe('the closing line of the first note fits who is being contacted', () => {
  const settings = { noteTemplate: defaultNoteTemplate };
  it('asks a recruiter about openings, never about "their work"', () => {
    const note = renderNote(settings, 'Product Management internship', { name: 'Akash Ganguly', companyName: 'TCS', category: 'recruiter' }, 'Arpit Singh');
    expect(note).toBe('Hi Akash, I’m Arpit, exploring Product Management internship opportunities. Would love to connect in case there are relevant openings at TCS.');
    expect(renderNote(settings, 'Product Management internship', { name: 'Aashish G', category: 'recruiter' }, 'Arpit Singh')).toMatch(/in case you’re hiring for relevant roles\.$/);
  });
  it('asks a team leader about their team and a founder about what they are building', () => {
    expect(renderNote(settings, 'Product Management', { name: 'Riya S', companyName: 'Acme', category: 'leader' }, 'Arpit')).toMatch(/learn about your team’s work at Acme\.$/);
    expect(renderNote(settings, 'Product Management', { name: 'Dev K', companyName: 'Acme', category: 'founder' }, 'Arpit')).toMatch(/learn about what you’re building at Acme\.$/);
  });
  it('stays within LinkedIn’s 200 characters for a long company name', () => {
    expect(renderNote(settings, 'Product Management internship', { name: 'Sreekanth R.', companyName: 'Tenarai India Private Limited Technologies', category: 'recruiter' }, 'Arpit').length).toBeLessThanOrEqual(200);
  });
});
