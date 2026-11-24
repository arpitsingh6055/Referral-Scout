import { describe, expect, it } from 'vitest';
import {
  datesIn,
  gradeIn,
  normaliseDate,
  parseCv,
  parseEducation,
  parseEmployment,
  parseIdentity,
  parseSkills,
  sections,
  summarise,
} from '../src/shared/domain/cv';

const CV = `
Arpit Singh
arpit.singh@example.com | +91 99999 00000 | linkedin.com/in/arpitsingh

EDUCATION
PGDM, Institute of Management Technology, Ghaziabad | Jun 2026 – Apr 2028
Marketing and Strategy | CGPA: 8.4/10
B.Com, Delhi University | 2022 – 2025
Percentage: 78%
12th, CBSE Board | 2022 | 91%

WORK EXPERIENCE
Product Intern, TBX Technologies Pvt Ltd | Apr 2026 – Present
Gurugram
• Grew activation 12% by reworking the onboarding flow
• Ran weekly research calls with merchants
Business Analyst Intern, Acme Labs | Jun 2025 - Aug 2025
• Built dashboards for the operations team

PROJECTS
Campus placement tracker
• Built a tracker used by 300 students across two campuses

SKILLS
Tools: SQL, Figma, Mixpanel
Product analytics, User research, Stakeholder communication

INTERESTS
Cricket, cooking
`;

describe('sectioning', () => {
  it('splits the document by its own headings', () => {
    const found = sections(CV);
    expect([...found.keys()]).toEqual(expect.arrayContaining(['header', 'education', 'employment', 'projects', 'skills']));
  });

  it('does not treat a sentence mentioning experience as a heading', () => {
    const found = sections(
      'EDUCATION\nB.Com, Delhi University | 2022 - 2025\nI have experience building dashboards for operations teams every week.',
    );
    expect(found.get('education')!.length).toBe(2);
  });

  it('skips sections that are not profile records', () => {
    expect(sections(CV).has('skip')).toBe(true);
  });
});

describe('dates', () => {
  it('normalises the ways a CV writes a date', () => {
    expect(normaliseDate('Jun 2026')).toBe('2026-06');
    expect(normaliseDate('06/2026')).toBe('2026-06');
    expect(normaliseDate('2026')).toBe('2026');
    expect(normaliseDate('Present')).toBeUndefined();
  });

  it('reads a range and knows when it is still running', () => {
    expect(datesIn('Product Intern | Apr 2026 – Present')).toEqual({ startDate: '2026-04', current: true });
    expect(datesIn('Jun 2025 - Aug 2025')).toEqual({ startDate: '2025-06', endDate: '2025-08' });
  });

  it('takes a lone year as an end date rather than inventing a range', () => {
    expect(datesIn('12th, CBSE Board | 2022')).toEqual({ endDate: '2022' });
  });
});

describe('grades', () => {
  it('keeps the scale beside the number', () => {
    expect(gradeIn('CGPA: 8.4/10')).toEqual({ grade: '8.4', gradeScale: 'out of 10' });
    expect(gradeIn('Percentage: 78%')).toEqual({ grade: '78', gradeScale: 'percent' });
  });

  it('never leaves a grade without a scale, since a form will ask which it is', () => {
    const g = gradeIn('CGPA 9.1');
    expect(g.grade).toBe('9.1');
    expect(g.gradeScale).toBeTruthy();
  });
});

describe('education', () => {
  const records = parseEducation(sections(CV).get('education')!);

  it('finds each qualification separately', () => {
    expect(records.length).toBeGreaterThanOrEqual(3);
    expect(records.map(r => r.qualification)).toEqual(expect.arrayContaining(['PGDM', 'BCOM']));
  });

  it('classifies the level so school and degree are not confused', () => {
    expect(records.find(r => r.qualification === 'PGDM')!.level).toBe('masters');
    expect(records.find(r => r.level === '12th')).toBeTruthy();
  });

  it('keeps the institution and the dates with the right record', () => {
    const pgdm = records.find(r => r.qualification === 'PGDM')!;
    expect(pgdm.institution).toContain('Institute of Management Technology');
    expect(pgdm.endDate).toBe('2028-04');
  });

  it('marks everything it read as unverified', () => {
    for (const r of records) {
      expect(r.provenance.source).toBe('cv');
      expect(r.provenance.verifiedAt).toBeUndefined();
    }
  });

  it('keeps the line it read each record from, so it can be checked', () => {
    expect(records[0]!.provenance.sourceSpan).toContain('PGDM');
  });
});

describe('employment', () => {
  const records = parseEmployment(sections(CV).get('employment')!);

  it('finds each role', () => {
    expect(records).toHaveLength(2);
    expect(records[0]!.employer).toContain('TBX');
  });

  it('knows which role is current', () => {
    expect(records[0]!.current).toBe(true);
    expect(records[1]!.current).toBeUndefined();
  });

  it('separates a quantified achievement from a plain responsibility', () => {
    expect(records[0]!.achievements.join(' ')).toContain('12%');
    expect(records[0]!.responsibilities.join(' ')).toContain('research calls');
  });

  it('does not turn a bullet into a separate role', () => {
    expect(records.every(r => !r.title.startsWith('•'))).toBe(true);
  });
});

describe('skills', () => {
  const skills = parseSkills(sections(CV).get('skills')!);

  it('reads both labelled and plain skill lines', () => {
    const names = skills.map(s => s.skill);
    expect(names).toEqual(expect.arrayContaining(['SQL', 'Figma', 'Product analytics', 'User research']));
  });

  it('drops the label itself rather than saving "Tools" as a skill', () => {
    expect(skills.map(s => s.skill)).not.toContain('Tools');
  });

  it('does not save a sentence as a skill', () => {
    const noisy = parseSkills(['I am comfortable working with large cross functional teams across time zones']);
    expect(noisy).toHaveLength(0);
  });

  it('saves each skill once', () => {
    const repeated = parseSkills(['SQL, sql, SQL']);
    expect(repeated).toHaveLength(1);
  });
});

describe('identity', () => {
  it('reads contact details from the top of the document', () => {
    const identity = parseIdentity(CV);
    expect(identity.email).toBe('arpit.singh@example.com');
    expect(identity.phone).toBeTruthy();
    expect(identity.links.join(' ')).toContain('linkedin.com/in/arpitsingh');
  });

  it('does not mistake part of an email for a phone number', () => {
    const identity = parseIdentity('someone@example.com');
    expect(identity.phone).toBeUndefined();
  });
});

describe('the whole document', () => {
  it('reads every section and reports what it found', () => {
    const summary = summarise(parseCv(CV));
    expect(summary.education).toBeGreaterThanOrEqual(3);
    expect(summary.employment).toBe(2);
    expect(summary.projects).toBe(1);
    expect(summary.skills).toBeGreaterThanOrEqual(5);
    expect(summary.warnings).toHaveLength(0);
  });

  it('says what it could not find instead of returning a confident empty profile', () => {
    const summary = summarise(parseCv('Arpit Singh\nSome prose with no headings at all.'));
    expect(summary.warnings.join(' ')).toContain('education');
    expect(summary.warnings.join(' ')).toContain('skills');
  });
});
